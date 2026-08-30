import { Temporal } from '@js-temporal/polyfill';

export const AVAILABILITY_HORIZON_DAYS = 56;
export const MAX_DESIRED_AVAILABILITY_OCCURRENCES = 10_000;

export type AvailabilityMaterializationErrorCode =
  | 'INVALID_FROZEN_TIME'
  | 'INVALID_TIMEZONE'
  | 'INVALID_LOCAL_DATE'
  | 'INVALID_LOCAL_MINUTE'
  | 'INVALID_LOCAL_EXCEPTION'
  | 'LOCAL_TIME_NOT_UNIQUE'
  | 'ELAPSED_DURATION_MISMATCH'
  | 'INVALID_TEMPLATE'
  | 'INVALID_OCCURRENCE'
  | 'OCCURRENCE_LIMIT_EXCEEDED'
  | 'OVERLAPPING_DESIRED_OCCURRENCES'
  | 'GENERATION_KEY_CONFLICT';

export class AvailabilityMaterializationError extends Error {
  constructor(
    readonly code: AvailabilityMaterializationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AvailabilityMaterializationError';
  }
}

export interface AvailabilityPublicationHorizon {
  sourceTimezone: string;
  frozenNow: Date;
  localStartDate: string;
  localEndDateExclusive: string;
}

export interface ResolvedLocalBoundary {
  canonicalLocalDateTime: string;
  instant: Date;
}

export interface ResolvedAvailabilityException {
  localStartsAt: string;
  localEndsAt: string;
  startsAt: Date;
  endsAt: Date;
  sourceTimezone: string;
  isAllDay: boolean;
}

const CANONICAL_LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CANONICAL_LOCAL_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:00$/;
const MILLISECONDS_PER_MINUTE = 60_000;

export function captureAvailabilityHorizon(
  frozenNow: Date,
  sourceTimezone: string,
): AvailabilityPublicationHorizon {
  assertFiniteDate(frozenNow, 'INVALID_FROZEN_TIME', 'command time');
  assertIanaTimezone(sourceTimezone);

  const localStartDate = Temporal.Instant.fromEpochMilliseconds(
    frozenNow.getTime(),
  )
    .toZonedDateTimeISO(sourceTimezone)
    .toPlainDate();

  return {
    sourceTimezone,
    frozenNow: new Date(frozenNow),
    localStartDate: localStartDate.toString(),
    localEndDateExclusive: localStartDate
      .add({ days: AVAILABILITY_HORIZON_DAYS })
      .toString(),
  };
}

export function assertIanaTimezone(sourceTimezone: string): void {
  if (
    sourceTimezone.trim() !== sourceTimezone ||
    sourceTimezone.length === 0 ||
    sourceTimezone.startsWith('+') ||
    sourceTimezone.startsWith('-') ||
    sourceTimezone === 'Z'
  ) {
    throw new AvailabilityMaterializationError(
      'INVALID_TIMEZONE',
      'Availability source timezone must be a valid IANA timezone.',
    );
  }

  try {
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(
      sourceTimezone,
    );
  } catch {
    throw new AvailabilityMaterializationError(
      'INVALID_TIMEZONE',
      'Availability source timezone must be a valid IANA timezone.',
    );
  }
}

export function parseCanonicalLocalDate(value: string): Temporal.PlainDate {
  if (!CANONICAL_LOCAL_DATE.test(value)) {
    throw new AvailabilityMaterializationError(
      'INVALID_LOCAL_DATE',
      'Availability local date must use canonical YYYY-MM-DD format.',
    );
  }

  try {
    const date = Temporal.PlainDate.from(value);
    if (date.year < 1 || date.toString() !== value) {
      throw new Error('Non-canonical local date.');
    }
    return date;
  } catch {
    throw new AvailabilityMaterializationError(
      'INVALID_LOCAL_DATE',
      'Availability local date must be a valid canonical calendar date.',
    );
  }
}

