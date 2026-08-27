import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { PatientPortalPublicRegistrationGuard } from './patient-portal-public-registration.guard.js';

function contextFor(request: Partial<Request>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: <T>() => request as T,
    }),
  } as ExecutionContext;
}

describe('PatientPortalPublicRegistrationGuard', () => {
  const config = {
    getOrThrow: (name: string) => {
      if (name !== 'PATIENT_CORS_ORIGIN') throw new Error('Unexpected config');
      return 'https://patient.uae-health.example';
    },
  } as ConfigService;

  it('permits only the exact patient browser origin', () => {
    const guard = new PatientPortalPublicRegistrationGuard(config);

    expect(
      guard.canActivate(
        contextFor({
          headers: { origin: 'https://patient.uae-health.example' },
        }),
      ),
    ).toBe(true);
  });

  it('rejects a workforce or lookalike browser origin', () => {
    const guard = new PatientPortalPublicRegistrationGuard(config);

    expect(() =>
      guard.canActivate(
        contextFor({ headers: { origin: 'https://uae-health.example' } }),
      ),
    ).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextFor({ headers: {} }))).toThrow(
      ForbiddenException,
    );
    expect(() =>
      guard.canActivate(
        contextFor({
          headers: { origin: 'https://patient.uae-health.example.attacker' },
        }),
      ),
    ).toThrow('Patient portal origin required.');
  });
});
