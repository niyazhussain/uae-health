import {
  addLocalCalendarDays,
  assertElapsedDurationMinutes,
  assertIanaTimezone,
  AvailabilityMaterializationError,
  type AvailabilityPublicationHorizon,
  captureAvailabilityHorizon,
  compareCanonicalLocalDates,
  getIsoWeekday,
  MAX_DESIRED_AVAILABILITY_OCCURRENCES,
  parseCanonicalLocalDate,
  resolveLocalMinuteBoundary,
} from './provider-availability-time.js';
import { buildProviderSlotGenerationKeyHash } from './provider-slot-generation-key.js';

export type ProviderAvailabilityTemplateStatus = 'active' | 'inactive';
export type ProviderAvailabilityExceptionStatus = 'active' | 'cancelled';
export type ProviderAvailabilityExceptionKind =
  'facility_closed' | 'practitioner_unavailable';
export type ProviderAvailabilitySlotStatus = 'available' | 'withdrawn';

export interface ProviderAvailabilityScope {
  bookablePracticeId: string;
  tenantId: string;
  organizationId: string;
  facilityId: string;
  practitionerFacilityAssignmentId: string;
  practitionerServiceAssignmentId: string;
  practitionerId: string;
  appointmentServiceId: string;
}

export interface ProviderAvailabilityTemplateDefinition extends ProviderAvailabilityScope {
  id: string;
  isoWeekday: number;
  localStartMinute: number;
  localEndMinute: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  sourceTimezone: string;
  durationMinutes: number;
  status: ProviderAvailabilityTemplateStatus;
}

export interface ProviderAvailabilityExceptionInterval {
  id: string;
  facilityId: string;
  practitionerFacilityAssignmentId: string | null;
  practitionerId: string | null;
  kind: ProviderAvailabilityExceptionKind;
  startsAt: Date;
  endsAt: Date;
  sourceTimezone: string;
  status: ProviderAvailabilityExceptionStatus;
}

export interface DesiredProviderAvailabilityOccurrence extends ProviderAvailabilityScope {
  availabilityTemplateId: string;
  generationKeyHash: string;
  sourceLocalDate: string;
  sourceTimezone: string;
  startsAt: Date;
  endsAt: Date;
}

export interface ProviderAvailabilityStoredSlot extends DesiredProviderAvailabilityOccurrence {
  id: string;
  status: ProviderAvailabilitySlotStatus;
  withdrawalPending: boolean;
  liveAppointmentId: string | null;
}

export interface ProviderAvailabilityMaterializationResult {
  horizon: AvailabilityPublicationHorizon;
  occurrences: DesiredProviderAvailabilityOccurrence[];
  consideredOccurrenceCount: number;
  exceptionExcludedCount: number;
}

export interface ProviderAvailabilityReactivation {
  slot: ProviderAvailabilityStoredSlot;
  occurrence: DesiredProviderAvailabilityOccurrence;
}

export interface ProviderAvailabilitySkippedLiveConflict {
  occurrence: DesiredProviderAvailabilityOccurrence;
  conflictingSlot: ProviderAvailabilityStoredSlot;
  liveAppointmentId: string;
}

export interface ProviderAvailabilityReconciliationPlan {
  created: DesiredProviderAvailabilityOccurrence[];
  reactivated: ProviderAvailabilityReactivation[];
  withdrawn: ProviderAvailabilityStoredSlot[];
  preservedLive: ProviderAvailabilityStoredSlot[];
  clearedWithdrawalPending: ProviderAvailabilityStoredSlot[];
  unchanged: ProviderAvailabilityStoredSlot[];
  skippedLive: ProviderAvailabilitySkippedLiveConflict[];
}

export type ProviderSlotValidityReason =
  | 'desired'
  | 'not-future'
  | 'outside-horizon'
  | 'template-inactive'
  | 'outside-effective-range'
  | 'weekday-mismatch'
  | 'definition-mismatch'
  | 'exception-covered';

export interface ProviderSlotValidity {
  isDesired: boolean;
  reason: ProviderSlotValidityReason;
  occurrence?: DesiredProviderAvailabilityOccurrence;
}

