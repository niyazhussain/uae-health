import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { DatabaseService } from '../database/database.service.js';
import type { DatabaseSchema } from '../database/database.types.js';
import type {
  PersistWorkforceInvitationInput,
  WorkforceDirectoryContext,
  WorkforceDirectoryMember,
  WorkforceDirectoryRepositoryPort,
  WorkforceInvitationAuthorization,
  WorkforceInvitationResponse,
} from './workforce-directory.types.js';
import {
  WorkforceIdentityConflictError,
  WorkforceInvitationAuthorizationLostError,
  WorkforceMembershipConflictError,
} from './workforce-directory.types.js';

interface ContextRow {
  tenant_id: string;
  tenant_name: string;
  organization_id: string;
  organization_name: string;
}

interface MemberRow {
  application_user_id: string;
  display_name: string;
  primary_email: string | null;
  membership_status: WorkforceDirectoryMember['membershipStatus'];
  identity_status: WorkforceDirectoryMember['identityStatus'];
  cognito_subject: string | null;
  is_synthetic: boolean;
}

interface InvitationAuthorizationRow {
  actor_user_id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_is_synthetic: boolean;
  organization_id: string;
  organization_name: string;
}

type DatabaseExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  return (error as { code?: unknown }).code === '23505';
}

@Injectable()
export class WorkforceDirectoryRepository implements WorkforceDirectoryRepositoryPort {
  private readonly cognitoIssuer: string;

  constructor(
    private readonly database: DatabaseService,
    config: ConfigService,
  ) {
    const region = config.getOrThrow<string>('COGNITO_REGION');
    const userPoolId = config.getOrThrow<string>('COGNITO_USER_POOL_ID');
    this.cognitoIssuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
  }

  async listManageableContexts(
    cognitoSubject: string,
  ): Promise<WorkforceDirectoryContext[]> {
    const result = await sql<ContextRow>`
      with recursive resolved_actors as (
        select distinct identity.application_user_id
        from user_identities identity
        join identity_connections connection
          on connection.id = identity.identity_connection_id
        join application_users actor
          on actor.id = identity.application_user_id
        where identity.subject = ${cognitoSubject}
          and identity.status = 'active'
          and connection.issuer = ${this.cognitoIssuer}
          and connection.status = 'active'
          and actor.status = 'active'
      ),
      authorized_organizations as (
        select
          assignment.tenant_id,
          assignment.scope_organization_id as organization_id,
          assignment.include_descendants
        from resolved_actors actor
        join organization_memberships membership
          on membership.application_user_id = actor.application_user_id
        join role_assignments assignment
          on assignment.membership_id = membership.id
         and assignment.tenant_id = membership.tenant_id
        join roles role
          on role.id = assignment.role_id
        join role_permissions role_permission
          on role_permission.role_id = assignment.role_id
        join permissions permission
          on permission.id = role_permission.permission_id
        where membership.status = 'active'
          and membership.valid_from <= now()
          and (membership.valid_until is null or membership.valid_until > now())
          and (select count(*) from resolved_actors) = 1
          and role.status = 'active'
          and (role.tenant_id is null or role.tenant_id = assignment.tenant_id)
          and assignment.revoked_at is null
          and assignment.valid_from <= now()
          and (assignment.valid_until is null or assignment.valid_until > now())
          and permission.code = 'tenant.memberships.manage'

        union

        select
          authorized.tenant_id,
          child.id,
          true
        from authorized_organizations authorized
        join organizations child
          on child.tenant_id = authorized.tenant_id
         and child.parent_organization_id = authorized.organization_id
        where authorized.include_descendants
      )
      select distinct
        tenant.id as tenant_id,
        tenant.name as tenant_name,
        organization.id as organization_id,
        organization.name as organization_name
      from authorized_organizations authorized
      join tenants tenant
        on tenant.id = authorized.tenant_id
       and tenant.status = 'active'
      join organizations organization
        on organization.id = authorized.organization_id
       and organization.tenant_id = authorized.tenant_id
      order by tenant.name, organization.name
    `.execute(this.database.client);

    return result.rows.map((row) => ({
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
    }));
  }

  async listMembers(
    tenantId: string,
    organizationId: string,
  ): Promise<WorkforceDirectoryMember[]> {
    const result = await sql<MemberRow>`
      select
        application_user.id as application_user_id,
        application_user.display_name,
        application_user.primary_email,
        membership.status as membership_status,
        identity.status as identity_status,
        identity.subject as cognito_subject,
        application_user.is_synthetic
      from organization_memberships membership
      join application_users application_user
        on application_user.id = membership.application_user_id
      left join identity_connections connection
        on connection.tenant_id = membership.tenant_id
       and connection.issuer = ${this.cognitoIssuer}
      left join user_identities identity
        on identity.application_user_id = application_user.id
       and identity.identity_connection_id = connection.id
      where membership.tenant_id = ${tenantId}
        and membership.organization_id = ${organizationId}
      order by application_user.display_name, application_user.id
    `.execute(this.database.client);

    return result.rows.map((row) => ({
      applicationUserId: row.application_user_id,
      displayName: row.display_name,
      email: row.primary_email,
      membershipStatus: row.membership_status,
      identityStatus: row.identity_status,
      cognitoSubject: row.cognito_subject,
      isSynthetic: row.is_synthetic,
    }));
  }

