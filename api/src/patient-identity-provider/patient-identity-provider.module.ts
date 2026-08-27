import { Module } from '@nestjs/common';
import { PATIENT_PORTAL_ACCESS_TOKEN_VERIFIER } from '../patient-portal-auth/patient-portal-auth.constants.js';
import { CognitoPatientAccessTokenVerifierAdapter } from './cognito-patient-access-token.verifier.js';
import { CognitoPatientIdentityAdapter } from './cognito-patient-identity.adapter.js';
import { PATIENT_IDENTITY_PROVIDER } from './patient-identity-provider.constants.js';

@Module({
  providers: [
    CognitoPatientAccessTokenVerifierAdapter,
    CognitoPatientIdentityAdapter,
    {
      provide: PATIENT_IDENTITY_PROVIDER,
      useExisting: CognitoPatientIdentityAdapter,
    },
    {
      provide: PATIENT_PORTAL_ACCESS_TOKEN_VERIFIER,
      useExisting: CognitoPatientAccessTokenVerifierAdapter,
    },
  ],
  exports: [PATIENT_IDENTITY_PROVIDER, PATIENT_PORTAL_ACCESS_TOKEN_VERIFIER],
})
export class PatientIdentityProviderModule {}
