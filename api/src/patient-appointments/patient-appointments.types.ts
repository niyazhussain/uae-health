import type { PatientPortalAccessContext } from '../patient-portal-auth/patient-portal-auth.types.js';

export type PatientAppointmentContext = Extract<
  PatientPortalAccessContext,
  { kind: 'practice' | 'appointment-onboarding' }
>;

export interface PatientAppointmentView {
  appointmentId: string;
  status: 'requested' | 'cancelled';
  startsAt: string;
  endsAt: string;
  version: number;
  canCancel: boolean;
  canReschedule: boolean;
}

export interface PatientAppointmentSlotView {
  slotId: string;
  startsAt: string;
  endsAt: string;
}
