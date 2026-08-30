import { createHash } from 'node:crypto';
import { buildProviderSlotGenerationKeyHash } from '../workforce-scheduling/provider-slot-generation-key.js';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const DEFAULT_SYNTHETIC_APPOINTMENT_DURATION_MINUTES = 30;
const SYNTHETIC_TEMPLATE_EFFECTIVE_FROM = '2020-01-01';
const SYNTHETIC_PROVIDER_NAMESPACE =
  'uae-health:synthetic-provider-scheduling:v1';

export type SyntheticProviderFixtureKind =
  | 'facility'
  | 'practitioner'
  | 'specialty'
  | 'practitioner-facility-assignment'
  | 'appointment-service'
  | 'practitioner-service-assignment'
  | 'availability-template';

export interface SyntheticAppointmentSlotTemplate {
  bookablePracticeId: string;
  organizationId: string;
  facilityId: string;
  practitionerFacilityAssignmentId: string;
  practitionerServiceAssignmentId: string;
  practitionerId: string;
  appointmentServiceId: string;
  sourceTimezone: string;
  durationMinutes: number;
  offsetHours: number;
}

export interface SyntheticAvailabilityTemplateSeed {
  id: string;
  tenant_id: string;
  organization_id: string;
  facility_id: string;
  practitioner_facility_assignment_id: string;
  practitioner_service_assignment_id: string;
  practitioner_id: string;
  appointment_service_id: string;
  iso_weekday: number;
  local_start_minute: number;
  local_end_minute: number;
  effective_from: string;
  effective_until: null;
  source_timezone: string;
  status: 'active';
  is_synthetic: true;
}

export interface SyntheticAppointmentSlotSeed {
  bookable_practice_id: string;
  tenant_id: string;
  organization_id: string;
  starts_at: Date;
  ends_at: Date;
  facility_id: string;
  practitioner_facility_assignment_id: string;
  practitioner_service_assignment_id: string;
  practitioner_id: string;
  appointment_service_id: string;
  availability_template_id: string;
  generation_key_hash: string;
  source_local_date: string;
  source_timezone: string;
  status: 'available';
  is_synthetic: true;
}

export interface SyntheticAppointmentFixtures {
  availabilityTemplates: SyntheticAvailabilityTemplateSeed[];
  slots: SyntheticAppointmentSlotSeed[];
}

export interface PersistedSyntheticAvailabilityTemplate {
  tenant_id: string;
  organization_id: string;
  facility_id: string;
  practitioner_facility_assignment_id: string;
  practitioner_service_assignment_id: string;
  practitioner_id: string;
  appointment_service_id: string;
  iso_weekday: number;
  local_start_minute: number;
  local_end_minute: number;
  effective_from: string | Date;
  effective_until: string | Date | null;
  source_timezone: string;
  status: string;
  is_synthetic: boolean;
}

export interface PersistedSyntheticAppointmentSlot {
  bookable_practice_id: string;
  tenant_id: string;
  organization_id: string;
  starts_at: Date;
  ends_at: Date;
  facility_id: string | null;
  practitioner_facility_assignment_id: string | null;
  practitioner_service_assignment_id: string | null;
  practitioner_id: string | null;
  appointment_service_id: string | null;
  availability_template_id: string | null;
  generation_key_hash: string | null;
  source_local_date: string | Date | null;
  source_timezone: string | null;
  status: string;
  is_synthetic: boolean;
}

interface LocalDateTimeParts {
  date: string;
  isoWeekday: number;
  minuteOfDay: number;
}

/**
 * Produce the same namespace-derived UUID as the task 2.4 PostgreSQL backfill.
 * MD5 is used only as a stable UUID-shaped content identifier, never for
 * credentials, signatures, tokens, or other security decisions.
 */
export function buildSyntheticProviderFixtureId(
  kind: SyntheticProviderFixtureKind,
  identity: string,
): string {
  const digest = createHash('md5')
    .update(`${SYNTHETIC_PROVIDER_NAMESPACE}:${kind}:${identity}`)
    .digest('hex');

  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join('-');
}

export function buildSyntheticFacilityCode(facilityId: string): string {
  return `SYN-${facilityId.replaceAll('-', '').slice(-28).toUpperCase()}`;
}

export function assertSyntheticSchedulingFacilityScope(input: {
  tenantId: string;
  organizationId: string;
  bookableTimezone: string;
  facility: {
    tenantId: string;
    organizationId: string;
    timezone: string;
    isSynthetic: boolean;
  };
}): void {
  if (
    input.facility.tenantId !== input.tenantId ||
    input.facility.organizationId !== input.organizationId ||
    !input.facility.isSynthetic ||
    input.facility.timezone !== input.bookableTimezone
  ) {
    throw new Error(
      'Synthetic scheduling facility and bookable practice scope do not match.',
    );
  }

  try {
    new Intl.DateTimeFormat('en', {
      timeZone: input.facility.timezone,
    }).format();
  } catch {
    throw new Error('Synthetic scheduling facility timezone is invalid.');
  }
}

