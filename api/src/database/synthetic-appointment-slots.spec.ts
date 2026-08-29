import {
  assertSyntheticAppointmentSlotMatch,
  assertSyntheticAvailabilityTemplateMatch,
  assertSyntheticSchedulingFacilityScope,
  buildSyntheticAppointmentFixtures,
  buildSyntheticAppointmentSlots,
  buildSyntheticFacilityCode,
  buildSyntheticProviderFixtureId,
  inferSyntheticAppointmentDurationMinutes,
} from './synthetic-appointment-slots.js';

const providerScope = {
  facilityId: 'b0000000-0000-4000-8000-000000000001',
  practitionerFacilityAssignmentId: 'b1000000-0000-4000-8000-000000000001',
  practitionerServiceAssignmentId: 'b2000000-0000-4000-8000-000000000001',
  practitionerId: 'b3000000-0000-4000-8000-000000000001',
  appointmentServiceId: 'b4000000-0000-4000-8000-000000000001',
  sourceTimezone: 'Asia/Dubai',
} as const;

const templates = [
  {
    bookablePracticeId: 'a0000000-0000-4000-8000-000000000001',
    organizationId: '20000000-0000-4000-8000-000000000001',
    ...providerScope,
    durationMinutes: 30,
    offsetHours: 0,
  },
  {
    bookablePracticeId: 'a0000000-0000-4000-8000-000000000001',
    organizationId: '20000000-0000-4000-8000-000000000001',
    ...providerScope,
    durationMinutes: 30,
    offsetHours: 1,
  },
] as const;

