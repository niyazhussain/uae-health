import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import type {
  AppointmentServiceStatus,
  PatientPortalAppointmentSlotStatus,
  PractitionerFacilityAssignmentStatus,
  PractitionerAvailabilityTemplateStatus,
  PractitionerServiceAssignmentStatus,
  PractitionerStatus,
  ProviderAvailabilityExceptionKind,
  ProviderAvailabilityExceptionStatus,
  SpecialtyStatus,
} from '../database/database.types.js';
import type { WorkforceSchedulingReasonCode } from './workforce-scheduling-reasons.js';

export type { WorkforceSchedulingCommandOperation } from '../database/database.types.js';

export interface WorkforceSchedulingFacilityContext {
  facilityId: string;
  facilityName: string;
  timezone: string;
}

export interface WorkforceSchedulingContext {
  tenantId: string;
  tenantName: string;
  organizationId: string;
  organizationName: string;
  canManagePracticeCatalogue: boolean;
  facilities: WorkforceSchedulingFacilityContext[];
}

export interface WorkforceSchedulingContextsResponse {
  contexts: WorkforceSchedulingContext[];
}

export interface WorkforceSchedulingPage<T> {
  page: number;
  pageSize: number;
  total: number;
  items: T[];
}

export interface WorkforceSchedulingListQuery {
  organizationId: string;
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
}

export interface WorkforceAvailabilityTemplateListQuery {
  organizationId: string;
  page: number;
  pageSize: number;
  facilityId?: string;
  practitionerFacilityAssignmentId?: string;
  practitionerServiceAssignmentId?: string;
  appointmentServiceId?: string;
  status?: PractitionerAvailabilityTemplateStatus;
}

export interface WorkforceAvailabilityExceptionListQuery {
  organizationId: string;
  page: number;
  pageSize: number;
  facilityId?: string;
  practitionerFacilityAssignmentId?: string;
  kind?: ProviderAvailabilityExceptionKind;
  status?: ProviderAvailabilityExceptionStatus;
  startsBefore?: string;
  endsAfter?: string;
}

export interface WorkforceAvailabilitySlotListQuery {
  organizationId: string;
  facilityId: string;
  startsAt: string;
  endsAt: string;
  page: number;
  pageSize: number;
  appointmentServiceId?: string;
  practitionerId?: string;
  status?: PatientPortalAppointmentSlotStatus;
}

export interface PractitionerFacilityAssignmentView {
  assignmentId: string;
  facilityId: string;
  facilityName: string;
  status: PractitionerFacilityAssignmentStatus;
  updatedAt: string;
}

export interface PractitionerServiceAssignmentView {
  assignmentId: string;
  practitionerFacilityAssignmentId: string;
  appointmentServiceId: string;
  serviceName: string;
  facilityId: string;
  status: PractitionerServiceAssignmentStatus;
  updatedAt: string;
}

export interface WorkforcePractitionerView {
  practitionerId: string;
  displayName: string;
  professionalTitle: string;
  status: PractitionerStatus;
  applicationUserLinked: boolean;
  updatedAt: string;
  facilityAssignments: PractitionerFacilityAssignmentView[];
  serviceAssignments: PractitionerServiceAssignmentView[];
}

export interface WorkforceSpecialtyView {
  specialtyId: string;
  code: string;
  name: string;
  status: SpecialtyStatus;
  updatedAt: string;
}

export interface WorkforceAppointmentServiceView {
  appointmentServiceId: string;
  facilityId: string;
  facilityName: string;
  specialtyId: string;
  specialtyName: string;
  code: string;
  patientFacingName: string;
  durationMinutes: number;
  allowsAnyPractitioner: boolean;
  status: AppointmentServiceStatus;
  publishable: boolean;
  activePractitionerCount: number;
  updatedAt: string;
  practitionerAssignments: PractitionerServiceAssignmentView[];
}