  authorizeInvitation(
    cognitoSubject: string,
    organizationId: string,
  ): Promise<WorkforceInvitationAuthorization | null> {
    return this.findInvitationAuthorization(
      this.database.client,
      cognitoSubject,
      organizationId,
    );
  }

  async isCognitoSubjectBound(cognitoSubject: string): Promise<boolean> {
    const binding = await this.database.client
      .selectFrom('user_identities as identity')
      .innerJoin(
        'identity_connections as connection',
        'connection.id',
        'identity.identity_connection_id',
      )
      .select('identity.id')
      .where('connection.issuer', '=', this.cognitoIssuer)
      .where('identity.subject', '=', cognitoSubject)
      .executeTakeFirst();

    return binding !== undefined;
  }

  async persistInvitation(
    input: PersistWorkforceInvitationInput,
  ): Promise<WorkforceInvitationResponse> {
    try {
      return await this.database.client
        .transaction()
        .setIsolationLevel('serializable')
        .execute(async (trx) => {
          const currentAuthorization = await this.findInvitationAuthorization(
            trx,
            input.actorCognitoSubject,
            input.authorization.organizationId,
          );

          if (
            !currentAuthorization ||
            currentAuthorization.actorUserId !==
              input.authorization.actorUserId ||
            currentAuthorization.tenantId !== input.authorization.tenantId
          ) {
            throw new WorkforceInvitationAuthorizationLostError();
          }

          const targetConnections = await trx
            .selectFrom('identity_connections')
            .select('id')
            .where('tenant_id', '=', currentAuthorization.tenantId)
            .where('issuer', '=', this.cognitoIssuer)
            .where('protocol', '=', 'cognito')
            .where('status', '=', 'active')
            .execute();

          if (targetConnections.length !== 1) {
            throw new Error(
              'The tenant must have exactly one active Cognito identity connection for this issuer.',
            );
          }

          const existingIdentities = await trx
            .selectFrom('user_identities as identity')
            .innerJoin(
              'identity_connections as connection',
              'connection.id',
              'identity.identity_connection_id',
            )
            .innerJoin(
              'application_users as application_user',
              'application_user.id',
              'identity.application_user_id',
            )
            .select([
              'identity.application_user_id as application_user_id',
              'application_user.status as application_user_status',
              'identity.status as identity_status',
            ])
            .where('connection.issuer', '=', this.cognitoIssuer)
            .where('identity.subject', '=', input.account.subject)
            .execute();
          const existingApplicationUserIds = new Set(
            existingIdentities.map((identity) => identity.application_user_id),
          );

          if (existingApplicationUserIds.size > 1) {
            throw new Error(
              'The Cognito subject resolves to multiple application users.',
            );
          }

          if (
            existingIdentities.some(
              (identity) =>
                identity.identity_status !== 'active' ||
                identity.application_user_status !== 'active',
            )
          ) {
            throw new WorkforceIdentityConflictError(
              'The existing workforce identity is suspended or closed.',
            );
          }

          let applicationUserId = [...existingApplicationUserIds][0];

          if (!applicationUserId) {
            const applicationUser = await trx
              .insertInto('application_users')
              .values({
                display_name: input.displayName,
                primary_email: input.email,
                status: 'active',
                is_synthetic: currentAuthorization.tenantIsSynthetic,
              })
              .returning('id')
              .executeTakeFirstOrThrow();
            applicationUserId = applicationUser.id;
          }

          const targetConnectionId = targetConnections[0].id;
          const targetBinding = await trx
            .selectFrom('user_identities')
            .select(['id', 'subject', 'status'])
            .where('application_user_id', '=', applicationUserId)
            .where('identity_connection_id', '=', targetConnectionId)
            .executeTakeFirst();

          if (
            targetBinding &&
            (targetBinding.subject !== input.account.subject ||
              targetBinding.status !== 'active')
          ) {
            throw new WorkforceIdentityConflictError(
              'The application user already has a different or suspended identity for this tenant.',
            );
          }

          if (!targetBinding) {
            await trx
              .insertInto('user_identities')
              .values({
                application_user_id: applicationUserId,
                identity_connection_id: targetConnectionId,
                subject: input.account.subject,
                status: 'active',
                last_authenticated_at: null,
              })
              .execute();
          }

          const existingMembership = await trx
            .selectFrom('organization_memberships')
            .select(['id', 'status'])
            .where('application_user_id', '=', applicationUserId)
            .where('organization_id', '=', currentAuthorization.organizationId)
            .executeTakeFirst();

          if (existingMembership) {
            throw new WorkforceMembershipConflictError(
              `This user already has ${existingMembership.status} membership in the practice.`,
            );
          }

          const membership = await trx
            .insertInto('organization_memberships')
            .values({
              tenant_id: currentAuthorization.tenantId,
              organization_id: currentAuthorization.organizationId,
              application_user_id: applicationUserId,
              status: 'active',
              provisioning_method: 'admin_invite',
              external_id: null,
              valid_until: null,
            })
            .returning('id')
            .executeTakeFirstOrThrow();

          await trx
            .insertInto('audit_events')
            .values({
              actor_type: 'user',
              actor_identifier: input.actorCognitoSubject,
              actor_user_id: currentAuthorization.actorUserId,
              effective_user_id: currentAuthorization.actorUserId,
              tenant_id: currentAuthorization.tenantId,
              organization_id: currentAuthorization.organizationId,
              facility_id: null,
              action: 'identity.workforce_invited',
              target_entity_type: 'organization_membership',
              target_entity_id: membership.id,
              outcome: 'success',
              correlation_id: randomUUID(),
              reason: input.reason,
              before_data: null,
              after_data: {
                membershipStatus: 'active',
                cognitoAccountCreated: input.account.created,
                roleAssigned: false,
              },
            })
            .execute();

          return {
            applicationUserId,
            membershipId: membership.id,
            organizationId: currentAuthorization.organizationId,
            email: input.email,
            membershipStatus: 'active',
            accountCreated: input.account.created,
            delivery: input.account.created ? 'email' : 'existing-account',
          };
        });
    } catch (error) {
      if (
        error instanceof WorkforceMembershipConflictError ||
        error instanceof WorkforceInvitationAuthorizationLostError ||
        error instanceof WorkforceIdentityConflictError
      ) {
        throw error;
      }

      if (isUniqueViolation(error)) {
        throw new WorkforceMembershipConflictError(
          'The workforce account or practice membership was created by another request.',
        );
      }

      throw error;
    }
  }

