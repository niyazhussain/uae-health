import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { Request } from 'express';
import { CognitoAuthenticationGuard } from './cognito-authentication.guard.js';
import type {
  AuthenticatedRequest,
  CognitoAccessTokenVerifierPort,
} from './auth.types.js';

function contextFor(request: Partial<Request>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: <T>() => request as T,
    }),
  } as ExecutionContext;
}

describe('CognitoAuthenticationGuard', () => {
  it('attaches the immutable Cognito subject for a valid access token', async () => {
    const verify = jest.fn().mockResolvedValue({
      sub: 'subject-123',
      client_id: 'client-123',
      token_use: 'access',
      username: 'workforce-user',
    });
    const verifier: CognitoAccessTokenVerifierPort = {
      verify,
    };
    const guard = new CognitoAuthenticationGuard(verifier);
    const request: AuthenticatedRequest = {
      headers: { authorization: 'Bearer valid-token' },
    } as AuthenticatedRequest;

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('valid-token');
    expect(request.principal).toEqual({
      subject: 'subject-123',
      clientId: 'client-123',
      username: 'workforce-user',
    });
  });

  it('rejects a missing bearer token', async () => {
    const verify = jest.fn();
    const verifier: CognitoAccessTokenVerifierPort = {
      verify,
    };
    const guard = new CognitoAuthenticationGuard(verifier);

    await expect(
      guard.canActivate(contextFor({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verify).not.toHaveBeenCalled();
  });

  it('maps verifier failures to a generic unauthorized response', async () => {
    const verifier: CognitoAccessTokenVerifierPort = {
      verify: jest.fn().mockRejectedValue(new Error('signature details')),
    };
    const guard = new CognitoAuthenticationGuard(verifier);

    await expect(
      guard.canActivate(
        contextFor({ headers: { authorization: 'Bearer invalid-token' } }),
      ),
    ).rejects.toMatchObject({
      message: 'Valid Cognito access token required.',
    });
  });
});
