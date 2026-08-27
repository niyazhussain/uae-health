import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { PatientPortalAuthenticatedRequest } from './patient-portal-auth.types.js';
import { PatientPortalPracticeContextGuard } from './patient-portal-practice-context.guard.js';

function contextFor(
  request: Partial<PatientPortalAuthenticatedRequest>,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: <T>() => request as T,
    }),
  } as ExecutionContext;
}

describe('PatientPortalPracticeContextGuard', () => {
  const guard = new PatientPortalPracticeContextGuard();

  it('denies a restricted onboarding session', () => {
    expect(() =>
      guard.canActivate(
        contextFor({
          patientPortalSession: {
            context: { kind: 'onboarding' },
          } as never,
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('accepts a session with one server-selected practice', () => {
    expect(
      guard.canActivate(
        contextFor({
          patientPortalSession: {
            context: {
              kind: 'practice',
              portalProfileId: 'profile-id',
              practiceName: 'Synthetic Practice',
              tenantId: 'tenant-id',
              organizationId: 'organization-id',
            },
          } as never,
        }),
      ),
    ).toBe(true);
  });
});