describe('synthetic appointment slot schedule', () => {
  it('is stable across restarts on the same UTC day', () => {
    const morning = buildSyntheticAppointmentSlots({
      now: new Date('2026-08-27T01:00:00.000Z'),
      tenantId: '10000000-0000-4000-8000-000000000001',
      templates,
      horizonDays: 2,
    });
    const evening = buildSyntheticAppointmentSlots({
      now: new Date('2026-08-27T23:00:00.000Z'),
      tenantId: '10000000-0000-4000-8000-000000000001',
      templates,
      horizonDays: 2,
    });

    expect(evening).toEqual(morning);
    expect(morning.map((slot) => slot.starts_at.toISOString())).toEqual([
      '2026-08-28T09:00:00.000Z',
      '2026-08-28T10:00:00.000Z',
      '2026-08-29T09:00:00.000Z',
      '2026-08-29T10:00:00.000Z',
    ]);
  });

  it('advances by one day without reusing the prior start times', () => {
    const beforeMidnight = buildSyntheticAppointmentSlots({
      now: new Date('2026-08-27T23:59:59.000Z'),
      tenantId: '10000000-0000-4000-8000-000000000001',
      templates,
      horizonDays: 1,
    });
    const afterMidnight = buildSyntheticAppointmentSlots({
      now: new Date('2026-08-28T00:00:01.000Z'),
      tenantId: '10000000-0000-4000-8000-000000000001',
      templates,
      horizonDays: 1,
    });

    expect(afterMidnight[0].starts_at.getTime()).toBe(
      beforeMidnight[0].starts_at.getTime() + 24 * 60 * 60_000,
    );
    expect(
      new Set(
        [...beforeMidnight, ...afterMidnight].map(
          (slot) =>
            `${slot.bookable_practice_id}:${slot.starts_at.toISOString()}`,
        ),
      ).size,
    ).toBe(4);
  });

  it('builds a complete deterministic provider bundle and weekly templates', () => {
    const first = buildSyntheticAppointmentFixtures({
      now: new Date('2026-08-27T01:00:00.000Z'),
      tenantId: '10000000-0000-4000-8000-000000000001',
      templates,
      horizonDays: 8,
    });
    const retry = buildSyntheticAppointmentFixtures({
      now: new Date('2026-08-27T21:00:00.000Z'),
      tenantId: '10000000-0000-4000-8000-000000000001',
      templates,
      horizonDays: 8,
    });

    expect(retry).toEqual(first);
    expect(first.availabilityTemplates).toHaveLength(14);
    expect(first.slots).toHaveLength(16);
    expect(first.slots[0]).toMatchObject({
      facility_id: providerScope.facilityId,
      practitioner_facility_assignment_id:
        providerScope.practitionerFacilityAssignmentId,
      practitioner_service_assignment_id:
        providerScope.practitionerServiceAssignmentId,
      practitioner_id: providerScope.practitionerId,
      appointment_service_id: providerScope.appointmentServiceId,
      source_local_date: '2026-08-28',
      source_timezone: 'Asia/Dubai',
    });
    expect(first.slots[0].generation_key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(
      new Set(first.slots.map((slot) => slot.generation_key_hash)).size,
    ).toBe(first.slots.length);
    expect(first.slots[14].availability_template_id).toBe(
      first.slots[0].availability_template_id,
    );
    expect(first.slots[14].generation_key_hash).not.toBe(
      first.slots[0].generation_key_hash,
    );
    expect(
      first.availabilityTemplates.every(
        (template) =>
          template.status === 'active' &&
          template.effective_from === '2020-01-01' &&
          template.effective_until === null,
      ),
    ).toBe(true);
  });

  it('derives stable namespace identifiers without depending on run time', () => {
    const practiceId = 'a0000000-0000-4000-8000-000000000001';
    expect(buildSyntheticProviderFixtureId('practitioner', practiceId)).toBe(
      '0601b36b-ddf5-43f2-5634-f27b64f7294e',
    );
    expect(
      buildSyntheticFacilityCode(
        buildSyntheticProviderFixtureId('facility', practiceId),
      ),
    ).toBe('SYN-523CA3EB3634270E692BBA594434');
  });

  it('preserves a matching non-Dubai scheduling timezone and rejects drift', () => {
    const scope = {
      tenantId: '10000000-0000-4000-8000-000000000001',
      organizationId: '20000000-0000-4000-8000-000000000001',
      bookableTimezone: 'Asia/Singapore',
      facility: {
        tenantId: '10000000-0000-4000-8000-000000000001',
        organizationId: '20000000-0000-4000-8000-000000000001',
        timezone: 'Asia/Singapore',
        isSynthetic: true,
      },
    } as const;

    expect(() => assertSyntheticSchedulingFacilityScope(scope)).not.toThrow();
    expect(() =>
      assertSyntheticSchedulingFacilityScope({
        ...scope,
        facility: { ...scope.facility, timezone: 'Asia/Dubai' },
      }),
    ).toThrow(
      'Synthetic scheduling facility and bookable practice scope do not match.',
    );
    expect(() =>
      assertSyntheticSchedulingFacilityScope({
        ...scope,
        facility: { ...scope.facility, isSynthetic: false },
      }),
    ).toThrow(
      'Synthetic scheduling facility and bookable practice scope do not match.',
    );
    expect(() =>
      assertSyntheticSchedulingFacilityScope({
        ...scope,
        bookableTimezone: 'Not/A-Timezone',
        facility: { ...scope.facility, timezone: 'Not/A-Timezone' },
      }),
    ).toThrow('Synthetic scheduling facility timezone is invalid.');
  });

  it('preserves a 45-minute service duration across same-day restarts', () => {
    const input = {
      tenantId: '10000000-0000-4000-8000-000000000001',
      templates: [{ ...templates[0], durationMinutes: 45 }],
      horizonDays: 1,
    } as const;
    const morning = buildSyntheticAppointmentFixtures({
      ...input,
      now: new Date('2026-08-27T01:00:00.000Z'),
    });
    const evening = buildSyntheticAppointmentFixtures({
      ...input,
      now: new Date('2026-08-27T23:00:00.000Z'),
    });

    expect(evening).toEqual(morning);
    expect(morning.slots[0].starts_at.toISOString()).toBe(
      '2026-08-28T09:00:00.000Z',
    );
    expect(morning.slots[0].ends_at.toISOString()).toBe(
      '2026-08-28T09:45:00.000Z',
    );
    expect(morning.availabilityTemplates[0]).toMatchObject({
      local_start_minute: 13 * 60,
      local_end_minute: 13 * 60 + 45,
    });
    expect(morning.slots[0].availability_template_id).toBe(
      'b9d2a0c4-823c-b19c-aa45-0e0b812fe901',
    );
    expect(morning.slots[0].generation_key_hash).toBe(
      'd7438c96f10ffc8e3b891294122a86db9418211278f5c6140469cc1607e1d64e',
    );
  });

  it('represents an exact following-midnight boundary as minute 1440', () => {
    const result = buildSyntheticAppointmentFixtures({
      now: new Date('2026-08-27T01:00:00.000Z'),
      tenantId: '10000000-0000-4000-8000-000000000001',
      templates: [
        {
          ...templates[0],
          durationMinutes: 30,
          offsetHours: 10.5,
        },
      ],
      horizonDays: 1,
    });

    expect(result.slots[0]).toMatchObject({
      starts_at: new Date('2026-08-28T19:30:00.000Z'),
      ends_at: new Date('2026-08-28T20:00:00.000Z'),
      source_local_date: '2026-08-28',
    });
    expect(result.availabilityTemplates[0]).toMatchObject({
      local_start_minute: 23 * 60 + 30,
      local_end_minute: 24 * 60,
    });
  });

  it('infers one whole-minute legacy duration and fails closed on ambiguity', () => {
    expect(inferSyntheticAppointmentDurationMinutes([])).toBe(30);
    expect(
      inferSyntheticAppointmentDurationMinutes([
        {
          startsAt: new Date('2026-08-28T09:00:00.000Z'),
          endsAt: new Date('2026-08-28T09:45:00.000Z'),
        },
        {
          startsAt: new Date('2026-08-29T09:00:00.000Z'),
          endsAt: new Date('2026-08-29T09:45:00.000Z'),
        },
      ]),
    ).toBe(45);
    expect(() =>
      inferSyntheticAppointmentDurationMinutes([
        {
          startsAt: new Date('2026-08-28T09:00:00.000Z'),
          endsAt: new Date('2026-08-28T09:30:00.000Z'),
        },
        {
          startsAt: new Date('2026-08-29T09:00:00.000Z'),
          endsAt: new Date('2026-08-29T09:45:00.000Z'),
        },
      ]),
    ).toThrow(
      'Synthetic legacy appointment slots must share one service duration.',
    );
    expect(() =>
      inferSyntheticAppointmentDurationMinutes([
        {
          startsAt: new Date('2026-08-28T09:00:00.000Z'),
          endsAt: new Date('2026-08-28T09:30:30.000Z'),
        },
      ]),
    ).toThrow(
      'Synthetic legacy appointment slots require a positive whole-minute duration.',
    );
  });

  it('accepts only an exact synthetic template at a deterministic ID', () => {
    const [expected] = buildSyntheticAppointmentFixtures({
      now: new Date('2026-08-27T01:00:00.000Z'),
      tenantId: '10000000-0000-4000-8000-000000000001',
      templates: [templates[0]],
      horizonDays: 1,
    }).availabilityTemplates;

    expect(() =>
      assertSyntheticAvailabilityTemplateMatch(expected, expected),
    ).not.toThrow();
    expect(() =>
      assertSyntheticAvailabilityTemplateMatch(
        { ...expected, is_synthetic: false },
        expected,
      ),
    ).toThrow(
      'Deterministic synthetic availability template is not an exact fixture match.',
    );
    expect(() =>
      assertSyntheticAvailabilityTemplateMatch(
        { ...expected, practitioner_id: 'different-practitioner' },
        expected,
      ),
    ).toThrow(
      'Deterministic synthetic availability template is not an exact fixture match.',
    );
  });

  it('preserves an exact withdrawn generation-key row and rejects drift', () => {
    const [expected] = buildSyntheticAppointmentSlots({
      now: new Date('2026-08-27T01:00:00.000Z'),
      tenantId: '10000000-0000-4000-8000-000000000001',
      templates: [templates[0]],
      horizonDays: 1,
    });

    expect(() =>
      assertSyntheticAppointmentSlotMatch(
        { ...expected, status: 'withdrawn' },
        expected,
      ),
    ).not.toThrow();
    expect(() =>
      assertSyntheticAppointmentSlotMatch(
        {
          ...expected,
          ends_at: new Date(expected.ends_at.getTime() + 60_000),
        },
        expected,
      ),
    ).toThrow(
      'Synthetic appointment generation key is not an exact fixture match.',
    );
    expect(() =>
      assertSyntheticAppointmentSlotMatch(
        { ...expected, is_synthetic: false },
        expected,
      ),
    ).toThrow(
      'Synthetic appointment generation key is not an exact fixture match.',
    );
  });

  it('rejects invalid horizons and timezone configuration', () => {
    expect(() =>
      buildSyntheticAppointmentFixtures({
        now: new Date('2026-08-27T01:00:00.000Z'),
        tenantId: '10000000-0000-4000-8000-000000000001',
        templates,
        horizonDays: 0,
      }),
    ).toThrow('Synthetic appointment horizon must be a positive integer.');
    expect(() =>
      buildSyntheticAppointmentFixtures({
        now: new Date('2026-08-27T01:00:00.000Z'),
        tenantId: '10000000-0000-4000-8000-000000000001',
        templates: [
          {
            ...templates[0],
            sourceTimezone: 'Not/A-Timezone',
          },
        ],
        horizonDays: 1,
      }),
    ).toThrow('Invalid synthetic appointment timezone: Not/A-Timezone');
    expect(() =>
      buildSyntheticAppointmentFixtures({
        now: new Date('2026-08-27T01:00:00.000Z'),
        tenantId: '10000000-0000-4000-8000-000000000001',
        templates: [{ ...templates[0], durationMinutes: 0 }],
        horizonDays: 1,
      }),
    ).toThrow(
      'Synthetic appointment duration must be a positive whole number of minutes.',
    );
  });
});
