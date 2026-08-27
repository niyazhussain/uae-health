import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { DatabaseService } from '../database/database.service.js';
import type { DatabaseSchema } from '../database/database.types.js';
import { WORKFORCE_IDENTITY_PROVIDER } from '../identity-provider/identity-provider.constants.js';
import type { WorkforceIdentityProviderPort } from '../identity-provider/identity-provider.types.js';
import { PatientPortalProfileLinkService } from './patient-portal-profile-link.service.js';
import type { PatientPortalSessionContext } from './patient-portal-auth.types.js';
import {
  patientPortalInvitationAuditReason,
  type PatientPortalInvitationReasonCode,
} from './patient-portal-invitation-reasons.js';

type DatabaseExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

interface InvitationAuthorizationRow {
  actor_user_id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_is_synthetic: boolean;
  organization_id: string;
  organization_name: string;
}

interface InvitationRow {
  id: string;
  tenant_id: string;
  organization_id: string;
  organization_name: string;
  tenant_is_synthetic: boolean;
  issued_by_user_id: string;
  status: 'issued' | 'accepted' | 'revoked' | 'expired';
  expires_at: Date;
  accepted_patient_portal_identity_id: string | null;
  accepted_patient_portal_profile_id: string | null;
}

export interface PatientPortalInvitationContext {
  tenantId: string;
  tenantName: string;
  organizationId: string;
  organizationName: string;
}

export interface IssuedPatientPortalInvitation {
  invitationId: string;
  expiresAt: Date;
}

export interface AcceptedPatientPortalInvitation {
  portalProfileId: string;
  practiceName: string;
}

type InvitationAcceptanceResult =
  | { kind: 'accepted'; value: AcceptedPatientPortalInvitation }
  | { kind: 'unavailable' };

export class PatientPortalInvitationUnavailableError extends Error {
  constructor() {
    super('The patient portal invitation is unavailable.');
  }
}

export class PatientPortalInvitationAuthorizationLostError extends Error {
  constructor() {
    super('Patient portal invitation authority is no longer active.');
  }
}

@Injectable()
export class PatientPortalInvitationRepository {
  private readonly workforceIssuer: string;

  constructor(
    private readonly database: DatabaseService,
    private readonly profileLinks: PatientPortalProfileLinkService,
    @Inject(WORKFORCE_IDENTITY_PROVIDER)
    workforceIdentityProvider: WorkforceIdentityProviderPort,
  ) {
    this.workforceIssuer = workforceIdentityProvider.issuer;
  }

  async listContexts(
    subject: string,
  ): Promise<PatientPortalInvitationContext[]> {
    const result = await sql<InvitationAuthorizationRow>`
      with resolved_actor as (
        select distinct identity.application_user_id
        from user_identities identity
        join identity_connections connection
          on connection.id = identity.identity_connection_id
        join application_users actor
          on actor.id = identity.application_user_id
        where identity.subject = ${subject}
          and identity.status = 'active'
          and connection.issuer = ${this.workforceIssuer}
          and connection.status = 'active'
          and actor.status = 'active'
      )
      select distinct
        actor.application_user_id as actor_user_id,
        tenant.id as tenant_id,
        tenant.name as tenant_name,
        tenant.is_synthetic as tenant_is_synthetic,
        organization.id as organization_id,
        organization.name as organization_name
      from resolved_actor actor
      join organization_memberships membership
        on membership.application_user_id = actor.application_user_id
      join role_assignments assignment
        on assignment.membership_id = membership.id
       and assignment.tenant_id = membership.tenant_id
      join roles role
        on role.id = assignment.role_id
      join role_permissions role_permission
        on role_permission.role_id = role.id
      join permissions permission
        on permission.id = role_permission.permission_id
      join tenants tenant
        on tenant.id = membership.tenant_id
       and tenant.status = 'active'
      join organizations organization
        on organization.id = membership.organization_id
       and organization.tenant_id = membership.tenant_id
      where (select count(*) from resolved_actor) = 1
        and membership.status = 'active'
        and membership.valid_from <= now()
        and (membership.valid_until is null or membership.valid_until > now())
        and assignment.scope_organization_id = membership.organization_id
        and assignment.facility_id is null
        and assignment.include_descendants = false
        and assignment.revoked_at is null
        and assignment.valid_from <= now()
        and (assignment.valid_until is null or assignment.valid_until > now())
        and role.status = 'active'
        and (role.tenant_id is null or role.tenant_id = membership.tenant_id)
        and permission.code = 'patients.portal.invite'
      order by organization.name, organization.id
    `.execute(this.database.client);

    return result.rows.map((row) => ({
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
    }));
  }

