import type { Transaction } from 'kysely';
import { sql } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';
import {
  evaluateProviderSlotCurrentValidity,
  type ProviderAvailabilityExceptionInterval,
  type ProviderAvailabilityStoredSlot,
  type ProviderAvailabilityTemplateDefinition,
  type ProviderSlotValidityReason,
} from '../workforce-scheduling/provider-availability-materializer.js';
import { AvailabilityMaterializationError } from '../workforce-scheduling/provider-availability-time.js';

export interface ReleasedPendingProviderSlotResult {
  disposition: 'not_pending' | 'still_live' | 'available' | 'withdrawn';
  validityReason: ProviderSlotValidityReason | 'inactive_chain' | null;
}

/**
 * Resolve a deferred workforce withdrawal after an appointment command
 * releases a slot. This helper must run in the same transaction as the
 * appointment state transition so patient and workforce commands share one
 * authoritative release path.
 */
export async function reconcileReleasedPendingProviderSlot(
  database: Transaction<DatabaseSchema>,
  slotId: string,
  frozenNow: Date,
): Promise<ReleasedPendingProviderSlotResult> {
  const slot = await database
    .selectFrom('patient_portal_appointment_slots as slot')
    .innerJoin('patient_portal_bookable_practices as bookable', (join) =>
      join
        .onRef('bookable.id', '=', 'slot.bookable_practice_id')
        .onRef('bookable.tenant_id', '=', 'slot.tenant_id')
        .onRef('bookable.organization_id', '=', 'slot.organization_id'),
    )
    .innerJoin('tenants as tenant', 'tenant.id', 'slot.tenant_id')
    .innerJoin('organizations as organization', (join) =>
      join
        .onRef('organization.id', '=', 'slot.organization_id')
        .onRef('organization.tenant_id', '=', 'slot.tenant_id'),
    )
    .innerJoin('facilities as facility', (join) =>
      join
        .onRef('facility.id', '=', 'slot.facility_id')
        .onRef('facility.tenant_id', '=', 'slot.tenant_id')
        .onRef('facility.organization_id', '=', 'slot.organization_id'),
    )
    .innerJoin('practitioner_availability_templates as template', (join) =>
      join
        .onRef('template.id', '=', 'slot.availability_template_id')
        .onRef('template.tenant_id', '=', 'slot.tenant_id')
        .onRef('template.organization_id', '=', 'slot.organization_id')
        .onRef('template.facility_id', '=', 'slot.facility_id')
        .onRef(
          'template.practitioner_facility_assignment_id',
          '=',
          'slot.practitioner_facility_assignment_id',
        )
        .onRef(
          'template.practitioner_service_assignment_id',
          '=',
          'slot.practitioner_service_assignment_id',
        )
        .onRef('template.practitioner_id', '=', 'slot.practitioner_id')
        .onRef(
          'template.appointment_service_id',
          '=',
          'slot.appointment_service_id',
        )
        .onRef('template.source_timezone', '=', 'slot.source_timezone'),
    )
    .innerJoin(
      'practitioner_facility_assignments as facility_assignment',
      (join) =>
        join
          .onRef(
            'facility_assignment.id',
            '=',
            'slot.practitioner_facility_assignment_id',
          )
          .onRef('facility_assignment.tenant_id', '=', 'slot.tenant_id')
          .onRef(
            'facility_assignment.organization_id',
            '=',
            'slot.organization_id',
          )
          .onRef('facility_assignment.facility_id', '=', 'slot.facility_id')
          .onRef(
            'facility_assignment.practitioner_id',
            '=',
            'slot.practitioner_id',
          ),
    )
    .innerJoin('practitioners as practitioner', (join) =>
      join
        .onRef('practitioner.id', '=', 'slot.practitioner_id')
        .onRef('practitioner.tenant_id', '=', 'slot.tenant_id'),
    )
    .innerJoin('appointment_services as service', (join) =>
      join
        .onRef('service.id', '=', 'slot.appointment_service_id')
        .onRef('service.tenant_id', '=', 'slot.tenant_id')
        .onRef('service.organization_id', '=', 'slot.organization_id')
        .onRef('service.facility_id', '=', 'slot.facility_id'),
    )
    .innerJoin('specialties as specialty', (join) =>
      join
        .onRef('specialty.id', '=', 'service.specialty_id')
        .onRef('specialty.tenant_id', '=', 'service.tenant_id')
        .onRef('specialty.organization_id', '=', 'service.organization_id'),
    )
    .innerJoin(
      'practitioner_service_assignments as service_assignment',
      (join) =>
        join
          .onRef(
            'service_assignment.id',
            '=',
            'slot.practitioner_service_assignment_id',
          )
          .onRef('service_assignment.tenant_id', '=', 'slot.tenant_id')
          .onRef(
            'service_assignment.organization_id',
            '=',
            'slot.organization_id',
          )
          .onRef('service_assignment.facility_id', '=', 'slot.facility_id')
          .onRef(
            'service_assignment.practitioner_facility_assignment_id',
            '=',
            'slot.practitioner_facility_assignment_id',
          )
          .onRef(
            'service_assignment.practitioner_id',
            '=',
            'slot.practitioner_id',
          )
          .onRef(
            'service_assignment.appointment_service_id',
            '=',
            'slot.appointment_service_id',
          ),
    )
    .select([
      'slot.id',
      'slot.bookable_practice_id',
      'slot.tenant_id',
      'slot.organization_id',
      'slot.facility_id',
      'slot.practitioner_facility_assignment_id',
      'slot.practitioner_service_assignment_id',
      'slot.practitioner_id',
      'slot.appointment_service_id',
      'slot.availability_template_id',
      'slot.generation_key_hash',
      'slot.source_local_date',
      'slot.source_timezone',
      'slot.starts_at',
      'slot.ends_at',
      'slot.status',
      'slot.withdrawal_pending',
      'slot.is_synthetic as slot_is_synthetic',
      'bookable.status as bookable_status',
      'bookable.is_synthetic as bookable_is_synthetic',
      'tenant.status as tenant_status',
      'tenant.is_synthetic as tenant_is_synthetic',
      'organization.kind as organization_kind',
      'organization.is_synthetic as organization_is_synthetic',
      'facility.timezone as facility_timezone',
      'facility.is_synthetic as facility_is_synthetic',
      'facility_assignment.status as facility_assignment_status',
      'facility_assignment.is_synthetic as facility_assignment_is_synthetic',
      'practitioner.status as practitioner_status',
      'practitioner.is_synthetic as practitioner_is_synthetic',
      'service.duration_minutes',
      'service.status as service_status',
      'service.is_synthetic as service_is_synthetic',
      'specialty.status as specialty_status',
      'specialty.is_synthetic as specialty_is_synthetic',
      'service_assignment.status as service_assignment_status',
      'service_assignment.is_synthetic as service_assignment_is_synthetic',
      'template.iso_weekday',
      'template.local_start_minute',
      'template.local_end_minute',
      'template.effective_from',
      'template.effective_until',
      'template.source_timezone as template_source_timezone',
      'template.status as template_status',
      'template.is_synthetic as template_is_synthetic',
    ])
    .where('slot.id', '=', slotId)
    .where('slot.withdrawal_pending', '=', true)
    .forUpdate('slot')
    .forShare([
      'bookable',
      'tenant',
      'organization',
      'facility',
      'template',
      'facility_assignment',
      'practitioner',
      'service',
      'specialty',
      'service_assignment',
    ])
    .executeTakeFirst();

  if (!slot) {
    return { disposition: 'not_pending', validityReason: null };
  }

  const liveAppointment = await database
    .selectFrom('patient_portal_appointments')
    .select('id')
    .where('appointment_slot_id', '=', slot.id)
    .where(sql<boolean>`status in ('requested', 'confirmed')`)
    .orderBy('id')
    .executeTakeFirst();
  if (liveAppointment) {
    return { disposition: 'still_live', validityReason: null };
  }

  const completeProviderBundle =
    slot.facility_id !== null &&
    slot.practitioner_facility_assignment_id !== null &&
    slot.practitioner_service_assignment_id !== null &&
    slot.practitioner_id !== null &&
    slot.appointment_service_id !== null &&
    slot.availability_template_id !== null &&
    slot.generation_key_hash !== null &&
    slot.source_local_date !== null &&
    slot.source_timezone !== null;
  const completeActiveChain =
    completeProviderBundle &&
    slot.status === 'available' &&
    slot.slot_is_synthetic &&
    slot.bookable_status === 'active' &&
    slot.bookable_is_synthetic &&
    slot.tenant_status === 'active' &&
    slot.tenant_is_synthetic &&
    slot.organization_kind === 'practice' &&
    slot.organization_is_synthetic &&
    slot.facility_is_synthetic &&
    slot.facility_assignment_status === 'active' &&
    slot.facility_assignment_is_synthetic &&
    slot.practitioner_status === 'active' &&
    slot.practitioner_is_synthetic &&
    slot.specialty_status === 'active' &&
    slot.specialty_is_synthetic &&
    slot.service_status === 'active' &&
    slot.service_is_synthetic &&
    slot.service_assignment_status === 'active' &&
    slot.service_assignment_is_synthetic &&
    slot.template_is_synthetic;

  let isDesired = false;
  let validityReason: ReleasedPendingProviderSlotResult['validityReason'] =
    'inactive_chain';

  if (completeActiveChain) {
    const exceptions = await database
      .selectFrom('provider_availability_exceptions as exception')
      .select([
        'exception.id',
        'exception.facility_id',
        'exception.practitioner_facility_assignment_id',
        'exception.practitioner_id',
        'exception.kind',
        'exception.starts_at',
        'exception.ends_at',
        'exception.source_timezone',
        'exception.status',
      ])
      .where('exception.tenant_id', '=', slot.tenant_id)
      .where('exception.organization_id', '=', slot.organization_id)
      .where('exception.facility_id', '=', slot.facility_id)
      .where('exception.status', '=', 'active')
      .where(
        sql<boolean>`tstzrange(
          exception.starts_at,
          exception.ends_at,
          '[)'
        ) && tstzrange(${slot.starts_at}, ${slot.ends_at}, '[)')`,
      )
      .orderBy('exception.starts_at')
      .orderBy('exception.id')
      .forShare()
      .execute();

    const template: ProviderAvailabilityTemplateDefinition = {
      id: slot.availability_template_id!,
      bookablePracticeId: slot.bookable_practice_id,
      tenantId: slot.tenant_id,
      organizationId: slot.organization_id,
      facilityId: slot.facility_id!,
      practitionerFacilityAssignmentId:
        slot.practitioner_facility_assignment_id!,
      practitionerServiceAssignmentId: slot.practitioner_service_assignment_id!,
      practitionerId: slot.practitioner_id!,
      appointmentServiceId: slot.appointment_service_id!,
      isoWeekday: slot.iso_weekday,
      localStartMinute: slot.local_start_minute,
      localEndMinute: slot.local_end_minute,
      effectiveFrom: slot.effective_from,
      effectiveUntil: slot.effective_until,
      sourceTimezone: slot.template_source_timezone,
      durationMinutes: slot.duration_minutes,
      status: slot.template_status,
    };
    const storedSlot: ProviderAvailabilityStoredSlot = {
      id: slot.id,
      bookablePracticeId: slot.bookable_practice_id,
      tenantId: slot.tenant_id,
      organizationId: slot.organization_id,
      facilityId: slot.facility_id!,
      practitionerFacilityAssignmentId:
        slot.practitioner_facility_assignment_id!,
      practitionerServiceAssignmentId: slot.practitioner_service_assignment_id!,
      practitionerId: slot.practitioner_id!,
      appointmentServiceId: slot.appointment_service_id!,
      availabilityTemplateId: slot.availability_template_id!,
      generationKeyHash: slot.generation_key_hash!,
      sourceLocalDate: slot.source_local_date!,
      sourceTimezone: slot.source_timezone!,
      startsAt: slot.starts_at,
      endsAt: slot.ends_at,
      status: slot.status,
      withdrawalPending: slot.withdrawal_pending,
      liveAppointmentId: null,
    };
    const exceptionIntervals: ProviderAvailabilityExceptionInterval[] =
      exceptions.map((exception) => ({
        id: exception.id,
        facilityId: exception.facility_id,
        practitionerFacilityAssignmentId:
          exception.practitioner_facility_assignment_id,
        practitionerId: exception.practitioner_id,
        kind: exception.kind,
        startsAt: exception.starts_at,
        endsAt: exception.ends_at,
        sourceTimezone: exception.source_timezone,
        status: exception.status,
      }));

    try {
      const validity = evaluateProviderSlotCurrentValidity({
        frozenNow,
        sourceTimezone: slot.facility_timezone,
        template,
        exceptions: exceptionIntervals,
        slot: storedSlot,
      });
      isDesired = validity.isDesired;
      validityReason = validity.reason;
    } catch (error) {
      if (!(error instanceof AvailabilityMaterializationError)) throw error;
      validityReason = 'definition-mismatch';
    }
  }

  await database
    .updateTable('patient_portal_appointment_slots')
    .set({
      status: isDesired ? 'available' : 'withdrawn',
      withdrawal_pending: false,
      updated_at: frozenNow,
    })
    .where('id', '=', slot.id)
    .where('withdrawal_pending', '=', true)
    .executeTakeFirstOrThrow();

  return {
    disposition: isDesired ? 'available' : 'withdrawn',
    validityReason,
  };
}
