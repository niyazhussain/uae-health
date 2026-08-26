export interface WorkforceIdentityProviderAccount {
  subject: string;
  externalAccountId: string;
  availableForWorkforceAccess: boolean;
  created: boolean;
}

export interface WorkforceIdentityProviderPort {
  readonly issuer: string;
  readonly protocol: 'cognito' | 'oidc' | 'saml';
  provisionAccount(
    email: string,
    displayName: string,
  ): Promise<WorkforceIdentityProviderAccount>;
  deleteAccount(externalAccountId: string): Promise<void>;
}
