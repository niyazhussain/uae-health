import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { WorkforceSessionAuthenticationGuard } from '../auth/workforce-session-authentication.guard.js';
import { ChangePractitionerFacilityAssignmentStatusDto } from './dto/change-practitioner-facility-assignment-status.dto.js';
import { ChangePractitionerServiceAssignmentStatusDto } from './dto/change-practitioner-service-assignment-status.dto.js';
import { CreatePractitionerFacilityAssignmentDto } from './dto/create-practitioner-facility-assignment.dto.js';
import { CreatePractitionerServiceAssignmentDto } from './dto/create-practitioner-service-assignment.dto.js';
import { CreateWorkforceAppointmentServiceDto } from './dto/create-workforce-appointment-service.dto.js';
import { CreateWorkforcePractitionerDto } from './dto/create-workforce-practitioner.dto.js';
import { CreateWorkforceSpecialtyDto } from './dto/create-workforce-specialty.dto.js';
import { LinkPractitionerApplicationUserDto } from './dto/link-practitioner-application-user.dto.js';
import { UpdateWorkforceAppointmentServiceDto } from './dto/update-workforce-appointment-service.dto.js';
import { UpdateWorkforceSpecialtyDto } from './dto/update-workforce-specialty.dto.js';
import { WorkforceSchedulingListQueryDto } from './dto/workforce-scheduling-list-query.dto.js';
import { WorkforceSchedulingService } from './workforce-scheduling.service.js';
import type {
  AppointmentServiceMutationResponse,
  PractitionerFacilityAssignmentMutationResponse,
  PractitionerMutationResponse,
  PractitionerServiceAssignmentMutationResponse,
  SpecialtyMutationResponse,
  WorkforceAppointmentServiceView,
  WorkforcePractitionerView,
  WorkforceSchedulingContextsResponse,
  WorkforceSchedulingPage,
  WorkforceSpecialtyView,
} from './workforce-scheduling.types.js';

@ApiTags('Workforce scheduling')
@ApiCookieAuth()
@Controller('v1/admin/scheduling')
@UseGuards(WorkforceSessionAuthenticationGuard)
@ApiUnauthorizedResponse({
  description: 'An active workforce session is required.',
})
@ApiForbiddenResponse({
  description: 'Current scheduling.manage authority is required.',
})
export class WorkforceSchedulingController {
  constructor(private readonly scheduling: WorkforceSchedulingService) {}