export interface WorkforceAvailabilityTemplateView {
  availabilityTemplateId: string;
  facilityId: string;
  facilityName: string;
  practitionerFacilityAssignmentId: string;
  practitionerServiceAssignmentId: string;
  practitionerId: string;
  practitionerDisplayName: string;
  appointmentServiceId: string;
  serviceName: string;
  durationMinutes: number;
  isoWeekday: number;
  localStartMinute: number;
  localEndMinute: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  sourceTimezone: string;
  status: PractitionerAvailabilityTemplateStatus;
  updatedAt: string;
}

export interface WorkforceAvailabilityExceptionView {
  availabilityExceptionId: string;
  facilityId: string;
  facilityName: string;
  practitionerFacilityAssignmentId: string | null;
  practitionerId: string | null;
  practitionerDisplayName: string | null;
  kind: ProviderAvailabilityExceptionKind;
  isAllDay: boolean;
  localStartsAt: string;
  localEndsAt: string;
  startsAt: string;
  endsAt: string;
  sourceTimezone: string;
  status: ProviderAvailabilityExceptionStatus;
  updatedAt: string;
}

export interface WorkforceAvailabilitySlotView {
  appointmentSlotId: string;
  availabilityTemplateId: string;
  facilityId: string;
  practitionerFacilityAssignmentId: string;
  practitionerServiceAssignmentId: string;
  practitionerId: string;
  appointmentServiceId: string;
  sourceLocalDate: string;
  sourceTimezone: string;
  startsAt: string;
  endsAt: string;
  status: PatientPortalAppointmentSlotStatus;
  withdrawalPending: boolean;
  hasLiveAppointment: boolean;
  updatedAt: string;
}

export interface SchedulingMutationInput {
  organizationId: string;
  reasonCode: WorkforceSchedulingReasonCode;
}

export interface CreatePractitionerInput extends SchedulingMutationInput {
  facilityId: string;
  displayName: string;
  professionalTitle: string;
}

export interface LinkPractitionerApplicationUserInput extends SchedulingMutationInput {
  applicationUserId: string;
  expectedUpdatedAt: string;
}

export interface CreatePractitionerFacilityAssignmentInput extends SchedulingMutationInput {
  facilityId: string;
}

export interface ChangePractitionerFacilityAssignmentStatusInput extends SchedulingMutationInput {
  status: PractitionerFacilityAssignmentStatus;
  expectedUpdatedAt: string;
}

export interface CreateSpecialtyInput extends SchedulingMutationInput {
  code: string;
  name: string;
}

export interface UpdateSpecialtyInput extends SchedulingMutationInput {
  name?: string;
  status?: SpecialtyStatus;
  expectedUpdatedAt: string;
}

export interface CreateAppointmentServiceInput extends SchedulingMutationInput {
  facilityId: string;
  specialtyId: string;
  code: string;
  patientFacingName: string;
  durationMinutes: number;
  allowsAnyPractitioner: boolean;
}

export interface UpdateAppointmentServiceInput extends SchedulingMutationInput {
  patientFacingName?: string;
  allowsAnyPractitioner?: boolean;
  status?: AppointmentServiceStatus;
  expectedUpdatedAt: string;
}

export interface CreatePractitionerServiceAssignmentInput extends SchedulingMutationInput {
  practitionerFacilityAssignmentId: string;
}

export interface ChangePractitionerServiceAssignmentStatusInput extends SchedulingMutationInput {
  status: PractitionerServiceAssignmentStatus;
  expectedUpdatedAt: string;
}

export interface AvailabilityTemplateDefinitionInput extends SchedulingMutationInput {
  practitionerServiceAssignmentId: string;
  isoWeekday: number;
  localStartMinute: number;
  localEndMinute: number;
  effectiveFrom: string;
  effectiveUntil?: string;
  status: PractitionerAvailabilityTemplateStatus;
}

export type CreateAvailabilityTemplateInput =
  AvailabilityTemplateDefinitionInput;