interface GeneratedTemplateDateOccurrences {
  candidates: DesiredProviderAvailabilityOccurrence[];
  desired: DesiredProviderAvailabilityOccurrence[];
  exceptionExcludedCount: number;
}

export interface UtcHalfOpenInterval {
  startsAt: Date;
  endsAt: Date;
}

export function materializeProviderAvailability(input: {
  frozenNow: Date;
  sourceTimezone: string;
  templates: readonly ProviderAvailabilityTemplateDefinition[];
  exceptions: readonly ProviderAvailabilityExceptionInterval[];
}): ProviderAvailabilityMaterializationResult {
  const horizon = captureAvailabilityHorizon(
    input.frozenNow,
    input.sourceTimezone,
  );
  validateExceptionIntervals(input.exceptions, input.sourceTimezone);

  const occurrences: DesiredProviderAvailabilityOccurrence[] = [];
  let consideredOccurrenceCount = 0;
  let exceptionExcludedCount = 0;

  for (const template of [...input.templates].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    validateTemplate(template, input.sourceTimezone);
    if (template.status !== 'active') continue;

    for (
      let localDate = horizon.localStartDate;
      compareCanonicalLocalDates(localDate, horizon.localEndDateExclusive) < 0;
      localDate = addLocalCalendarDays(localDate, 1)
    ) {
      if (!templateAppliesOnLocalDate(template, localDate)) continue;

      const generated = generateTemplateDateOccurrences({
        template,
        localDate,
        frozenNow: horizon.frozenNow,
        exceptions: input.exceptions,
      });
      consideredOccurrenceCount += generated.candidates.length;
      if (consideredOccurrenceCount > MAX_DESIRED_AVAILABILITY_OCCURRENCES) {
        throw new AvailabilityMaterializationError(
          'OCCURRENCE_LIMIT_EXCEEDED',
          'Availability publication exceeds the 10,000-occurrence safety limit.',
        );
      }
      exceptionExcludedCount += generated.exceptionExcludedCount;
      occurrences.push(...generated.desired);
    }
  }

  occurrences.sort(compareOccurrences);
  assertDesiredOccurrencesDoNotOverlap(occurrences);

  return {
    horizon,
    occurrences,
    consideredOccurrenceCount,
    exceptionExcludedCount,
  };
}

/**
 * Decide whether one stored slot is still generated by its current immutable
 * template and service duration. Cancellation and rescheduling use this to
 * resolve deferred withdrawal without reimplementing wall-time logic.
 */
export function evaluateProviderSlotCurrentValidity(input: {
  frozenNow: Date;
  sourceTimezone: string;
  template: ProviderAvailabilityTemplateDefinition;
  exceptions: readonly ProviderAvailabilityExceptionInterval[];
  slot: ProviderAvailabilityStoredSlot;
}): ProviderSlotValidity {
  const horizon = captureAvailabilityHorizon(
    input.frozenNow,
    input.sourceTimezone,
  );
  validateTemplate(input.template, input.sourceTimezone);
  validateExceptionIntervals(input.exceptions, input.sourceTimezone);
  validateStoredSlot(input.slot);

  if (input.slot.startsAt.getTime() <= horizon.frozenNow.getTime()) {
    return { isDesired: false, reason: 'not-future' };
  }
  if (
    compareCanonicalLocalDates(
      input.slot.sourceLocalDate,
      horizon.localStartDate,
    ) < 0 ||
    compareCanonicalLocalDates(
      input.slot.sourceLocalDate,
      horizon.localEndDateExclusive,
    ) >= 0
  ) {
    return { isDesired: false, reason: 'outside-horizon' };
  }
  if (input.template.status !== 'active') {
    return { isDesired: false, reason: 'template-inactive' };
  }
  if (!templateDateIsEffective(input.template, input.slot.sourceLocalDate)) {
    return { isDesired: false, reason: 'outside-effective-range' };
  }
  if (getIsoWeekday(input.slot.sourceLocalDate) !== input.template.isoWeekday) {
    return { isDesired: false, reason: 'weekday-mismatch' };
  }

  const generated = generateTemplateDateOccurrences({
    template: input.template,
    localDate: input.slot.sourceLocalDate,
    frozenNow: horizon.frozenNow,
    exceptions: input.exceptions,
  });
  const candidate = generated.candidates.find(
    (occurrence) =>
      occurrence.availabilityTemplateId === input.slot.availabilityTemplateId &&
      occurrence.generationKeyHash === input.slot.generationKeyHash,
  );
  if (!candidate) {
    return { isDesired: false, reason: 'definition-mismatch' };
  }
  assertStoredSlotMatchesOccurrence(input.slot, candidate);

  if (
    !generated.desired.some(
      (occurrence) =>
        occurrence.availabilityTemplateId ===
          candidate.availabilityTemplateId &&
        occurrence.generationKeyHash === candidate.generationKeyHash,
    )
  ) {
    return {
      isDesired: false,
      reason: 'exception-covered',
      occurrence: candidate,
    };
  }

  return { isDesired: true, reason: 'desired', occurrence: candidate };
}