  @Get('contexts')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List exact-practice scheduling contexts' })
  @ApiOkResponse({ description: 'Authorized practices and facilities.' })
  contexts(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<WorkforceSchedulingContextsResponse> {
    return this.scheduling.listContexts(principal);
  }

  @Get('practitioners')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List practitioners in one authorized practice' })
  @ApiOkResponse({ description: 'A bounded exact-practice practitioner page.' })
  practitioners(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() query: WorkforceSchedulingListQueryDto,
  ): Promise<WorkforceSchedulingPage<WorkforcePractitionerView>> {
    return this.scheduling.listPractitioners(principal, query);
  }

  @Post('practitioners')
  @ApiOperation({
    summary: 'Create a synthetic practitioner and first affiliation',
  })
  @ApiCreatedResponse({
    description: 'The practitioner and active affiliation.',
  })
  @ApiBadRequestResponse({
    description: 'The command or idempotency key is invalid.',
  })
  @ApiConflictResponse({ description: 'The catalogue command conflicts.' })
  @ApiServiceUnavailableResponse({
    description: 'The command could not be stored.',
  })
  createPractitioner(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: CreateWorkforcePractitionerDto,
  ): Promise<PractitionerMutationResponse> {
    return this.scheduling.createPractitioner(principal, idempotencyKey, input);
  }

  @Put('practitioners/:practitionerId/application-user')
  @ApiOperation({ summary: 'Set the immutable local workforce-user link' })
  @ApiOkResponse({ description: 'The explicitly linked practitioner.' })
  @ApiNotFoundResponse({
    description: 'The target is unavailable in this practice.',
  })
  @ApiConflictResponse({ description: 'The link or expected state conflicts.' })
  linkPractitionerApplicationUser(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('practitionerId', new ParseUUIDPipe()) practitionerId: string,
    @Body() input: LinkPractitionerApplicationUserDto,
  ): Promise<PractitionerMutationResponse> {
    return this.scheduling.linkPractitionerApplicationUser(
      principal,
      idempotencyKey,
      practitionerId,
      input,
    );
  }

  @Post('practitioners/:practitionerId/facility-assignments')
  @ApiOperation({ summary: 'Add an exact-practice facility affiliation' })
  @ApiCreatedResponse({ description: 'The new inactive facility affiliation.' })
  @ApiNotFoundResponse({
    description: 'The target is unavailable in this practice.',
  })
  @ApiConflictResponse({
    description: 'The affiliation already exists or conflicts.',
  })
  createPractitionerFacilityAssignment(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('practitionerId', new ParseUUIDPipe()) practitionerId: string,
    @Body() input: CreatePractitionerFacilityAssignmentDto,
  ): Promise<PractitionerFacilityAssignmentMutationResponse> {
    return this.scheduling.createPractitionerFacilityAssignment(
      principal,
      idempotencyKey,
      practitionerId,
      input,
    );
  }

  @Patch('practitioner-facility-assignments/:assignmentId')
  @ApiOperation({
    summary: 'Change an exact-practice facility affiliation status',
  })
  @ApiOkResponse({
    description: 'The affiliation and safe affected request IDs.',
  })
  @ApiNotFoundResponse({
    description: 'The target is unavailable in this practice.',
  })
  @ApiConflictResponse({
    description: 'The state is stale or cannot be changed.',
  })
  changePractitionerFacilityAssignmentStatus(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('assignmentId', new ParseUUIDPipe()) assignmentId: string,
    @Body() input: ChangePractitionerFacilityAssignmentStatusDto,
  ): Promise<PractitionerFacilityAssignmentMutationResponse> {
    return this.scheduling.changePractitionerFacilityAssignmentStatus(
      principal,
      idempotencyKey,
      assignmentId,
      input,
    );
  }

  @Get('specialties')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List specialties in one authorized practice' })
  @ApiOkResponse({ description: 'A bounded exact-practice specialty page.' })
  specialties(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() query: WorkforceSchedulingListQueryDto,
  ): Promise<WorkforceSchedulingPage<WorkforceSpecialtyView>> {
    return this.scheduling.listSpecialties(principal, query);
  }

  @Post('specialties')
  @ApiOperation({ summary: 'Create an active practice specialty' })
  @ApiCreatedResponse({ description: 'The new controlled specialty.' })
  @ApiConflictResponse({ description: 'The specialty code already exists.' })
  createSpecialty(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: CreateWorkforceSpecialtyDto,
  ): Promise<SpecialtyMutationResponse> {
    return this.scheduling.createSpecialty(principal, idempotencyKey, input);
  }

  @Patch('specialties/:specialtyId')
  @ApiOperation({ summary: 'Rename or retire a practice specialty' })
  @ApiOkResponse({ description: 'The updated specialty.' })
  @ApiNotFoundResponse({
    description: 'The target is unavailable in this practice.',
  })
  @ApiConflictResponse({
    description: 'The state is stale or cannot be changed.',
  })
  updateSpecialty(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('specialtyId', new ParseUUIDPipe()) specialtyId: string,
    @Body() input: UpdateWorkforceSpecialtyDto,
  ): Promise<SpecialtyMutationResponse> {
    return this.scheduling.updateSpecialty(
      principal,
      idempotencyKey,
      specialtyId,
      input,
    );
  }

  @Get('services')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'List appointment services in one authorized practice',
  })
  @ApiOkResponse({ description: 'A bounded exact-practice service page.' })
  services(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() query: WorkforceSchedulingListQueryDto,
  ): Promise<WorkforceSchedulingPage<WorkforceAppointmentServiceView>> {
    return this.scheduling.listServices(principal, query);
  }

  @Post('services')
  @ApiOperation({ summary: 'Create an inactive appointment service' })
  @ApiCreatedResponse({ description: 'The new inactive service.' })
  @ApiConflictResponse({ description: 'The service code or scope conflicts.' })
  createService(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: CreateWorkforceAppointmentServiceDto,
  ): Promise<AppointmentServiceMutationResponse> {
    return this.scheduling.createService(principal, idempotencyKey, input);
  }

  @Patch('services/:serviceId')
  @ApiOperation({ summary: 'Update safe metadata or lifecycle for a service' })
  @ApiOkResponse({ description: 'The updated service and safe affected IDs.' })
  @ApiNotFoundResponse({
    description: 'The target is unavailable in this practice.',
  })
  @ApiConflictResponse({
    description: 'The state is stale or cannot be changed.',
  })
  updateService(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('serviceId', new ParseUUIDPipe()) serviceId: string,
    @Body() input: UpdateWorkforceAppointmentServiceDto,
  ): Promise<AppointmentServiceMutationResponse> {
    return this.scheduling.updateService(
      principal,
      idempotencyKey,
      serviceId,
      input,
    );
  }

  @Post('services/:serviceId/practitioner-assignments')
  @ApiOperation({ summary: 'Add an inactive practitioner-service eligibility' })
  @ApiCreatedResponse({ description: 'The new inactive eligibility.' })
  @ApiNotFoundResponse({
    description: 'The target is unavailable in this practice.',
  })
  @ApiConflictResponse({
    description: 'The eligibility already exists or conflicts.',
  })
  createPractitionerServiceAssignment(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('serviceId', new ParseUUIDPipe()) serviceId: string,
    @Body() input: CreatePractitionerServiceAssignmentDto,
  ): Promise<PractitionerServiceAssignmentMutationResponse> {
    return this.scheduling.createPractitionerServiceAssignment(
      principal,
      idempotencyKey,
      serviceId,
      input,
    );
  }

  @Patch('practitioner-service-assignments/:assignmentId')
  @ApiOperation({ summary: 'Change practitioner-service eligibility status' })
  @ApiOkResponse({ description: 'The eligibility and safe affected IDs.' })
  @ApiNotFoundResponse({
    description: 'The target is unavailable in this practice.',
  })
  @ApiConflictResponse({
    description: 'The state is stale or cannot be changed.',
  })
  changePractitionerServiceAssignmentStatus(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('assignmentId', new ParseUUIDPipe()) assignmentId: string,
    @Body() input: ChangePractitionerServiceAssignmentStatusDto,
  ): Promise<PractitionerServiceAssignmentMutationResponse> {
    return this.scheduling.changePractitionerServiceAssignmentStatus(
      principal,
      idempotencyKey,
      assignmentId,
      input,
    );
  }
}
