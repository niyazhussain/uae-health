export const workforceSchedulingReasonCodes = [
  'catalogue-setup',
  'staffing-change',
  'service-configuration',
  'service-retirement',
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
};

export function workforceSchedulingAuditReason(
  reasonCode: WorkforceSchedulingReasonCode,
): string {
  return auditReasons[reasonCode];
}