/**
 * Plan persistence changes for a caller-supplied, already locked population.
 * `existingSlots` must be bounded to the same future facility-local horizon as
 * `desiredOccurrences`, plus any currently overlapping started rows supplied as
 * immutable blockers. Completed historical rows are evidence, not planner input.
 */
export function planProviderAvailabilityReconciliation(input: {
  desiredOccurrences: readonly DesiredProviderAvailabilityOccurrence[];
  existingSlots: readonly ProviderAvailabilityStoredSlot[];
}): ProviderAvailabilityReconciliationPlan {
  const desiredByKey = new Map<string, DesiredProviderAvailabilityOccurrence>();
  for (const occurrence of input.desiredOccurrences) {
    validateOccurrence(occurrence);
    const key = occurrenceKey(occurrence);
    if (desiredByKey.has(key)) {
      throw new AvailabilityMaterializationError(
        'GENERATION_KEY_CONFLICT',
        'Availability generation input contains a duplicate occurrence key.',
      );
    }
    desiredByKey.set(key, occurrence);
  }

  const existingByKey = new Map<string, ProviderAvailabilityStoredSlot>();
  for (const slot of input.existingSlots) {
    validateStoredSlot(slot);
    const key = occurrenceKey(slot);
    if (existingByKey.has(key)) {
      throw new AvailabilityMaterializationError(
        'GENERATION_KEY_CONFLICT',
        'Persisted availability contains a duplicate occurrence key.',
      );
    }
    existingByKey.set(key, slot);
  }

  const plan: ProviderAvailabilityReconciliationPlan = {
    created: [],
    reactivated: [],
    withdrawn: [],
    preservedLive: [],
    clearedWithdrawalPending: [],
    unchanged: [],
    skippedLive: [],
  };
  const reactivationCandidates: ProviderAvailabilityReactivation[] = [];
  const pendingClearCandidates: ProviderAvailabilityReactivation[] = [];

  for (const slot of [...input.existingSlots].sort(compareStoredSlots)) {
    const desired = desiredByKey.get(occurrenceKey(slot));
    if (desired) {
      assertStoredSlotMatchesOccurrence(slot, desired);
      desiredByKey.delete(occurrenceKey(slot));

      if (slot.status === 'withdrawn') {
        if (slot.liveAppointmentId !== null || slot.withdrawalPending) {
          throw new AvailabilityMaterializationError(
            'INVALID_OCCURRENCE',
            'A withdrawn availability slot cannot retain live or pending state.',
          );
        }
        reactivationCandidates.push({ slot, occurrence: desired });
      } else if (slot.withdrawalPending) {
        pendingClearCandidates.push({ slot, occurrence: desired });
      } else {
        plan.unchanged.push(slot);
      }
      continue;
    }

    if (slot.liveAppointmentId !== null) {
      if (slot.status !== 'available') {
        throw new AvailabilityMaterializationError(
          'INVALID_OCCURRENCE',
          'A live appointment must retain an available overlap-reserving slot.',
        );
      }
      plan.preservedLive.push(slot);
    } else if (slot.status === 'available') {
      plan.withdrawn.push(slot);
    } else {
      plan.unchanged.push(slot);
    }
  }

  const blockers = plan.preservedLive;
  for (const candidate of reactivationCandidates) {
    const blocker = findLiveBlocker(
      candidate.occurrence,
      candidate.slot.id,
      blockers,
    );
    if (blocker?.liveAppointmentId) {
      plan.unchanged.push(candidate.slot);
      plan.skippedLive.push({
        occurrence: candidate.occurrence,
        conflictingSlot: blocker,
        liveAppointmentId: blocker.liveAppointmentId,
      });
    } else {
      plan.reactivated.push(candidate);
    }
  }
  for (const { slot, occurrence } of pendingClearCandidates) {
    const blocker = findLiveBlocker(occurrence, slot.id, blockers);
    if (blocker?.liveAppointmentId) {
      plan.unchanged.push(slot);
      plan.skippedLive.push({
        occurrence,
        conflictingSlot: blocker,
        liveAppointmentId: blocker.liveAppointmentId,
      });
    } else {
      plan.clearedWithdrawalPending.push(slot);
    }
  }
  for (const occurrence of [...desiredByKey.values()].sort(
    compareOccurrences,
  )) {
    const blocker = findLiveBlocker(occurrence, null, blockers);
    if (blocker?.liveAppointmentId) {
      plan.skippedLive.push({
        occurrence,
        conflictingSlot: blocker,
        liveAppointmentId: blocker.liveAppointmentId,
      });
    } else {
      plan.created.push(occurrence);
    }
  }

  return plan;
}

