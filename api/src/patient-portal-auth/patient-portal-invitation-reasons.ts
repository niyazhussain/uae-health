export const PATIENT_PORTAL_INVITATION_REASON_CODES = [
  'patient-portal-onboarding',
  'patient-requested-access',
  'staff-assisted-enrolment',
] as const;

export type PatientPortalInvitationReasonCode =
  (typeof PATIENT_PORTAL_INVITATION_REASON_CODES)[number];

const auditReasonByCode: Record<PatientPortalInvitationReasonCode, string> = {
  'patient-portal-onboarding':
    'Issue a patient portal invitation for approved portal onboarding.',
  'patient-requested-access':
    'Issue a patient portal invitation after a patient requested access.',
  'staff-assisted-enrolment':
    'Issue a patient portal invitation during staff-assisted enrolment.',
};

export function isPatientPortalInvitationReasonCode(
  value: string,
): value is PatientPortalInvitationReasonCode {
  return (PATIENT_PORTAL_INVITATION_REASON_CODES as readonly string[]).includes(
    value,
  );
}

export function patientPortalInvitationAuditReason(
  reasonCode: PatientPortalInvitationReasonCode,
): string {
  return auditReasonByCode[reasonCode];
}