/**
 * A deterministic template ID must never be used to relabel or reactivate a
 * different row. Existing rows are accepted only when their persisted
 * scheduling meaning and synthetic provenance exactly match the seed input.
 */
export function assertSyntheticAvailabilityTemplateMatch(
  persisted: PersistedSyntheticAvailabilityTemplate,
  expected: SyntheticAvailabilityTemplateSeed,
): void {
  if (
    persisted.tenant_id !== expected.tenant_id ||
    persisted.organization_id !== expected.organization_id ||
    persisted.facility_id !== expected.facility_id ||
    persisted.practitioner_facility_assignment_id !==
      expected.practitioner_facility_assignment_id ||
    persisted.practitioner_service_assignment_id !==
      expected.practitioner_service_assignment_id ||
    persisted.practitioner_id !== expected.practitioner_id ||
    persisted.appointment_service_id !== expected.appointment_service_id ||
    persisted.iso_weekday !== expected.iso_weekday ||
    persisted.local_start_minute !== expected.local_start_minute ||
    persisted.local_end_minute !== expected.local_end_minute ||
    dateOnly(persisted.effective_from) !== expected.effective_from ||
    persisted.effective_until !== expected.effective_until ||
    persisted.source_timezone !== expected.source_timezone ||
    persisted.status !== expected.status ||
    !persisted.is_synthetic
  ) {
    throw new Error(
      'Deterministic synthetic availability template is not an exact fixture match.',
    );
  }
}

/**
 * Generation keys are immutable scheduling evidence. A collision may retain a
 * withdrawn status, but every identity, provider, local-time, and UTC-time
 * field must otherwise be identical before a restart can reuse the row.
 */
export function assertSyntheticAppointmentSlotMatch(
  persisted: PersistedSyntheticAppointmentSlot,
  expected: SyntheticAppointmentSlotSeed,
): void {
  if (
    persisted.bookable_practice_id !== expected.bookable_practice_id ||
    persisted.tenant_id !== expected.tenant_id ||
    persisted.organization_id !== expected.organization_id ||
    persisted.starts_at.getTime() !== expected.starts_at.getTime() ||
    persisted.ends_at.getTime() !== expected.ends_at.getTime() ||
    persisted.facility_id !== expected.facility_id ||
    persisted.practitioner_facility_assignment_id !==
      expected.practitioner_facility_assignment_id ||
    persisted.practitioner_service_assignment_id !==
      expected.practitioner_service_assignment_id ||
    persisted.practitioner_id !== expected.practitioner_id ||
    persisted.appointment_service_id !== expected.appointment_service_id ||
    persisted.availability_template_id !== expected.availability_template_id ||
    persisted.generation_key_hash !== expected.generation_key_hash ||
    (persisted.source_local_date === null
      ? null
      : dateOnly(persisted.source_local_date)) !== expected.source_local_date ||
    persisted.source_timezone !== expected.source_timezone ||
    (persisted.status !== 'available' && persisted.status !== 'withdrawn') ||
    !persisted.is_synthetic
  ) {
    throw new Error(
      'Synthetic appointment generation key is not an exact fixture match.',
    );
  }
}

/**
 * Infer the one legacy duration that can safely become the practice service
 * duration. Empty practices use the POC default; any invalid or mixed legacy
 * evidence fails closed instead of silently retiming future availability.
 */
export function inferSyntheticAppointmentDurationMinutes(
  slots: readonly { startsAt: Date; endsAt: Date }[],
): number {
  if (slots.length === 0) {
    return DEFAULT_SYNTHETIC_APPOINTMENT_DURATION_MINUTES;
  }

  const durations = new Set<number>();
  for (const slot of slots) {
    const durationMilliseconds =
      slot.endsAt.getTime() - slot.startsAt.getTime();
    if (
      !Number.isFinite(durationMilliseconds) ||
      durationMilliseconds <= 0 ||
      durationMilliseconds % MINUTE_MS !== 0
    ) {
      throw new Error(
        'Synthetic legacy appointment slots require a positive whole-minute duration.',
      );
    }
    durations.add(durationMilliseconds / MINUTE_MS);
  }

  if (durations.size !== 1) {
    throw new Error(
      'Synthetic legacy appointment slots must share one service duration.',
    );
  }

  for (const duration of durations) {
    return duration;
  }
  throw new Error('Synthetic appointment duration could not be inferred.');
}

/**
 * Build a bounded rolling provider-aware window without moving an existing
 * slot identifier. The database upserts by immutable template/generation key,
 * so same-day restarts are idempotent and later restarts append future dates.
 * A referenced or withdrawn slot is never retimed or reactivated.
 */