function findLiveBlocker(
  occurrence: DesiredProviderAvailabilityOccurrence,
  ignoredSlotId: string | null,
  blockers: readonly ProviderAvailabilityStoredSlot[],
): ProviderAvailabilityStoredSlot | undefined {
  return blockers.find(
    (slot) =>
      slot.id !== ignoredSlotId &&
      slot.tenantId === occurrence.tenantId &&
      slot.practitionerId === occurrence.practitionerId &&
      intervalsOverlap(slot, occurrence),
  );
}

export function unionUtcHalfOpenIntervals(
  intervals: readonly UtcHalfOpenInterval[],
): UtcHalfOpenInterval[] {
  const sorted = intervals
    .map((interval) => {
      validateUtcInterval(interval);
      return {
        startsAt: new Date(interval.startsAt),
        endsAt: new Date(interval.endsAt),
      };
    })
    .sort(
      (left, right) =>
        left.startsAt.getTime() - right.startsAt.getTime() ||
        left.endsAt.getTime() - right.endsAt.getTime(),
    );
  const union: UtcHalfOpenInterval[] = [];

  for (const interval of sorted) {
    const previous = union.at(-1);
    if (!previous || previous.endsAt.getTime() < interval.startsAt.getTime()) {
      union.push(interval);
      continue;
    }
    if (interval.endsAt.getTime() > previous.endsAt.getTime()) {
      previous.endsAt = new Date(interval.endsAt);
    }
  }

  return union;
}

