import {
  evaluateProviderSlotCurrentValidity,
  materializeProviderAvailability,
  planProviderAvailabilityReconciliation,
  type DesiredProviderAvailabilityOccurrence,
  type ProviderAvailabilityExceptionInterval,
  type ProviderAvailabilityStoredSlot,
  type ProviderAvailabilityTemplateDefinition,
  unionUtcHalfOpenIntervals,
} from './provider-availability-materializer.js';
import { buildProviderSlotGenerationKeyHash } from './provider-slot-generation-key.js';
import {
  AvailabilityMaterializationError,
  type AvailabilityMaterializationErrorCode,
} from './provider-availability-time.js';

const scope = {
  bookablePracticeId: 'a0000000-0000-4000-8000-000000000001',
  tenantId: '10000000-0000-4000-8000-000000000001',
  organizationId: '20000000-0000-4000-8000-000000000001',
  facilityId: 'b0000000-0000-4000-8000-000000000001',
  practitionerFacilityAssignmentId: 'b1000000-0000-4000-8000-000000000001',
  practitionerServiceAssignmentId: 'b2000000-0000-4000-8000-000000000001',
  practitionerId: 'b3000000-0000-4000-8000-000000000001',
  appointmentServiceId: 'b4000000-0000-4000-8000-000000000001',
} as const;

const dubaiMondayTemplate: ProviderAvailabilityTemplateDefinition = {
  id: 'c0000000-0000-4000-8000-000000000001',
  ...scope,
  isoWeekday: 1,
  localStartMinute: 9 * 60,
  localEndMinute: 10 * 60 + 15,
  effectiveFrom: '2026-01-01',
  effectiveUntil: null,
  sourceTimezone: 'Asia/Dubai',
  durationMinutes: 30,
  status: 'active',
};