export function parseCanonicalLocalDateTime(
  value: string,
): Temporal.PlainDateTime {
  if (!CANONICAL_LOCAL_DATE_TIME.test(value)) {
    throw new AvailabilityMaterializationError(
      'INVALID_LOCAL_EXCEPTION',
      'Availability exception time must use canonical YYYY-MM-DDTHH:mm:00 format.',
    );
  }

  try {
    const dateTime = Temporal.PlainDateTime.from(value);
    if (
      dateTime.year < 1 ||
      dateTime.toString({ smallestUnit: 'second' }) !== value
    ) {
      throw new Error('Non-canonical local date-time.');
    }
    return dateTime;
  } catch {
    throw new AvailabilityMaterializationError(
      'INVALID_LOCAL_EXCEPTION',
      'Availability exception time must be a valid canonical local date-time.',
    );
  }
}

/** Resolve a same-day template minute. Minute 1440 means next local midnight. */
export function resolveLocalMinuteBoundary(
  localDate: string,
  minuteOfDay: number,
  sourceTimezone: string,
): ResolvedLocalBoundary {
  const date = parseCanonicalLocalDate(localDate);
  if (
    !Number.isInteger(minuteOfDay) ||
    minuteOfDay < 0 ||
    minuteOfDay > 24 * 60
  ) {
    throw new AvailabilityMaterializationError(
      'INVALID_LOCAL_MINUTE',
      'Availability boundary minute must be an integer from 0 through 1440.',
    );
  }

  const boundaryDate = minuteOfDay === 24 * 60 ? date.add({ days: 1 }) : date;
  const normalizedMinute = minuteOfDay === 24 * 60 ? 0 : minuteOfDay;
  const plainDateTime = boundaryDate.toPlainDateTime({
    hour: Math.floor(normalizedMinute / 60),
    minute: normalizedMinute % 60,
  });

  return resolvePlainDateTime(plainDateTime, sourceTimezone);
}

export function resolveCanonicalLocalException(input: {
  localStartsAt: string;
  localEndsAt: string;
  sourceTimezone: string;
  isAllDay: boolean;
  horizon?: AvailabilityPublicationHorizon;
}): ResolvedAvailabilityException {
  const localStart = parseCanonicalLocalDateTime(input.localStartsAt);
  const localEnd = parseCanonicalLocalDateTime(input.localEndsAt);
  assertIanaTimezone(input.sourceTimezone);

  if (Temporal.PlainDateTime.compare(localStart, localEnd) >= 0) {
    throw new AvailabilityMaterializationError(
      'INVALID_LOCAL_EXCEPTION',
      'Availability exception end must be after its start.',
    );
  }

  if (
    input.isAllDay &&
    (!isLocalMidnight(localStart) ||
      !isLocalMidnight(localEnd) ||
      !localEnd.equals(localStart.add({ days: 1 })))
  ) {
    throw new AvailabilityMaterializationError(
      'INVALID_LOCAL_EXCEPTION',
      'An all-day availability exception must cover one local midnight-to-midnight day.',
    );
  }

  if (input.horizon) {
    assertExceptionHorizon(input.horizon, input.sourceTimezone);
    const horizonStart = parseCanonicalLocalDate(
      input.horizon.localStartDate,
    ).toPlainDateTime();
    const horizonEnd = parseCanonicalLocalDate(
      input.horizon.localEndDateExclusive,
    ).toPlainDateTime();

    if (
      Temporal.PlainDateTime.compare(localStart, horizonStart) < 0 ||
      Temporal.PlainDateTime.compare(localEnd, horizonEnd) > 0
    ) {
      throw new AvailabilityMaterializationError(
        'INVALID_LOCAL_EXCEPTION',
        'Availability exception must remain inside the current 56-day local publication horizon.',
      );
    }
  }

  const startsAt = resolvePlainDateTime(
    localStart,
    input.sourceTimezone,
  ).instant;
  const endsAt = resolvePlainDateTime(localEnd, input.sourceTimezone).instant;

  if (startsAt.getTime() >= endsAt.getTime()) {
    throw new AvailabilityMaterializationError(
      'INVALID_LOCAL_EXCEPTION',
      'Availability exception must resolve to an increasing UTC interval.',
    );
  }

  return {
    localStartsAt: input.localStartsAt,
    localEndsAt: input.localEndsAt,
    startsAt,
    endsAt,
    sourceTimezone: input.sourceTimezone,
    isAllDay: input.isAllDay,
  };
}

