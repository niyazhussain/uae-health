import type { Request } from 'express';

export interface PatientPortalAccessTokenClaims {
  issuer: string;
  sub: string;
  client_id: string;
  token_use: 'access';
  username?: string;
  exp: number;
}

export interface PatientPortalAccessTokenVerifierPort {
  verify(token: string): Promise<PatientPortalAccessTokenClaims>;
}

export interface PatientPortalPrincipal {
  issuer: string;
  subject: string;
  clientId: string;
  username?: string;
  providerExpiresAt?: Date;
}

export interface PatientPortalAvailablePractice {
  portalProfileId: string;
  practiceName: string;
}

/**
 * A pending appointment-onboarding relationship. It is deliberately distinct
 * from an approved portal-profile link and cannot grant normal practice access.
 */
export interface PatientPortalAppointmentOnboardingPractice {
  appointmentRelationshipId: string;
  practiceName: string;
}

export interface PatientPortalOnboardingContext {
  kind: 'onboarding';
}

export interface PatientPortalPracticeContext {
  kind: 'practice';
  portalProfileId: string;
  practiceName: string;
  tenantId: string;
  organizationId: string;
}

export interface PatientPortalAppointmentOnboardingContext {
  kind: 'appointment-onboarding';
  appointmentRelationshipId: string;
  practiceName: string;
  tenantId: string;
  organizationId: string;
}

export type PatientPortalAccessContext =
  | PatientPortalOnboardingContext
  | PatientPortalPracticeContext
  | PatientPortalAppointmentOnboardingContext;

export interface PatientPortalSessionContext {
  sessionId: string;
  principal: PatientPortalPrincipal;
  patientPortalIdentityId: string;
  applicationUserId: string;
  displayName: string;
  context: PatientPortalAccessContext;
  availablePractices: PatientPortalAvailablePractice[];
  appointmentOnboardingPractices: PatientPortalAppointmentOnboardingPractice[];
  csrfToken: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  renewed: boolean;
}

export interface PatientPortalAuthenticatedRequest extends Request {
  patientPortalPrincipal?: PatientPortalPrincipal;
  patientPortalSession?: PatientPortalSessionContext;
}

export interface CreatePatientPortalProfileLink {
  patientPortalProfileId: string;
  patientPortalIdentityId: string;
  actorUserId: string | null;
  actorIdentifier?: string;
  reason: string;
  correlationId: string;
}
