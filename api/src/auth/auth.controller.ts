import { Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CognitoAuthenticationGuard } from './cognito-authentication.guard.js';
import { CurrentPrincipal } from './current-principal.decorator.js';
import { CurrentWorkforceSession } from './current-workforce-session.decorator.js';
import type {
  AuthenticatedPrincipal,
  AuthenticatedSessionContext,
} from './auth.types.js';
import { WorkforceSessionAuthenticationGuard } from './workforce-session-authentication.guard.js';
import { WorkforceSessionCookieService } from './workforce-session-cookie.service.js';
import { WorkforceSessionService } from './workforce-session.service.js';

interface SessionResponse {
  subject: string;
  username?: string;
  csrfToken: string;
  expiresAt: string;
  absoluteExpiresAt: string;
}

@ApiTags('Authentication')
@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly sessions: WorkforceSessionService,
    private readonly cookies: WorkforceSessionCookieService,
  ) {}

  @Post('session')
  @UseGuards(CognitoAuthenticationGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Exchange a Cognito access token for a workforce session',
  })
  @ApiCreatedResponse({ description: 'The opaque workforce session.' })
  @ApiUnauthorizedResponse({
    description: 'The Cognito access token is invalid or expired.',
  })
  async createSession(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const session = await this.sessions.create(principal);
    this.cookies.set(response, session.sessionToken, session.idleExpiresAt);
    return this.toResponse(session);
  }

  @Get('session')
  @UseGuards(WorkforceSessionAuthenticationGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Restore the current workforce session' })
  @ApiOkResponse({ description: 'The server-side session is active.' })
  @ApiUnauthorizedResponse({
    description: 'The workforce session is missing, expired, or revoked.',
  })
  session(
    @CurrentWorkforceSession() session: AuthenticatedSessionContext,
  ): SessionResponse {
    return this.toResponse(session);
  }

  @Post('logout')
  @UseGuards(WorkforceSessionAuthenticationGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Revoke the current workforce session' })
  @ApiOkResponse({ description: 'The workforce session was revoked.' })
  async logout(
    @CurrentWorkforceSession() session: AuthenticatedSessionContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ signedOut: true }> {
    await this.sessions.revoke(session);
    this.cookies.clear(response);
    return { signedOut: true };
  }

  private toResponse(session: AuthenticatedSessionContext): SessionResponse {
    return {
      subject: session.principal.subject,
      ...(session.principal.username
        ? { username: session.principal.username }
        : {}),
      csrfToken: session.csrfToken,
      expiresAt: session.idleExpiresAt.toISOString(),
      absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
    };
  }
}
