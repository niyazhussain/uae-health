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
  identityStatus: 'active' | 'suspended' | null;
  cognitoSubject: string | null;
  isSynthetic: boolean;
}

export interface CognitoWorkforceAccount {
  subject: string;
  enabled: boolean;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CognitoProvisionedWorkforceAccount {
  subject: string;
  username: string;
  enabled: boolean;
  status: string;
  created: boolean;
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
  actorCognitoSubject: string;
  authorization: WorkforceInvitationAuthorization;
  account: CognitoProvisionedWorkforceAccount;
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
  actorCognitoSubject: string;
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

export interface AssignWorkforceGlobalRoleInput {
  organizationId: string;
  roleId: string;
  reason: string;
}

export interface AssignWorkforceGlobalRoleRepositoryInput extends AssignWorkforceGlobalRoleInput {
  actorCognitoSubject: string;
  membershipId: string;
}

export interface RevokeWorkforceRoleAssignmentInput {
  organizationId: string;
  reason: string;
}

export interface RevokeWorkforceRoleAssignmentRepositoryInput extends RevokeWorkforceRoleAssignmentInput {
  actorCognitoSubject: string;
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

export interface WorkforceDirectoryUser {
  membershipId: string;
  applicationUserId: string;
  canChangeMembership: boolean;
  roleAssignments: WorkforceRoleAssignment[];
  displayName: string;
  email: string | null;
  membershipStatus: WorkforceDirectoryMember['membershipStatus'];
  identityStatus: WorkforceDirectoryMember['identityStatus'];
  cognitoStatus: string | null;
  cognitoEnabled: boolean | null;
  cognitoCreatedAt: string | null;
  cognitoUpdatedAt: string | null;
  isSynthetic: boolean;
}

export interface WorkforceDirectoryResponse {
  contexts: WorkforceDirectoryContext[];
  selectedContext: WorkforceDirectoryContext;
  canManageRoles: boolean;
  assignableGlobalRoles: WorkforceAssignableGlobalRole[];
  users: WorkforceDirectoryUser[];
}

export interface WorkforceDirectoryRepositoryPort {
  listManageableContexts(
    cognitoSubject: string,
  ): Promise<WorkforceDirectoryContext[]>;
  listMembers(
    tenantId: string,
    organizationId: string,
  ): Promise<WorkforceDirectoryMember[]>;
  authorizeInvitation(
    cognitoSubject: string,
    organizationId: string,
  ): Promise<WorkforceInvitationAuthorization | null>;
  authorizeRoleManagement(
    cognitoSubject: string,
    organizationId: string,
  ): Promise<WorkforceInvitationAuthorization | null>;
  listRoleAssignments(
    tenantId: string,
    organizationId: string,
  ): Promise<WorkforceRoleAssignment[]>;
  listAssignableGlobalRoles(): Promise<WorkforceAssignableGlobalRole[]>;
  isCognitoSubjectBound(cognitoSubject: string): Promise<boolean>;
  persistInvitation(
    input: PersistWorkforceInvitationInput,
  ): Promise<WorkforceInvitationResponse>;
  changeMembershipStatus(
    input: ChangeWorkforceMembershipStatusRepositoryInput,
  ): Promise<WorkforceMembershipStatusResponse>;
  assignGlobalRole(
    input: AssignWorkforceGlobalRoleRepositoryInput,
  ): Promise<WorkforceRoleAssignment>;
  revokeRoleAssignment(
    input: RevokeWorkforceRoleAssignmentRepositoryInput,
  ): Promise<WorkforceRoleAssignment>;
}

export interface CognitoWorkforceDirectoryPort {
  listAccounts(): Promise<CognitoWorkforceAccount[]>;
  provisionAccount(
    email: string,
    displayName: string,
  ): Promise<CognitoProvisionedWorkforceAccount>;
  deleteAccount(username: string): Promise<void>;
}
