import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type {
  PatientPortalAccessTokenClaims,
  PatientPortalAccessTokenVerifierPort,
} from './patient-portal-auth.types.js';

@Injectable()
export class CognitoPatientPortalAccessTokenVerifierAdapter implements PatientPortalAccessTokenVerifierPort {
  private readonly verifier?: ReturnType<typeof CognitoJwtVerifier.create>;
  private readonly issuer?: string;

  constructor(config: ConfigService) {
    if (config.getOrThrow<string>('PATIENT_AUTH_MODE') !== 'cognito') {
      return;
    }

    const region = config.getOrThrow<string>('COGNITO_REGION');
    const userPoolId = config.getOrThrow<string>(
      'PATIENT_COGNITO_USER_POOL_ID',
    );

    this.issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
    this.verifier = CognitoJwtVerifier.create({
      userPoolId,
      tokenUse: 'access',
      clientId: config.getOrThrow<string>(
        'PATIENT_COGNITO_USER_POOL_CLIENT_ID',
      ),
    });
  }

  async verify(token: string): Promise<PatientPortalAccessTokenClaims> {
    if (!this.verifier || !this.issuer) {
      throw new Error('Patient identity authentication is not configured.');
    }

    const payload = await this.verifier.verify(token);

    if (
      payload.token_use !== 'access' ||
      typeof payload.sub !== 'string' ||
      typeof payload.client_id !== 'string' ||
      typeof payload.exp !== 'number'
    ) {
      throw new Error('Patient identity token is not an access token.');
    }

    return {
      issuer: this.issuer,
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
