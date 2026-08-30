import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import type {
  AuthorizationRequest,
  AuthorizedAccess,
} from '../authorization/authorization.types.js';
import { DatabaseService } from '../database/database.service.js';
import type {
  DatabaseSchema,
  WorkforceSchedulingCommandOperation,
} from '../database/database.types.js';
import { reconcileReleasedPendingProviderSlot } from '../patient-appointments/provider-slot-release.js';
import { workforceAppointmentDecisionAuditReason } from './workforce-appointment-decision-reasons.js';
import type {
  WorkforceAppointmentDecisionRequest,
  WorkforceAppointmentDecisionResponse,
  WorkforceAppointmentPage,
  WorkforceAppointmentQueueQuery,
  WorkforceAppointmentView,
} from './workforce-appointment-queue.types.js';
import {
  WorkforceAppointmentAuthorizationError,
  WorkforceAppointmentConflictError,
  WorkforceAppointmentPersistenceError,
  WorkforceAppointmentTargetUnavailableError,
  WorkforceAppointmentValidationError,
} from './workforce-appointment-queue.types.js';

type DatabaseExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

interface PracticeContext {
  tenantId: string;
  organizationId: string;
}

interface FacilityContext {
  facilityId: string;
  facilityName: string;
  timezone: string;
}

interface MutationMetadata {
  correlationId: string;
  frozenNow: Date;
  idempotencyKeyHash: string;
  requestHash: string;
  operation: WorkforceSchedulingCommandOperation;
}

interface StoredCommand {
  tenantId: string;
  organizationId: string;
  requestHash: string;
  responseData: Record<string, unknown>;
}

class AppointmentAuthorizationDeniedError extends Error {
  constructor(readonly request: AuthorizationRequest) {
    super('Workforce appointment authorization was denied.');
  }
}

class AppointmentScopedTargetDeniedError extends Error {
  constructor(readonly request: AuthorizationRequest) {
    super('The workforce appointment target was outside the exact scope.');
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object' || value === null) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function databaseErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function isRetryableTransactionError(error: unknown): boolean {
  const code = databaseErrorCode(error);
  return code === '40001' || code === '40P01';
}

function isConstraintConflict(error: unknown): boolean {
  const code = databaseErrorCode(error);
  return code === '23503' || code === '23505' || code === '23514';
}

function isUniqueViolation(error: unknown): boolean {
  return databaseErrorCode(error) === '23505';
}

function asCount(value: string | number | bigint | undefined): number {
  if (value === undefined) return 0;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Injectable()
export class WorkforceAppointmentQueueRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}

