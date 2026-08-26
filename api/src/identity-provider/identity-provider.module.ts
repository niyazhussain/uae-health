import { Module } from '@nestjs/common';
import { WORKFORCE_IDENTITY_PROVIDER } from '../workforce-directory/workforce-directory.constants.js';
import { CognitoWorkforceIdentityAdapter } from './cognito-workforce-identity.adapter.js';

@Module({
  providers: [
    CognitoWorkforceIdentityAdapter,
    {
      provide: WORKFORCE_IDENTITY_PROVIDER,
      useExisting: CognitoWorkforceIdentityAdapter,
    },
  ],
  exports: [WORKFORCE_IDENTITY_PROVIDER],
})
export class IdentityProviderModule {}
