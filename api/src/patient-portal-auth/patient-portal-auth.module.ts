import { Module } from '@nestjs/common';
import { CognitoPatientPortalAccessTokenVerifierAdapter } from './cognito-patient-portal-access-token.verifier.js';
import { PATIENT_PORTAL_ACCESS_TOKEN_VERIFIER } from './patient-portal-auth.constants.js';
import { PatientPortalAuthController } from './patient-portal-auth.controller.js';
import { PatientPortalProfileLinkService } from './patient-portal-profile-link.service.js';
import { PatientPortalPracticeContextGuard } from './patient-portal-practice-context.guard.js';
import { PatientPortalSessionCookieService } from './patient-portal-session-cookie.service.js';
import { PatientPortalSessionAuthenticationGuard } from './patient-portal-session-authentication.guard.js';
import { PatientPortalSessionService } from './patient-portal-session.service.js';
import { PatientPortalTokenAuthenticationGuard } from './patient-portal-token-authentication.guard.js';

@Module({
  controllers: [PatientPortalAuthController],
  providers: [
    CognitoPatientPortalAccessTokenVerifierAdapter,
    PatientPortalTokenAuthenticationGuard,
    PatientPortalSessionAuthenticationGuard,
    PatientPortalPracticeContextGuard,
    PatientPortalSessionCookieService,
    PatientPortalSessionService,
    PatientPortalProfileLinkService,
    {
      provide: PATIENT_PORTAL_ACCESS_TOKEN_VERIFIER,
      useExisting: CognitoPatientPortalAccessTokenVerifierAdapter,
    },
  ],
  exports: [
    PatientPortalSessionAuthenticationGuard,
    PatientPortalPracticeContextGuard,
  ],
})
export class PatientPortalAuthModule {}