  async listAppointments(
    principal: AuthenticatedPrincipal,
    query: WorkforceAppointmentQueueQuery,
  ): Promise<WorkforceAppointmentPage> {
    if (
      !Number.isInteger(query.page) ||
      query.page < 1 ||
      !Number.isInteger(query.pageSize) ||
      query.pageSize < 1 ||
      query.pageSize > 100
    ) {
      throw new WorkforceAppointmentValidationError(
        'Appointment queue pagination is invalid.',
      );
    }
    const correlationId = randomUUID();
    const action = 'scheduling.appointment_queue_read';
    const reason = 'Review safe synthetic appointment requests.';

    try {
      const practice = await this.requirePractice(
        this.database.client,
        query.organizationId,
      );
      const facility = await this.requireFacility(
        this.database.client,
        principal,
        practice,
        query.facilityId,
        correlationId,
        action,
        reason,
      );
      await this.requireDualAuthorization(
        this.database.client,
        principal,
        practice,
        facility.facilityId,
        correlationId,
        action,
        'facility',
        facility.facilityId,
        reason,
      );

      let base = this.database.client
        .selectFrom('patient_portal_appointments as appointment')
        .innerJoin('patient_portal_appointment_slots as slot', (join) =>
          join
            .onRef('slot.id', '=', 'appointment.appointment_slot_id')
            .onRef('slot.tenant_id', '=', 'appointment.tenant_id')
            .onRef('slot.organization_id', '=', 'appointment.organization_id')
            .onRef('slot.facility_id', '=', 'appointment.facility_id'),
        )
        .innerJoin(
          'patient_portal_bookable_practices as bookable_practice',
          (join) =>
            join
              .onRef('bookable_practice.id', '=', 'slot.bookable_practice_id')
              .onRef(
                'bookable_practice.tenant_id',
                '=',
                'appointment.tenant_id',
              )
              .onRef(
                'bookable_practice.organization_id',
                '=',
                'appointment.organization_id',
              ),
        )
        .innerJoin('facilities as facility', (join) =>
          join
            .onRef('facility.id', '=', 'appointment.facility_id')
            .onRef('facility.tenant_id', '=', 'appointment.tenant_id')
            .onRef(
              'facility.organization_id',
              '=',
              'appointment.organization_id',
            ),
        )
        .innerJoin('appointment_services as service', (join) =>
          join
            .onRef('service.id', '=', 'appointment.appointment_service_id')
            .onRef('service.tenant_id', '=', 'appointment.tenant_id')
            .onRef(
              'service.organization_id',
              '=',
              'appointment.organization_id',
            )
            .onRef('service.facility_id', '=', 'appointment.facility_id'),
        )
        .innerJoin('specialties as specialty', (join) =>
          join
            .onRef('specialty.id', '=', 'service.specialty_id')
            .onRef('specialty.tenant_id', '=', 'appointment.tenant_id')
            .onRef(
              'specialty.organization_id',
              '=',
              'appointment.organization_id',
            ),
        )
        .innerJoin('practitioners as practitioner', (join) =>
          join
            .onRef('practitioner.id', '=', 'appointment.practitioner_id')
            .onRef('practitioner.tenant_id', '=', 'appointment.tenant_id'),
        )
        .innerJoin('patient_portal_identities as patient_identity', (join) =>
          join.onRef(
            'patient_identity.id',
            '=',
            'appointment.patient_portal_identity_id',
          ),
        )
        .innerJoin('application_users as identity_user', (join) =>
          join.onRef(
            'identity_user.id',
            '=',
            'patient_identity.application_user_id',
          ),
        )
        .leftJoin('patient_portal_profiles as patient_profile', (join) =>
          join
            .onRef(
              'patient_profile.id',
              '=',
              'appointment.patient_portal_profile_id',
            )
            .onRef('patient_profile.tenant_id', '=', 'appointment.tenant_id')
            .onRef(
              'patient_profile.organization_id',
              '=',
              'appointment.organization_id',
            ),
        )
        .leftJoin('application_users as profile_user', (join) =>
          join.onRef(
            'profile_user.id',
            '=',
            'patient_profile.application_user_id',
          ),
        )
        .where('appointment.tenant_id', '=', practice.tenantId)
        .where('appointment.organization_id', '=', practice.organizationId)
        .where('appointment.facility_id', '=', facility.facilityId)
        .where('slot.is_synthetic', '=', true)
        .where('bookable_practice.is_synthetic', '=', true)
        .where('facility.is_synthetic', '=', true)
        .where('service.is_synthetic', '=', true)
        .where('specialty.is_synthetic', '=', true)
        .where('practitioner.is_synthetic', '=', true);

      base = query.status
        ? base.where('appointment.status', '=', query.status)
        : base.where('appointment.status', 'in', ['requested', 'confirmed']);
      if (query.practitionerId) {
        base = base.where(
          'appointment.practitioner_id',
          '=',
          query.practitionerId,
        );
      }
      if (query.appointmentServiceId) {
        base = base.where(
          'appointment.appointment_service_id',
          '=',
          query.appointmentServiceId,
        );
      }

      const [countRow, appointments] = await Promise.all([
        base
          .select((expression) =>
            expression.fn.countAll<string>().as('total_count'),
          )
          .executeTakeFirst(),
        base
          .select([
            'appointment.id',
            'appointment.status',
            'appointment.version',
            sql<string>`coalesce(profile_user.display_name, identity_user.display_name)`.as(
              'patient_display_name',
            ),
            'facility.id as facility_id',
            'facility.name as facility_name',
            'facility.timezone as facility_timezone',
            'service.id as appointment_service_id',
            'service.patient_facing_name as service_name',
            'specialty.id as specialty_id',
            'specialty.name as specialty_name',
            'practitioner.id as practitioner_id',
            'practitioner.display_name as practitioner_display_name',
            'practitioner.professional_title as practitioner_professional_title',
            'slot.id as appointment_slot_id',
            'slot.starts_at',
            'slot.ends_at',
            'slot.withdrawal_pending',
            'appointment.created_at',
            'appointment.updated_at',
          ])
          .orderBy('slot.starts_at', 'asc')
          .orderBy('appointment.id', 'asc')
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize)
          .execute(),
      ]);

      return {
        page: query.page,
        pageSize: query.pageSize,
        total: asCount(countRow?.total_count),
        items: appointments.map((appointment): WorkforceAppointmentView => ({
          appointmentId: appointment.id,
          status: appointment.status,
          version: appointment.version,
          patientDisplayName: appointment.patient_display_name,
          facilityId: appointment.facility_id,
          facilityName: appointment.facility_name,
          facilityTimezone: appointment.facility_timezone,
          appointmentServiceId: appointment.appointment_service_id,
          serviceName: appointment.service_name,
          specialtyId: appointment.specialty_id,
          specialtyName: appointment.specialty_name,
          practitionerId: appointment.practitioner_id,
          practitionerDisplayName: appointment.practitioner_display_name,
          practitionerProfessionalTitle:
            appointment.practitioner_professional_title,
          appointmentSlotId: appointment.appointment_slot_id,
          startsAt: appointment.starts_at.toISOString(),
          endsAt: appointment.ends_at.toISOString(),
          withdrawalPending: appointment.withdrawal_pending,
          createdAt: appointment.created_at.toISOString(),
          updatedAt: appointment.updated_at.toISOString(),
        })),
      };
    } catch (error) {
      if (
        error instanceof AppointmentAuthorizationDeniedError ||
        error instanceof AppointmentScopedTargetDeniedError
      ) {
        try {
          await this.authorization.recordDenied(error.request);
        } catch {
          throw new WorkforceAppointmentPersistenceError();
        }
        if (error instanceof AppointmentScopedTargetDeniedError) {
          throw new WorkforceAppointmentTargetUnavailableError();
        }
        throw new WorkforceAppointmentAuthorizationError();
      }
      if (
        error instanceof WorkforceAppointmentAuthorizationError ||
        error instanceof WorkforceAppointmentTargetUnavailableError ||
        error instanceof WorkforceAppointmentValidationError ||
        error instanceof WorkforceAppointmentPersistenceError
      ) {
        throw error;
      }
      throw new WorkforceAppointmentPersistenceError();
    }
  }

  changeAppointmentStatus(
    request: WorkforceAppointmentDecisionRequest,
    appointmentId: string,
  ): Promise<WorkforceAppointmentDecisionResponse> {
    return this.executeMutation(
      request,
      { appointmentId, input: request.input },
      async (database, metadata) => {
        const practice = await this.requirePractice(
          database,
          request.input.organizationId,
        );
        const action =
          request.input.status === 'confirmed'
            ? 'scheduling.appointment_confirmed'
            : 'scheduling.appointment_declined';
        const reason = workforceAppointmentDecisionAuditReason(
          request.input.reasonCode,
        );
        const facility = await this.requireFacility(
          database,
          request.principal,
          practice,
          request.input.facilityId,
          metadata.correlationId,
          action,
          reason,
        );
        const access = await this.requireDualAuthorization(
          database,
          request.principal,
          practice,
          facility.facilityId,
          metadata.correlationId,
          action,
          'patient_portal_appointment',
          appointmentId,
          reason,
        );
        const replay =
          await this.replayCommand<WorkforceAppointmentDecisionResponse>(
            database,
            access,
            practice,
            metadata,
          );
        if (replay) return replay;

        const appointment = await database
          .selectFrom('patient_portal_appointments as appointment')
          .innerJoin('patient_portal_appointment_slots as slot', (join) =>
            join
              .onRef('slot.id', '=', 'appointment.appointment_slot_id')
              .onRef('slot.tenant_id', '=', 'appointment.tenant_id')
              .onRef('slot.organization_id', '=', 'appointment.organization_id')
              .onRef('slot.facility_id', '=', 'appointment.facility_id'),
          )
          .innerJoin(
            'patient_portal_bookable_practices as bookable_practice',
            (join) =>
              join
                .onRef('bookable_practice.id', '=', 'slot.bookable_practice_id')
                .onRef(
                  'bookable_practice.tenant_id',
                  '=',
                  'appointment.tenant_id',
                )
                .onRef(
                  'bookable_practice.organization_id',
                  '=',
                  'appointment.organization_id',
                ),
          )
          .select([
            'appointment.id',
            'appointment.status',
            'appointment.version',
            'appointment.patient_portal_profile_id',
            'appointment.patient_portal_appointment_relationship_id',
            'appointment.appointment_slot_id',
            'appointment.facility_id',
            'appointment.practitioner_facility_assignment_id',
            'appointment.practitioner_service_assignment_id',
            'appointment.practitioner_id',
            'appointment.appointment_service_id',
            'slot.withdrawal_pending',
          ])
          .where('appointment.id', '=', appointmentId)
          .where('appointment.tenant_id', '=', practice.tenantId)
          .where('appointment.organization_id', '=', practice.organizationId)
          .where('appointment.facility_id', '=', facility.facilityId)
          .where('slot.is_synthetic', '=', true)
          .where('bookable_practice.is_synthetic', '=', true)
          .forUpdate('appointment')
          .executeTakeFirst();

        if (!appointment) {
          throw new AppointmentScopedTargetDeniedError(
            this.authorizationRequest({
              principal: request.principal,
              practice,
              facilityId: facility.facilityId,
              permissionCode: 'patients.read',
              correlationId: metadata.correlationId,
              action: 'scheduling.appointment_target_unavailable',
              targetEntityType: 'patient_portal_appointment',
              targetEntityId: appointmentId,
              reason:
                'The appointment request was unavailable in the exact authorized facility.',
            }),
          );
        }
        if (
          !appointment.facility_id ||
          !appointment.practitioner_facility_assignment_id ||
          !appointment.practitioner_service_assignment_id ||
          !appointment.practitioner_id ||
          !appointment.appointment_service_id
        ) {
          throw new WorkforceAppointmentPersistenceError();
        }
        if (
          appointment.status !== 'requested' ||
          appointment.version !== request.input.expectedVersion
        ) {
          throw new WorkforceAppointmentConflictError(
            'This appointment request changed. Refresh and try again.',
          );
        }

        const updated = await database
          .updateTable('patient_portal_appointments')
          .set({
            status: request.input.status,
            version: appointment.version + 1,
            updated_at: metadata.frozenNow,
          })
          .where('id', '=', appointment.id)
          .where('tenant_id', '=', practice.tenantId)
          .where('organization_id', '=', practice.organizationId)
          .where('facility_id', '=', facility.facilityId)
          .where('status', '=', 'requested')
          .where('version', '=', request.input.expectedVersion)
          .returning(['id', 'status', 'version', 'updated_at'])
          .executeTakeFirst();
        if (!updated) {
          throw new WorkforceAppointmentConflictError(
            'This appointment request changed. Refresh and try again.',
          );
        }

        const releasedSlot =
          request.input.status === 'declined'
            ? await reconcileReleasedPendingProviderSlot(
                database,
                appointment.appointment_slot_id,
                metadata.frozenNow,
              )
            : null;
        const withdrawalPending =
          request.input.status === 'confirmed'
            ? appointment.withdrawal_pending
            : releasedSlot?.disposition === 'still_live';
        const response: WorkforceAppointmentDecisionResponse = {
          appointment: {
            appointmentId: updated.id,
            appointmentSlotId: appointment.appointment_slot_id,
            facilityId: appointment.facility_id,
            practitionerId: appointment.practitioner_id,
            appointmentServiceId: appointment.appointment_service_id,
            status: request.input.status,
            version: updated.version,
            updatedAt: updated.updated_at.toISOString(),
            withdrawalPending,
            releasedSlotDisposition: releasedSlot?.disposition ?? null,
            releasedSlotValidityReason: releasedSlot?.validityReason ?? null,
          },
        };
        const patientContextId =
          appointment.patient_portal_profile_id ??
          appointment.patient_portal_appointment_relationship_id;
        const commonAuditData = {
          appointmentId: appointment.id,
          patientContextId,
          appointmentSlotId: appointment.appointment_slot_id,
          facilityId: appointment.facility_id,
          practitionerFacilityAssignmentId:
            appointment.practitioner_facility_assignment_id,
          practitionerServiceAssignmentId:
            appointment.practitioner_service_assignment_id,
          practitionerId: appointment.practitioner_id,
          appointmentServiceId: appointment.appointment_service_id,
        };
        await this.insertSuccessAudit(database, {
          principal: request.principal,
          access,
          practice,
          facilityId: facility.facilityId,
          correlationId: metadata.correlationId,
          action,
          targetEntityId: appointment.id,
          reason,
          beforeData: {
            ...commonAuditData,
            status: appointment.status,
            version: appointment.version,
            withdrawalPending: appointment.withdrawal_pending,
          },
          afterData: {
            ...commonAuditData,
            status: response.appointment.status,
            version: response.appointment.version,
            reasonCode: request.input.reasonCode,
            withdrawalPending: response.appointment.withdrawalPending,
            releasedSlotDisposition:
              response.appointment.releasedSlotDisposition,
            releasedSlotValidityReason:
              response.appointment.releasedSlotValidityReason,
          },
        });
        await this.insertCommand(
          database,
          access,
          practice,
          metadata,
          { ...response },
          appointment.id,
        );
        return response;
      },
    );
  }

  private async requirePractice(
    database: DatabaseExecutor,
    organizationId: string,
  ): Promise<PracticeContext> {
    const practice = await database
      .selectFrom('organizations as organization')
      .innerJoin('tenants as tenant', 'tenant.id', 'organization.tenant_id')
      .select(['tenant.id as tenant_id', 'organization.id as organization_id'])
      .where('organization.id', '=', organizationId)
      .where('organization.kind', '=', 'practice')
      .where('organization.is_synthetic', '=', true)
      .where('tenant.status', '=', 'active')
      .where('tenant.is_synthetic', '=', true)
      .executeTakeFirst();
    if (!practice) throw new WorkforceAppointmentTargetUnavailableError();
    return {
      tenantId: practice.tenant_id,
      organizationId: practice.organization_id,
    };
  }

  private async requireFacility(
    database: DatabaseExecutor,
    principal: AuthenticatedPrincipal,
    practice: PracticeContext,
    facilityId: string,
    correlationId: string,
    action: string,
    reason: string,
  ): Promise<FacilityContext> {
    const facility = await database
      .selectFrom('facilities as facility')
      .select(['facility.id', 'facility.name', 'facility.timezone'])
      .where('facility.id', '=', facilityId)
      .where('facility.tenant_id', '=', practice.tenantId)
      .where('facility.organization_id', '=', practice.organizationId)
      .where('facility.is_synthetic', '=', true)
      .executeTakeFirst();
    if (!facility) {
      throw new AppointmentScopedTargetDeniedError(
        this.authorizationRequest({
          principal,
          practice,
          permissionCode: 'patients.read',
          correlationId,
          action,
          targetEntityType: 'facility',
          targetEntityId: facilityId,
          reason,
        }),
      );
    }
    return {
      facilityId: facility.id,
      facilityName: facility.name,
      timezone: facility.timezone,
    };
  }

  private authorizationRequest(input: {
    principal: AuthenticatedPrincipal;
    practice: PracticeContext;
    facilityId?: string;
    permissionCode: 'scheduling.manage' | 'patients.read';
    correlationId: string;
    action: string;
    targetEntityType: string;
    targetEntityId: string;
    reason: string;
  }): AuthorizationRequest {
    return {
      principal: input.principal,
      tenantId: input.practice.tenantId,
      organizationId: input.practice.organizationId,
      ...(input.facilityId ? { facilityId: input.facilityId } : {}),
      permissionCode: input.permissionCode,
      confidential: false,
      action: input.action,
      targetEntityType: input.targetEntityType,
      targetEntityId: input.targetEntityId,
      correlationId: input.correlationId,
      reason: input.reason,
    };
  }

  private async requireDualAuthorization(
    database: DatabaseExecutor,
    principal: AuthenticatedPrincipal,
    practice: PracticeContext,
    facilityId: string,
    correlationId: string,
    action: string,
    targetEntityType: string,
    targetEntityId: string,
    reason: string,
  ): Promise<AuthorizedAccess> {
    const schedulingRequest = this.authorizationRequest({
      principal,
      practice,
      facilityId,
      permissionCode: 'scheduling.manage',
      correlationId,
      action,
      targetEntityType,
      targetEntityId,
      reason,
    });
    const schedulingAccess = await this.authorization.evaluate(
      schedulingRequest,
      database,
    );
    if (!schedulingAccess) {
      throw new AppointmentAuthorizationDeniedError(schedulingRequest);
    }

    const patientsRequest = this.authorizationRequest({
      principal,
      practice,
      facilityId,
      permissionCode: 'patients.read',
      correlationId,
      action,
      targetEntityType,
      targetEntityId,
      reason,
    });
    const patientsAccess = await this.authorization.evaluate(
      patientsRequest,
      database,
    );
    if (
      !patientsAccess ||
      patientsAccess.applicationUserId !== schedulingAccess.applicationUserId ||
      patientsAccess.membershipId !== schedulingAccess.membershipId
    ) {
      throw new AppointmentAuthorizationDeniedError(patientsRequest);
    }
    return schedulingAccess;
  }

  private async executeMutation(
    request: WorkforceAppointmentDecisionRequest,
    fingerprint: Record<string, unknown>,
    work: (
      database: Transaction<DatabaseSchema>,
      metadata: MutationMetadata,
    ) => Promise<WorkforceAppointmentDecisionResponse>,
  ): Promise<WorkforceAppointmentDecisionResponse> {
    const operation: WorkforceSchedulingCommandOperation =
      'appointment_request_decision';
    const metadata: MutationMetadata = {
      correlationId: randomUUID(),
      frozenNow: new Date(),
      idempotencyKeyHash: sha256(request.idempotencyKey),
      requestHash: sha256(stableJson({ operation, ...fingerprint })),
      operation,
    };
    let transactionRetryCount = 0;
    let uniqueRetryUsed = false;

    for (;;) {
      try {
        return await this.database.client
          .transaction()
          .setIsolationLevel('serializable')
          .execute((transaction) => work(transaction, metadata));
      } catch (error) {
        if (
          error instanceof AppointmentAuthorizationDeniedError ||
          error instanceof AppointmentScopedTargetDeniedError
        ) {
          try {
            await this.authorization.recordDenied(error.request);
          } catch {
            throw new WorkforceAppointmentPersistenceError();
          }
          if (error instanceof AppointmentScopedTargetDeniedError) {
            throw new WorkforceAppointmentTargetUnavailableError();
          }
          throw new WorkforceAppointmentAuthorizationError();
        }
        if (
          error instanceof WorkforceAppointmentAuthorizationError ||
          error instanceof WorkforceAppointmentTargetUnavailableError ||
          error instanceof WorkforceAppointmentConflictError ||
          error instanceof WorkforceAppointmentPersistenceError
        ) {
          throw error;
        }
        if (isRetryableTransactionError(error)) {
          if (transactionRetryCount < 3) {
            transactionRetryCount += 1;
            continue;
          }
          throw new WorkforceAppointmentPersistenceError();
        }
        if (isUniqueViolation(error) && !uniqueRetryUsed) {
          uniqueRetryUsed = true;
          continue;
        }
        if (isConstraintConflict(error)) {
          throw new WorkforceAppointmentConflictError();
        }
        throw new WorkforceAppointmentPersistenceError();
      }
    }
  }

  private async replayCommand<TResponse>(
    database: Transaction<DatabaseSchema>,
    access: AuthorizedAccess,
    practice: PracticeContext,
    metadata: MutationMetadata,
  ): Promise<TResponse | null> {
    const command = await database
      .selectFrom('workforce_scheduling_commands as command')
      .select([
        'command.tenant_id',
        'command.organization_id',
        'command.request_hash',
        'command.response_data',
      ])
      .where('command.actor_user_id', '=', access.applicationUserId)
      .where('command.tenant_id', '=', practice.tenantId)
      .where('command.organization_id', '=', practice.organizationId)
      .where('command.operation', '=', metadata.operation)
      .where('command.idempotency_key_hash', '=', metadata.idempotencyKeyHash)
      .executeTakeFirst();
    if (!command) return null;

    const stored: StoredCommand = {
      tenantId: command.tenant_id,
      organizationId: command.organization_id,
      requestHash: command.request_hash,
      responseData: command.response_data,
    };
    if (
      stored.tenantId !== practice.tenantId ||
      stored.organizationId !== practice.organizationId ||
      stored.requestHash !== metadata.requestHash
    ) {
      throw new WorkforceAppointmentConflictError(
        'Idempotency-Key was already used for a different appointment decision.',
      );
    }
    if (!isRecord(stored.responseData)) {
      throw new WorkforceAppointmentPersistenceError();
    }
    return stored.responseData as TResponse;
  }

  private async insertCommand(
    database: Transaction<DatabaseSchema>,
    access: AuthorizedAccess,
    practice: PracticeContext,
    metadata: MutationMetadata,
    response: Record<string, unknown>,
    appointmentId: string,
  ): Promise<void> {
    await database
      .insertInto('workforce_scheduling_commands')
      .values({
        actor_user_id: access.applicationUserId,
        tenant_id: practice.tenantId,
        organization_id: practice.organizationId,
        operation: metadata.operation,
        idempotency_key_hash: metadata.idempotencyKeyHash,
        request_hash: metadata.requestHash,
        response_data: response,
        target_entity_type: 'patient_portal_appointment',
        target_entity_id: appointmentId,
      })
      .execute();
  }

  private async insertSuccessAudit(
    database: Transaction<DatabaseSchema>,
    input: {
      principal: AuthenticatedPrincipal;
      access: AuthorizedAccess;
      practice: PracticeContext;
      facilityId: string;
      correlationId: string;
      action: string;
      targetEntityId: string;
      reason: string;
      beforeData: Record<string, unknown>;
      afterData: Record<string, unknown>;
    },
  ): Promise<void> {
    await database
      .insertInto('audit_events')
      .values({
        actor_type: 'user',
        actor_identifier: input.principal.subject,
        actor_user_id: input.access.applicationUserId,
        effective_user_id: input.access.applicationUserId,
        tenant_id: input.practice.tenantId,
        organization_id: input.practice.organizationId,
        facility_id: input.facilityId,
        action: input.action,
        target_entity_type: 'patient_portal_appointment',
        target_entity_id: input.targetEntityId,
        outcome: 'success',
        correlation_id: input.correlationId,
        reason: input.reason,
        before_data: input.beforeData,
        after_data: input.afterData,
      })
      .execute();
  }
}
