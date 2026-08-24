import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { COGNITO_ACCESS_TOKEN_VERIFIER } from './auth.constants.js';
import { CognitoAccessTokenVerifierAdapter } from './cognito-access-token.verifier.js';
import { CognitoAuthenticationGuard } from './cognito-authentication.guard.js';

@Module({
  controllers: [AuthController],
  providers: [
    CognitoAccessTokenVerifierAdapter,
    CognitoAuthenticationGuard,
    {
      provide: COGNITO_ACCESS_TOKEN_VERIFIER,
      useExisting: CognitoAccessTokenVerifierAdapter,
    },
  ],
  exports: [CognitoAuthenticationGuard, COGNITO_ACCESS_TOKEN_VERIFIER],
})
export class AuthModule {}