export interface ReplaceAvailabilityTemplateInput extends AvailabilityTemplateDefinitionInput {
  expectedUpdatedAt: string;
}

export interface ChangeAvailabilityTemplateStatusInput extends SchedulingMutationInput {
  status: PractitionerAvailabilityTemplateStatus;
  expectedUpdatedAt: string;
}

export interface MaterializeAvailabilityTemplateInput extends SchedulingMutationInput {
  expectedUpdatedAt: string;
}

export interface CreateAvailabilityExceptionInput extends SchedulingMutationInput {
  facilityId: string;
  practitionerFacilityAssignmentId?: string;
  kind: ProviderAvailabilityExceptionKind;
  isAllDay: boolean;
  localStartsAt: string;
  localEndsAt: string;
}

export interface CancelAvailabilityExceptionInput extends SchedulingMutationInput {
  status: 'cancelled';
  expectedUpdatedAt: string;
}

export interface ChangeAppointmentServiceDurationInput extends SchedulingMutationInput {
  durationMinutes: number;
  expectedUpdatedAt: string;
}

export interface PractitionerMutationResponse {
  practitioner: WorkforcePractitionerView;
}

export interface PractitionerFacilityAssignmentMutationResponse {
  assignment: PractitionerFacilityAssignmentView;
  affectedAppointmentCount: number;
  affectedAppointmentIds: string[];
  affectedAppointmentIdsTruncated: boolean;
}

export interface SpecialtyMutationResponse {
  specialty: WorkforceSpecialtyView;
}

export interface AppointmentServiceMutationResponse {
  service: WorkforceAppointmentServiceView;
  affectedAppointmentCount: number;
  affectedAppointmentIds: string[];
  affectedAppointmentIdsTruncated: boolean;
}

export interface PractitionerServiceAssignmentMutationResponse {
  assignment: PractitionerServiceAssignmentView;
  affectedAppointmentCount: number;
  affectedAppointmentIds: string[];
  affectedAppointmentIdsTruncated: boolean;
}

export interface AvailabilityMaterializationSummary {
  horizonStartsOn: string;
  horizonEndsBefore: string;
  sourceTimezone: string;
  createdSlotCount: number;
  reactivatedSlotCount: number;
  withdrawnSlotCount: number;
  preservedLiveSlotCount: number;
  skippedOverlapCount: number;
  affectedAppointmentCount: number;
  affectedAppointmentIds: string[];
  affectedAppointmentIdsTruncated: boolean;
}

export interface AvailabilityTemplateMutationResponse {
  template: WorkforceAvailabilityTemplateView;
  replacedTemplateId: string | null;
  materialization: AvailabilityMaterializationSummary;
}

export interface AvailabilityExceptionMutationResponse {
  exception: WorkforceAvailabilityExceptionView;
  materialization: AvailabilityMaterializationSummary;
}

export interface AppointmentServiceDurationMutationResponse {
  service: WorkforceAppointmentServiceView;
  materialization: AvailabilityMaterializationSummary;
}

export interface SchedulingMutationRequest<TInput> {
  principal: AuthenticatedPrincipal;
  idempotencyKey: string;
  input: TInput;
}

export class WorkforceSchedulingAuthorizationLostError extends Error {
  constructor() {
    super('Scheduling catalogue authorization is no longer active.');
  }
}

export class WorkforceSchedulingTargetUnavailableError extends Error {
  constructor() {
    super('The scheduling catalogue target is unavailable.');
  }
}

export class WorkforceSchedulingConflictError extends Error {
  constructor(message = 'The scheduling catalogue change conflicts.') {
    super(message);
  }
}

export class WorkforceSchedulingPersistenceError extends Error {
  constructor() {
    super('The scheduling catalogue is temporarily unavailable.');
  }
}

export class WorkforceSchedulingValidationError extends Error {
  constructor(message = 'The scheduling availability input is invalid.') {
    super(message);
  }
}
