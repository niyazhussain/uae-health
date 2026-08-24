import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type {
  CognitoAccessTokenClaims,
  CognitoAccessTokenVerifierPort,
} from './auth.types.js';

@Injectable()
export class CognitoAccessTokenVerifierAdapter implements CognitoAccessTokenVerifierPort {
  private readonly verifier?: ReturnType<typeof CognitoJwtVerifier.create>;

  constructor(config: ConfigService) {
    if (config.getOrThrow<string>('AUTH_MODE') !== 'cognito') {
      return;
    }

    this.verifier = CognitoJwtVerifier.create({
      userPoolId: config.getOrThrow<string>('COGNITO_USER_POOL_ID'),
      tokenUse: 'access',
      clientId: config.getOrThrow<string>('COGNITO_USER_POOL_CLIENT_ID'),
    });
  }

  async verify(token: string): Promise<CognitoAccessTokenClaims> {
    if (!this.verifier) {
      throw new Error('Cognito authentication is not configured.');
    }

    const payload = await this.verifier.verify(token);

    if (
      payload.token_use !== 'access' ||
      typeof payload.sub !== 'string' ||
      typeof payload.client_id !== 'string' ||
      typeof payload.exp !== 'number'
    ) {
      throw new Error('Cognito token is not an access token.');
    }

    return {
      sub: payload.sub,
      client_id: payload.client_id,
      token_use: 'access',
      exp: payload.exp,
      ...(typeof payload.username === 'string'
        ? { username: payload.username }
        : {}),
    };
  }
}
