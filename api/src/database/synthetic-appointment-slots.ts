export interface SyntheticAppointmentSlotTemplate {
  bookablePracticeId: string;
  organizationId: string;
  offsetHours: number;
}

export interface SyntheticAppointmentSlotSeed {
  bookable_practice_id: string;
  tenant_id: string;
  organization_id: string;
  starts_at: Date;
  ends_at: Date;
  status: 'available';
  is_synthetic: true;
}

/**
 * Build a bounded rolling window without moving an existing slot identifier.
 * The database upserts these rows by practice and start time, so restarts on
 * the same UTC day are idempotent and a later restart only appends new dates.
 */
export function buildSyntheticAppointmentSlots(input: {
  now: Date;
  tenantId: string;
  templates: readonly SyntheticAppointmentSlotTemplate[];
  horizonDays?: number;
}): SyntheticAppointmentSlotSeed[] {
  const horizonDays = input.horizonDays ?? 14;
  const firstDayStart = new Date(input.now);
  firstDayStart.setUTCDate(firstDayStart.getUTCDate() + 1);
  firstDayStart.setUTCHours(9, 0, 0, 0);

  return Array.from({ length: horizonDays }, (_, dayIndex) =>
    input.templates.map((template) => {
      const startsAt = new Date(
        firstDayStart.getTime() +
          dayIndex * 24 * 60 * 60_000 +
          template.offsetHours * 60 * 60_000,
      );

      return {
        bookable_practice_id: template.bookablePracticeId,
        tenant_id: input.tenantId,
        organization_id: template.organizationId,
        starts_at: startsAt,
        ends_at: new Date(startsAt.getTime() + 30 * 60_000),
        status: 'available' as const,
        is_synthetic: true as const,
      };
    }),
  ).flat();
}
