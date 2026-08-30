import type { Generated } from 'kysely';

export type TenantStatus = 'active' | 'suspended' | 'closed';
export type OrganizationKind = 'group' | 'practice';
export type UserStatus = 'active' | 'suspended' | 'closed';
export type IdentityProtocol = 'cognito' | 'oidc' | 'saml';
export type IdentityStatus = 'active' | 'suspended';
export type ProviderSyncStatus = 'pending' | 'synchronized' | 'failed';
export type PatientPortalIdentityStatus =
  'pending_verification' | 'active' | 'suspended';
export type PatientPortalProfileStatus = 'active' | 'suspended' | 'closed';
export type PatientPortalProfileLinkStatus = 'active' | 'revoked';
export type PatientPortalAppointmentRelationshipStatus = 'pending';
export type PatientPortalBookablePracticeStatus = 'active' | 'unavailable';
export type PatientPortalAppointmentSlotStatus = 'available' | 'withdrawn';
export type PatientPortalAppointmentStatus = 'requested' | 'cancelled';
export type PractitionerStatus = 'active' | 'inactive';
export type SpecialtyStatus = 'active' | 'retired';
export type AppointmentServiceStatus = 'active' | 'inactive';
export type PractitionerFacilityAssignmentStatus = 'active' | 'inactive';
export type PractitionerServiceAssignmentStatus = 'active' | 'inactive';
export type PractitionerAvailabilityTemplateStatus = 'active' | 'inactive';
export type ProviderAvailabilityExceptionKind =
  'facility_closed' | 'practitioner_unavailable';
export type ProviderAvailabilityExceptionStatus = 'active' | 'cancelled';
export type PatientPortalAppointmentCommandOperation =
  | 'relationship_create'
  | 'appointment_create'
  | 'appointment_cancellation'
  | 'appointment_reschedule';
export type WorkforceSchedulingCommandOperation =
  | 'practitioner_create'
  | 'practitioner_link_application_user'
  | 'practitioner_facility_assignment_create'
  | 'practitioner_facility_assignment_status'
  | 'specialty_create'
  | 'specialty_update'
  | 'service_create'
  | 'service_update'
  | 'practitioner_service_assignment_create'
  | 'practitioner_service_assignment_status'
  | 'availability_template_create'
  | 'availability_template_replace'
  | 'availability_template_status'
  | 'availability_exception_create'
  | 'availability_exception_cancel'
  | 'availability_template_materialize'
  | 'service_duration_update';
export type PatientPortalRegistrationRequestStatus =
  'pending_provider' | 'pending_binding' | 'accepted' | 'rate_limited';
export type PatientPortalInvitationStatus =
  'issued' | 'accepted' | 'revoked' | 'expired';
export type MembershipStatus = 'pending' | 'active' | 'suspended' | 'revoked';
export type ProvisioningMethod = 'admin_invite' | 'jit' | 'scim';
export type RoleRequestPolicy = 'admin_only' | 'approval_required';
export type RoleStatus = 'active' | 'retired';
export type RoleRequestStatus =
  'pending' | 'approved' | 'rejected' | 'cancelled';
export type AssignmentSource =
  'admin' | 'approved_request' | 'system_bootstrap';
export type AuditActorType = 'user' | 'service' | 'system';
export type AuditOutcome = 'success' | 'denied' | 'failure';
export type AuditSnapshot = Record<string, unknown>;

