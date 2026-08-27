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
import type { PatientPortalAuthenticatedRequest } from './patient-portal-auth.types.js';
import { PatientPortalSessionCookieService } from './patient-portal-session-cookie.service.js';
import { PatientPortalSessionService } from './patient-portal-session.service.js';

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
export class PatientPortalSessionAuthenticationGuard implements CanActivate {
  private readonly allowedOrigins: Set<string>;

  constructor(
    private readonly sessions: PatientPortalSessionService,
    private readonly cookies: PatientPortalSessionCookieService,
    config: ConfigService,
  ) {
    this.allowedOrigins = new Set(
      config
        .getOrThrow<string>('PATIENT_CORS_ORIGIN')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<PatientPortalAuthenticatedRequest>();
    const response = http.getResponse<Response>();
    const sessionToken = this.cookies.read(request);

    if (!sessionToken) {
      throw new UnauthorizedException(
        'Active patient portal session required.',
      );
    }

    const session = await this.sessions.authenticate(sessionToken);

    if (!session) {
      this.cookies.clear(response);
      throw new UnauthorizedException(
        'Active patient portal session required.',
      );
    }

    if (!safeMethods.has(request.method.toUpperCase())) {
      const origin = request.headers.origin;
      const csrf = request.headers['x-csrf-token'];

      if (
        typeof origin !== 'string' ||
        !this.allowedOrigins.has(origin) ||
        typeof csrf !== 'string' ||
        !safeEqual(csrf, session.csrfToken)
      ) {
        throw new ForbiddenException(
          'Valid patient portal session CSRF proof required.',
        );
      }
    }

    request.patientPortalPrincipal = session.principal;
    request.patientPortalSession = session;

    if (session.renewed) {
      this.cookies.set(response, sessionToken, session.idleExpiresAt);
    }

    return true;
  }
}
