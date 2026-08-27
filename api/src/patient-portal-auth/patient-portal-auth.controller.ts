import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentPatientPortalPrincipal } from './current-patient-portal-principal.decorator.js';
import { CurrentPatientPortalSession } from './current-patient-portal-session.decorator.js';
import { SelectPatientPortalContextDto } from './dto/select-patient-portal-context.dto.js';
import { PATIENT_PORTAL_COOKIE_AUTH } from './patient-portal-auth.constants.js';
import { PatientPortalSessionCookieService } from './patient-portal-session-cookie.service.js';
import { PatientPortalSessionAuthenticationGuard } from './patient-portal-session-authentication.guard.js';
import { PatientPortalSessionService } from './patient-portal-session.service.js';
import { PatientPortalTokenAuthenticationGuard } from './patient-portal-token-authentication.guard.js';
import type {
  PatientPortalPrincipal,
  PatientPortalSessionContext,
} from './patient-portal-auth.types.js';

interface PatientPortalSessionResponse {
  displayName: string;
  context:
    | { kind: 'onboarding' }
    | { kind: 'practice'; portalProfileId: string; practiceName: string };
  availablePractices: Array<{
    portalProfileId: string;
    practiceName: string;
  }>;
  csrfToken: string;
  expiresAt: string;
  absoluteExpiresAt: string;
}

@ApiTags('Patient portal authentication')
@Controller('v1/patient-auth')
export class PatientPortalAuthController {
  constructor(
    private readonly sessions: PatientPortalSessionService,
    private readonly cookies: PatientPortalSessionCookieService,
  ) {}

  @Post('session')
  @UseGuards(PatientPortalTokenAuthenticationGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Exchange a patient identity access token for a portal session',
  })
  @ApiCreatedResponse({ description: 'The opaque patient portal session.' })
  @ApiUnauthorizedResponse({
    description: 'The patient identity access token is invalid or expired.',
  })
  @ApiForbiddenResponse({
    description: 'The patient identity is not an active HIS portal account.',
  })
  async createSession(
    @CurrentPatientPortalPrincipal() principal: PatientPortalPrincipal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PatientPortalSessionResponse> {
    const session = await this.sessions.create(principal);
    this.cookies.set(response, session.sessionToken, session.idleExpiresAt);
    return this.toResponse(session);
  }

  @Get('session')
  @UseGuards(PatientPortalSessionAuthenticationGuard)
  @ApiCookieAuth(PATIENT_PORTAL_COOKIE_AUTH)
  @ApiOperation({ summary: 'Restore the current patient portal session' })
  @ApiOkResponse({
    description: 'The server-side patient portal session is active.',
  })
  @ApiUnauthorizedResponse({
    description: 'The patient portal session is missing, expired, or revoked.',
  })
  session(
    @CurrentPatientPortalSession() session: PatientPortalSessionContext,
  ): PatientPortalSessionResponse {
    return this.toResponse(session);
  }

  @Post('session/context')
  @UseGuards(PatientPortalSessionAuthenticationGuard)
  @ApiCookieAuth(PATIENT_PORTAL_COOKIE_AUTH)
  @ApiOperation({
    summary: 'Rotate the patient session into one explicit practice context',
  })
  @ApiCreatedResponse({
    description: 'A fresh opaque session in the selected access context.',
  })
  @ApiForbiddenResponse({
    description: 'The selected portal profile is not an active explicit link.',
  })
  async selectContext(
    @CurrentPatientPortalSession() session: PatientPortalSessionContext,
    @Body() command: SelectPatientPortalContextDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PatientPortalSessionResponse> {
    const rotated = await this.sessions.rotateContext(
      session,
      command.portalProfileId,
    );
    this.cookies.set(response, rotated.sessionToken, rotated.idleExpiresAt);
    return this.toResponse(rotated);
  }

  @Post('logout')
  @UseGuards(PatientPortalSessionAuthenticationGuard)
  @ApiCookieAuth(PATIENT_PORTAL_COOKIE_AUTH)
  @ApiOperation({ summary: 'Revoke the current patient portal session' })
  @ApiOkResponse({ description: 'The patient portal session was revoked.' })
  async logout(
    @CurrentPatientPortalSession() session: PatientPortalSessionContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ signedOut: true }> {
    await this.sessions.revoke(session);
    this.cookies.clear(response);
    return { signedOut: true };
  }

  private toResponse(
    session: PatientPortalSessionContext,
  ): PatientPortalSessionResponse {
    return {
      displayName: session.displayName,
      context:
        session.context.kind === 'practice'
          ? {
              kind: 'practice',
              portalProfileId: session.context.portalProfileId,
              practiceName: session.context.practiceName,
            }
          : { kind: 'onboarding' },
      availablePractices: session.availablePractices,
      csrfToken: session.csrfToken,
      expiresAt: session.idleExpiresAt.toISOString(),
      absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
    };
  }
}
