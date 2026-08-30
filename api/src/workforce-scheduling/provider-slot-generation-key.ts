import { createHash } from 'node:crypto';

export const PROVIDER_SLOT_GENERATION_NAMESPACE =
  'uae-health:synthetic-provider-slot:v1';

/**
 * Keep this hash byte-for-byte compatible with the task 2.4 backfill and the
 * restart-safe synthetic seed. It identifies one immutable occurrence; it is
 * not a credential, signature, or authorization decision.
 */
export function buildProviderSlotGenerationKeyHash(input: {
  availabilityTemplateId: string;
  sourceLocalDate: string;
  startsAt: Date;
  endsAt: Date;
}): string {
  const generationKey = [
    PROVIDER_SLOT_GENERATION_NAMESPACE,
    input.availabilityTemplateId,
    input.sourceLocalDate,
    Math.trunc(input.startsAt.getTime() / 1_000),
    Math.trunc(input.endsAt.getTime() / 1_000),
  ].join('|');

  return createHash('sha256').update(generationKey).digest('hex');
}
