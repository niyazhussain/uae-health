import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { IdentityProviderModule } from '../identity-provider/identity-provider.module.js';
import { PatientIdentityProviderModule } from '../patient-identity-provider/patient-identity-provider.module.js';
import { PatientPortalAuthController } from './patient-portal-auth.controller.js';
import { PatientPortalInvitationAdminController } from './patient-portal-invitation-admin.controller.js';
import { PatientPortalInvitationRepository } from './patient-portal-invitation.repository.js';
import { PatientPortalInvitationService } from './patient-portal-invitation.service.js';
import { PatientPortalProfileLinkService } from './patient-portal-profile-link.service.js';
import { PatientPortalPracticeContextGuard } from './patient-portal-practice-context.guard.js';
import { PatientPortalSessionCookieService } from './patient-portal-session-cookie.service.js';
import { PatientPortalSessionAuthenticationGuard } from './patient-portal-session-authentication.guard.js';
import { PatientPortalSessionService } from './patient-portal-session.service.js';
import { PatientPortalTokenAuthenticationGuard } from './patient-portal-token-authentication.guard.js';
import { PatientPortalPublicRegistrationGuard } from './patient-portal-public-registration.guard.js';
import { PatientPortalRegistrationService } from './patient-portal-registration.service.js';

@Module({
  imports: [AuthModule, IdentityProviderModule, PatientIdentityProviderModule],
  controllers: [
    PatientPortalAuthController,
    PatientPortalInvitationAdminController,
  ],
  providers: [
    PatientPortalTokenAuthenticationGuard,
    PatientPortalSessionAuthenticationGuard,
    PatientPortalPracticeContextGuard,
    PatientPortalPublicRegistrationGuard,
    PatientPortalSessionCookieService,
    PatientPortalSessionService,
    PatientPortalProfileLinkService,
    PatientPortalRegistrationService,
    PatientPortalInvitationRepository,
    PatientPortalInvitationService,
  ],
  exports: [
    PatientPortalSessionAuthenticationGuard,
    PatientPortalPracticeContextGuard,
  ],
})
export class PatientPortalAuthModule {}
