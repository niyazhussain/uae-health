import {
  Body,
  Controller,
  Get,
  Delete,
  Header,
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
import { AssignWorkforceGlobalRoleDto } from './dto/assign-workforce-global-role.dto.js';
import { AssignWorkforceTenantLocalRoleDto } from './dto/assign-workforce-tenant-local-role.dto.js';
import { CreateWorkforceInvitationDto } from './dto/create-workforce-invitation.dto.js';
import { CreateWorkforceTenantLocalRoleDto } from './dto/create-workforce-tenant-local-role.dto.js';
import { RevokeWorkforceRoleAssignmentDto } from './dto/revoke-workforce-role-assignment.dto.js';
import { WorkforceDirectoryQueryDto } from './dto/workforce-directory-query.dto.js';
import { WorkforceRoleCatalogueQueryDto } from './dto/workforce-role-catalogue-query.dto.js';
import { WorkforceDirectoryService } from './workforce-directory.service.js';
import type {
  WorkforceDirectoryResponse,
  WorkforceInvitationResponse,
  WorkforceMembershipStatusResponse,
  WorkforceRoleAssignment,
  WorkforceRoleCatalogueResponse,
  WorkforceTenantLocalRole,
} from './workforce-directory.types.js';

@ApiTags('Workforce administration')
@ApiCookieAuth()
@Controller('v1/admin/workforce-directory')
@UseGuards(WorkforceSessionAuthenticationGuard)
export class WorkforceDirectoryController {
  constructor(private readonly directory: WorkforceDirectoryService) {}

  @Get('role-catalogue')
  @ApiOperation({
    summary:
      'List active global and current-tenant roles for an authorized practice',
  })
  @ApiOkResponse({ description: 'The scoped, read-only role catalogue.' })
  @ApiUnauthorizedResponse({ description: 'An active session is required.' })
  @ApiForbiddenResponse({
    description: 'The caller cannot manage roles for the requested practice.',
  })
  @Header('Cache-Control', 'no-store')
  getRoleCatalogue(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() query: WorkforceRoleCatalogueQueryDto,
  ): Promise<WorkforceRoleCatalogueResponse> {
    return this.directory.getRoleCatalogue(principal, query.organizationId);
  }

  @Get()
  @ApiOperation({
    summary: 'List workforce members inside an authorized practice scope',
  })
  @ApiOkResponse({ description: 'The scoped workforce directory.' })
  @ApiUnauthorizedResponse({ description: 'An active session is required.' })
  @ApiForbiddenResponse({
    description: 'The caller cannot manage the requested organization.',
  })
  @Header('Cache-Control', 'no-store')
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
    description: 'The external account and active practice membership.',
  })
  @ApiUnauthorizedResponse({ description: 'An active session is required.' })
  @ApiForbiddenResponse({
    description: 'The caller cannot manage the requested organization.',
  })
  @ApiConflictResponse({
    description: 'The identity is disabled, conflicting, or already a member.',
  })
  @ApiServiceUnavailableResponse({
    description:
      'Identity-provider or HIS persistence is temporarily unavailable.',
  })
  createInvitation(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() input: CreateWorkforceInvitationDto,
  ): Promise<WorkforceInvitationResponse> {
    return this.directory.createInvitation(principal, input);
  }

  @Post('tenant-local-roles')
  @ApiOperation({
    summary: 'Create a delegable tenant-local role in an authorized practice',
  })
  @ApiCreatedResponse({ description: 'The tenant-local role definition.' })
  @ApiUnauthorizedResponse({ description: 'An active session is required.' })
  @ApiForbiddenResponse({
    description: 'The caller cannot manage roles in the target organization.',
  })
  @ApiConflictResponse({
    description: 'The tenant-local role name or permissions are not valid.',
  })
  @ApiServiceUnavailableResponse({
    description: 'Tenant-local role persistence is temporarily unavailable.',
  })
  createTenantLocalRole(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() input: CreateWorkforceTenantLocalRoleDto,
  ): Promise<WorkforceTenantLocalRole> {
    return this.directory.createTenantLocalRole(principal, input);
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

  @Post('memberships/:membershipId/role-assignments')
  @ApiOperation({
    summary:
      'Assign an approved global workforce role in an authorized practice',
  })
  @ApiCreatedResponse({ description: 'The practice-scoped role assignment.' })
  @ApiUnauthorizedResponse({ description: 'An active session is required.' })
  @ApiForbiddenResponse({
    description: 'The caller cannot manage roles in the target organization.',
  })
  @ApiConflictResponse({
    description: 'The role or membership cannot be changed.',
  })
  @ApiServiceUnavailableResponse({
    description: 'Role assignment persistence is temporarily unavailable.',
  })
  assignGlobalRole(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
    @Body() input: AssignWorkforceGlobalRoleDto,
  ): Promise<WorkforceRoleAssignment> {
    return this.directory.assignGlobalRole(principal, membershipId, input);
  }

  @Post('memberships/:membershipId/tenant-local-role-assignments')
  @ApiOperation({
    summary: 'Assign a tenant-local workforce role in an authorized practice',
  })
  @ApiCreatedResponse({ description: 'The practice-scoped role assignment.' })
  @ApiUnauthorizedResponse({ description: 'An active session is required.' })
  @ApiForbiddenResponse({
    description: 'The caller cannot manage roles in the target organization.',
  })
  @ApiConflictResponse({
    description: 'The role or membership cannot be changed.',
  })
  @ApiServiceUnavailableResponse({
    description: 'Role assignment persistence is temporarily unavailable.',
  })
  assignTenantLocalRole(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
    @Body() input: AssignWorkforceTenantLocalRoleDto,
  ): Promise<WorkforceRoleAssignment> {
    return this.directory.assignTenantLocalRole(principal, membershipId, input);
  }

  @Delete('role-assignments/:assignmentId')
  @ApiOperation({
    summary: 'Revoke a workforce role assignment in an authorized practice',
  })
  @ApiOkResponse({ description: 'The role assignment was revoked.' })
  @ApiUnauthorizedResponse({ description: 'An active session is required.' })
  @ApiForbiddenResponse({
    description: 'The caller cannot manage roles in the target organization.',
  })
  @ApiConflictResponse({
    description: 'The role assignment cannot be revoked.',
  })
  @ApiServiceUnavailableResponse({
    description: 'Role assignment persistence is temporarily unavailable.',
  })
  revokeRoleAssignment(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('assignmentId', new ParseUUIDPipe()) assignmentId: string,
    @Body() input: RevokeWorkforceRoleAssignmentDto,
  ): Promise<WorkforceRoleAssignment> {
    return this.directory.revokeRoleAssignment(principal, assignmentId, input);
  }
}
