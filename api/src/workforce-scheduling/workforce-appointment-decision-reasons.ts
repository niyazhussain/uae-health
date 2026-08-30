export const workforceAppointmentDecisionReasonCodes = [
  'appointment-request-confirmed',
  'appointment-request-provider-unavailable',
  'appointment-request-service-unavailable',
  'appointment-request-scheduling-conflict',
] as const;

export type WorkforceAppointmentDecisionReasonCode =
  (typeof workforceAppointmentDecisionReasonCodes)[number];

export const workforceAppointmentDeclineReasonCodes = [
  'appointment-request-provider-unavailable',
  'appointment-request-service-unavailable',
  'appointment-request-scheduling-conflict',
] as const satisfies readonly WorkforceAppointmentDecisionReasonCode[];

const auditReasons: Record<WorkforceAppointmentDecisionReasonCode, string> = {
  'appointment-request-confirmed':
    'Confirm an approved synthetic appointment request.',
  'appointment-request-provider-unavailable':
    'Decline a synthetic appointment request because its provider is unavailable.',
  'appointment-request-service-unavailable':
    'Decline a synthetic appointment request because its service is unavailable.',
  'appointment-request-scheduling-conflict':
    'Decline a synthetic appointment request because of an approved scheduling conflict.',
};

export function workforceAppointmentDecisionAuditReason(
  reasonCode: WorkforceAppointmentDecisionReasonCode,
): string {
  return auditReasons[reasonCode];
}