function generateTemplateDateOccurrences(input: {
  template: ProviderAvailabilityTemplateDefinition;
  localDate: string;
  frozenNow: Date;
  exceptions: readonly ProviderAvailabilityExceptionInterval[];
}): GeneratedTemplateDateOccurrences {
  // Resolve definition endpoints even when no complete duration fits. Invalid
  // local boundaries must fail the whole publication command.
  resolveLocalMinuteBoundary(
    input.localDate,
    input.template.localStartMinute,
    input.template.sourceTimezone,
  );
  resolveLocalMinuteBoundary(
    input.localDate,
    input.template.localEndMinute,
    input.template.sourceTimezone,
  );

  const activeExceptionUnion = unionUtcHalfOpenIntervals(
    matchingExceptionIntervals(input.template, input.exceptions),
  );
  const candidates: DesiredProviderAvailabilityOccurrence[] = [];
  const desired: DesiredProviderAvailabilityOccurrence[] = [];
  let exceptionExcludedCount = 0;

  for (
    let localStartMinute = input.template.localStartMinute;
    localStartMinute + input.template.durationMinutes <=
    input.template.localEndMinute;
    localStartMinute += input.template.durationMinutes
  ) {
    const startsAt = resolveLocalMinuteBoundary(
      input.localDate,
      localStartMinute,
      input.template.sourceTimezone,
    ).instant;
    const endsAt = resolveLocalMinuteBoundary(
      input.localDate,
      localStartMinute + input.template.durationMinutes,
      input.template.sourceTimezone,
    ).instant;
    assertElapsedDurationMinutes(
      startsAt,
      endsAt,
      input.template.durationMinutes,
    );

    if (startsAt.getTime() <= input.frozenNow.getTime()) continue;

    const occurrence: DesiredProviderAvailabilityOccurrence = {
      bookablePracticeId: input.template.bookablePracticeId,
      tenantId: input.template.tenantId,
      organizationId: input.template.organizationId,
      facilityId: input.template.facilityId,
      practitionerFacilityAssignmentId:
        input.template.practitionerFacilityAssignmentId,
      practitionerServiceAssignmentId:
        input.template.practitionerServiceAssignmentId,
      practitionerId: input.template.practitionerId,
      appointmentServiceId: input.template.appointmentServiceId,
      availabilityTemplateId: input.template.id,
      generationKeyHash: buildProviderSlotGenerationKeyHash({
        availabilityTemplateId: input.template.id,
        sourceLocalDate: input.localDate,
        startsAt,
        endsAt,
      }),
      sourceLocalDate: input.localDate,
      sourceTimezone: input.template.sourceTimezone,
      startsAt,
      endsAt,
    };
    candidates.push(occurrence);

    if (
      activeExceptionUnion.some((interval) =>
        intervalsOverlap(interval, occurrence),
      )
    ) {
      exceptionExcludedCount += 1;
    } else {
      desired.push(occurrence);
    }
  }

  return { candidates, desired, exceptionExcludedCount };
}

function validateTemplate(
  template: ProviderAvailabilityTemplateDefinition,
  facilityTimezone: string,
): void {
  assertIanaTimezone(facilityTimezone);
  if (template.sourceTimezone !== facilityTimezone) {
    throw new AvailabilityMaterializationError(
      'INVALID_TEMPLATE',
      'Availability template timezone must match the locked facility timezone.',
    );
  }
  if (template.status !== 'active' && template.status !== 'inactive') {
    throw new AvailabilityMaterializationError(
      'INVALID_TEMPLATE',
      'Availability template requires a supported lifecycle status.',
    );
  }
  if (
    !template.id ||
    !template.bookablePracticeId ||
    !template.tenantId ||
    !template.organizationId ||
    !template.facilityId ||
    !template.practitionerFacilityAssignmentId ||
    !template.practitionerServiceAssignmentId ||
    !template.practitionerId ||
    !template.appointmentServiceId
  ) {
    throw new AvailabilityMaterializationError(
      'INVALID_TEMPLATE',
      'Availability template requires one complete immutable provider scope.',
    );
  }
  if (
    !Number.isInteger(template.isoWeekday) ||
    template.isoWeekday < 1 ||
    template.isoWeekday > 7
  ) {
    throw new AvailabilityMaterializationError(
      'INVALID_TEMPLATE',
      'Availability template weekday must use ISO values 1 through 7.',
    );
  }
  if (
    !Number.isInteger(template.localStartMinute) ||
    !Number.isInteger(template.localEndMinute) ||
    template.localStartMinute < 0 ||
    template.localStartMinute > 1439 ||
    template.localEndMinute < 1 ||
    template.localEndMinute > 1440 ||
    template.localEndMinute <= template.localStartMinute
  ) {
    throw new AvailabilityMaterializationError(
      'INVALID_TEMPLATE',
      'Availability template must use an increasing same-day minute window.',
    );
  }
  if (
    !Number.isInteger(template.durationMinutes) ||
    template.durationMinutes < 1
  ) {
    throw new AvailabilityMaterializationError(
      'INVALID_TEMPLATE',
      'Availability service duration must be a positive whole number of minutes.',
    );
  }
  parseCanonicalLocalDate(template.effectiveFrom);
  if (
    template.effectiveUntil !== null &&
    compareCanonicalLocalDates(
      template.effectiveUntil,
      template.effectiveFrom,
    ) < 0
  ) {
    throw new AvailabilityMaterializationError(
      'INVALID_TEMPLATE',
      'Availability template effective end cannot precede its start.',
    );
  }
}

