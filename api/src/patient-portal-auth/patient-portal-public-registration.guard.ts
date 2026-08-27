import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

@Injectable()
export class PatientPortalPublicRegistrationGuard implements CanActivate {
  private readonly allowedOrigins: Set<string>;

  constructor(config: ConfigService) {
    this.allowedOrigins = new Set(
      config
        .getOrThrow<string>('PATIENT_CORS_ORIGIN')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.headers.origin;

    // This is an intentionally browser-only public endpoint. Require the
    // exact patient audience origin rather than accepting a non-browser call
    // with no Origin or a workforce host that CORS may otherwise permit.
    if (typeof origin !== 'string' || !this.allowedOrigins.has(origin)) {
      throw new ForbiddenException('Patient portal origin required.');
    }

    return true;
  }
}
