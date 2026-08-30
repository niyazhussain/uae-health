import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
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
import { ChangeWorkforceAppointmentStatusDto } from './dto/change-workforce-appointment-status.dto.js';
import { WorkforceAppointmentQueueQueryDto } from './dto/workforce-appointment-queue-query.dto.js';
import { WorkforceAppointmentQueueService } from './workforce-appointment-queue.service.js';
import type {
  WorkforceAppointmentDecisionResponse,
  WorkforceAppointmentPage,
} from './workforce-appointment-queue.types.js';

@ApiTags('Workforce scheduling appointments')
@ApiCookieAuth()
@Controller('v1/admin/scheduling/appointments')
@UseGuards(WorkforceSessionAuthenticationGuard)
@ApiUnauthorizedResponse({
  description: 'An active workforce session is required.',
})
@ApiForbiddenResponse({
  description:
    'Current scheduling.manage and patients.read authority is required in the exact facility.',
})
export class WorkforceAppointmentQueueController {
  constructor(
    private readonly appointments: WorkforceAppointmentQueueService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List one exact-facility appointment queue' })
  @ApiOkResponse({
    description: 'A bounded page of safe appointment summaries.',
  })
  @ApiBadRequestResponse({ description: 'The queue query is invalid.' })
  @ApiServiceUnavailableResponse({
    description: 'The appointment queue is temporarily unavailable.',
  })
  listAppointments(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() query: WorkforceAppointmentQueueQueryDto,
  ): Promise<WorkforceAppointmentPage> {
    return this.appointments.listAppointments(principal, query);
  }

  @Patch(':appointmentId/status')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Confirm or decline one appointment request' })
  @ApiOkResponse({ description: 'The versioned appointment decision.' })
  @ApiBadRequestResponse({
    description: 'The decision, reason, or idempotency key is invalid.',
  })
  @ApiNotFoundResponse({
    description: 'The appointment request is unavailable in this facility.',
  })
  @ApiConflictResponse({
    description: 'The appointment, version, or idempotency key conflicts.',
  })
  @ApiServiceUnavailableResponse({
    description: 'The appointment decision is temporarily unavailable.',
  })
  changeAppointmentStatus(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
    @Body() input: ChangeWorkforceAppointmentStatusDto,
  ): Promise<WorkforceAppointmentDecisionResponse> {
    return this.appointments.changeAppointmentStatus(
      principal,
      idempotencyKey,
      appointmentId,
      input,
    );
  }
}
