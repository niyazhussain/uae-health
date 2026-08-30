import {
  addLocalCalendarDays,
  assertIanaTimezone,
  AvailabilityMaterializationError,
  type AvailabilityMaterializationErrorCode,
  captureAvailabilityHorizon,
  resolveCanonicalLocalException,
  resolveLocalMinuteBoundary,
} from './provider-availability-time.js';

describe('provider availability facility-local time', () => {
  it('captures exactly 56 facility-local calendar dates from one frozen instant', () => {
    const horizon = captureAvailabilityHorizon(
      new Date('2026-08-30T22:30:00.000Z'),
      'Asia/Dubai',
    );

    expect(horizon).toEqual({
      sourceTimezone: 'Asia/Dubai',
      frozenNow: new Date('2026-08-30T22:30:00.000Z'),
      localStartDate: '2026-08-31',
      localEndDateExclusive: '2026-10-26',
    });
    expect(addLocalCalendarDays(horizon.localStartDate, 56)).toBe(
      horizon.localEndDateExclusive,
    );
  });

  it('accepts IANA zones and rejects fixed-offset identifiers', () => {
    expect(() => assertIanaTimezone('Asia/Dubai')).not.toThrow();
    expect(() => assertIanaTimezone('America/New_York')).not.toThrow();
    expectAvailabilityError(
      () => assertIanaTimezone('+04:00'),
      'INVALID_TIMEZONE',
    );
  });

  it('resolves minute 1440 as the following local midnight', () => {
    expect(
      resolveLocalMinuteBoundary('2026-08-31', 1440, 'Asia/Dubai'),
    ).toEqual({
      canonicalLocalDateTime: '2026-09-01T00:00:00',
      instant: new Date('2026-08-31T20:00:00.000Z'),
    });
  });

  it.each([
    ['2026-03-08', 2 * 60 + 30],
    ['2026-11-01', 1 * 60 + 30],
  ])(
    'rejects a nonexistent or ambiguous New York boundary on %s',
    (localDate, minuteOfDay) => {
      expectAvailabilityError(
        () =>
          resolveLocalMinuteBoundary(
            localDate,
            minuteOfDay,
            'America/New_York',
          ),
        'LOCAL_TIME_NOT_UNIQUE',
      );
    },
  );

  it('requires canonical minute-precision exception evidence', () => {
    const horizon = captureAvailabilityHorizon(
      new Date('2026-08-30T00:00:00.000Z'),
      'Asia/Dubai',
    );
    expect(
      resolveCanonicalLocalException({
        localStartsAt: '2026-08-31T09:00:00',
        localEndsAt: '2026-08-31T09:30:00',
        sourceTimezone: 'Asia/Dubai',
        isAllDay: false,
        horizon,
      }),
    ).toMatchObject({
      startsAt: new Date('2026-08-31T05:00:00.000Z'),
      endsAt: new Date('2026-08-31T05:30:00.000Z'),
    });

    for (const localStartsAt of [
      '2026-8-31T09:00:00',
      '2026-08-31T09:00',
      '2026-08-31T09:00:30',
      '2026-08-31T09:00:00Z',
    ]) {
      expectAvailabilityError(
        () =>
          resolveCanonicalLocalException({
            localStartsAt,
            localEndsAt: '2026-08-31T09:30:00',
            sourceTimezone: 'Asia/Dubai',
            isAllDay: false,
            horizon,
          }),
        'INVALID_LOCAL_EXCEPTION',
      );
    }
  });

  it('allows one local all-day exception across a daylight-saving transition', () => {
    const horizon = captureAvailabilityHorizon(
      new Date('2026-03-07T00:00:00.000Z'),
      'America/New_York',
    );
    const exception = resolveCanonicalLocalException({
      localStartsAt: '2026-03-08T00:00:00',
      localEndsAt: '2026-03-09T00:00:00',
      sourceTimezone: 'America/New_York',
      isAllDay: true,
      horizon,
    });

    expect(exception.endsAt.getTime() - exception.startsAt.getTime()).toBe(
      23 * 60 * 60_000,
    );
  });

  it('bounds exceptions to the current local publication horizon', () => {
    const horizon = captureAvailabilityHorizon(
      new Date('2026-08-30T00:00:00.000Z'),
      'Asia/Dubai',
    );

    expectAvailabilityError(
      () =>
        resolveCanonicalLocalException({
          localStartsAt: '2026-10-24T23:30:00',
          localEndsAt: '2026-10-25T00:01:00',
          sourceTimezone: 'Asia/Dubai',
          isAllDay: false,
          horizon,
        }),
      'INVALID_LOCAL_EXCEPTION',
    );
  });

  it('exposes stable domain error codes', () => {
    try {
      captureAvailabilityHorizon(new Date('invalid'), 'Asia/Dubai');
      throw new Error('Expected invalid time rejection.');
    } catch (error) {
      expect(error).toBeInstanceOf(AvailabilityMaterializationError);
      expect(error).toMatchObject({ code: 'INVALID_FROZEN_TIME' });
    }
  });
});

function expectAvailabilityError(
  action: () => unknown,
  code: AvailabilityMaterializationErrorCode,
): void {
  try {
    action();
    throw new Error(`Expected availability error ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(AvailabilityMaterializationError);
    expect((error as AvailabilityMaterializationError).code).toBe(code);
  }
}