function validateExceptionIntervals(
  exceptions: readonly ProviderAvailabilityExceptionInterval[],
  sourceTimezone: string,
): void {
  for (const exception of exceptions) {
    if (exception.sourceTimezone !== sourceTimezone) {
      throw new AvailabilityMaterializationError(
        'INVALID_OCCURRENCE',
        'Availability exception timezone must match the locked facility timezone.',
      );
    }
    if (exception.status !== 'active' && exception.status !== 'cancelled') {
      throw new AvailabilityMaterializationError(
        'INVALID_OCCURRENCE',
        'Availability exception requires a supported lifecycle status.',
      );
    }
    validateUtcInterval(exception);
    const isFacilityClosure =
      exception.kind === 'facility_closed' &&
      exception.practitionerFacilityAssignmentId === null &&
      exception.practitionerId === null;
    const isPractitionerLeave =
      exception.kind === 'practitioner_unavailable' &&
      exception.practitionerFacilityAssignmentId !== null &&
      exception.practitionerId !== null;
    if (
      !exception.id ||
      !exception.facilityId ||
      (!isFacilityClosure && !isPractitionerLeave)
    ) {
      throw new AvailabilityMaterializationError(
        'INVALID_OCCURRENCE',
        'Availability exception requires one valid facility or practitioner scope.',
      );
    }
  }
}

function validateOccurrence(
  occurrence: DesiredProviderAvailabilityOccurrence,
): void {
  parseCanonicalLocalDate(occurrence.sourceLocalDate);
  assertIanaTimezone(occurrence.sourceTimezone);
  validateUtcInterval(occurrence);
  if (
    !occurrence.availabilityTemplateId ||
    !/^[0-9a-f]{64}$/.test(occurrence.generationKeyHash)
  ) {
    throw new AvailabilityMaterializationError(
      'INVALID_OCCURRENCE',
      'Availability occurrence requires an immutable template and SHA-256 generation key.',
    );
  }
  for (const value of scopeValues(occurrence)) {
    if (!value) {
      throw new AvailabilityMaterializationError(
        'INVALID_OCCURRENCE',
        'Availability occurrence requires one complete provider scope.',
      );
    }
  }
}

function validateStoredSlot(slot: ProviderAvailabilityStoredSlot): void {
  validateOccurrence(slot);
  if (!slot.id) {
    throw new AvailabilityMaterializationError(
      'INVALID_OCCURRENCE',
      'Persisted availability slot requires an opaque identifier.',
    );
  }
  if (slot.status === 'withdrawn' && slot.withdrawalPending) {
    throw new AvailabilityMaterializationError(
      'INVALID_OCCURRENCE',
      'A withdrawn availability slot cannot be pending withdrawal.',
    );
  }
}

function validateUtcInterval(interval: UtcHalfOpenInterval): void {
  if (
    !(interval.startsAt instanceof Date) ||
    !(interval.endsAt instanceof Date) ||
    !Number.isFinite(interval.startsAt.getTime()) ||
    !Number.isFinite(interval.endsAt.getTime()) ||
    interval.startsAt.getTime() >= interval.endsAt.getTime()
  ) {
    throw new AvailabilityMaterializationError(
      'INVALID_OCCURRENCE',
      'Availability UTC interval must have a valid increasing start and end.',
    );
  }
}

function matchingExceptionIntervals(
  template: ProviderAvailabilityTemplateDefinition,
  exceptions: readonly ProviderAvailabilityExceptionInterval[],
): UtcHalfOpenInterval[] {
  return exceptions
    .filter(
      (exception) =>
        exception.status === 'active' &&
        exception.facilityId === template.facilityId &&
        (exception.kind === 'facility_closed' ||
          (exception.practitionerFacilityAssignmentId ===
            template.practitionerFacilityAssignmentId &&
            exception.practitionerId === template.practitionerId)),
    )
    .map(({ startsAt, endsAt }) => ({ startsAt, endsAt }));
}

