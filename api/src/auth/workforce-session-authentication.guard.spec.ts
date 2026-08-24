import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import type { Response } from 'express';
import type {
  AuthenticatedRequest,
  AuthenticatedSessionContext,
} from './auth.types.js';
import { WorkforceSessionAuthenticationGuard } from './workforce-session-authentication.guard.js';
import type { WorkforceSessionCookieService } from './workforce-session-cookie.service.js';
import type { WorkforceSessionService } from './workforce-session.service.js';

function contextFor(
  request: Partial<AuthenticatedRequest>,
  response: Partial<Response> = {},
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: <T>() => request as T,
      getResponse: <T>() => response as T,
    }),
  } as ExecutionContext;
}

const activeSession: AuthenticatedSessionContext = {
  sessionId: 'session-id',
  principal: {
    subject: 'subject-123',
    clientId: 'client-123',
    username: 'workforce-user',
  },
  csrfToken: 'csrf-token',
  idleExpiresAt: new Date('2026-08-24T16:00:00.000Z'),
  absoluteExpiresAt: new Date('2026-08-24T23:45:00.000Z'),
  renewed: true,
};

function createGuard(session: AuthenticatedSessionContext | null) {
  const read = jest.fn(() => 'raw-session-token');
  const set = jest.fn();
  const clear = jest.fn();
  const authenticate = jest.fn(() => Promise.resolve(session));
  const sessions = { authenticate } as unknown as WorkforceSessionService;
  const cookies = {
    read,
    set,
    clear,
  } as unknown as WorkforceSessionCookieService;
  const config = {
    getOrThrow: () => 'http://localhost:5173',
  } as ConfigService;

  return {
    guard: new WorkforceSessionAuthenticationGuard(sessions, cookies, config),
    read,
    set,
    clear,
    authenticate,
  };
}

describe('WorkforceSessionAuthenticationGuard', () => {
  it('restores a principal and renews the cookie for an active session', async () => {
    const { guard, set } = createGuard(activeSession);
    const request = {
      method: 'GET',
      headers: { cookie: 'uae_health_session_local=raw-session-token' },
    } as Partial<AuthenticatedRequest>;

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.principal).toEqual(activeSession.principal);
    expect(request.workforceSession).toEqual(activeSession);
    expect(set).toHaveBeenCalledWith(
      expect.anything(),
      'raw-session-token',
      activeSession.idleExpiresAt,
    );
  });

  it('rejects a missing or expired session with a safe 401', async () => {
    const { guard, clear } = createGuard(null);

    await expect(
      guard.canActivate(
        contextFor({
          method: 'GET',
          headers: { cookie: 'uae_health_session_local=expired' },
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(clear).toHaveBeenCalled();
  });

  it('rejects a cookie-authenticated mutation without CSRF proof', async () => {
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

  it('accepts a mutation from the allowed origin with matching CSRF proof', async () => {
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
  });
});
