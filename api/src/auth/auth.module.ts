import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { COGNITO_ACCESS_TOKEN_VERIFIER } from './auth.constants.js';
import { CognitoAccessTokenVerifierAdapter } from './cognito-access-token.verifier.js';
import { CognitoAuthenticationGuard } from './cognito-authentication.guard.js';
import { WorkforceSessionAuthenticationGuard } from './workforce-session-authentication.guard.js';
import { WorkforceSessionCookieService } from './workforce-session-cookie.service.js';
import { WorkforceSessionService } from './workforce-session.service.js';

@Module({
  controllers: [AuthController],
  providers: [
    CognitoAccessTokenVerifierAdapter,
    CognitoAuthenticationGuard,
    WorkforceSessionAuthenticationGuard,
    WorkforceSessionCookieService,
    WorkforceSessionService,
    {
      provide: COGNITO_ACCESS_TOKEN_VERIFIER,
      useExisting: CognitoAccessTokenVerifierAdapter,
    },
  ],
  exports: [
    CognitoAuthenticationGuard,
    WorkforceSessionAuthenticationGuard,
    WorkforceSessionCookieService,
    WorkforceSessionService,
    COGNITO_ACCESS_TOKEN_VERIFIER,
  ],
})
export class AuthModule {}