  private async findInvitationAuthorization(
    executor: DatabaseExecutor,
    cognitoSubject: string,
    organizationId: string,
  ): Promise<WorkforceInvitationAuthorization | null> {
    const result = await sql<InvitationAuthorizationRow>`
      with recursive resolved_actors as (
        select distinct identity.application_user_id
        from user_identities identity
        join identity_connections connection
          on connection.id = identity.identity_connection_id
        join application_users actor
          on actor.id = identity.application_user_id
        where identity.subject = ${cognitoSubject}
          and identity.status = 'active'
          and connection.issuer = ${this.cognitoIssuer}
          and connection.status = 'active'
          and actor.status = 'active'
      ),
      authorized_organizations as (
        select
          assignment.tenant_id,
          assignment.scope_organization_id as organization_id,
          assignment.include_descendants
        from resolved_actors actor
        join organization_memberships membership
          on membership.application_user_id = actor.application_user_id
        join role_assignments assignment
          on assignment.membership_id = membership.id
         and assignment.tenant_id = membership.tenant_id
        join roles role
          on role.id = assignment.role_id
        join role_permissions role_permission
          on role_permission.role_id = assignment.role_id
        join permissions permission
          on permission.id = role_permission.permission_id
        where membership.status = 'active'
          and membership.valid_from <= now()
          and (membership.valid_until is null or membership.valid_until > now())
          and (select count(*) from resolved_actors) = 1
          and role.status = 'active'
          and (role.tenant_id is null or role.tenant_id = assignment.tenant_id)
          and assignment.revoked_at is null
          and assignment.valid_from <= now()
          and (assignment.valid_until is null or assignment.valid_until > now())
          and permission.code = 'tenant.memberships.manage'

        union

        select
          authorized.tenant_id,
          child.id,
          true
        from authorized_organizations authorized
        join organizations child
          on child.tenant_id = authorized.tenant_id
         and child.parent_organization_id = authorized.organization_id
        where authorized.include_descendants
      )
      select distinct
        actor.application_user_id as actor_user_id,
        tenant.id as tenant_id,
        tenant.name as tenant_name,
        tenant.is_synthetic as tenant_is_synthetic,
        organization.id as organization_id,
        organization.name as organization_name
      from authorized_organizations authorized
      cross join resolved_actors actor
      join tenants tenant
        on tenant.id = authorized.tenant_id
       and tenant.status = 'active'
      join organizations organization
        on organization.id = authorized.organization_id
       and organization.tenant_id = authorized.tenant_id
      where organization.id = ${organizationId}
    `.execute(executor);

    if (result.rows.length !== 1) {
      return null;
    }

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
