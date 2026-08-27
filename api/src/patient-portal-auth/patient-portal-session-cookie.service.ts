import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

@Injectable()
export class PatientPortalSessionCookieService {
  readonly name: string;
  private readonly secure: boolean;

  constructor(config: ConfigService) {
    this.secure = config.getOrThrow<string>('SESSION_COOKIE_SECURE') === 'true';
    this.name = this.secure
      ? '__Host-uae_health_patient_session'
      : 'uae_health_patient_session_local';
  }

  read(request: Request): string | null {
    const header = request.headers.cookie;

    if (!header) return null;

    for (const part of header.split(';')) {
      const separator = part.indexOf('=');

      if (separator < 0) continue;
      if (part.slice(0, separator).trim() !== this.name) continue;

      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return null;
      }
    }

    return null;
  }

  set(response: Response, sessionToken: string, expiresAt: Date): void {
    response.cookie(this.name, sessionToken, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'strict',
      path: '/',
      expires: expiresAt,
    });
  }

  clear(response: Response): void {
    response.clearCookie(this.name, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'strict',
      path: '/',
    });
  }
}
