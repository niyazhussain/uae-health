import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentPatientPortalSession } from '../patient-portal-auth/current-patient-portal-session.decorator.js';
import { PATIENT_PORTAL_COOKIE_AUTH } from '../patient-portal-auth/patient-portal-auth.constants.js';
import type { PatientPortalSessionContext } from '../patient-portal-auth/patient-portal-auth.types.js';
import { PatientPortalSessionAuthenticationGuard } from '../patient-portal-auth/patient-portal-session-authentication.guard.js';
import { CancelPatientAppointmentDto } from './dto/cancel-patient-appointment.dto.js';
import { CreatePatientAppointmentRelationshipDto } from './dto/create-patient-appointment-relationship.dto.js';
import { CreatePatientAppointmentDto } from './dto/create-patient-appointment.dto.js';
import { ReschedulePatientAppointmentDto } from './dto/reschedule-patient-appointment.dto.js';
import { PatientAppointmentsService } from './patient-appointments.service.js';
import type { PatientAppointmentView } from './patient-appointments.types.js';
import { PatientPortalAppointmentContextGuard } from './patient-portal-appointment-context.guard.js';

@ApiTags('Patient appointments')
@ApiCookieAuth(PATIENT_PORTAL_COOKIE_AUTH)
@Controller('v1/patient-appointments')
export class PatientAppointmentsController {
  constructor(private readonly appointments: PatientAppointmentsService) {}

  @Get('bookable-practices')
  @Header('Cache-Control', 'no-store')
  @UseGuards(PatientPortalSessionAuthenticationGuard)
  @ApiOperation({
    summary:
      'List bounded safe synthetic practices available for appointment onboarding',
  })
  @ApiOkResponse({ description: 'Safe bookable practice summaries.' })
  @ApiUnauthorizedResponse({
    description: 'An active patient session is required.',
  })
  bookablePractices(
    @CurrentPatientPortalSession() session: PatientPortalSessionContext,
  ): Promise<{
    bookablePractices: Array<{
      bookablePracticeId: string;
      practiceName: string;
      timezone: string;
    }>;
  }> {
    return this.appointments.listBookablePractices(session);
  }

  @Post('relationships')
  @UseGuards(PatientPortalSessionAuthenticationGuard)
  @ApiOperation({
    summary:
      'Create or return one patient-owned pending appointment relationship',
  })
  @ApiCreatedResponse({ description: 'The pending appointment relationship.' })
  async createRelationship(
    @CurrentPatientPortalSession() session: PatientPortalSessionContext,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: CreatePatientAppointmentRelationshipDto,
  ): Promise<{ appointmentRelationshipId: string; practiceName: string }> {
    return this.appointments.createRelationship(
      session,
      idempotencyKey ?? '',
      input.bookablePracticeId,
    );
  }

  @Get('availability')
  @Header('Cache-Control', 'no-store')
  @UseGuards(
    PatientPortalSessionAuthenticationGuard,
    PatientPortalAppointmentContextGuard,
  )
  @ApiOperation({
    summary:
      'List safe available appointment slots for the current server-selected context',
  })
  @ApiForbiddenResponse({
    description: 'A practice or appointment context is required.',
  })
  availability(
    @CurrentPatientPortalSession() session: PatientPortalSessionContext,
  ): Promise<{
    practiceName: string;
    timezone: string;
    slots: Array<{ slotId: string; startsAt: string; endsAt: string }>;
  }> {
    return this.appointments.listAvailability(session);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @UseGuards(
    PatientPortalSessionAuthenticationGuard,
    PatientPortalAppointmentContextGuard,
  )
  @ApiOperation({
    summary: 'List only the current patient context appointment requests',
  })
  appointmentsForContext(
    @CurrentPatientPortalSession() session: PatientPortalSessionContext,
  ): Promise<{
    practiceName: string;
    timezone: string;
    appointments: Array<{
      appointmentId: string;
      status: PatientAppointmentView['status'];
      startsAt: string;
      endsAt: string;
      version: number;
      canCancel: boolean;
      canReschedule: boolean;
    }>;
  }> {
    return this.appointments.listAppointments(session);
  }

  @Post()
  @UseGuards(
    PatientPortalSessionAuthenticationGuard,
    PatientPortalAppointmentContextGuard,
  )
  @ApiOperation({
    summary:
      'Request one available appointment slot in the current patient context',
  })
  createAppointment(
    @CurrentPatientPortalSession() session: PatientPortalSessionContext,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: CreatePatientAppointmentDto,
  ): Promise<{
    appointment: Awaited<
      ReturnType<PatientAppointmentsService['createAppointment']>
    >['appointment'];
  }> {
    return this.appointments.createAppointment(
      session,
      idempotencyKey ?? '',
      input.slotId,
    );
  }

  @Post(':appointmentId/cancellation')
  @UseGuards(
    PatientPortalSessionAuthenticationGuard,
    PatientPortalAppointmentContextGuard,
  )
  @ApiOperation({ summary: 'Cancel one current-context appointment request' })
  cancelAppointment(
    @CurrentPatientPortalSession() session: PatientPortalSessionContext,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: CancelPatientAppointmentDto,
  ): Promise<{
    appointment: Awaited<
      ReturnType<PatientAppointmentsService['cancelAppointment']>
    >['appointment'];
  }> {
    return this.appointments.cancelAppointment(
      session,
      idempotencyKey ?? '',
      appointmentId,
      input.version,
    );
  }

  @Post(':appointmentId/reschedule')
  @UseGuards(
    PatientPortalSessionAuthenticationGuard,
    PatientPortalAppointmentContextGuard,
  )
  @ApiOperation({
    summary: 'Reschedule one current-context appointment request',
  })
  rescheduleAppointment(
    @CurrentPatientPortalSession() session: PatientPortalSessionContext,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: ReschedulePatientAppointmentDto,
  ): Promise<{
    appointment: Awaited<
      ReturnType<PatientAppointmentsService['rescheduleAppointment']>
    >['appointment'];
  }> {
    return this.appointments.rescheduleAppointment(
      session,
      idempotencyKey ?? '',
      appointmentId,
      input.slotId,
      input.version,
    );
  }
}
