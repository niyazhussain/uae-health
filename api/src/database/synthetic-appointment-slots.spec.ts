import { buildSyntheticAppointmentSlots } from './synthetic-appointment-slots.js';

const templates = [
  {
    bookablePracticeId: 'a0000000-0000-4000-8000-000000000001',
    organizationId: '20000000-0000-4000-8000-000000000001',
    offsetHours: 0,
  },
  {
    bookablePracticeId: 'a0000000-0000-4000-8000-000000000001',
    organizationId: '20000000-0000-4000-8000-000000000001',
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
});
