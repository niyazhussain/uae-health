import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { WorkforceSessionAuthenticationGuard } from '../auth/workforce-session-authentication.guard.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { ChangeWorkforceMembershipStatusDto } from './dto/change-workforce-membership-status.dto.js';
import { CreateWorkforceInvitationDto } from './dto/create-workforce-invitation.dto.js';
import { WorkforceDirectoryQueryDto } from './dto/workforce-directory-query.dto.js';
import { WorkforceDirectoryService } from './workforce-directory.service.js';
import type {
  WorkforceDirectoryResponse,
  WorkforceInvitationResponse,
  WorkforceMembershipStatusResponse,
} from './workforce-directory.types.js';

@ApiTags('Workforce administration')
@ApiCookieAuth()
@Controller('v1/admin/workforce-directory')
@UseGuards(WorkforceSessionAuthenticationGuard)
export class WorkforceDirectoryController {
  constructor(private readonly directory: WorkforceDirectoryService) {}

  @Get()
  @ApiOperation({
    summary: 'List workforce members inside an authorized practice scope',
  })
  @ApiOkResponse({ description: 'The scoped workforce directory.' })
  @ApiUnauthorizedResponse({ description: 'An active session is required.' })
  @ApiForbiddenResponse({
    description: 'The caller cannot manage the requested organization.',
  })
  @ApiServiceUnavailableResponse({
    description: 'Cognito account status is temporarily unavailable.',
  })
  getDirectory(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() query: WorkforceDirectoryQueryDto,
  ): Promise<WorkforceDirectoryResponse> {
    return this.directory.getDirectory(principal, query.organizationId);
  }

  @Post('invitations')
  @ApiOperation({
    summary: 'Invite a native workforce user into an authorized practice',
  })
  @ApiCreatedResponse({
    description: 'The Cognito account and active practice membership.',
  })
  @ApiUnauthorizedResponse({ description: 'An active session is required.' })
  @ApiForbiddenResponse({
    description: 'The caller cannot manage the requested organization.',
  })
  @ApiConflictResponse({
    description: 'The identity is disabled, conflicting, or already a member.',
  })
  @ApiServiceUnavailableResponse({
    description: 'Cognito or HIS persistence is temporarily unavailable.',
  })
  createInvitation(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() input: CreateWorkforceInvitationDto,
  ): Promise<WorkforceInvitationResponse> {
    return this.directory.createInvitation(principal, input);
  }

  @Patch('memberships/:membershipId/status')
  @ApiOperation({
    summary:
      'Suspend or restore a workforce membership in an authorized practice',
  })
  @ApiOkResponse({
    description: 'The practice membership state was changed.',
  })
  @ApiUnauthorizedResponse({ description: 'An active session is required.' })
  @ApiForbiddenResponse({
    description: 'The caller cannot manage the target organization.',
  })
  @ApiConflictResponse({
    description: 'The membership state cannot be changed.',
  })
  changeMembershipStatus(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
    @Body() input: ChangeWorkforceMembershipStatusDto,
  ): Promise<WorkforceMembershipStatusResponse> {
    return this.directory.changeMembershipStatus(
      principal,
      membershipId,
      input,
    );
  }
}
