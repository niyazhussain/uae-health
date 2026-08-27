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

export interface DatabaseSchema {
  tenants: TenantTable;
  organizations: OrganizationTable;
  facilities: FacilityTable;
  application_users: ApplicationUserTable;
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
}