export function buildSyntheticAppointmentFixtures(input: {
  now: Date;
  tenantId: string;
  templates: readonly SyntheticAppointmentSlotTemplate[];
  horizonDays?: number;
}): SyntheticAppointmentFixtures {
  const horizonDays = input.horizonDays ?? 14;
  if (!Number.isInteger(horizonDays) || horizonDays < 1) {
    throw new Error(
      'Synthetic appointment horizon must be a positive integer.',
    );
  }
  for (const template of input.templates) {
    if (
      !Number.isInteger(template.durationMinutes) ||
      template.durationMinutes < 1
    ) {
      throw new Error(
        'Synthetic appointment duration must be a positive whole number of minutes.',
      );
    }
  }

  const firstDayStart = new Date(input.now);
  firstDayStart.setUTCDate(firstDayStart.getUTCDate() + 1);
  firstDayStart.setUTCHours(9, 0, 0, 0);

  const availabilityTemplates = new Map<
    string,
    SyntheticAvailabilityTemplateSeed
  >();
  const slots: SyntheticAppointmentSlotSeed[] = [];

  for (let dayIndex = 0; dayIndex < horizonDays; dayIndex += 1) {
    for (const template of input.templates) {
      const startsAt = new Date(
        firstDayStart.getTime() +
          dayIndex * DAY_MS +
          template.offsetHours * 60 * MINUTE_MS,
      );
      const endsAt = new Date(
        startsAt.getTime() + template.durationMinutes * MINUTE_MS,
      );
      const localStart = localDateTimeParts(startsAt, template.sourceTimezone);
      const localEnd = localDateTimeParts(endsAt, template.sourceTimezone);
      const endsAtFollowingMidnight =
        localEnd.minuteOfDay === 0 &&
        localEnd.date === nextLocalDate(localStart.date);
      const localEndMinute = endsAtFollowingMidnight
        ? 24 * 60
        : localEnd.minuteOfDay;

      if (
        !endsAtFollowingMidnight &&
        (localStart.date !== localEnd.date ||
          localEnd.minuteOfDay <= localStart.minuteOfDay)
      ) {
        throw new Error(
          'Synthetic appointment templates must remain within one local day or end at the following midnight.',
        );
      }

      const templateIdentity = [
        template.bookablePracticeId,
        localStart.isoWeekday,
        localStart.minuteOfDay,
        localEndMinute,
        template.sourceTimezone,
      ].join('|');
      const availabilityTemplateId = buildSyntheticProviderFixtureId(
        'availability-template',
        templateIdentity,
      );

      availabilityTemplates.set(availabilityTemplateId, {
        id: availabilityTemplateId,
        tenant_id: input.tenantId,
        organization_id: template.organizationId,
        facility_id: template.facilityId,
        practitioner_facility_assignment_id:
          template.practitionerFacilityAssignmentId,
        practitioner_service_assignment_id:
          template.practitionerServiceAssignmentId,
        practitioner_id: template.practitionerId,
        appointment_service_id: template.appointmentServiceId,
        iso_weekday: localStart.isoWeekday,
        local_start_minute: localStart.minuteOfDay,
        local_end_minute: localEndMinute,
        effective_from: SYNTHETIC_TEMPLATE_EFFECTIVE_FROM,
        effective_until: null,
        source_timezone: template.sourceTimezone,
        status: 'active',
        is_synthetic: true,
      });

      slots.push({
        bookable_practice_id: template.bookablePracticeId,
        tenant_id: input.tenantId,
        organization_id: template.organizationId,
        starts_at: startsAt,
        ends_at: endsAt,
        facility_id: template.facilityId,
        practitioner_facility_assignment_id:
          template.practitionerFacilityAssignmentId,
        practitioner_service_assignment_id:
          template.practitionerServiceAssignmentId,
        practitioner_id: template.practitionerId,
        appointment_service_id: template.appointmentServiceId,
        availability_template_id: availabilityTemplateId,
        generation_key_hash: buildProviderSlotGenerationKeyHash({
          availabilityTemplateId,
          sourceLocalDate: localStart.date,
          startsAt,
          endsAt,
        }),
        source_local_date: localStart.date,
        source_timezone: template.sourceTimezone,
        status: 'available',
        is_synthetic: true,
      });
    }
  }

  return {
    availabilityTemplates: [...availabilityTemplates.values()].sort(
      (first, second) => first.id.localeCompare(second.id),
    ),
    slots,
  };
}

/** Compatibility helper retained for callers interested only in slot rows. */
export function buildSyntheticAppointmentSlots(
  input: Parameters<typeof buildSyntheticAppointmentFixtures>[0],
): SyntheticAppointmentSlotSeed[] {
  return buildSyntheticAppointmentFixtures(input).slots;
}

function localDateTimeParts(date: Date, timeZone: string): LocalDateTimeParts {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
  } catch {
    throw new Error(`Invalid synthetic appointment timezone: ${timeZone}`);
  }

  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type)?.value;
    if (!part) throw new Error('Unable to resolve synthetic local time.');
    return Number(part);
  };
  const year = value('year');
  const month = value('month');
  const day = value('day');
  const hour = value('hour');
  const minute = value('minute');
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return {
    date: `${year.toString().padStart(4, '0')}-${month
      .toString()
      .padStart(2, '0')}-${day.toString().padStart(2, '0')}`,
    isoWeekday: dayOfWeek === 0 ? 7 : dayOfWeek,
    minuteOfDay: hour * 60 + minute,
  };
}

function nextLocalDate(date: string): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function dateOnly(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}
