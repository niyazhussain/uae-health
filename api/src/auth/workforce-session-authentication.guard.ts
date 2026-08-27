import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';
import type { AuthenticatedRequest } from './auth.types.js';
import { WorkforceSessionCookieService } from './workforce-session-cookie.service.js';
import { WorkforceSessionService } from './workforce-session.service.js';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

@Injectable()
export class WorkforceSessionAuthenticationGuard implements CanActivate {
  private readonly allowedOrigins: Set<string>;

  constructor(
    private readonly sessions: WorkforceSessionService,
    private readonly cookies: WorkforceSessionCookieService,
    config: ConfigService,
  ) {
    this.allowedOrigins = new Set(
      config
        .getOrThrow<string>('WORKFORCE_CORS_ORIGIN')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();
    const sessionToken = this.cookies.read(request);

    if (!sessionToken) {
      throw new UnauthorizedException('Active workforce session required.');
    }

    const session = await this.sessions.authenticate(sessionToken);

    if (!session) {
      this.cookies.clear(response);
      throw new UnauthorizedException('Active workforce session required.');
    }

    const origin = request.headers.origin;

    // Cookies are scoped to the shared API host. Whenever a browser supplies
    // Origin, bind this session guard to its audience even for a safe GET so a
    // patient origin cannot read workforce data with a workforce cookie.
    if (
      origin !== undefined &&
      (typeof origin !== 'string' || !this.allowedOrigins.has(origin))
    ) {
      throw new ForbiddenException('Workforce session origin required.');
    }

    if (!safeMethods.has(request.method.toUpperCase())) {
      const csrf = request.headers['x-csrf-token'];

      if (
        typeof origin !== 'string' ||
        !this.allowedOrigins.has(origin) ||
        typeof csrf !== 'string' ||
        !safeEqual(csrf, session.csrfToken)
      ) {
        throw new ForbiddenException('Valid session CSRF proof required.');
      }
    }

    request.principal = session.principal;
    request.workforceSession = session;

    if (session.renewed) {
      this.cookies.set(response, sessionToken, session.idleExpiresAt);
    }

    return true;
  }
}