describe('provider availability materializer', () => {
  it('generates a deterministic 56-local-day horizon and drops a trailing remainder', () => {
    const input = {
      frozenNow: new Date('2026-08-30T00:00:00.000Z'),
      sourceTimezone: 'Asia/Dubai',
      templates: [dubaiMondayTemplate],
      exceptions: [],
    } as const;
    const first = materializeProviderAvailability(input);
    const retry = materializeProviderAvailability(input);

    expect(retry).toEqual(first);
    expect(first.horizon).toMatchObject({
      localStartDate: '2026-08-30',
      localEndDateExclusive: '2026-10-25',
    });
    expect(first.consideredOccurrenceCount).toBe(16);
    expect(first.occurrences).toHaveLength(16);
    expect(first.occurrences[0]).toMatchObject({
      ...scope,
      availabilityTemplateId: dubaiMondayTemplate.id,
      sourceLocalDate: '2026-08-31',
      sourceTimezone: 'Asia/Dubai',
      startsAt: new Date('2026-08-31T05:00:00.000Z'),
      endsAt: new Date('2026-08-31T05:30:00.000Z'),
    });
    expect(first.occurrences[1].startsAt).toEqual(
      new Date('2026-08-31T05:30:00.000Z'),
    );
  });

  it('subtracts the active applicable exception union using half-open intervals', () => {
    const exceptions: ProviderAvailabilityExceptionInterval[] = [
      {
        id: 'e0000000-0000-4000-8000-000000000001',
        facilityId: scope.facilityId,
        practitionerFacilityAssignmentId: null,
        practitionerId: null,
        kind: 'facility_closed',
        startsAt: new Date('2026-08-31T05:30:00.000Z'),
        endsAt: new Date('2026-08-31T06:00:00.000Z'),
        sourceTimezone: 'Asia/Dubai',
        status: 'active',
      },
      {
        id: 'e0000000-0000-4000-8000-000000000002',
        facilityId: scope.facilityId,
        practitionerFacilityAssignmentId:
          scope.practitionerFacilityAssignmentId,
        practitionerId: scope.practitionerId,
        kind: 'practitioner_unavailable',
        startsAt: new Date('2026-08-31T05:45:00.000Z'),
        endsAt: new Date('2026-08-31T06:15:00.000Z'),
        sourceTimezone: 'Asia/Dubai',
        status: 'cancelled',
      },
      {
        id: 'e0000000-0000-4000-8000-000000000003',
        facilityId: 'different-facility',
        practitionerFacilityAssignmentId: null,
        practitionerId: null,
        kind: 'facility_closed',
        startsAt: new Date('2026-08-31T05:00:00.000Z'),
        endsAt: new Date('2026-08-31T05:30:00.000Z'),
        sourceTimezone: 'Asia/Dubai',
        status: 'active',
      },
    ];

    const result = materializeProviderAvailability({
      frozenNow: new Date('2026-08-30T00:00:00.000Z'),
      sourceTimezone: 'Asia/Dubai',
      templates: [dubaiMondayTemplate],
      exceptions,
    });

    expect(result.consideredOccurrenceCount).toBe(16);
    expect(result.exceptionExcludedCount).toBe(1);
    expect(result.occurrences).toHaveLength(15);
    expect(result.occurrences[0].startsAt).toEqual(
      new Date('2026-08-31T05:00:00.000Z'),
    );
    expect(result.occurrences[1].startsAt).toEqual(
      new Date('2026-09-07T05:00:00.000Z'),
    );
  });

  it('emits only starts strictly after the frozen command instant', () => {
    const result = materializeProviderAvailability({
      frozenNow: new Date('2026-08-30T00:00:00.000Z'),
      sourceTimezone: 'Asia/Dubai',
      templates: [
        {
          ...dubaiMondayTemplate,
          id: 'c0000000-0000-4000-8000-000000000002',
          isoWeekday: 7,
          localStartMinute: 4 * 60,
          localEndMinute: 5 * 60,
        },
      ],
      exceptions: [],
    });

    expect(result.occurrences[0]).toMatchObject({
      sourceLocalDate: '2026-08-30',
      startsAt: new Date('2026-08-30T00:30:00.000Z'),
    });
    expect(
      result.occurrences.some(
        (occurrence) =>
          occurrence.startsAt.getTime() ===
          new Date('2026-08-30T00:00:00.000Z').getTime(),
      ),
    ).toBe(false);
  });

  it('supports an exact following-midnight slot boundary', () => {
    const result = materializeProviderAvailability({
      frozenNow: new Date('2026-08-30T00:00:00.000Z'),
      sourceTimezone: 'Asia/Dubai',
      templates: [
        {
          ...dubaiMondayTemplate,
          localStartMinute: 23 * 60 + 30,
          localEndMinute: 1440,
        },
      ],
      exceptions: [],
    });

    expect(result.occurrences[0]).toMatchObject({
      startsAt: new Date('2026-08-31T19:30:00.000Z'),
      endsAt: new Date('2026-08-31T20:00:00.000Z'),
      sourceLocalDate: '2026-08-31',
    });
  });

  it('iterates local dates while UTC offsets change across daylight saving', () => {
    const result = materializeProviderAvailability({
      frozenNow: new Date('2026-02-27T12:00:00.000Z'),
      sourceTimezone: 'America/New_York',
      templates: [
        {
          ...dubaiMondayTemplate,
          sourceTimezone: 'America/New_York',
          localStartMinute: 9 * 60,
          localEndMinute: 9 * 60 + 30,
        },
      ],
      exceptions: [],
    });

    expect(
      result.occurrences.slice(0, 2).map((occurrence) => ({
        localDate: occurrence.sourceLocalDate,
        utcStart: occurrence.startsAt.toISOString(),
      })),
    ).toEqual([
      { localDate: '2026-03-02', utcStart: '2026-03-02T14:00:00.000Z' },
      { localDate: '2026-03-09', utcStart: '2026-03-09T13:00:00.000Z' },
    ]);
  });

  it('rejects every nonexistent interior boundary at a daylight-saving gap', () => {
    expectAvailabilityError(
      () =>
        materializeProviderAvailability({
          frozenNow: new Date('2026-03-06T12:00:00.000Z'),
          sourceTimezone: 'America/New_York',
          templates: [
            {
              ...dubaiMondayTemplate,
              sourceTimezone: 'America/New_York',
              isoWeekday: 7,
              localStartMinute: 0,
              localEndMinute: 4 * 60,
            },
          ],
          exceptions: [],
        }),
      'LOCAL_TIME_NOT_UNIQUE',
    );
  });

  it('rejects a duration whose valid wall boundaries change elapsed UTC minutes', () => {
    expectAvailabilityError(
      () =>
        materializeProviderAvailability({
          frozenNow: new Date('2026-10-30T12:00:00.000Z'),
          sourceTimezone: 'America/New_York',
          templates: [
            {
              ...dubaiMondayTemplate,
              sourceTimezone: 'America/New_York',
              isoWeekday: 7,
              localStartMinute: 30,
              localEndMinute: 2 * 60 + 30,
              durationMinutes: 120,
            },
          ],
          exceptions: [],
        }),
      'ELAPSED_DURATION_MISMATCH',
    );
  });

  it('fails atomically before considering more than 10,000 future occurrences', () => {
    expectAvailabilityError(
      () =>
        materializeProviderAvailability({
          frozenNow: new Date('2026-08-29T00:00:00.000Z'),
          sourceTimezone: 'Etc/UTC',
          templates: [
            {
              ...dubaiMondayTemplate,
              sourceTimezone: 'Etc/UTC',
              isoWeekday: 7,
              localStartMinute: 0,
              localEndMinute: 1440,
              durationMinutes: 1,
            },
          ],
          exceptions: [],
        }),
      'OCCURRENCE_LIMIT_EXCEEDED',
    );
  });

  it('rejects overlapping desired slots for one tenant practitioner', () => {
    expectAvailabilityError(
      () =>
        materializeProviderAvailability({
          frozenNow: new Date('2026-08-30T00:00:00.000Z'),
          sourceTimezone: 'Asia/Dubai',
          templates: [
            dubaiMondayTemplate,
            {
              ...dubaiMondayTemplate,
              id: 'c0000000-0000-4000-8000-000000000099',
              practitionerServiceAssignmentId:
                'b2000000-0000-4000-8000-000000000099',
              appointmentServiceId: 'b4000000-0000-4000-8000-000000000099',
            },
          ],
          exceptions: [],
        }),
      'OVERLAPPING_DESIRED_OCCURRENCES',
    );
  });

  it('merges overlapping and adjacent half-open exception intervals', () => {
    expect(
      unionUtcHalfOpenIntervals([
        {
          startsAt: new Date('2026-08-31T05:30:00.000Z'),
          endsAt: new Date('2026-08-31T06:00:00.000Z'),
        },
        {
          startsAt: new Date('2026-08-31T05:45:00.000Z'),
          endsAt: new Date('2026-08-31T06:30:00.000Z'),
        },
        {
          startsAt: new Date('2026-08-31T06:30:00.000Z'),
          endsAt: new Date('2026-08-31T07:00:00.000Z'),
        },
      ]),
    ).toEqual([
      {
        startsAt: new Date('2026-08-31T05:30:00.000Z'),
        endsAt: new Date('2026-08-31T07:00:00.000Z'),
      },
    ]);
  });

  it('evaluates one pending slot with the same generation and exception rules', () => {
    const result = materializeProviderAvailability({
      frozenNow: new Date('2026-08-30T00:00:00.000Z'),
      sourceTimezone: 'Asia/Dubai',
      templates: [dubaiMondayTemplate],
      exceptions: [],
    });
    const slot = storedSlot('slot-1', result.occurrences[0], {
      withdrawalPending: true,
      liveAppointmentId: 'appointment-1',
    });
    expect(
      evaluateProviderSlotCurrentValidity({
        frozenNow: new Date('2026-08-30T00:00:00.000Z'),
        sourceTimezone: 'Asia/Dubai',
        template: dubaiMondayTemplate,
        exceptions: [],
        slot,
      }),
    ).toMatchObject({ isDesired: true, reason: 'desired' });

    const exception: ProviderAvailabilityExceptionInterval = {
      id: 'exception-1',
      facilityId: scope.facilityId,
      practitionerFacilityAssignmentId: null,
      practitionerId: null,
      kind: 'facility_closed',
      startsAt: new Date(slot.startsAt),
      endsAt: new Date(slot.endsAt),
      sourceTimezone: 'Asia/Dubai',
      status: 'active',
    };
    expect(
      evaluateProviderSlotCurrentValidity({
        frozenNow: new Date('2026-08-30T00:00:00.000Z'),
        sourceTimezone: 'Asia/Dubai',
        template: dubaiMondayTemplate,
        exceptions: [exception],
        slot,
      }),
    ).toMatchObject({ isDesired: false, reason: 'exception-covered' });
  });

  it('plans create, reuse, reactivation, withdrawal, and live preservation deterministically', () => {
    const desired = [
      occurrence('desired-1', '2026-08-31T05:00:00.000Z'),
      occurrence('desired-2', '2026-08-31T06:00:00.000Z'),
      occurrence('desired-3', '2026-08-31T07:00:00.000Z'),
      occurrence('desired-4', '2026-08-31T08:00:00.000Z'),
      occurrence('desired-5', '2026-08-31T09:00:00.000Z'),
    ];
    const existing = [
      storedSlot('slot-1', desired[0]),
      storedSlot('slot-2', desired[1], { status: 'withdrawn' }),
      storedSlot('slot-pending', desired[4], {
        withdrawalPending: true,
        liveAppointmentId: 'appointment-pending',
      }),
      storedSlot(
        'slot-live',
        occurrence('obsolete-live', '2026-08-31T07:15:00.000Z'),
        { liveAppointmentId: 'appointment-live' },
      ),
      storedSlot(
        'slot-obsolete',
        occurrence('obsolete-free', '2026-08-31T10:00:00.000Z'),
      ),
    ];

    const plan = planProviderAvailabilityReconciliation({
      desiredOccurrences: desired,
      existingSlots: existing,
    });

    expect(plan.unchanged.map(({ id }) => id)).toEqual(['slot-1']);
    expect(plan.reactivated.map(({ slot }) => slot.id)).toEqual(['slot-2']);
    expect(plan.clearedWithdrawalPending.map(({ id }) => id)).toEqual([
      'slot-pending',
    ]);
    expect(plan.withdrawn.map(({ id }) => id)).toEqual(['slot-obsolete']);
    expect(plan.preservedLive.map(({ id }) => id)).toEqual(['slot-live']);
    expect(plan.skippedLive).toMatchObject([
      {
        occurrence: { availabilityTemplateId: 'desired-3' },
        conflictingSlot: { id: 'slot-live' },
        liveAppointmentId: 'appointment-live',
      },
    ]);
    expect(
      plan.created.map(({ availabilityTemplateId }) => availabilityTemplateId),
    ).toEqual(['desired-4']);
  });

  it('keeps an exact withdrawn occurrence unavailable when a private live slot overlaps it', () => {
    const desired = occurrence(
      'withdrawn-local-template',
      '2026-08-31T05:00:00.000Z',
    );
    const withdrawn = storedSlot('withdrawn-local-slot', desired, {
      status: 'withdrawn',
    });
    const privateBlocker = storedSlot(
      'private-sibling-slot',
      occurrence('private-sibling-template', '2026-08-31T05:15:00.000Z'),
      {
        bookablePracticeId: 'a0000000-0000-4000-8000-000000000002',
        organizationId: '20000000-0000-4000-8000-000000000002',
        facilityId: 'b0000000-0000-4000-8000-000000000002',
        practitionerFacilityAssignmentId:
          'b1000000-0000-4000-8000-000000000002',
        practitionerServiceAssignmentId: 'b2000000-0000-4000-8000-000000000002',
        appointmentServiceId: 'b4000000-0000-4000-8000-000000000002',
        liveAppointmentId: 'private-scope-blocker',
      },
    );

    const plan = planProviderAvailabilityReconciliation({
      desiredOccurrences: [desired],
      existingSlots: [withdrawn, privateBlocker],
    });

    expect(plan.reactivated).toEqual([]);
    expect(plan.unchanged.map(({ id }) => id)).toContain(withdrawn.id);
    expect(plan.skippedLive).toMatchObject([
      {
        occurrence: { availabilityTemplateId: desired.availabilityTemplateId },
        conflictingSlot: { id: privateBlocker.id },
        liveAppointmentId: 'private-scope-blocker',
      },
    ]);
  });

  it('reactivates an exact withdrawn occurrence when live blockers do not overlap it', () => {
    const desired = occurrence(
      'safe-reactivation-template',
      '2026-08-31T06:00:00.000Z',
    );
    const withdrawn = storedSlot('safe-reactivation-slot', desired, {
      status: 'withdrawn',
    });
    const nonoverlappingBlocker = storedSlot(
      'nonoverlapping-live-slot',
      occurrence('nonoverlapping-template', '2026-08-31T07:00:00.000Z'),
      { liveAppointmentId: 'private-scope-blocker' },
    );

    const plan = planProviderAvailabilityReconciliation({
      desiredOccurrences: [desired],
      existingSlots: [withdrawn, nonoverlappingBlocker],
    });

    expect(plan.reactivated.map(({ slot }) => slot.id)).toEqual([withdrawn.id]);
    expect(plan.skippedLive).toEqual([]);
  });

  it('rejects immutable drift under an existing generation key', () => {
    const desired = occurrence(
      'collision-template',
      '2026-08-31T05:00:00.000Z',
    );
    const drifted = storedSlot('collision-slot', desired, {
      endsAt: new Date('2026-08-31T05:45:00.000Z'),
    });

    expectAvailabilityError(
      () =>
        planProviderAvailabilityReconciliation({
          desiredOccurrences: [desired],
          existingSlots: [drifted],
        }),
      'GENERATION_KEY_CONFLICT',
    );
  });

  it('keeps the v1 generation formula byte-compatible with the synthetic seed', () => {
    expect(
      buildProviderSlotGenerationKeyHash({
        availabilityTemplateId: 'b9d2a0c4-823c-b19c-aa45-0e0b812fe901',
        sourceLocalDate: '2026-08-28',
        startsAt: new Date('2026-08-28T09:00:00.000Z'),
        endsAt: new Date('2026-08-28T09:45:00.000Z'),
      }),
    ).toBe('d7438c96f10ffc8e3b891294122a86db9418211278f5c6140469cc1607e1d64e');
  });
});

function occurrence(
  availabilityTemplateId: string,
  startsAtIso: string,
): DesiredProviderAvailabilityOccurrence {
  const startsAt = new Date(startsAtIso);
  const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
  const sourceLocalDate = '2026-08-31';
  return {
    ...scope,
    availabilityTemplateId,
    generationKeyHash: buildProviderSlotGenerationKeyHash({
      availabilityTemplateId,
      sourceLocalDate,
      startsAt,
      endsAt,
    }),
    sourceLocalDate,
    sourceTimezone: 'Asia/Dubai',
    startsAt,
    endsAt,
  };
}

function storedSlot(
  id: string,
  desired: DesiredProviderAvailabilityOccurrence,
  overrides: Partial<ProviderAvailabilityStoredSlot> = {},
): ProviderAvailabilityStoredSlot {
  return {
    ...desired,
    id,
    status: 'available',
    withdrawalPending: false,
    liveAppointmentId: null,
    ...overrides,
  };
}

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
