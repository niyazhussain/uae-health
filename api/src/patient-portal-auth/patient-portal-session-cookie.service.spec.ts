import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import type { Request, Response } from 'express';
import { PatientPortalSessionCookieService } from './patient-portal-session-cookie.service.js';

function serviceFor(secure: boolean): PatientPortalSessionCookieService {
  return new PatientPortalSessionCookieService({
    getOrThrow: () => String(secure),
  } as ConfigService);
}

describe('PatientPortalSessionCookieService', () => {
  it('uses a different local-only cookie from workforce sessions', () => {
    const service = serviceFor(false);
    const cookie = jest.fn();
    const expiresAt = new Date('2026-08-26T16:00:00.000Z');

    service.set({ cookie } as unknown as Response, 'patient-token', expiresAt);

    expect(service.name).toBe('uae_health_patient_session_local');
    expect(cookie).toHaveBeenCalledWith(
      'uae_health_patient_session_local',
      'patient-token',
      {
        httpOnly: true,
        secure: false,
        sameSite: 'strict',
        path: '/',
        expires: expiresAt,
      },
    );
  });

  it('uses a separate host-only cookie name for secure environments', () => {
    const service = serviceFor(true);
    const clearCookie = jest.fn();

    service.clear({ clearCookie } as unknown as Response);

    expect(service.name).toBe('__Host-uae_health_patient_session');
    expect(clearCookie).toHaveBeenCalledWith(
      '__Host-uae_health_patient_session',
      {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
      },
    );
  });

  it('does not read the workforce session cookie', () => {
    const service = serviceFor(true);

    expect(
      service.read({
        headers: {
          cookie:
            '__Host-uae_health_session=workforce; __Host-uae_health_patient_session=patient%2Dtoken',
        },
      } as Request),
    ).toBe('patient-token');
  });
});
