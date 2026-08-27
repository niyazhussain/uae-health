import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import { DatabaseService } from '../database/database.service.js';
import type { DatabaseSchema } from '../database/database.types.js';
import { PATIENT_IDENTITY_PROVIDER } from '../patient-identity-provider/patient-identity-provider.constants.js';
import type {
  CreatedPatientIdentityProviderAccount,
  PatientIdentityProviderPort,
} from '../patient-identity-provider/patient-identity-provider.types.js';

interface PatientPortalRegistrationCommand {
  displayName: string;
  email: string;
  idempotencyKey: string;
  clientIp: string;
}

interface RegistrationHashes {
  idempotencyKeyHash: string;
  requestHash: string;
  emailHmac: string;
  clientIpHmac: string;
}

type RegistrationReservation =
  | { kind: 'provision'; requestId: string }
  | { kind: 'bind'; requestId: string; providerSubject: string }
  | { kind: 'retry_later' }
  | { kind: 'accepted' };

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

@Injectable()
export class PatientPortalRegistrationService {
  private readonly logger = new Logger(PatientPortalRegistrationService.name);
  private readonly enabled: boolean;
  private readonly hmacSecret?: string;
  private readonly windowMilliseconds: number;
  private readonly ipLimit: number;
  private readonly emailLimit: number;
  private readonly isSynthetic: boolean;

  constructor(
    private readonly database: DatabaseService,
    @Inject(PATIENT_IDENTITY_PROVIDER)
    private readonly identityProvider: PatientIdentityProviderPort,
    config: ConfigService,
  ) {
    this.enabled =
      config.getOrThrow<string>('PATIENT_PUBLIC_REGISTRATION_ENABLED') ===
      'true';
    this.windowMilliseconds =
      config.getOrThrow<number>('PATIENT_PUBLIC_REGISTRATION_WINDOW_SECONDS') *
      1_000;
    this.ipLimit = config.getOrThrow<number>(
      'PATIENT_PUBLIC_REGISTRATION_IP_LIMIT',
    );
    this.emailLimit = config.getOrThrow<number>(
      'PATIENT_PUBLIC_REGISTRATION_EMAIL_LIMIT',
    );
    this.isSynthetic =
      config.getOrThrow<string>('DEPLOYMENT_ENVIRONMENT') !== 'production';

    if (this.enabled) {
      this.hmacSecret = config.getOrThrow<string>(
        'PATIENT_REGISTRATION_EMAIL_HMAC_SECRET',
      );
    }
  }

  async register(
    command: PatientPortalRegistrationCommand,
  ): Promise<{ accepted: true }> {
    if (!this.enabled || !this.hmacSecret || !this.identityProvider.clientId) {
      throw new NotFoundException('Patient registration is unavailable.');
    }

    const idempotencyKey = command.idempotencyKey.trim();

    if (idempotencyKey.length < 16 || idempotencyKey.length > 200) {
      throw new BadRequestException(
        'Idempotency-Key must contain between 16 and 200 characters.',
      );
    }

    const normalizedEmail = command.email.trim().toLowerCase();
    const hashes = this.hashes({
      ...command,
      email: normalizedEmail,
      idempotencyKey,
    });
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.windowMilliseconds);
    let reservation: RegistrationReservation;

    try {
      reservation = await this.reserve(hashes, now, expiresAt);
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (isUniqueViolation(error)) {
        return this.resolveConcurrentIdempotency(hashes, now);
      }
      throw new ServiceUnavailableException(
        'Patient registration is temporarily unavailable.',
      );
    }

    if (reservation.kind === 'accepted') return { accepted: true };

    if (reservation.kind === 'retry_later') {
      throw new ServiceUnavailableException(
        'Patient registration is temporarily unavailable.',
      );
    }