export function assertElapsedDurationMinutes(
  startsAt: Date,
  endsAt: Date,
  durationMinutes: number,
): void {
  assertFiniteDate(startsAt, 'INVALID_OCCURRENCE', 'slot start');
  assertFiniteDate(endsAt, 'INVALID_OCCURRENCE', 'slot end');
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1) {
    throw new AvailabilityMaterializationError(
      'INVALID_TEMPLATE',
      'Availability service duration must be a positive whole number of minutes.',
    );
  }

  if (
    endsAt.getTime() - startsAt.getTime() !==
    durationMinutes * MILLISECONDS_PER_MINUTE
  ) {
    throw new AvailabilityMaterializationError(
      'ELAPSED_DURATION_MISMATCH',
      'Availability slot does not preserve the configured elapsed service duration.',
    );
  }
}

export function compareCanonicalLocalDates(
  left: string,
  right: string,
): number {
  return Temporal.PlainDate.compare(
    parseCanonicalLocalDate(left),
    parseCanonicalLocalDate(right),
  );
}

export function addLocalCalendarDays(localDate: string, days: number): string {
  if (!Number.isInteger(days)) {
    throw new AvailabilityMaterializationError(
      'INVALID_LOCAL_DATE',
      'Local calendar-day increment must be a whole number.',
    );
  }
  return parseCanonicalLocalDate(localDate).add({ days }).toString();
}

export function getIsoWeekday(localDate: string): number {
  return parseCanonicalLocalDate(localDate).dayOfWeek;
}

function resolvePlainDateTime(
  plainDateTime: Temporal.PlainDateTime,
  sourceTimezone: string,
): ResolvedLocalBoundary {
  assertIanaTimezone(sourceTimezone);

  try {
    const zoned = plainDateTime.toZonedDateTime(sourceTimezone, {
      disambiguation: 'reject',
    });
    if (!zoned.toPlainDateTime().equals(plainDateTime)) {
      throw new Error('Local time did not round-trip exactly.');
    }

    const instant = new Date(zoned.epochMilliseconds);
    assertFiniteDate(instant, 'LOCAL_TIME_NOT_UNIQUE', 'resolved local time');
    return {
      canonicalLocalDateTime: plainDateTime.toString({
        smallestUnit: 'second',
      }),
      instant,
    };
  } catch (error) {
    if (error instanceof AvailabilityMaterializationError) throw error;
    throw new AvailabilityMaterializationError(
      'LOCAL_TIME_NOT_UNIQUE',
      'Availability local time must resolve to exactly one UTC instant.',
    );
  }
}

function assertExceptionHorizon(
  horizon: AvailabilityPublicationHorizon,
  sourceTimezone: string,
): void {
  assertFiniteDate(horizon.frozenNow, 'INVALID_FROZEN_TIME', 'command time');
  if (
    horizon.sourceTimezone !== sourceTimezone ||
    addLocalCalendarDays(horizon.localStartDate, AVAILABILITY_HORIZON_DAYS) !==
      horizon.localEndDateExclusive
  ) {
    throw new AvailabilityMaterializationError(
      'INVALID_LOCAL_EXCEPTION',
      'Availability exception horizon must be the server-owned 56-day facility-local range.',
    );
  }
}

function isLocalMidnight(value: Temporal.PlainDateTime): boolean {
  return (
    value.hour === 0 &&
    value.minute === 0 &&
    value.second === 0 &&
    value.millisecond === 0 &&
    value.microsecond === 0 &&
    value.nanosecond === 0
  );
}

function assertFiniteDate(
  value: Date,
  code: AvailabilityMaterializationErrorCode,
  label: string,
): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new AvailabilityMaterializationError(
      code,
      `Availability ${label} must be a valid instant.`,
    );
  }
}
