import type { Request } from 'express';

export interface CognitoAccessTokenClaims {
  sub: string;
  client_id: string;
  token_use: 'access';
  username?: string;
  exp: number;
}

export interface CognitoAccessTokenVerifierPort {
  verify(token: string): Promise<CognitoAccessTokenClaims>;
}

export interface AuthenticatedPrincipal {
  subject: string;
  clientId: string;
  username?: string;
  providerExpiresAt?: Date;
}

export interface AuthenticatedSessionContext {
  sessionId: string;
  principal: AuthenticatedPrincipal;
  csrfToken: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  renewed: boolean;
}

export interface AuthenticatedRequest extends Request {
  principal?: AuthenticatedPrincipal;
  workforceSession?: AuthenticatedSessionContext;
}