    if (reservation.kind === 'bind') {
      try {
        await this.completeRecordedProviderAccount(
          reservation.requestId,
          hashes.idempotencyKeyHash,
          normalizedEmail,
          command.displayName.trim(),
          reservation.providerSubject,
        );
      } catch {
        this.logger.warn(
          'event=patient_portal_registration outcome=failure classification=pending_binding_unavailable',
        );
        throw new ServiceUnavailableException(
          'Patient registration is temporarily unavailable.',
        );
      }

      return { accepted: true };
    }

    let providerAccount;

    try {
      providerAccount = await this.identityProvider.provisionAccount(
        normalizedEmail,
        command.displayName.trim(),
      );
    } catch {
      await this.releaseReservation(
        reservation.requestId,
        hashes.idempotencyKeyHash,
      );
      this.logger.warn(
        'event=patient_portal_registration outcome=failure classification=provider_unavailable',
      );
      throw new ServiceUnavailableException(
        'Patient registration is temporarily unavailable.',
      );
    }

    if (providerAccount.kind === 'already_exists') {
      try {
        await this.completeExistingProviderAccount(
          reservation.requestId,
          hashes.idempotencyKeyHash,
        );
      } catch {
        this.logger.error(
          'event=patient_portal_registration outcome=failure classification=persistence_unavailable',
        );
        throw new ServiceUnavailableException(
          'Patient registration is temporarily unavailable.',
        );
      }
      return { accepted: true };
    }

    let providerBindingRecorded: boolean;

    try {
      providerBindingRecorded = await this.recordCreatedProviderAccount(
        reservation.requestId,
        hashes.idempotencyKeyHash,
        providerAccount,
      );
    } catch {
      this.logger.error(
        'event=patient_portal_registration outcome=failure classification=provider_binding_record_unavailable',
      );
      throw new ServiceUnavailableException(
        'Patient registration is temporarily unavailable.',
      );
    }

    if (!providerBindingRecorded) {
      const compensated = await this.compensateIfUnbound(
        providerAccount,
        reservation.requestId,
        hashes.idempotencyKeyHash,
      );

      if (compensated) {
        await this.releaseReservation(
          reservation.requestId,
          hashes.idempotencyKeyHash,
        );
      }

      this.logger.warn(
        'event=patient_portal_registration outcome=failure classification=provider_binding_reservation_unavailable',
      );
      throw new ServiceUnavailableException(
        'Patient registration is temporarily unavailable.',
      );
    }

    try {
      await this.completeRecordedProviderAccount(
        reservation.requestId,
        hashes.idempotencyKeyHash,
        normalizedEmail,
        command.displayName.trim(),
        providerAccount.subject,
      );
    } catch {
      // A durable pending_binding record holds the immutable subject. Retrying
      // the same idempotency key resumes binding without another provider call;
      // never delete a provider account after a serializable/unique conflict.
      this.logger.warn(
        'event=patient_portal_registration outcome=failure classification=pending_binding_unavailable',
      );
      throw new ServiceUnavailableException(
        'Patient registration is temporarily unavailable.',
      );
    }

