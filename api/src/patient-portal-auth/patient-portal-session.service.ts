import {
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import { DatabaseService } from '../database/database.service.js';
import type { DatabaseSchema } from '../database/database.types.js';
import type {
  PatientPortalAccessContext,
  PatientPortalAvailablePractice,
  PatientPortalPrincipal,
  PatientPortalPracticeContext,
  PatientPortalSessionContext,
} from './patient-portal-auth.types.js';

export interface CreatedPatientPortalSession extends PatientPortalSessionContext {
  sessionToken: string;
}

interface ResolvedPatientPortalIdentity {
  patientPortalIdentityId: string;
  applicationUserId: string;
  displayName: string;
  issuer: string;
  subject: string;
  clientId: string;
  username: string | null;
}

type QueryExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function csrfForSession(sessionToken: string): string {
  return createHash('sha256')
    .update('uae-health-patient-portal-csrf:')
    .update(sessionToken)
    .digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function safeAuditContext(context: PatientPortalAccessContext): {
  kind: 'onboarding' | 'practice';
  portalProfileId?: string;
} {
  return context.kind === 'practice'
    ? { kind: 'practice', portalProfileId: context.portalProfileId }
    : { kind: 'onboarding' };
}

@Injectable()
export class PatientPortalSessionService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PatientPortalSessionService.name);
  private readonly idleMilliseconds: number;
  private readonly absoluteMilliseconds: number;
  private readonly renewalMilliseconds: number;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly database: DatabaseService,
    config: ConfigService,
  ) {
    this.idleMilliseconds =
      config.getOrThrow<number>('SESSION_IDLE_MINUTES') * 60_000;
    this.absoluteMilliseconds =
      config.getOrThrow<number>('SESSION_ABSOLUTE_MINUTES') * 60_000;
    this.renewalMilliseconds =
      config.getOrThrow<number>('SESSION_RENEWAL_MINUTES') * 60_000;
  }

  onModuleInit(): void {
    this.cleanupTimer = setInterval(
      () => void this.cleanupExpiredSessions(),
      60 * 60_000,
    );
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  async create(
    principal: PatientPortalPrincipal,
  ): Promise<CreatedPatientPortalSession> {
    const now = new Date();

    if (
      principal.providerExpiresAt &&
      principal.providerExpiresAt.getTime() <= now.getTime()
    ) {
      throw new UnauthorizedException(
        'The patient identity access token has expired.',
      );
    }

    const browserValues = this.createBrowserValues(now);
    const correlationId = randomUUID();
    const created = await this.database.client
      .transaction()
      .execute(async (trx) => {
        const identity = await this.resolveActivePatientIdentity(
          trx,
          principal,
        );

        if (!identity) {
          await this.recordDeniedSessionExchange(trx, principal, correlationId);
          return null;
        }

        const sessionId = await this.insertSession(
          trx,
          identity,
          null,
          browserValues,
          now,
        );

        await trx
          .updateTable('patient_portal_identities')
          .set({ last_authenticated_at: now, updated_at: now })
          .where('id', '=', identity.patientPortalIdentityId)
          .execute();

        await trx
          .insertInto('audit_events')
          .values({
            actor_type: 'user',
            actor_identifier: identity.subject,
            actor_user_id: identity.applicationUserId,
            effective_user_id: identity.applicationUserId,
            tenant_id: null,
            organization_id: null,
            facility_id: null,
            action: 'identity.patient_portal_session_created',
            target_entity_type: 'patient_portal_session',
            target_entity_id: sessionId,
            outcome: 'success',
            correlation_id: correlationId,
            reason:
              'Exchange a validated patient identity access token for a restricted onboarding session.',
            before_data: null,
            after_data: {
              context: 'onboarding',
              idleTimeoutMinutes: this.idleMilliseconds / 60_000,
              absoluteTimeoutMinutes: this.absoluteMilliseconds / 60_000,
            },
          })
          .execute();

        const availablePractices = await this.listAvailablePractices(
          trx,
          identity.patientPortalIdentityId,
          identity.applicationUserId,
        );

        return { identity, sessionId, availablePractices };
      });

    if (!created) {
      this.logger.warn(
        `event=patient_portal_session_created outcome=denied correlation_id=${correlationId}`,
      );
      throw new ForbiddenException(
        'An active patient portal account is required.',
      );
    }

    this.logger.log(
      `event=patient_portal_session_created outcome=success correlation_id=${correlationId}`,
    );

    return this.toCreatedSession(
      created.sessionId,
      created.identity,
      { kind: 'onboarding' },
      created.availablePractices,
      browserValues,
    );
  }

  async authenticate(
    sessionToken: string,
    csrfToken?: string,
  ): Promise<PatientPortalSessionContext | null> {
    const now = new Date();
    const sessions = await this.database.client
      .selectFrom('patient_portal_sessions as session')
      .innerJoin(
        'patient_portal_identities as identity',
        'identity.id',
        'session.patient_portal_identity_id',
      )
      .innerJoin(
        'application_users as application_user',
        'application_user.id',
        'identity.application_user_id',
      )
      .select([
        'session.id',
        'session.csrf_token_hash',
        'session.patient_portal_profile_id',
        'session.idle_expires_at',
        'session.absolute_expires_at',
        'session.last_seen_at',
        'identity.id as patient_portal_identity_id',
        'identity.application_user_id',
        'identity.issuer',
        'identity.subject',
        'identity.client_id',
        'identity.username',
        'application_user.display_name',
      ])
      .where('session.session_token_hash', '=', sha256(sessionToken))
      .where('session.revoked_at', 'is', null)
      .where('session.idle_expires_at', '>', now)
      .where('session.absolute_expires_at', '>', now)
      .where('identity.status', '=', 'active')
      .where('application_user.status', '=', 'active')
      .whereRef('session.identity_issuer', '=', 'identity.issuer')
      .whereRef('session.identity_subject', '=', 'identity.subject')
      .whereRef('session.identity_client_id', '=', 'identity.client_id')
      .limit(2)
      .execute();

    if (sessions.length !== 1) return null;

    const session = sessions[0];
    const expectedCsrfToken = csrfForSession(sessionToken);

    if (
      session.csrf_token_hash !== sha256(expectedCsrfToken) ||
      (csrfToken !== undefined && !safeEqual(csrfToken, expectedCsrfToken))
    ) {
      return null;
    }

    const identity: ResolvedPatientPortalIdentity = {
      patientPortalIdentityId: session.patient_portal_identity_id,
      applicationUserId: session.application_user_id,
      displayName: session.display_name,
      issuer: session.issuer,
      subject: session.subject,
      clientId: session.client_id,
      username: session.username,
    };
    const context = session.patient_portal_profile_id
      ? await this.resolveActivePractice(
          this.database.client,
          identity.patientPortalIdentityId,
          identity.applicationUserId,
          session.patient_portal_profile_id,
        )
      : null;

    if (session.patient_portal_profile_id && !context) return null;

    const availablePractices = await this.listAvailablePractices(
      this.database.client,
      identity.patientPortalIdentityId,
      identity.applicationUserId,
    );
    let idleExpiresAt = session.idle_expires_at;
    let renewed = false;

    if (
      now.getTime() - session.last_seen_at.getTime() >=
      this.renewalMilliseconds
    ) {
      idleExpiresAt = new Date(
        Math.min(
          now.getTime() + this.idleMilliseconds,
          session.absolute_expires_at.getTime(),
        ),
      );
      const renewedSession = await this.database.client
        .updateTable('patient_portal_sessions')
        .set({
          idle_expires_at: idleExpiresAt,
          last_seen_at: now,
          updated_at: now,
        })
        .where('id', '=', session.id)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();

      if (renewedSession.numUpdatedRows === 0n) return null;
      renewed = true;
    }

    return {
      sessionId: session.id,
      principal: this.toPrincipal(identity),
      patientPortalIdentityId: identity.patientPortalIdentityId,
      applicationUserId: identity.applicationUserId,
      displayName: identity.displayName,
      context: context ?? { kind: 'onboarding' },
      availablePractices,
      csrfToken: expectedCsrfToken,
      idleExpiresAt,
      absoluteExpiresAt: session.absolute_expires_at,
      renewed,
    };
  }

  async rotateContext(
    current: PatientPortalSessionContext,
    portalProfileId: string | null,
  ): Promise<CreatedPatientPortalSession> {
    const now = new Date();
    const correlationId = randomUUID();
    const browserValues = this.createBrowserValues(
      now,
      current.absoluteExpiresAt,
    );
    const result = await this.database.client
      .transaction()
      .setIsolationLevel('serializable')
      .execute(async (trx) => {
        const oldSession = await trx
          .selectFrom('patient_portal_sessions as session')
          .innerJoin(
            'patient_portal_identities as identity',
            'identity.id',
            'session.patient_portal_identity_id',
          )
          .innerJoin(
            'application_users as application_user',
            'application_user.id',
            'identity.application_user_id',
          )
          .select([
            'session.id',
            'session.absolute_expires_at',
            'session.patient_portal_profile_id',
            'identity.id as patient_portal_identity_id',
            'identity.application_user_id',
            'identity.issuer',
            'identity.subject',
            'identity.client_id',
            'identity.username',
            'application_user.display_name',
          ])
          .where('session.id', '=', current.sessionId)
          .where('session.revoked_at', 'is', null)
          .where('session.idle_expires_at', '>', now)
          .where('session.absolute_expires_at', '>', now)
          .where('identity.status', '=', 'active')
          .where('application_user.status', '=', 'active')
          .whereRef('session.identity_issuer', '=', 'identity.issuer')
          .whereRef('session.identity_subject', '=', 'identity.subject')
          .whereRef('session.identity_client_id', '=', 'identity.client_id')
          .forUpdate()
          .executeTakeFirst();

        if (
          !oldSession ||
          oldSession.patient_portal_identity_id !==
            current.patientPortalIdentityId
        ) {
          return { kind: 'invalid_session' } as const;
        }

        const identity: ResolvedPatientPortalIdentity = {
          patientPortalIdentityId: oldSession.patient_portal_identity_id,
          applicationUserId: oldSession.application_user_id,
          displayName: oldSession.display_name,
          issuer: oldSession.issuer,
          subject: oldSession.subject,
          clientId: oldSession.client_id,
          username: oldSession.username,
        };
        const oldPractice = oldSession.patient_portal_profile_id
          ? await this.resolveActivePractice(
              trx,
              identity.patientPortalIdentityId,
              identity.applicationUserId,
              oldSession.patient_portal_profile_id,
            )
          : null;

        if (oldSession.patient_portal_profile_id && !oldPractice) {
          return { kind: 'invalid_session' } as const;
        }

        const oldContext: PatientPortalAccessContext = oldPractice ?? {
          kind: 'onboarding',
        };
        const selectedPractice = portalProfileId
          ? await this.resolveActivePractice(
              trx,
              identity.patientPortalIdentityId,
              identity.applicationUserId,
              portalProfileId,
            )
          : null;

        if (portalProfileId && !selectedPractice) {
          await trx
            .insertInto('audit_events')
            .values({
              actor_type: 'user',
              actor_identifier: identity.subject,
              actor_user_id: identity.applicationUserId,
              effective_user_id: identity.applicationUserId,
              tenant_id: null,
              organization_id: null,
              facility_id: null,
              action: 'identity.patient_portal_context_change_denied',
              target_entity_type: 'patient_portal_profile',
              target_entity_id: portalProfileId,
              outcome: 'denied',
              correlation_id: correlationId,
              reason:
                'The requested patient portal profile is not an active explicit link for this identity.',
              before_data: safeAuditContext(oldContext),
              after_data: { classification: 'unavailable_practice_context' },
            })
            .execute();
          return { kind: 'unavailable_context' } as const;
        }

        const absoluteExpiresAt = oldSession.absolute_expires_at;
        const rotatedBrowserValues = {
          ...browserValues,
          idleExpiresAt: new Date(
            Math.min(
              browserValues.idleExpiresAt.getTime(),
              absoluteExpiresAt.getTime(),
            ),
          ),
          absoluteExpiresAt,
        };
        const revoked = await trx
          .updateTable('patient_portal_sessions')
          .set({ revoked_at: now, updated_at: now })
          .where('id', '=', oldSession.id)
          .where('revoked_at', 'is', null)
          .executeTakeFirst();

        if (revoked.numUpdatedRows !== 1n) {
          return { kind: 'invalid_session' } as const;
        }

        const sessionId = await this.insertSession(
          trx,
          identity,
          selectedPractice?.portalProfileId ?? null,
          rotatedBrowserValues,
          now,
        );

        const nextContext: PatientPortalAccessContext = selectedPractice ?? {
          kind: 'onboarding',
        };
        const auditedPractice = selectedPractice ?? oldPractice;
        await trx
          .insertInto('audit_events')
          .values({
            actor_type: 'user',
            actor_identifier: identity.subject,
            actor_user_id: identity.applicationUserId,
            effective_user_id: identity.applicationUserId,
            tenant_id: auditedPractice?.tenantId ?? null,
            organization_id: auditedPractice?.organizationId ?? null,
            facility_id: null,
            action: 'identity.patient_portal_session_context_changed',
            target_entity_type: 'patient_portal_session',
            target_entity_id: sessionId,
            outcome: 'success',
            correlation_id: correlationId,
            reason:
              'Rotate the patient portal session into the explicitly selected access context.',
            before_data: {
              ...safeAuditContext(oldContext),
              sessionId: oldSession.id,
            },
            after_data: {
              ...safeAuditContext(nextContext),
              sessionId,
            },
          })
          .execute();

        const availablePractices = await this.listAvailablePractices(
          trx,
          identity.patientPortalIdentityId,
          identity.applicationUserId,
        );
        return {
          kind: 'success',
          identity,
          context: nextContext,
          sessionId,
          browserValues: rotatedBrowserValues,
          availablePractices,
        } as const;
      });

    if (result.kind === 'invalid_session') {
      throw new UnauthorizedException(
        'Active patient portal session required.',
      );
    }

    if (result.kind === 'unavailable_context') {
      this.logger.warn(
        `event=patient_portal_session_context_changed outcome=denied correlation_id=${correlationId}`,
      );
      throw new ForbiddenException('The selected practice is unavailable.');
    }

    this.logger.log(
      `event=patient_portal_session_context_changed outcome=success correlation_id=${correlationId}`,
    );
    return this.toCreatedSession(
      result.sessionId,
      result.identity,
      result.context,
      result.availablePractices,
      result.browserValues,
    );
  }

  async revoke(session: PatientPortalSessionContext): Promise<void> {
    const now = new Date();
    const correlationId = randomUUID();

    await this.database.client.transaction().execute(async (trx) => {
      const result = await trx
        .updateTable('patient_portal_sessions')
        .set({ revoked_at: now, updated_at: now })
        .where('id', '=', session.sessionId)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();

      if (result.numUpdatedRows === 0n) return;

      await trx
        .insertInto('audit_events')
        .values({
          actor_type: 'user',
          actor_identifier: session.principal.subject,
          actor_user_id: session.applicationUserId,
          effective_user_id: session.applicationUserId,
          tenant_id:
            session.context.kind === 'practice'
              ? session.context.tenantId
              : null,
          organization_id:
            session.context.kind === 'practice'
              ? session.context.organizationId
              : null,
          facility_id: null,
          action: 'identity.patient_portal_session_revoked',
          target_entity_type: 'patient_portal_session',
          target_entity_id: session.sessionId,
          outcome: 'success',
          correlation_id: correlationId,
          reason: 'User signed out of the patient portal.',
          before_data: {
            status: 'active',
            ...safeAuditContext(session.context),
          },
          after_data: { status: 'revoked' },
        })
        .execute();
    });

    this.logger.log(
      `event=patient_portal_session_revoked outcome=success correlation_id=${correlationId}`,
    );
  }

  private createBrowserValues(
    now: Date,
    absoluteExpiresAt?: Date,
  ): {
    sessionToken: string;
    csrfToken: string;
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
  } {
    const sessionToken = randomBytes(32).toString('base64url');

    return {
      sessionToken,
      csrfToken: csrfForSession(sessionToken),
      idleExpiresAt: new Date(now.getTime() + this.idleMilliseconds),
      absoluteExpiresAt:
        absoluteExpiresAt ??
        new Date(now.getTime() + this.absoluteMilliseconds),
    };
  }

  private async insertSession(
    database: QueryExecutor,
    identity: ResolvedPatientPortalIdentity,
    portalProfileId: string | null,
    browserValues: {
      sessionToken: string;
      csrfToken: string;
      idleExpiresAt: Date;
      absoluteExpiresAt: Date;
    },
    now: Date,
  ): Promise<string> {
    const session = await database
      .insertInto('patient_portal_sessions')
      .values({
        session_token_hash: sha256(browserValues.sessionToken),
        csrf_token_hash: sha256(browserValues.csrfToken),
        patient_portal_identity_id: identity.patientPortalIdentityId,
        patient_portal_profile_id: portalProfileId,
        identity_issuer: identity.issuer,
        identity_subject: identity.subject,
        identity_client_id: identity.clientId,
        identity_username: identity.username,
        idle_expires_at: browserValues.idleExpiresAt,
        absolute_expires_at: browserValues.absoluteExpiresAt,
        last_seen_at: now,
        revoked_at: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return session.id;
  }

  private async resolveActivePatientIdentity(
    database: QueryExecutor,
    principal: PatientPortalPrincipal,
  ): Promise<ResolvedPatientPortalIdentity | null> {
    const identities = await database
      .selectFrom('patient_portal_identities as identity')
      .innerJoin(
        'application_users as application_user',
        'application_user.id',
        'identity.application_user_id',
      )
      .select([
        'identity.id',
        'identity.application_user_id',
        'identity.issuer',
        'identity.subject',
        'identity.client_id',
        'identity.username',
        'application_user.display_name',
      ])
      .where('identity.issuer', '=', principal.issuer)
      .where('identity.subject', '=', principal.subject)
      .where('identity.client_id', '=', principal.clientId)
      .where('identity.status', '=', 'active')
      .where('application_user.status', '=', 'active')
      .limit(2)
      .execute();

    if (identities.length !== 1) return null;

    const identity = identities[0];
    return {
      patientPortalIdentityId: identity.id,
      applicationUserId: identity.application_user_id,
      displayName: identity.display_name,
      issuer: identity.issuer,
      subject: identity.subject,
      clientId: identity.client_id,
      username: identity.username,
    };
  }

  private async resolveActivePractice(
    database: QueryExecutor,
    patientPortalIdentityId: string,
    applicationUserId: string,
    portalProfileId: string,
  ): Promise<PatientPortalPracticeContext | null> {
    const practice = await database
      .selectFrom('patient_portal_profile_links as profile_link')
      .innerJoin(
        'patient_portal_profiles as profile',
        'profile.id',
        'profile_link.patient_portal_profile_id',
      )
      .innerJoin('tenants as tenant', 'tenant.id', 'profile.tenant_id')
      .innerJoin('organizations as organization', (join) =>
        join
          .onRef('organization.id', '=', 'profile.organization_id')
          .onRef('organization.tenant_id', '=', 'profile.tenant_id'),
      )
      .select([
        'profile.id as portal_profile_id',
        'profile.tenant_id',
        'profile.organization_id',
        'organization.name as practice_name',
      ])
      .where(
        'profile_link.patient_portal_identity_id',
        '=',
        patientPortalIdentityId,
      )
      .where('profile_link.status', '=', 'active')
      .where('profile.id', '=', portalProfileId)
      .where('profile.application_user_id', '=', applicationUserId)
      .where('profile.status', '=', 'active')
      .where('tenant.status', '=', 'active')
      .executeTakeFirst();

    if (!practice) return null;

    return {
      kind: 'practice',
      portalProfileId: practice.portal_profile_id,
      practiceName: practice.practice_name,
      tenantId: practice.tenant_id,
      organizationId: practice.organization_id,
    };
  }

  private async listAvailablePractices(
    database: QueryExecutor,
    patientPortalIdentityId: string,
    applicationUserId: string,
  ): Promise<PatientPortalAvailablePractice[]> {
    const practices = await database
      .selectFrom('patient_portal_profile_links as profile_link')
      .innerJoin(
        'patient_portal_profiles as profile',
        'profile.id',
        'profile_link.patient_portal_profile_id',
      )
      .innerJoin('tenants as tenant', 'tenant.id', 'profile.tenant_id')
      .innerJoin('organizations as organization', (join) =>
        join
          .onRef('organization.id', '=', 'profile.organization_id')
          .onRef('organization.tenant_id', '=', 'profile.tenant_id'),
      )
      .select([
        'profile.id as portal_profile_id',
        'organization.name as practice_name',
      ])
      .where(
        'profile_link.patient_portal_identity_id',
        '=',
        patientPortalIdentityId,
      )
      .where('profile_link.status', '=', 'active')
      .where('profile.application_user_id', '=', applicationUserId)
      .where('profile.status', '=', 'active')
      .where('tenant.status', '=', 'active')
      .orderBy('organization.name', 'asc')
      .orderBy('profile.id', 'asc')
      .execute();

    return practices.map((practice) => ({
      portalProfileId: practice.portal_profile_id,
      practiceName: practice.practice_name,
    }));
  }

  private async recordDeniedSessionExchange(
    database: QueryExecutor,
    principal: PatientPortalPrincipal,
    correlationId: string,
  ): Promise<void> {
    await database
      .insertInto('audit_events')
      .values({
        actor_type: 'system',
        actor_identifier: 'patient-portal-session',
        actor_user_id: null,
        effective_user_id: null,
        tenant_id: null,
        organization_id: null,
        facility_id: null,
        action: 'identity.patient_portal_session_denied',
        target_entity_type: 'identity_principal',
        target_entity_id: principal.subject,
        outcome: 'denied',
        correlation_id: correlationId,
        reason:
          'The validated principal did not resolve to exactly one active HIS patient portal identity.',
        before_data: null,
        after_data: {
          classification: 'inactive_or_ambiguous_patient_identity',
        },
      })
      .execute();
  }

  private toPrincipal(
    identity: ResolvedPatientPortalIdentity,
  ): PatientPortalPrincipal {
    return {
      issuer: identity.issuer,
      subject: identity.subject,
      clientId: identity.clientId,
      ...(identity.username ? { username: identity.username } : {}),
    };
  }

  private toCreatedSession(
    sessionId: string,
    identity: ResolvedPatientPortalIdentity,
    context: PatientPortalAccessContext,
    availablePractices: PatientPortalAvailablePractice[],
    browserValues: {
      sessionToken: string;
      csrfToken: string;
      idleExpiresAt: Date;
      absoluteExpiresAt: Date;
    },
  ): CreatedPatientPortalSession {
    return {
      sessionId,
      sessionToken: browserValues.sessionToken,
      principal: this.toPrincipal(identity),
      patientPortalIdentityId: identity.patientPortalIdentityId,
      applicationUserId: identity.applicationUserId,
      displayName: identity.displayName,
      context,
      availablePractices,
      csrfToken: browserValues.csrfToken,
      idleExpiresAt: browserValues.idleExpiresAt,
      absoluteExpiresAt: browserValues.absoluteExpiresAt,
      renewed: true,
    };
  }

  private async cleanupExpiredSessions(): Promise<void> {
    const retentionCutoff = new Date(Date.now() - 60 * 60_000);

    try {
      const expiredSessionIds = this.database.client
        .selectFrom('patient_portal_sessions')
        .select('id')
        .where((expression) =>
          expression.or([
            expression('idle_expires_at', '<=', retentionCutoff),
            expression('absolute_expires_at', '<=', retentionCutoff),
            expression('revoked_at', '<=', retentionCutoff),
          ]),
        )
        .limit(500);
      await this.database.client
        .deleteFrom('patient_portal_sessions')
        .where('id', 'in', expiredSessionIds)
        .execute();
    } catch {
      this.logger.error(
        'event=patient_portal_session_cleanup outcome=failure classification=database_error',
      );
    }
  }
}
