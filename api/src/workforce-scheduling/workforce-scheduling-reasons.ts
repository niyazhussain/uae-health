export const workforceSchedulingReasonCodes = [
  'catalogue-setup',
  'staffing-change',
  'service-configuration',
  'service-retirement',
  'availability-configuration',
  'provider-availability-change',
  'facility-availability-change',
  'service-duration-change',
] as const;

export type WorkforceSchedulingReasonCode =
  (typeof workforceSchedulingReasonCodes)[number];

const auditReasons: Record<WorkforceSchedulingReasonCode, string> = {
  'catalogue-setup': 'Configure the approved synthetic scheduling catalogue.',
  'staffing-change': 'Apply an approved synthetic scheduling staffing change.',
  'service-configuration':
    'Apply an approved synthetic appointment-service configuration.',
  'service-retirement':
    'Retire approved synthetic scheduling catalogue configuration.',
  'availability-configuration':
    'Apply an approved synthetic practitioner-availability configuration.',
  'provider-availability-change':
    'Apply an approved synthetic practitioner-availability exception.',
  'facility-availability-change':
    'Apply an approved synthetic facility-availability exception.',
  'service-duration-change':
    'Apply an approved synthetic appointment-service duration change.',
};

export function workforceSchedulingAuditReason(
  reasonCode: WorkforceSchedulingReasonCode,
): string {
  return auditReasons[reasonCode];
}
