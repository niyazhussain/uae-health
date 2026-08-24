import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { COGNITO_ACCESS_TOKEN_VERIFIER } from './auth.constants.js';
import type {
  AuthenticatedRequest,
  CognitoAccessTokenVerifierPort,
} from './auth.types.js';

@Injectable()
export class CognitoAuthenticationGuard implements CanActivate {
  constructor(
    @Inject(COGNITO_ACCESS_TOKEN_VERIFIER)
    private readonly tokenVerifier: CognitoAccessTokenVerifierPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const match = authorization?.match(/^Bearer ([^\s]+)$/i);

    if (!match) {
      throw new UnauthorizedException('Valid Cognito access token required.');
    }

    try {
      const claims = await this.tokenVerifier.verify(match[1]);

      request.principal = {
        subject: claims.sub,
        clientId: claims.client_id,
        providerExpiresAt: new Date(claims.exp * 1000),
        ...(claims.username ? { username: claims.username } : {}),
      };

      return true;
    } catch {
      throw new UnauthorizedException('Valid Cognito access token required.');
    }
  }
}
