import { Body, Controller, Get, Header, Post, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { WorkforceSessionAuthenticationGuard } from '../auth/workforce-session-authentication.guard.js';
import { CreatePatientPortalInvitationDto } from './dto/create-patient-portal-invitation.dto.js';
import { PatientPortalInvitationService } from './patient-portal-invitation.service.js';

@ApiTags('Patient portal invitations')
@ApiCookieAuth()
@Controller('v1/admin/patient-portal-invitations')
@UseGuards(WorkforceSessionAuthenticationGuard)
export class PatientPortalInvitationAdminController {
  constructor(private readonly invitations: PatientPortalInvitationService) {}

  @Get('contexts')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'List practices where the current user may issue patient invitations',
  })
  @ApiOkResponse({ description: 'Exact-practice patient invitation contexts.' })
  @ApiUnauthorizedResponse({
    description: 'An active workforce session is required.',
  })
  contexts(@CurrentPrincipal() principal: AuthenticatedPrincipal): Promise<{
    contexts: Array<{
      tenantId: string;
      tenantName: string;
      organizationId: string;
      organizationName: string;
    }>;
  }> {
    return this.invitations.listContexts(principal);
  }

  @Post()
  @ApiOperation({
    summary:
      'Issue a one-time patient portal invitation for an authorized practice',
  })
  @ApiCreatedResponse({
    description: 'A one-time copyable patient invitation URL.',
  })
  @ApiUnauthorizedResponse({
    description: 'An active workforce session is required.',
  })
  @ApiForbiddenResponse({
    description:
      'The caller cannot issue patient invitations for this practice.',
  })
  issue(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() input: CreatePatientPortalInvitationDto,
  ): Promise<{ invitationUrl: string; expiresAt: string }> {
    return this.invitations.issue(principal, input);
  }
}