export interface TenantTable {
  id: Generated<string>;
  code: string;
  name: string;
  status: Generated<TenantStatus>;
  is_synthetic: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface OrganizationTable {
  id: Generated<string>;
  tenant_id: string;
  parent_organization_id: string | null;
  kind: OrganizationKind;
  code: string;
  name: string;
  is_synthetic: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface FacilityTable {
  id: Generated<string>;
  tenant_id: string;
  organization_id: string;
  code: string;
  name: string;
  timezone: string;
  is_synthetic: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ApplicationUserTable {
  id: Generated<string>;
  display_name: string;
  primary_email: string | null;
  status: Generated<UserStatus>;
  is_synthetic: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/**
 * A tenant-owned scheduling profile. Its optional application-user binding is
 * explicit and grants no authentication or authorization by itself.
 */
export interface PractitionerTable {
  id: Generated<string>;
  tenant_id: string;
  application_user_id: string | null;
  display_name: string;
  professional_title: string;
  status: Generated<PractitionerStatus>;
  is_synthetic: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SpecialtyTable {
  id: Generated<string>;
  tenant_id: string;
  organization_id: string;
  organization_kind: Generated<'practice'>;
  code: string;
  name: string;
  status: Generated<SpecialtyStatus>;
  is_synthetic: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AppointmentServiceTable {
  id: Generated<string>;
  tenant_id: string;
  organization_id: string;
  organization_kind: Generated<'practice'>;
  facility_id: string;
  specialty_id: string;
  code: string;
  patient_facing_name: string;
  duration_minutes: number;
  allows_any_practitioner: Generated<boolean>;
  status: Generated<AppointmentServiceStatus>;
  is_synthetic: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** An explicit doctor eligibility for one service at one practice facility. */
export interface PractitionerServiceAssignmentTable {
  id: Generated<string>;
  tenant_id: string;
  organization_id: string;
  facility_id: string;
  practitioner_facility_assignment_id: string;
  practitioner_id: string;
  appointment_service_id: string;
  status: Generated<PractitionerServiceAssignmentStatus>;
  is_synthetic: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** A doctor's explicit affiliation with one practice facility. */
export interface PractitionerFacilityAssignmentTable {
  id: Generated<string>;
  tenant_id: string;
  organization_id: string;
  organization_kind: Generated<'practice'>;
  facility_id: string;
  practitioner_id: string;
  status: Generated<PractitionerFacilityAssignmentStatus>;
  is_synthetic: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** A recurring same-local-day availability window for one eligible service. */
export interface PractitionerAvailabilityTemplateTable {
  id: Generated<string>;
  tenant_id: string;
  organization_id: string;
  facility_id: string;
  practitioner_facility_assignment_id: string;
  practitioner_service_assignment_id: string;
  practitioner_id: string;
  appointment_service_id: string;
  iso_weekday: number;
  local_start_minute: number;
  local_end_minute: number;
  effective_from: string;
  effective_until: string | null;
  source_timezone: string;
  status: Generated<PractitionerAvailabilityTemplateStatus>;
  is_synthetic: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** A dated facility closure or practitioner absence with resolved UTC bounds. */
export interface ProviderAvailabilityExceptionTable {
  id: Generated<string>;
  tenant_id: string;
  organization_id: string;
  organization_kind: Generated<'practice'>;
  facility_id: string;
  practitioner_facility_assignment_id: string | null;
  practitioner_id: string | null;
  kind: ProviderAvailabilityExceptionKind;
  local_starts_at: string;
  local_ends_at: string;
  starts_at: Date;
  ends_at: Date;
  source_timezone: string;
  is_all_day: Generated<boolean>;
  status: Generated<ProviderAvailabilityExceptionStatus>;
  is_synthetic: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface IdentityConnectionTable {
  id: Generated<string>;
  tenant_id: string;
  code: string;
  name: string;
  protocol: IdentityProtocol;
  issuer: string;
  status: Generated<IdentityStatus>;
  jit_provisioning_enabled: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface UserIdentityTable {
  id: Generated<string>;
  application_user_id: string;
  identity_connection_id: string;
  subject: string;
  status: Generated<IdentityStatus>;
  provider_sync_status: Generated<ProviderSyncStatus>;
  provider_sync_attempted_at: Date | null;
  provider_sync_completed_at: Date | null;
  provider_sync_error_code: string | null;
  last_authenticated_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface OrganizationMembershipTable {
  id: Generated<string>;
  tenant_id: string;
  organization_id: string;
  application_user_id: string;
  status: Generated<MembershipStatus>;
  provisioning_method: ProvisioningMethod;
  external_id: string | null;
  valid_from: Generated<Date>;
  valid_until: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface MembershipFacilityTable {
  tenant_id: string;
  membership_id: string;
  facility_id: string;
  created_at: Generated<Date>;
}

export interface PermissionTable {
  id: Generated<string>;
  code: string;
  name: string;
  description: string;
  is_delegable: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RoleTable {
  id: Generated<string>;
  tenant_id: string | null;
  code: string;
  name: string;
  description: string;
  is_system_template: Generated<boolean>;
  request_policy: Generated<RoleRequestPolicy>;
  cloned_from_role_id: string | null;
  status: Generated<RoleStatus>;
  created_by_user_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RolePermissionTable {
  role_id: string;
  permission_id: string;
  granted_by_user_id: string | null;
  created_at: Generated<Date>;
}

export interface RoleRequestTable {
  id: Generated<string>;
  tenant_id: string;
  membership_id: string;
  role_id: string;
  scope_organization_id: string;
  facility_id: string | null;
  include_descendants: Generated<boolean>;
  requested_by_user_id: string;
  request_reason: string;
  status: Generated<RoleRequestStatus>;
  decided_by_user_id: string | null;
  decision_reason: string | null;
  decided_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RoleAssignmentTable {
  id: Generated<string>;
  tenant_id: string;
  membership_id: string;
  role_id: string;
  scope_organization_id: string;
  facility_id: string | null;
  include_descendants: Generated<boolean>;
  assignment_source: AssignmentSource;
  assigned_by_user_id: string | null;
  source_role_request_id: string | null;
  valid_from: Generated<Date>;
  valid_until: Date | null;
  revoked_at: Date | null;
  revoked_by_user_id: string | null;
  revocation_reason: string | null;
  created_at: Generated<Date>;
}

export interface ApprovalLimitTable {
  id: Generated<string>;
  tenant_id: string;
  role_id: string | null;
  membership_id: string | null;
  operation_code: string;
  currency: string;
  maximum_amount: string;
  created_by_user_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AuditEventTable {
  id: Generated<string>;
  actor_type: AuditActorType;
  actor_identifier: string;
  actor_user_id: string | null;
  effective_user_id: string | null;
  tenant_id: string | null;
  organization_id: string | null;
  facility_id: string | null;
  action: string;
  target_entity_type: string;
  target_entity_id: string;
  outcome: AuditOutcome;
  correlation_id: string;
  reason: string;
  before_data: AuditSnapshot | null;
  after_data: AuditSnapshot | null;
  occurred_at: Generated<Date>;
}

export interface WorkforceSessionTable {
  id: Generated<string>;
  session_token_hash: string;
  csrf_token_hash: string;
  cognito_subject: string;
  cognito_client_id: string;
  cognito_username: string | null;
  idle_expires_at: Date;
  absolute_expires_at: Date;
  last_seen_at: Generated<Date>;
  revoked_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PatientPortalProfileTable {
  id: Generated<string>;
  tenant_id: string;
  organization_id: string;
  application_user_id: string;
  status: Generated<PatientPortalProfileStatus>;
  is_synthetic: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PatientPortalIdentityTable {
  id: Generated<string>;
  application_user_id: string;
  issuer: string;
  subject: string;
  client_id: string;
  username: string | null;
  status: Generated<PatientPortalIdentityStatus>;
  provider_sync_status: Generated<ProviderSyncStatus>;
  provider_sync_attempted_at: Date | null;
  provider_sync_completed_at: Date | null;
  provider_sync_error_code: string | null;
  last_authenticated_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PatientPortalRegistrationRequestTable {
  id: Generated<string>;
  idempotency_key_hash: string;
  request_hash: string;
  email_hmac: string;
  client_ip_hmac: string;
  provider_issuer: string | null;
  provider_subject: string | null;
  status: PatientPortalRegistrationRequestStatus;
  expires_at: Date;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PatientPortalInvitationTable {
  id: Generated<string>;
  tenant_id: string;
  organization_id: string;
  issued_by_user_id: string;
  token_hash: string;
  status: Generated<PatientPortalInvitationStatus>;
  reason: string;
  expires_at: Date;
  accepted_patient_portal_identity_id: string | null;
  accepted_patient_portal_profile_id: string | null;
  accepted_at: Date | null;
  revoked_at: Date | null;
  revoked_by_user_id: string | null;
  revocation_reason: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PatientPortalProfileLinkTable {
  id: Generated<string>;
  patient_portal_profile_id: string;
  patient_portal_identity_id: string;
  status: Generated<PatientPortalProfileLinkStatus>;
  linked_by_user_id: string | null;
  link_reason: string;
  revoked_at: Date | null;
  revoked_by_user_id: string | null;
  revocation_reason: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PatientPortalSessionTable {
  id: Generated<string>;
  session_token_hash: string;
  csrf_token_hash: string;
  patient_portal_identity_id: string;
  patient_portal_profile_id: string | null;
  patient_portal_appointment_relationship_id: string | null;
  identity_issuer: string;
  identity_subject: string;
  identity_client_id: string;
  identity_username: string | null;
  idle_expires_at: Date;
  absolute_expires_at: Date;
  last_seen_at: Generated<Date>;
  revoked_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/**
 * A patient-owned, practice-specific pending relationship created only by the
 * appointment-onboarding workflow. It is intentionally separate from an
 * approved patient_portal_profile_link and never grants normal portal access.
 */
export interface PatientPortalAppointmentRelationshipTable {
  id: Generated<string>;
  tenant_id: string;
  organization_id: string;
  patient_portal_identity_id: string;
  status: Generated<PatientPortalAppointmentRelationshipStatus>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** A practice that has explicitly opted into synthetic patient booking. */
export interface PatientPortalBookablePracticeTable {
  id: Generated<string>;
  tenant_id: string;
  organization_id: string;
  timezone: string;
  status: Generated<PatientPortalBookablePracticeStatus>;
  is_synthetic: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** A synthetic, one-patient-capacity appointment slot. */
export interface PatientPortalAppointmentSlotTable {
  id: Generated<string>;
  bookable_practice_id: string;
  tenant_id: string;
  organization_id: string;
  starts_at: Date;
  ends_at: Date;
  facility_id: Generated<string | null>;
  practitioner_facility_assignment_id: Generated<string | null>;
  practitioner_service_assignment_id: Generated<string | null>;
  practitioner_id: Generated<string | null>;
  appointment_service_id: Generated<string | null>;
  availability_template_id: Generated<string | null>;
  generation_key_hash: Generated<string | null>;
  source_local_date: Generated<string | null>;
  source_timezone: Generated<string | null>;
  status: Generated<PatientPortalAppointmentSlotStatus>;
  withdrawal_pending: Generated<boolean>;
  is_synthetic: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PatientPortalAppointmentTable {
  id: Generated<string>;
  tenant_id: string;
  organization_id: string;
  patient_portal_identity_id: string;
  patient_portal_profile_id: string | null;
  patient_portal_appointment_relationship_id: string | null;
  appointment_slot_id: string;
  facility_id: Generated<string | null>;
  practitioner_facility_assignment_id: Generated<string | null>;
  practitioner_service_assignment_id: Generated<string | null>;
  practitioner_id: Generated<string | null>;
  appointment_service_id: Generated<string | null>;
  status: Generated<PatientPortalAppointmentStatus>;
  version: Generated<number>;
  cancelled_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/**
 * Durable idempotency evidence for authenticated patient appointment commands.
 * The command key and request data are hashed before persistence.
 */
export interface PatientPortalAppointmentCommandTable {
  id: Generated<string>;
  patient_portal_identity_id: string;
  operation: PatientPortalAppointmentCommandOperation;
  idempotency_key_hash: string;
  request_hash: string;
  response_data: Record<string, unknown>;
  patient_portal_appointment_relationship_id: string | null;
  patient_portal_appointment_id: string | null;
  created_at: Generated<Date>;
}

/**
 * Durable idempotency evidence for exact-practice workforce scheduling
 * catalogue commands. Raw command keys and request payloads are never stored.
 */
export interface WorkforceSchedulingCommandTable {
  id: Generated<string>;
  actor_user_id: string;
  tenant_id: string;
  organization_id: string;
  organization_kind: Generated<'practice'>;
  operation: WorkforceSchedulingCommandOperation;
  idempotency_key_hash: string;
  request_hash: string;
  response_data: Record<string, unknown>;
  target_entity_type: string;
  target_entity_id: string;
  created_at: Generated<Date>;
}

export interface DatabaseSchema {
  tenants: TenantTable;
  organizations: OrganizationTable;
  facilities: FacilityTable;
  application_users: ApplicationUserTable;
  practitioners: PractitionerTable;
  specialties: SpecialtyTable;
  practitioner_facility_assignments: PractitionerFacilityAssignmentTable;
  appointment_services: AppointmentServiceTable;
  practitioner_service_assignments: PractitionerServiceAssignmentTable;
  practitioner_availability_templates: PractitionerAvailabilityTemplateTable;
  provider_availability_exceptions: ProviderAvailabilityExceptionTable;
  identity_connections: IdentityConnectionTable;
  user_identities: UserIdentityTable;
  organization_memberships: OrganizationMembershipTable;
  membership_facilities: MembershipFacilityTable;
  permissions: PermissionTable;
  roles: RoleTable;
  role_permissions: RolePermissionTable;
  role_requests: RoleRequestTable;
  role_assignments: RoleAssignmentTable;
  approval_limits: ApprovalLimitTable;
  audit_events: AuditEventTable;
  workforce_sessions: WorkforceSessionTable;
  patient_portal_identities: PatientPortalIdentityTable;
  patient_portal_registration_requests: PatientPortalRegistrationRequestTable;
  patient_portal_profiles: PatientPortalProfileTable;
  patient_portal_profile_links: PatientPortalProfileLinkTable;
  patient_portal_sessions: PatientPortalSessionTable;
  patient_portal_invitations: PatientPortalInvitationTable;
  patient_portal_appointment_relationships: PatientPortalAppointmentRelationshipTable;
  patient_portal_bookable_practices: PatientPortalBookablePracticeTable;
  patient_portal_appointment_slots: PatientPortalAppointmentSlotTable;
  patient_portal_appointments: PatientPortalAppointmentTable;
  patient_portal_appointment_commands: PatientPortalAppointmentCommandTable;
  workforce_scheduling_commands: WorkforceSchedulingCommandTable;
}
