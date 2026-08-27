import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PATIENT_PORTAL_ACCESS_TOKEN_VERIFIER } from './patient-portal-auth.constants.js';
import type {
  PatientPortalAccessTokenVerifierPort,
  PatientPortalAuthenticatedRequest,
} from './patient-portal-auth.types.js';

@Injectable()
export class PatientPortalTokenAuthenticationGuard implements CanActivate {
  constructor(
    @Inject(PATIENT_PORTAL_ACCESS_TOKEN_VERIFIER)
    private readonly tokenVerifier: PatientPortalAccessTokenVerifierPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<PatientPortalAuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const match = authorization?.match(/^Bearer ([^\s]+)$/i);

    if (!match) {
      throw new UnauthorizedException(
        'Valid patient identity access token required.',
      );
    }

    try {
      const claims = await this.tokenVerifier.verify(match[1]);
      request.patientPortalPrincipal = {
        issuer: claims.issuer,
        subject: claims.sub,
        clientId: claims.client_id,
        providerExpiresAt: new Date(claims.exp * 1000),
        ...(claims.username ? { username: claims.username } : {}),
      };
      return true;
    } catch {
      throw new UnauthorizedException(
        'Valid patient identity access token required.',
      );
    }
  }
}
