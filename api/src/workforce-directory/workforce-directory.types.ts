import type { WorkforceIdentityProviderAccount } from '../identity-provider/identity-provider.types.js';

export type {
  WorkforceIdentityProviderAccount,
  WorkforceIdentityProviderPort,
} from '../identity-provider/identity-provider.types.js';

export interface WorkforceDirectoryContext {
  tenantId: string;
  tenantName: string;
  organizationId: string;
  organizationName: string;
}

export interface WorkforceDirectoryMember {
  membershipId: string;
  applicationUserId: string;
  displayName: string;
  email: string | null;
  membershipStatus: 'pending' | 'active' | 'suspended' | 'revoked';
  accountStatus: 'active' | 'suspended' | 'closed';
  identityStatus: 'active' | 'suspended' | null;
  identitySubject: string | null;
  providerSyncStatus: 'pending' | 'synchronized' | 'failed' | null;
  isSynthetic: boolean;
}

export interface CreateWorkforceInvitationInput {
  organizationId: string;
  displayName: string;
  email: string;
  reason: string;
}

export interface WorkforceInvitationAuthorization {
  actorUserId: string;
  tenantId: string;
  tenantName: string;
  tenantIsSynthetic: boolean;
  organizationId: string;
  organizationName: string;
}

export interface PersistWorkforceInvitationInput {
  actorSubject: string;
  authorization: WorkforceInvitationAuthorization;
  account: WorkforceIdentityProviderAccount;
  displayName: string;
  email: string;
  reason: string;
}

export interface WorkforceInvitationResponse {
  applicationUserId: string;
  membershipId: string;
  organizationId: string;
  email: string;
  membershipStatus: 'active';
  accountCreated: boolean;
  delivery: 'email' | 'existing-account';
}

export type WorkforceMembershipMutableStatus = 'active' | 'suspended';

export interface ChangeWorkforceMembershipStatusInput {
  organizationId: string;
  status: WorkforceMembershipMutableStatus;
  reason: string;
}

export interface ChangeWorkforceMembershipStatusRepositoryInput extends ChangeWorkforceMembershipStatusInput {
  actorSubject: string;
  membershipId: string;
}

export interface WorkforceMembershipStatusResponse {
  membershipId: string;
  organizationId: string;
  membershipStatus: WorkforceMembershipMutableStatus;
  sessionsRevoked: number;
}

export interface WorkforceRoleAssignment {
  assignmentId: string;
  membershipId: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  roleDescription: string;
  organizationId: string;
}

export interface WorkforceAssignableGlobalRole {
  roleId: string;
  code: string;
  name: string;
  description: string;
}

export interface WorkforceDelegablePermission {
  permissionId: string;
  code: string;
  name: string;
  description: string;
}

export interface WorkforceTenantLocalRole {
  roleId: string;
  code: string;
  name: string;
  description: string;
  permissions: WorkforceDelegablePermission[];
}

export interface WorkforceRoleCataloguePermission {
  permissionId: string;
  code: string;
  name: string;
  description: string;
  isDelegable: boolean;
}

export type WorkforceRoleCatalogueSource = 'all' | 'global' | 'tenant-local';

export interface WorkforceRoleCatalogueQuery {
  organizationId?: string;
  page: number;
  pageSize: number;
  source: WorkforceRoleCatalogueSource;
  search?: string;
}

export interface WorkforceRoleCatalogueRole {
  roleId: string;
  code: string;
  name: string;
  description: string;
  source: 'global' | 'tenant-local';
  isDelegable: boolean;
  assignmentCount: number;
  permissionCount: number;
}

export interface WorkforceRoleCatalogueRoleDetail extends WorkforceRoleCatalogueRole {
  permissions: WorkforceRoleCataloguePermission[];
}

export interface WorkforceRoleCataloguePage {
  roles: WorkforceRoleCatalogueRole[];
  total: number;
}

export interface AssignWorkforceGlobalRoleInput {
  organizationId: string;
  roleId: string;
  reason: string;
}

export interface AssignWorkforceGlobalRoleRepositoryInput extends AssignWorkforceGlobalRoleInput {
  actorSubject: string;
  membershipId: string;
}

export interface CreateWorkforceTenantLocalRoleInput {
  organizationId: string;
  name: string;
  description: string;
  permissionIds: string[];
  reason: string;
}

export interface CreateWorkforceTenantLocalRoleRepositoryInput extends CreateWorkforceTenantLocalRoleInput {
  actorSubject: string;
}

export interface AssignWorkforceTenantLocalRoleInput {
  organizationId: string;
  roleId: string;
  reason: string;
}

export interface AssignWorkforceTenantLocalRoleRepositoryInput extends AssignWorkforceTenantLocalRoleInput {
  actorSubject: string;
  membershipId: string;
}

export interface RevokeWorkforceRoleAssignmentInput {
  organizationId: string;
  reason: string;
}

export interface RevokeWorkforceRoleAssignmentRepositoryInput extends RevokeWorkforceRoleAssignmentInput {
  actorSubject: string;
  assignmentId: string;
}

