export interface WorkforceDirectoryContext {
  tenantId: string;
  tenantName: string;
  organizationId: string;
  organizationName: string;
}

export interface WorkforceDirectoryMember {
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

export interface WorkforceDirectoryUser {
  applicationUserId: string;
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
  isCognitoSubjectBound(cognitoSubject: string): Promise<boolean>;
  persistInvitation(
    input: PersistWorkforceInvitationInput,
  ): Promise<WorkforceInvitationResponse>;
}

export interface CognitoWorkforceDirectoryPort {
  listAccounts(): Promise<CognitoWorkforceAccount[]>;
  provisionAccount(
    email: string,
    displayName: string,
  ): Promise<CognitoProvisionedWorkforceAccount>;
  deleteAccount(username: string): Promise<void>;
}