function templateAppliesOnLocalDate(
  template: ProviderAvailabilityTemplateDefinition,
  localDate: string,
): boolean {
  return (
    templateDateIsEffective(template, localDate) &&
    getIsoWeekday(localDate) === template.isoWeekday
  );
}

function templateDateIsEffective(
  template: ProviderAvailabilityTemplateDefinition,
  localDate: string,
): boolean {
  return (
    compareCanonicalLocalDates(localDate, template.effectiveFrom) >= 0 &&
    (template.effectiveUntil === null ||
      compareCanonicalLocalDates(localDate, template.effectiveUntil) <= 0)
  );
}

function assertDesiredOccurrencesDoNotOverlap(
  occurrences: readonly DesiredProviderAvailabilityOccurrence[],
): void {
  const previousByPractitioner = new Map<
    string,
    DesiredProviderAvailabilityOccurrence
  >();
  for (const occurrence of occurrences) {
    const key = `${occurrence.tenantId}:${occurrence.practitionerId}`;
    const previous = previousByPractitioner.get(key);
    if (previous && intervalsOverlap(previous, occurrence)) {
      throw new AvailabilityMaterializationError(
        'OVERLAPPING_DESIRED_OCCURRENCES',
        'Availability publication would overlap another desired slot for the same practitioner.',
      );
    }
    previousByPractitioner.set(key, occurrence);
  }
}

function assertStoredSlotMatchesOccurrence(
  slot: ProviderAvailabilityStoredSlot,
  occurrence: DesiredProviderAvailabilityOccurrence,
): void {
  if (
    occurrenceKey(slot) !== occurrenceKey(occurrence) ||
    slot.startsAt.getTime() !== occurrence.startsAt.getTime() ||
    slot.endsAt.getTime() !== occurrence.endsAt.getTime() ||
    slot.sourceLocalDate !== occurrence.sourceLocalDate ||
    slot.sourceTimezone !== occurrence.sourceTimezone ||
    scopeValues(slot).some(
      (value, index) => value !== scopeValues(occurrence)[index],
    )
  ) {
    throw new AvailabilityMaterializationError(
      'GENERATION_KEY_CONFLICT',
      'An existing availability generation key does not exactly match its immutable occurrence.',
    );
  }
}

function scopeValues(scope: ProviderAvailabilityScope): string[] {
  return [
    scope.bookablePracticeId,
    scope.tenantId,
    scope.organizationId,
    scope.facilityId,
    scope.practitionerFacilityAssignmentId,
    scope.practitionerServiceAssignmentId,
    scope.practitionerId,
    scope.appointmentServiceId,
  ];
}

function occurrenceKey(input: {
  availabilityTemplateId: string;
  generationKeyHash: string;
}): string {
  return `${input.availabilityTemplateId}:${input.generationKeyHash}`;
}

function intervalsOverlap(
  left: UtcHalfOpenInterval,
  right: UtcHalfOpenInterval,
): boolean {
  return (
    left.startsAt.getTime() < right.endsAt.getTime() &&
    right.startsAt.getTime() < left.endsAt.getTime()
  );
}

function compareOccurrences(
  left: DesiredProviderAvailabilityOccurrence,
  right: DesiredProviderAvailabilityOccurrence,
): number {
  return (
    left.startsAt.getTime() - right.startsAt.getTime() ||
    left.practitionerId.localeCompare(right.practitionerId) ||
    left.availabilityTemplateId.localeCompare(right.availabilityTemplateId) ||
    left.generationKeyHash.localeCompare(right.generationKeyHash)
  );
}

function compareStoredSlots(
  left: ProviderAvailabilityStoredSlot,
  right: ProviderAvailabilityStoredSlot,
): number {
  return compareOccurrences(left, right) || left.id.localeCompare(right.id);
}
