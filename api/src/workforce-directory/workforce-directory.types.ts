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
}

export interface CognitoWorkforceDirectoryPort {
  listAccounts(): Promise<CognitoWorkforceAccount[]>;
}
