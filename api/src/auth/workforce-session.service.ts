import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';
import type {
  AuthenticatedPrincipal,
  AuthenticatedSessionContext,
} from './auth.types.js';

interface CreatedWorkforceSession extends AuthenticatedSessionContext {
  sessionToken: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function csrfForSession(sessionToken: string): string {
  return createHash('sha256')
    .update('uae-health-csrf:')
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

@Injectable()
export class WorkforceSessionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkforceSessionService.name);
  private readonly idleMilliseconds: number;
  private readonly absoluteMilliseconds: number;
  private readonly renewalMilliseconds: number;
  private readonly cognitoIssuer: string;
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
    this.cognitoIssuer = `https://cognito-idp.${config.getOrThrow<string>('COGNITO_REGION')}.amazonaws.com/${config.getOrThrow<string>('COGNITO_USER_POOL_ID')}`;
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
    principal: AuthenticatedPrincipal,
  ): Promise<CreatedWorkforceSession> {
    const now = new Date();

    if (
      principal.providerExpiresAt &&
      principal.providerExpiresAt.getTime() <= now.getTime()
    ) {
      throw new Error('The Cognito access token has expired.');
    }

    const sessionToken = randomBytes(32).toString('base64url');
    const csrfToken = csrfForSession(sessionToken);
    const idleExpiresAt = new Date(now.getTime() + this.idleMilliseconds);
    const absoluteExpiresAt = new Date(
      now.getTime() + this.absoluteMilliseconds,
    );
    const correlationId = randomUUID();

    const created = await this.database.client
      .transaction()
      .execute(async (trx) => {
        const resolvedUsers = await trx
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
          .select('identity.application_user_id')
          .distinct()
          .where('identity.subject', '=', principal.subject)
          .where('identity.status', '=', 'active')
          .where('connection.issuer', '=', this.cognitoIssuer)
          .where('connection.status', '=', 'active')
          .where('application_user.status', '=', 'active')
          .execute();
        const actorUserId =
          resolvedUsers.length === 1
            ? resolvedUsers[0].application_user_id
            : null;
        const session = await trx
          .insertInto('workforce_sessions')
          .values({
            session_token_hash: sha256(sessionToken),
            csrf_token_hash: sha256(csrfToken),
            cognito_subject: principal.subject,
            cognito_client_id: principal.clientId,
            cognito_username: principal.username ?? null,
            idle_expires_at: idleExpiresAt,
            absolute_expires_at: absoluteExpiresAt,
            last_seen_at: now,
            revoked_at: null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        await trx
          .insertInto('audit_events')
          .values({
            actor_type: actorUserId ? 'user' : 'system',
            actor_identifier: actorUserId
              ? principal.subject
              : 'cognito-session-exchange',
            actor_user_id: actorUserId,
            effective_user_id: actorUserId,
            tenant_id: null,
            organization_id: null,
            facility_id: null,
            action: 'identity.session_created',
            target_entity_type: 'workforce_session',
            target_entity_id: session.id,
            outcome: 'success',
            correlation_id: correlationId,
            reason:
              'Exchange a validated Cognito access token for an application session.',
            before_data: null,
            after_data: {
              idleTimeoutMinutes: this.idleMilliseconds / 60_000,
              absoluteTimeoutMinutes: this.absoluteMilliseconds / 60_000,
            },
          })
          .execute();

        return session;
      });

    this.logger.log(
      `event=workforce_session_created outcome=success correlation_id=${correlationId}`,
    );

    return {
      sessionId: created.id,
      sessionToken,
      principal: {
        subject: principal.subject,
        clientId: principal.clientId,
        ...(principal.username ? { username: principal.username } : {}),
      },
      csrfToken,
      idleExpiresAt,
      absoluteExpiresAt,
      renewed: true,
    };
  }

  async authenticate(
    sessionToken: string,
    csrfToken?: string,
  ): Promise<AuthenticatedSessionContext | null> {
    const now = new Date();
    const session = await this.database.client
      .selectFrom('workforce_sessions')
      .select([
        'id',
        'csrf_token_hash',
        'cognito_subject',
        'cognito_client_id',
        'cognito_username',
        'idle_expires_at',
        'absolute_expires_at',
        'last_seen_at',
      ])
      .where('session_token_hash', '=', sha256(sessionToken))
      .where('revoked_at', 'is', null)
      .where('idle_expires_at', '>', now)
      .where('absolute_expires_at', '>', now)
      .executeTakeFirst();

    if (!session) {
      return null;
    }

    const expectedCsrfToken = csrfForSession(sessionToken);

    if (
      session.csrf_token_hash !== sha256(expectedCsrfToken) ||
      (csrfToken !== undefined && !safeEqual(csrfToken, expectedCsrfToken))
    ) {
      return null;
    }

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
      await this.database.client
        .updateTable('workforce_sessions')
        .set({
          idle_expires_at: idleExpiresAt,
          last_seen_at: now,
          updated_at: now,
        })
        .where('id', '=', session.id)
        .where('revoked_at', 'is', null)
        .execute();
      renewed = true;
    }

    return {
      sessionId: session.id,
      principal: {
        subject: session.cognito_subject,
        clientId: session.cognito_client_id,
        ...(session.cognito_username
          ? { username: session.cognito_username }
          : {}),
      },
      csrfToken: expectedCsrfToken,
      idleExpiresAt,
      absoluteExpiresAt: session.absolute_expires_at,
      renewed,
    };
  }

  async revoke(session: AuthenticatedSessionContext): Promise<void> {
    const now = new Date();
    const correlationId = randomUUID();

    await this.database.client.transaction().execute(async (trx) => {
      const result = await trx
        .updateTable('workforce_sessions')
        .set({ revoked_at: now, updated_at: now })
        .where('id', '=', session.sessionId)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();

      if (result.numUpdatedRows === 0n) return;

      const actor = await trx
        .selectFrom('user_identities as identity')
        .innerJoin(
          'identity_connections as connection',
          'connection.id',
          'identity.identity_connection_id',
        )
        .select('identity.application_user_id')
        .distinct()
        .where('identity.subject', '=', session.principal.subject)
        .where('connection.issuer', '=', this.cognitoIssuer)
        .execute();
      const actorUserId =
        actor.length === 1 ? actor[0].application_user_id : null;

      await trx
        .insertInto('audit_events')
        .values({
          actor_type: actorUserId ? 'user' : 'system',
          actor_identifier: actorUserId
            ? session.principal.subject
            : 'workforce-session',
          actor_user_id: actorUserId,
          effective_user_id: actorUserId,
          tenant_id: null,
          organization_id: null,
          facility_id: null,
          action: 'identity.session_revoked',
          target_entity_type: 'workforce_session',
          target_entity_id: session.sessionId,
          outcome: 'success',
          correlation_id: correlationId,
          reason: 'User signed out of the workforce application.',
          before_data: { status: 'active' },
          after_data: { status: 'revoked' },
        })
        .execute();
    });

    this.logger.log(
      `event=workforce_session_revoked outcome=success correlation_id=${correlationId}`,
    );
  }

  private async cleanupExpiredSessions(): Promise<void> {
    const retentionCutoff = new Date(Date.now() - 60 * 60_000);

    try {
      const expiredSessionIds = this.database.client
        .selectFrom('workforce_sessions')
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
        .deleteFrom('workforce_sessions')
        .where('id', 'in', expiredSessionIds)
        .execute();
    } catch {
      this.logger.error(
        'event=workforce_session_cleanup outcome=failure classification=database_error',
      );
    }
  }
}