  async issue(
    subject: string,
    organizationId: string,
    reasonCode: PatientPortalInvitationReasonCode,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<IssuedPatientPortalInvitation> {
    return this.database.client
      .transaction()
      .setIsolationLevel('serializable')
      .execute(async (trx) => {
        const authorization = await this.findExactPracticeAuthorization(
          trx,
          subject,
          organizationId,
        );

        if (!authorization) {
          throw new PatientPortalInvitationAuthorizationLostError();
        }

        const invitation = await trx
          .insertInto('patient_portal_invitations')
          .values({
            tenant_id: authorization.tenantId,
            organization_id: authorization.organizationId,
            issued_by_user_id: authorization.actorUserId,
            token_hash: tokenHash,
            status: 'issued',
            reason: reasonCode,
            expires_at: expiresAt,
            accepted_patient_portal_identity_id: null,
            accepted_patient_portal_profile_id: null,
            accepted_at: null,
            revoked_at: null,
            revoked_by_user_id: null,
            revocation_reason: null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        await trx
          .insertInto('audit_events')
          .values({
            actor_type: 'user',
            actor_identifier: subject,
            actor_user_id: authorization.actorUserId,
            effective_user_id: authorization.actorUserId,
            tenant_id: authorization.tenantId,
            organization_id: authorization.organizationId,
            facility_id: null,
            action: 'identity.patient_portal_invitation_issued',
            target_entity_type: 'patient_portal_invitation',
            target_entity_id: invitation.id,
            outcome: 'success',
            correlation_id: randomUUID(),
            reason: patientPortalInvitationAuditReason(reasonCode),
            before_data: null,
            after_data: {
              expiresAt: expiresAt.toISOString(),
              reasonCode,
            },
          })
          .execute();

        return { invitationId: invitation.id, expiresAt };
      });
  }

  async accept(
    session: PatientPortalSessionContext,
    tokenHash: string,
  ): Promise<AcceptedPatientPortalInvitation> {
    const now = new Date();
    const correlationId = randomUUID();

    const result = await this.database.client
      .transaction()
      .setIsolationLevel('serializable')
      .execute<InvitationAcceptanceResult>(async (trx) => {
        const invitation = await trx
          .selectFrom('patient_portal_invitations as invitation')
          .innerJoin('tenants as tenant', 'tenant.id', 'invitation.tenant_id')
          .innerJoin('organizations as organization', (join) =>
            join
              .onRef('organization.id', '=', 'invitation.organization_id')
              .onRef('organization.tenant_id', '=', 'invitation.tenant_id'),
          )
          .select([
            'invitation.id',
            'invitation.tenant_id',
            'invitation.organization_id',
            'organization.name as organization_name',
            'tenant.is_synthetic as tenant_is_synthetic',
            'invitation.issued_by_user_id',
            'invitation.status',
            'invitation.expires_at',
            'invitation.accepted_patient_portal_identity_id',
            'invitation.accepted_patient_portal_profile_id',
          ])
          .where('invitation.token_hash', '=', tokenHash)
          .forUpdate()
          .executeTakeFirst();

        if (!invitation) return { kind: 'unavailable' };

        const typedInvitation = invitation;

        if (typedInvitation.status === 'accepted') {
          return {
            kind: 'accepted',
            value: await this.acceptedReplay(trx, typedInvitation, session),
          };
        }

        if (
          typedInvitation.status !== 'issued' ||
          typedInvitation.expires_at.getTime() <= now.getTime()
        ) {
          if (typedInvitation.status === 'issued') {
            await trx
              .updateTable('patient_portal_invitations')
              .set({ status: 'expired', updated_at: now })
              .where('id', '=', typedInvitation.id)
              .where('status', '=', 'issued')
              .execute();
          }
          // Return rather than throw so an issued-but-expired invitation is
          // durably marked expired before the generic public response.
          return { kind: 'unavailable' };
        }

        const identity = await trx
          .selectFrom('patient_portal_identities as identity')
          .innerJoin(
            'application_users as application_user',
            'application_user.id',
            'identity.application_user_id',
          )
          .select([
            'identity.id',
            'identity.application_user_id',
            'identity.subject',
          ])
          .where('identity.id', '=', session.patientPortalIdentityId)
          .where('identity.issuer', '=', session.principal.issuer)
          .where('identity.subject', '=', session.principal.subject)
          .where('identity.client_id', '=', session.principal.clientId)
          .where('identity.status', '=', 'active')
          .where('application_user.id', '=', session.applicationUserId)
          .where('application_user.status', '=', 'active')
          .forUpdate()
          .executeTakeFirst();

        if (!identity) throw new PatientPortalInvitationUnavailableError();

        const profile = await this.resolveOrCreateProfile(
          trx,
          typedInvitation,
          identity.application_user_id,
        );
        let link;

        try {
          link = await this.profileLinks.createApprovedLinkInTransaction(trx, {
            patientPortalProfileId: profile.id,
            patientPortalIdentityId: identity.id,
            actorUserId: identity.application_user_id,
            actorIdentifier: identity.subject,
            reason: 'Patient accepted a practice-issued portal invitation.',
            correlationId,
          });
        } catch (error) {
          if (
            error instanceof ConflictException ||
            error instanceof NotFoundException ||
            error instanceof PatientPortalInvitationUnavailableError
          ) {
            throw new PatientPortalInvitationUnavailableError();
          }
          throw error;
        }

        await trx
          .updateTable('patient_portal_invitations')
          .set({
            status: 'accepted',
            accepted_patient_portal_identity_id: identity.id,
            accepted_patient_portal_profile_id: profile.id,
            accepted_at: now,
            updated_at: now,
          })
          .where('id', '=', typedInvitation.id)
          .where('status', '=', 'issued')
          .executeTakeFirstOrThrow();

        await trx
          .insertInto('audit_events')
          .values({
            actor_type: 'user',
            actor_identifier: identity.subject,
            actor_user_id: identity.application_user_id,
            effective_user_id: identity.application_user_id,
            tenant_id: typedInvitation.tenant_id,
            organization_id: typedInvitation.organization_id,
            facility_id: null,
            action: 'identity.patient_portal_invitation_accepted',
            target_entity_type: 'patient_portal_invitation',
            target_entity_id: typedInvitation.id,
            outcome: 'success',
            correlation_id: correlationId,
            reason: 'Patient accepted a practice-issued portal invitation.',
            before_data: { status: 'issued' },
            after_data: {
              status: 'accepted',
              profileId: profile.id,
              linkCreated: link.created,
            },
          })
          .execute();

        return {
          kind: 'accepted',
          value: {
            portalProfileId: profile.id,
            practiceName: typedInvitation.organization_name,
          },
        };
      });

    if (result.kind === 'unavailable') {
      throw new PatientPortalInvitationUnavailableError();
    }

    return result.value;
  }

  private async acceptedReplay(
    trx: Transaction<DatabaseSchema>,
    invitation: InvitationRow,
    session: PatientPortalSessionContext,
  ): Promise<AcceptedPatientPortalInvitation> {
    if (
      invitation.accepted_patient_portal_identity_id !==
        session.patientPortalIdentityId ||
      !invitation.accepted_patient_portal_profile_id
    ) {
      throw new PatientPortalInvitationUnavailableError();
    }

    const profile = await trx
      .selectFrom('patient_portal_profiles as profile')
      .innerJoin(
        'patient_portal_profile_links as link',
        'link.patient_portal_profile_id',
        'profile.id',
      )
      .select('profile.id')
      .where('profile.id', '=', invitation.accepted_patient_portal_profile_id)
      .where('profile.tenant_id', '=', invitation.tenant_id)
      .where('profile.organization_id', '=', invitation.organization_id)
      .where('profile.application_user_id', '=', session.applicationUserId)
      .where('profile.status', '=', 'active')
      .where(
        'link.patient_portal_identity_id',
        '=',
        session.patientPortalIdentityId,
      )
      .where('link.status', '=', 'active')
      .executeTakeFirst();

    if (!profile) throw new PatientPortalInvitationUnavailableError();

    return {
      portalProfileId: profile.id,
      practiceName: invitation.organization_name,
    };
  }

  private async resolveOrCreateProfile(
    trx: Transaction<DatabaseSchema>,
    invitation: InvitationRow,
    applicationUserId: string,
  ): Promise<{ id: string }> {
    // Different invitation tokens can be accepted concurrently for the same
    // patient and practice. A transaction-scoped advisory lock makes the
    // profile's database uniqueness rule deterministic, so the second
    // acceptance reuses the profile/link instead of surfacing a unique error.
    await sql`
      select pg_advisory_xact_lock(
        hashtextextended(
          ${`${invitation.tenant_id}:${invitation.organization_id}:${applicationUserId}`},
          0
        )
      )
    `.execute(trx);

    const existing = await trx
      .selectFrom('patient_portal_profiles')
      .select(['id', 'status'])
      .where('tenant_id', '=', invitation.tenant_id)
      .where('organization_id', '=', invitation.organization_id)
      .where('application_user_id', '=', applicationUserId)
      .forUpdate()
      .executeTakeFirst();

    if (existing) {
      if (existing.status !== 'active') {
        throw new PatientPortalInvitationUnavailableError();
      }
      return { id: existing.id };
    }

    return trx
      .insertInto('patient_portal_profiles')
      .values({
        tenant_id: invitation.tenant_id,
        organization_id: invitation.organization_id,
        application_user_id: applicationUserId,
        status: 'active',
        is_synthetic: invitation.tenant_is_synthetic,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
  }

  private async findExactPracticeAuthorization(
    database: DatabaseExecutor,
    subject: string,
    organizationId: string,
  ): Promise<{
    actorUserId: string;
    tenantId: string;
    tenantName: string;
    tenantIsSynthetic: boolean;
    organizationId: string;
    organizationName: string;
  } | null> {
    const result = await sql<InvitationAuthorizationRow>`
      with resolved_actor as (
        select distinct identity.application_user_id
        from user_identities identity
        join identity_connections connection
          on connection.id = identity.identity_connection_id
        join application_users actor
          on actor.id = identity.application_user_id
        where identity.subject = ${subject}
          and identity.status = 'active'
          and connection.issuer = ${this.workforceIssuer}
          and connection.status = 'active'
          and actor.status = 'active'
      )
      select distinct
        actor.application_user_id as actor_user_id,
        tenant.id as tenant_id,
        tenant.name as tenant_name,
        tenant.is_synthetic as tenant_is_synthetic,
        organization.id as organization_id,
        organization.name as organization_name
      from resolved_actor actor
      join organization_memberships membership
        on membership.application_user_id = actor.application_user_id
      join role_assignments assignment
        on assignment.membership_id = membership.id
       and assignment.tenant_id = membership.tenant_id
      join roles role
        on role.id = assignment.role_id
      join role_permissions role_permission
        on role_permission.role_id = role.id
      join permissions permission
        on permission.id = role_permission.permission_id
      join tenants tenant
        on tenant.id = membership.tenant_id
       and tenant.status = 'active'
      join organizations organization
        on organization.id = membership.organization_id
       and organization.tenant_id = membership.tenant_id
      where (select count(*) from resolved_actor) = 1
        and membership.organization_id = ${organizationId}
        and membership.status = 'active'
        and membership.valid_from <= now()
        and (membership.valid_until is null or membership.valid_until > now())
        and assignment.scope_organization_id = ${organizationId}
        and assignment.facility_id is null
        and assignment.include_descendants = false
        and assignment.revoked_at is null
        and assignment.valid_from <= now()
        and (assignment.valid_until is null or assignment.valid_until > now())
        and role.status = 'active'
        and (role.tenant_id is null or role.tenant_id = membership.tenant_id)
        and permission.code = 'patients.portal.invite'
    `.execute(database);

    if (result.rows.length !== 1) return null;

    const row = result.rows[0];
    return {
      actorUserId: row.actor_user_id,
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      tenantIsSynthetic: row.tenant_is_synthetic,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
    };
  }
}
