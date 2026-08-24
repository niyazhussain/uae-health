import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import type { Request, Response } from 'express';
import { WorkforceSessionCookieService } from './workforce-session-cookie.service.js';

function serviceFor(secure: boolean): WorkforceSessionCookieService {
  return new WorkforceSessionCookieService({
    getOrThrow: () => String(secure),
  } as ConfigService);
}

describe('WorkforceSessionCookieService', () => {
  it('uses a local-only name and strict HttpOnly controls for HTTP development', () => {
    const service = serviceFor(false);
    const cookie = jest.fn();
    const expiresAt = new Date('2026-08-24T16:00:00.000Z');

    service.set({ cookie } as unknown as Response, 'opaque-token', expiresAt);

    expect(service.name).toBe('uae_health_session_local');
    expect(cookie).toHaveBeenCalledWith(
      'uae_health_session_local',
      'opaque-token',
      {
        httpOnly: true,
        secure: false,
        sameSite: 'strict',
        path: '/',
        expires: expiresAt,
      },
    );
  });

  it('uses the __Host prefix for secure staging and production cookies', () => {
    const service = serviceFor(true);
    const clearCookie = jest.fn();

    service.clear({ clearCookie } as unknown as Response);

    expect(service.name).toBe('__Host-uae_health_session');
    expect(clearCookie).toHaveBeenCalledWith('__Host-uae_health_session', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
    });
  });

  it('reads only the configured cookie and rejects malformed encoding', () => {
    const service = serviceFor(true);

    expect(
      service.read({
        headers: {
          cookie: 'other=value; __Host-uae_health_session=opaque%2Dtoken',
        },
      } as Request),
    ).toBe('opaque-token');
    expect(
      service.read({
        headers: { cookie: '__Host-uae_health_session=%E0%A4%A' },
      } as Request),
    ).toBeNull();
  });
});
