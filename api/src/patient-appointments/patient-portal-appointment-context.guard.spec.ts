import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { PatientPortalAuthenticatedRequest } from '../patient-portal-auth/patient-portal-auth.types.js';
import { PatientPortalAppointmentContextGuard } from './patient-portal-appointment-context.guard.js';

function contextFor(
  request: Partial<PatientPortalAuthenticatedRequest>,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: <T>() => request as T,
    }),
  } as ExecutionContext;
}

describe('PatientPortalAppointmentContextGuard', () => {
  const guard = new PatientPortalAppointmentContextGuard();

  it('denies a restricted onboarding session', () => {
    expect(() =>
      guard.canActivate(
        contextFor({
          patientPortalSession: { context: { kind: 'onboarding' } } as never,
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('accepts a server-selected active practice context', () => {
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

  it('accepts only the restricted server-selected appointment relationship context', () => {
    expect(
      guard.canActivate(
        contextFor({
          patientPortalSession: {
            context: {
              kind: 'appointment-onboarding',
              appointmentRelationshipId: 'relationship-id',
              practiceName: 'Synthetic Appointment Practice',
              tenantId: 'tenant-id',
              organizationId: 'organization-id',
            },
          } as never,
        }),
      ),
    ).toBe(true);
  });
});