export class WorkforceMembershipConflictError extends Error {
  constructor(message = 'This user already has membership in the practice.') {
    super(message);
    this.name = 'WorkforceMembershipConflictError';
  }
}

export class WorkforceInvitationAuthorizationLostError extends Error {
  constructor() {
    super('Invitation authorization is no longer active.');
    this.name = 'WorkforceInvitationAuthorizationLostError';
  }
}

export class WorkforceIdentityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkforceIdentityConflictError';
  }
}

export class WorkforceMembershipStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkforceMembershipStateConflictError';
  }
}

export class WorkforceMembershipManagementAuthorizationLostError extends Error {
  constructor() {
    super('Workforce membership-management authorization is no longer active.');
    this.name = 'WorkforceMembershipManagementAuthorizationLostError';
  }
}

export class WorkforceRoleManagementAuthorizationLostError extends Error {
  constructor() {
    super('Workforce role-management authorization is no longer active.');
    this.name = 'WorkforceRoleManagementAuthorizationLostError';
  }
}

export class WorkforceRoleAssignmentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkforceRoleAssignmentConflictError';
  }
}

export class WorkforceTenantLocalRoleConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkforceTenantLocalRoleConflictError';
  }
}

export interface WorkforceDirectoryUser {
  membershipId: string;
  applicationUserId: string;
  canChangeMembership: boolean;
  roleAssignments: WorkforceRoleAssignment[];
  displayName: string;
  email: string | null;
  membershipStatus: WorkforceDirectoryMember['membershipStatus'];
  accountStatus: WorkforceDirectoryMember['accountStatus'];
  identityStatus: WorkforceDirectoryMember['identityStatus'];
  providerSyncStatus: WorkforceDirectoryMember['providerSyncStatus'];
  isSynthetic: boolean;
}

export interface WorkforceDirectoryResponse {
  contexts: WorkforceDirectoryContext[];
  selectedContext: WorkforceDirectoryContext;
  canManageRoles: boolean;
  assignableGlobalRoles: WorkforceAssignableGlobalRole[];
  tenantLocalRoles: WorkforceTenantLocalRole[];
  delegablePermissions: WorkforceDelegablePermission[];
  users: WorkforceDirectoryUser[];
}

export interface WorkforceRoleCatalogueResponse {
  contexts: WorkforceDirectoryContext[];
  selectedContext: WorkforceDirectoryContext;
  page: number;
  pageSize: number;
  total: number;
  roles: WorkforceRoleCatalogueRole[];
}

export interface WorkforceDirectoryRepositoryPort {
  listManageableContexts(subject: string): Promise<WorkforceDirectoryContext[]>;
  listRoleManageableContexts(
    subject: string,
  ): Promise<WorkforceDirectoryContext[]>;
  listMembers(
    tenantId: string,
    organizationId: string,
  ): Promise<WorkforceDirectoryMember[]>;
  authorizeInvitation(
    subject: string,
    organizationId: string,
  ): Promise<WorkforceInvitationAuthorization | null>;
  authorizeRoleManagement(
    subject: string,
    organizationId: string,
  ): Promise<WorkforceInvitationAuthorization | null>;
  listRoleAssignments(
    tenantId: string,
    organizationId: string,
  ): Promise<WorkforceRoleAssignment[]>;
  listAssignableGlobalRoles(): Promise<WorkforceAssignableGlobalRole[]>;
  listTenantLocalRoles(tenantId: string): Promise<WorkforceTenantLocalRole[]>;
  listRoleCatalogue(
    tenantId: string,
    organizationId: string,
    query: WorkforceRoleCatalogueQuery,
  ): Promise<WorkforceRoleCataloguePage>;
  getRoleCatalogueRole(
    tenantId: string,
    organizationId: string,
    roleId: string,
  ): Promise<WorkforceRoleCatalogueRoleDetail | null>;
  listDelegablePermissions(): Promise<WorkforceDelegablePermission[]>;
  isIdentitySubjectBound(subject: string): Promise<boolean>;
  persistInvitation(
    input: PersistWorkforceInvitationInput,
  ): Promise<WorkforceInvitationResponse>;
  changeMembershipStatus(
    input: ChangeWorkforceMembershipStatusRepositoryInput,
  ): Promise<WorkforceMembershipStatusResponse>;
  assignGlobalRole(
    input: AssignWorkforceGlobalRoleRepositoryInput,
  ): Promise<WorkforceRoleAssignment>;
  createTenantLocalRole(
    input: CreateWorkforceTenantLocalRoleRepositoryInput,
  ): Promise<WorkforceTenantLocalRole>;
  assignTenantLocalRole(
    input: AssignWorkforceTenantLocalRoleRepositoryInput,
  ): Promise<WorkforceRoleAssignment>;
  revokeRoleAssignment(
    input: RevokeWorkforceRoleAssignmentRepositoryInput,
  ): Promise<WorkforceRoleAssignment>;
}
