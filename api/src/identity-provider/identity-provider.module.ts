import { Module } from '@nestjs/common';
import { CognitoWorkforceIdentityAdapter } from './cognito-workforce-identity.adapter.js';
import { WORKFORCE_IDENTITY_PROVIDER } from './identity-provider.constants.js';

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