    this.logger.log(
      'event=patient_portal_registration outcome=accepted classification=identity_pending_verification',
    );
    return { accepted: true };
  }

  private hashes(
    command: PatientPortalRegistrationCommand,
  ): RegistrationHashes {
    return {
      idempotencyKeyHash: this.hmac(command.idempotencyKey.trim()),
      requestHash: this.hmac(
        `${command.displayName.trim()}\n${command.email.trim().toLowerCase()}`,
      ),
      emailHmac: this.hmac(command.email.trim().toLowerCase()),
      clientIpHmac: this.hmac(command.clientIp.trim() || 'unavailable'),
    };
  }

  private hmac(value: string): string {
    return createHmac('sha256', this.hmacSecret!).update(value).digest('hex');
  }

  private async reserve(
    hashes: RegistrationHashes,
    now: Date,
    expiresAt: Date,
  ): Promise<RegistrationReservation> {
    return this.database.client
      .transaction()
      .setIsolationLevel('serializable')
      .execute(async (trx) => {
        // Reclaim this exact key first. The bounded batch cleanup below may
        // leave older expired rows behind, but an expired idempotency record
        // must never block a safe later request with the same key.
        await trx
          .deleteFrom('patient_portal_registration_requests')
          .where('idempotency_key_hash', '=', hashes.idempotencyKeyHash)
          .where('expires_at', '<=', now)
          .execute();

        await sql`
          with expired as (
            select id
            from patient_portal_registration_requests
            where expires_at <= ${now}
            order by expires_at asc
            limit 100
          )
          delete from patient_portal_registration_requests request
          using expired
          where request.id = expired.id
        `.execute(trx);

        const existing = await trx
          .selectFrom('patient_portal_registration_requests')
          .select([
            'id',
            'request_hash',
            'status',
            'provider_issuer',
            'provider_subject',
          ])
          .where('idempotency_key_hash', '=', hashes.idempotencyKeyHash)
          .where('expires_at', '>', now)
          .forUpdate()
          .executeTakeFirst();

        if (existing) {
          if (existing.request_hash !== hashes.requestHash) {
            throw new ConflictException(
              'Idempotency-Key cannot be reused with a different registration request.',
            );
          }

          if (
            existing.status === 'pending_binding' &&
            existing.provider_issuer === this.identityProvider.issuer &&
            existing.provider_subject
          ) {
            return {
              kind: 'bind',
              requestId: existing.id,
              providerSubject: existing.provider_subject,
            };
          }

          if (existing.status === 'pending_provider') {
            return { kind: 'retry_later' };
          }

          return { kind: 'accepted' };
        }

        const [emailAttempts, ipAttempts] = await Promise.all([
          this.countUnexpiredAttempts(trx, 'email_hmac', hashes.emailHmac, now),
          this.countUnexpiredAttempts(
            trx,
            'client_ip_hmac',
            hashes.clientIpHmac,
            now,
          ),
        ]);
        const rateLimited =
          emailAttempts >= this.emailLimit || ipAttempts >= this.ipLimit;
        const request = await trx
          .insertInto('patient_portal_registration_requests')
          .values({
            idempotency_key_hash: hashes.idempotencyKeyHash,
            request_hash: hashes.requestHash,
            email_hmac: hashes.emailHmac,
            client_ip_hmac: hashes.clientIpHmac,
            provider_issuer: null,
            provider_subject: null,
            status: rateLimited ? 'rate_limited' : 'pending_provider',
            expires_at: expiresAt,
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        if (rateLimited) {
          await trx
            .insertInto('audit_events')
            .values({
              actor_type: 'system',
              actor_identifier: 'patient-public-registration',
              actor_user_id: null,
              effective_user_id: null,
              tenant_id: null,
              organization_id: null,
              facility_id: null,
              action: 'identity.patient_portal_registration_rate_limited',
              target_entity_type: 'patient_portal_registration_request',
              target_entity_id: request.id,
              outcome: 'denied',
              correlation_id: randomUUID(),
              reason:
                'A public patient registration request exceeded a safe rate limit.',
              before_data: null,
              after_data: {
                classification: 'public_registration_rate_limited',
              },
            })
            .execute();
          return { kind: 'accepted' };
        }

        return { kind: 'provision', requestId: request.id };
      });
  }

  private async countUnexpiredAttempts(
    trx: Transaction<DatabaseSchema>,
    column: 'email_hmac' | 'client_ip_hmac',
    value: string,
    now: Date,
  ): Promise<number> {
    const attempts = await trx
      .selectFrom('patient_portal_registration_requests')
      .select((expression) => expression.fn.countAll<number>().as('count'))
      .where(column, '=', value)
      .where('expires_at', '>', now)
      .executeTakeFirstOrThrow();

    return Number(attempts.count);
  }

  /**
   * A concurrent insert can surface as a unique violation after the original
   * serializable transaction has rolled back. Re-read the durable request so
   * an idempotency key can never be silently reused for a different payload.
   */
  private async resolveConcurrentIdempotency(
    hashes: RegistrationHashes,
    now: Date,
  ): Promise<{ accepted: true }> {
    try {
      const existing = await this.database.client
        .selectFrom('patient_portal_registration_requests')
        .select('request_hash')
        .where('idempotency_key_hash', '=', hashes.idempotencyKeyHash)
        .where('expires_at', '>', now)
        .executeTakeFirst();

      if (!existing) {
        throw new ServiceUnavailableException(
          'Patient registration is temporarily unavailable.',
        );
      }

      if (existing.request_hash !== hashes.requestHash) {
        throw new ConflictException(
          'Idempotency-Key cannot be reused with a different registration request.',
        );
      }

      return { accepted: true };
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }

      throw new ServiceUnavailableException(
        'Patient registration is temporarily unavailable.',
      );
    }
  }

  private async releaseReservation(
    requestId: string,
    idempotencyKeyHash: string,
  ): Promise<void> {
    try {
      await this.database.client
        .deleteFrom('patient_portal_registration_requests')
        .where('id', '=', requestId)
        .where('idempotency_key_hash', '=', idempotencyKeyHash)
        .where('status', '=', 'pending_provider')
        .execute();
    } catch {
      this.logger.warn(
        'event=patient_portal_registration outcome=failure classification=reservation_cleanup_failed',
      );
    }
  }

  private async completeExistingProviderAccount(
    requestId: string,
    idempotencyKeyHash: string,
  ): Promise<void> {
    await this.database.client
      .transaction()
      .setIsolationLevel('serializable')
      .execute(async (trx) => {
        const request = await trx
          .selectFrom('patient_portal_registration_requests')
          .select(['id', 'status'])
          .where('id', '=', requestId)
          .where('idempotency_key_hash', '=', idempotencyKeyHash)
          .forUpdate()
          .executeTakeFirst();

        if (!request || request.status !== 'pending_provider') return;

        await trx
          .updateTable('patient_portal_registration_requests')
          .set({ status: 'accepted', updated_at: new Date() })
          .where('id', '=', request.id)
          .execute();
      });
  }

  /**
   * Persist the immutable provider subject before attempting local identity
   * creation. If the following transaction retries, the same idempotency key
   * can resume binding without another AdminCreateUser call.
   */
  private async recordCreatedProviderAccount(
    requestId: string,
    idempotencyKeyHash: string,
    account: CreatedPatientIdentityProviderAccount,
  ): Promise<boolean> {
    return this.database.client
      .transaction()
      .setIsolationLevel('serializable')
      .execute(async (trx) => {
        const request = await trx
          .selectFrom('patient_portal_registration_requests')
          .select(['id', 'status', 'provider_issuer', 'provider_subject'])
          .where('id', '=', requestId)
          .where('idempotency_key_hash', '=', idempotencyKeyHash)
          .forUpdate()
          .executeTakeFirst();

        if (!request) return false;

        if (request.status === 'pending_binding') {
          return (
            request.provider_issuer === this.identityProvider.issuer &&
            request.provider_subject === account.subject
          );
        }

        if (request.status !== 'pending_provider') return false;

        await trx
          .updateTable('patient_portal_registration_requests')
          .set({
            provider_issuer: this.identityProvider.issuer,
            provider_subject: account.subject,
            status: 'pending_binding',
            updated_at: new Date(),
          })
          .where('id', '=', request.id)
          .where('status', '=', 'pending_provider')
          .execute();

        return true;
      });
  }

  private async completeRecordedProviderAccount(
    requestId: string,
    idempotencyKeyHash: string,
    email: string,
    displayName: string,
    providerSubject: string,
  ): Promise<void> {
    const now = new Date();
    const correlationId = randomUUID();

    await this.database.client
      .transaction()
      .setIsolationLevel('serializable')
      .execute(async (trx) => {
        const request = await trx
          .selectFrom('patient_portal_registration_requests')
          .select(['id', 'status', 'provider_issuer', 'provider_subject'])
          .where('id', '=', requestId)
          .where('idempotency_key_hash', '=', idempotencyKeyHash)
          .forUpdate()
          .executeTakeFirst();

        if (!request || request.status === 'accepted') return;

        if (
          request.status !== 'pending_binding' ||
          request.provider_issuer !== this.identityProvider.issuer ||
          request.provider_subject !== providerSubject
        ) {
          throw new Error('Patient registration binding is unavailable.');
        }

        const existingIdentities = await trx
          .selectFrom('patient_portal_identities')
          .select(['id', 'application_user_id', 'client_id'])
          .where('issuer', '=', this.identityProvider.issuer)
          .where('subject', '=', providerSubject)
          .forUpdate()
          .execute();

        if (
          existingIdentities.length === 1 &&
          existingIdentities[0].client_id !== this.identityProvider.clientId
        ) {
          throw new Error('Patient identity client binding is unavailable.');
        }

        if (existingIdentities.length === 0) {
          const applicationUser = await trx
            .insertInto('application_users')
            .values({
              display_name: displayName,
              primary_email: email,
              status: 'active',
              is_synthetic: this.isSynthetic,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          const identity = await trx
            .insertInto('patient_portal_identities')
            .values({
              application_user_id: applicationUser.id,
              issuer: this.identityProvider.issuer,
              subject: providerSubject,
              client_id: this.identityProvider.clientId,
              username: email,
              status: 'pending_verification',
              provider_sync_status: 'synchronized',
              provider_sync_attempted_at: now,
              provider_sync_completed_at: now,
              provider_sync_error_code: null,
              last_authenticated_at: null,
            })
            .returning('id')
            .executeTakeFirstOrThrow();

          await trx
            .insertInto('audit_events')
            .values({
              actor_type: 'system',
              actor_identifier: 'patient-public-registration',
              actor_user_id: null,
              effective_user_id: applicationUser.id,
              tenant_id: null,
              organization_id: null,
              facility_id: null,
              action: 'identity.patient_portal_registration_started',
              target_entity_type: 'patient_portal_identity',
              target_entity_id: identity.id,
              outcome: 'success',
              correlation_id: correlationId,
              reason:
                'Create a restricted patient portal identity pending first verified sign-in.',
              before_data: null,
              after_data: {
                status: 'pending_verification',
                providerSyncStatus: 'synchronized',
              },
            })
            .execute();
        }

        await trx
          .updateTable('patient_portal_registration_requests')
          .set({
            status: 'accepted',
            updated_at: now,
          })
          .where('id', '=', request.id)
          .execute();
      });
  }

  private async compensateIfUnbound(
    account: CreatedPatientIdentityProviderAccount,
    requestId: string,
    idempotencyKeyHash: string,
  ): Promise<boolean> {
    try {
      const [binding, reservation] = await Promise.all([
        this.database.client
          .selectFrom('patient_portal_identities')
          .select('id')
          .where('issuer', '=', this.identityProvider.issuer)
          .where('subject', '=', account.subject)
          .executeTakeFirst(),
        this.database.client
          .selectFrom('patient_portal_registration_requests')
          .select('provider_subject')
          .where('id', '=', requestId)
          .where('idempotency_key_hash', '=', idempotencyKeyHash)
          .executeTakeFirst(),
      ]);

      // A durable provider subject may be committed even if the caller saw an
      // error. In that case retry binding; do not delete a potentially shared
      // provider account after a serialization or identity conflict.
      if (binding || reservation?.provider_subject) return false;

      await this.identityProvider.deleteAccount(account.externalAccountId);
      return true;
    } catch {
      this.logger.error(
        'event=patient_portal_registration outcome=failure classification=provider_compensation_failed',
      );
      return false;
    }
  }
}
