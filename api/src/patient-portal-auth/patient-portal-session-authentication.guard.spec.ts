import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import type { Response } from 'express';
import type {
  PatientPortalAuthenticatedRequest,
  PatientPortalSessionContext,
} from './patient-portal-auth.types.js';
import { PatientPortalSessionAuthenticationGuard } from './patient-portal-session-authentication.guard.js';
import type { PatientPortalSessionCookieService } from './patient-portal-session-cookie.service.js';
import type { PatientPortalSessionService } from './patient-portal-session.service.js';

function contextFor(
  request: Partial<PatientPortalAuthenticatedRequest>,
  response: Partial<Response> = {},
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: <T>() => request as T,
      getResponse: <T>() => response as T,
    }),
  } as ExecutionContext;
}

const activeSession: PatientPortalSessionContext = {
  sessionId: 'patient-session-id',
  principal: {
    issuer: 'https://identity.example.invalid/patient-pool',
    subject: 'patient-subject-123',
    clientId: 'patient-client-123',
  },
  applicationUserId: 'application-user-id',
  patientPortalIdentityId: 'patient-identity-id',
  displayName: 'Synthetic Patient',
  context: {
    kind: 'practice',
    portalProfileId: 'portal-profile-id',
    practiceName: 'Synthetic Practice',
    tenantId: 'tenant-id',
    organizationId: 'organization-id',
  },
  availablePractices: [
    {
      portalProfileId: 'portal-profile-id',
      practiceName: 'Synthetic Practice',
    },
  ],
  appointmentOnboardingPractices: [],
  csrfToken: 'patient-csrf-token',
  idleExpiresAt: new Date('2026-08-26T16:00:00.000Z'),
  absoluteExpiresAt: new Date('2026-08-26T23:45:00.000Z'),
  renewed: true,
};

function createGuard(session: PatientPortalSessionContext | null) {
  const read = jest.fn(() => 'raw-patient-session-token');
  const set = jest.fn();
  const clear = jest.fn();
  const authenticate = jest.fn(() => Promise.resolve(session));
  const sessions = { authenticate } as unknown as PatientPortalSessionService;
  const cookies = {
    read,
    set,
    clear,
  } as unknown as PatientPortalSessionCookieService;
  const config = {
    getOrThrow: (name: string) => {
      if (name !== 'PATIENT_CORS_ORIGIN') throw new Error('Unexpected config');
      return 'http://localhost:5173';
    },
  } as ConfigService;

  return {
    guard: new PatientPortalSessionAuthenticationGuard(
      sessions,
      cookies,
      config,
    ),
    set,
    clear,
  };
}

describe('PatientPortalSessionAuthenticationGuard', () => {
  it('attaches only the patient portal context and renews its own cookie', async () => {
    const { guard, set } = createGuard(activeSession);
    const request = {
      method: 'GET',
      headers: { cookie: 'uae_health_patient_session_local=patient-session' },
    } as Partial<PatientPortalAuthenticatedRequest>;

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.patientPortalPrincipal).toEqual(activeSession.principal);
    expect(request.patientPortalSession).toEqual(activeSession);
    expect(set).toHaveBeenCalledWith(
      expect.anything(),
      'raw-patient-session-token',
      activeSession.idleExpiresAt,
    );
  });

  it('fails closed for a missing patient portal session', async () => {
    const { guard, clear } = createGuard(null);

    await expect(
      guard.canActivate(contextFor({ method: 'GET', headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(clear).toHaveBeenCalled();
  });

  it('requires patient-session CSRF proof for mutations', async () => {
    const { guard } = createGuard(activeSession);

    await expect(
      guard.canActivate(
        contextFor({
          method: 'POST',
          headers: { origin: 'http://localhost:5173' },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a cross-audience GET even though it is a safe HTTP method', async () => {
    const { guard } = createGuard(activeSession);

    await expect(
      guard.canActivate(
        contextFor({
          method: 'GET',
          headers: { origin: 'http://localhost:5174' },
        }),
      ),
    ).rejects.toMatchObject({
      message: 'Patient portal session origin required.',
    });
  });

  it('accepts only the exact patient origin for cookie mutations', async () => {
    const { guard } = createGuard({ ...activeSession, renewed: false });

    await expect(
      guard.canActivate(
        contextFor({
          method: 'POST',
          headers: {
            origin: 'http://localhost:5173',
            'x-csrf-token': activeSession.csrfToken,
          },
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(
        contextFor({
          method: 'POST',
          headers: {
            origin: 'http://localhost:5174',
            'x-csrf-token': activeSession.csrfToken,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
