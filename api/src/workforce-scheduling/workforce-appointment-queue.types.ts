import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import type { PatientPortalAppointmentStatus } from '../database/database.types.js';
import type { ReleasedPendingProviderSlotResult } from '../patient-appointments/provider-slot-release.js';
import type { WorkforceAppointmentDecisionReasonCode } from './workforce-appointment-decision-reasons.js';

export interface WorkforceAppointmentQueueQuery {
  organizationId: string;
  facilityId: string;
  status?: PatientPortalAppointmentStatus;
  practitionerId?: string;
  appointmentServiceId?: string;
  page: number;
  pageSize: number;
}

export interface WorkforceAppointmentView {
  appointmentId: string;
  status: PatientPortalAppointmentStatus;
  version: number;
  patientDisplayName: string;
  facilityId: string;
  facilityName: string;
  facilityTimezone: string;
  appointmentServiceId: string;
  serviceName: string;
  specialtyId: string;
  specialtyName: string;
  practitionerId: string;
  practitionerDisplayName: string;
  practitionerProfessionalTitle: string;
  appointmentSlotId: string;
  startsAt: string;
  endsAt: string;
  withdrawalPending: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkforceAppointmentPage {
  page: number;
  pageSize: number;
  total: number;
  items: WorkforceAppointmentView[];
}

export interface ChangeWorkforceAppointmentStatusInput {
  organizationId: string;
  facilityId: string;
  status: 'confirmed' | 'declined';
  expectedVersion: number;
  reasonCode: WorkforceAppointmentDecisionReasonCode;
}

export interface WorkforceAppointmentDecisionView {
  appointmentId: string;
  appointmentSlotId: string;
  facilityId: string;
  practitionerId: string;
  appointmentServiceId: string;
  status: 'confirmed' | 'declined';
  version: number;
  updatedAt: string;
  withdrawalPending: boolean;
  releasedSlotDisposition:
    ReleasedPendingProviderSlotResult['disposition'] | null;
  releasedSlotValidityReason: ReleasedPendingProviderSlotResult['validityReason'];
}

export interface WorkforceAppointmentDecisionResponse {
  appointment: WorkforceAppointmentDecisionView;
}

export interface WorkforceAppointmentDecisionRequest {
  principal: AuthenticatedPrincipal;
  idempotencyKey: string;
  input: ChangeWorkforceAppointmentStatusInput;
}

export class WorkforceAppointmentAuthorizationError extends Error {
  constructor() {
    super('Workforce appointment access is no longer authorized.');
  }
}

export class WorkforceAppointmentTargetUnavailableError extends Error {
  constructor() {
    super('The workforce appointment target is unavailable.');
  }
}

export class WorkforceAppointmentConflictError extends Error {
  constructor(message = 'The appointment request decision conflicts.') {
    super(message);
  }
}

export class WorkforceAppointmentValidationError extends Error {
  constructor(message = 'The workforce appointment request is invalid.') {
    super(message);
  }
}

export class WorkforceAppointmentPersistenceError extends Error {
  constructor() {
    super('The workforce appointment service is temporarily unavailable.');
  }
}
