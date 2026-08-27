import { Module } from '@nestjs/common';
import { PatientPortalAuthModule } from '../patient-portal-auth/patient-portal-auth.module.js';
import { PatientAppointmentsController } from './patient-appointments.controller.js';
import { PatientAppointmentsService } from './patient-appointments.service.js';
import { PatientPortalAppointmentContextGuard } from './patient-portal-appointment-context.guard.js';

@Module({
  imports: [PatientPortalAuthModule],
  controllers: [PatientAppointmentsController],
  providers: [PatientAppointmentsService, PatientPortalAppointmentContextGuard],
})
export class PatientAppointmentsModule {}
