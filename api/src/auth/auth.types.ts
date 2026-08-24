import type { Request } from 'express';

export interface CognitoAccessTokenClaims {
  sub: string;
  client_id: string;
  token_use: 'access';
  username?: string;
}

export interface CognitoAccessTokenVerifierPort {
  verify(token: string): Promise<CognitoAccessTokenClaims>;
}

export interface AuthenticatedPrincipal {
  subject: string;
  clientId: string;
  username?: string;
}

export interface AuthenticatedRequest extends Request {
  principal?: AuthenticatedPrincipal;
}
