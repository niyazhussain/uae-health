import type { PatientPortalAppointmentStatus } from '../database/database.types.js';
import type { PatientPortalAccessContext } from '../patient-portal-auth/patient-portal-auth.types.js';

export type PatientAppointmentContext = Extract<
  PatientPortalAccessContext,
  { kind: 'practice' | 'appointment-onboarding' }
>;

export type PatientAppointmentPractitionerSelectionMode = 'named' | 'any';

export interface PatientAppointmentPageQuery {
  page: number;
  pageSize: number;
}

export interface PatientAppointmentPractitionerOptionsQuery extends PatientAppointmentPageQuery {
  appointmentServiceId: string;
}

export interface PatientAppointmentAvailabilityQuery extends PatientAppointmentPageQuery {
  appointmentServiceId?: string;
  selectionMode?: PatientAppointmentPractitionerSelectionMode;
  practitionerOptionId?: string;
}

export interface PatientAppointmentServiceView {
  appointmentServiceId: string;
  patientFacingName: string;
  durationMinutes: number;
  allowsAnyPractitioner: boolean;
  specialty: {
    specialtyId: string;
    name: string;
  };
  facility: {
    facilityId: string;
    name: string;
    timezone: string;
  };
}

export interface PatientAppointmentPractitionerOptionView {
  practitionerOptionId: string;
  displayName: string;
  professionalTitle: string;
}

export interface PatientAppointmentServicesResponse extends PatientAppointmentPageQuery {
  practiceName: string;
  timezone: string;
  total: number;
  services: PatientAppointmentServiceView[];
}

export interface PatientAppointmentPractitionerOptionsResponse extends PatientAppointmentPageQuery {
  practiceName: string;
  timezone: string;
  total: number;
  practitionerOptions: PatientAppointmentPractitionerOptionView[];
}

export interface PatientAppointmentAvailabilityResponse extends PatientAppointmentPageQuery {
  practiceName: string;
  timezone: string;
  total: number;
  slots: PatientAppointmentSlotView[];
}

export interface PatientAppointmentView {
  appointmentId: string;
  status: PatientPortalAppointmentStatus;
  startsAt: string;
  endsAt: string;
  version: number;
  canCancel: boolean;
  canReschedule: boolean;
}

/**
 * The provider-aware scheduling evidence returned for commands created after
 * provider-aware booking was enabled. Legacy durable command snapshots remain
 * valid PatientAppointmentView values so an old retry can return its exact
 * original result.
 */
export interface PatientProviderAwareAppointmentView extends PatientAppointmentView {
  slotId: string;
  service: PatientAppointmentServiceView;
  practitionerOption: PatientAppointmentPractitionerOptionView;
}

export type PatientAppointmentCommandView =
  PatientAppointmentView | PatientProviderAwareAppointmentView;

export interface PatientAppointmentSlotView {
  slotId: string;
  startsAt: string;
  endsAt: string;
  service: PatientAppointmentServiceView;
  practitionerOption: PatientAppointmentPractitionerOptionView;
}
