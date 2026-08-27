import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { Request } from 'express';
import { PatientPortalTokenAuthenticationGuard } from './patient-portal-token-authentication.guard.js';
import type {
  PatientPortalAccessTokenVerifierPort,
  PatientPortalAuthenticatedRequest,
} from './patient-portal-auth.types.js';

function contextFor(request: Partial<Request>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: <T>() => request as T,
    }),
  } as ExecutionContext;
}

describe('PatientPortalTokenAuthenticationGuard', () => {
  it('attaches the immutable patient-pool issuer and subject', async () => {
    const verify = jest.fn().mockResolvedValue({
      issuer: 'https://identity.example.invalid/patient-pool',
      sub: 'patient-subject-123',
      client_id: 'patient-client-123',
      token_use: 'access',
      username: 'patient@example.invalid',
      exp: 1787590800,
    });
    const verifier: PatientPortalAccessTokenVerifierPort = { verify };
    const guard = new PatientPortalTokenAuthenticationGuard(verifier);
    const request: PatientPortalAuthenticatedRequest = {
      headers: { authorization: 'Bearer valid-patient-token' },
    } as PatientPortalAuthenticatedRequest;

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.patientPortalPrincipal).toEqual({
      issuer: 'https://identity.example.invalid/patient-pool',
      subject: 'patient-subject-123',
      clientId: 'patient-client-123',
      username: 'patient@example.invalid',
      providerExpiresAt: new Date(1787590800 * 1000),
    });
  });

  it('rejects a missing or invalid patient token without exposing verifier detail', async () => {
    const verifier: PatientPortalAccessTokenVerifierPort = {
      verify: jest.fn().mockRejectedValue(new Error('signature detail')),
    };
    const guard = new PatientPortalTokenAuthenticationGuard(verifier);

    await expect(
      guard.canActivate(contextFor({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      guard.canActivate(
        contextFor({ headers: { authorization: 'Bearer invalid' } }),
      ),
    ).rejects.toMatchObject({
      message: 'Valid patient identity access token required.',
    });
  });
});
