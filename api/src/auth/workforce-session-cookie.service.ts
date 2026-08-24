import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

@Injectable()
export class WorkforceSessionCookieService {
  readonly name: string;
  private readonly secure: boolean;

  constructor(config: ConfigService) {
    this.secure = config.getOrThrow<string>('SESSION_COOKIE_SECURE') === 'true';
    this.name = this.secure
      ? '__Host-uae_health_session'
      : 'uae_health_session_local';
  }

  read(request: Request): string | null {
    const header = request.headers.cookie;

    if (!header) return null;

    for (const part of header.split(';')) {
      const separator = part.indexOf('=');

      if (separator < 0) continue;

      const name = part.slice(0, separator).trim();

      if (name !== this.name) continue;

      const value = part.slice(separator + 1).trim();

      try {
        return decodeURIComponent(value);
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
