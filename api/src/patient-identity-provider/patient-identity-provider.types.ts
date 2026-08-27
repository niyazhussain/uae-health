export interface CreatedPatientIdentityProviderAccount {
  kind: 'created';
  subject: string;
  externalAccountId: string;
}

export interface ExistingPatientIdentityProviderAccount {
  kind: 'already_exists';
}

export type PatientIdentityProviderProvisioningResult =
  | CreatedPatientIdentityProviderAccount
  | ExistingPatientIdentityProviderAccount;

export interface PatientIdentityProviderPort {
  readonly issuer: string;
  readonly clientId: string;
  readonly protocol: 'cognito' | 'oidc' | 'saml';
  provisionAccount(
    email: string,
    displayName: string,
  ): Promise<PatientIdentityProviderProvisioningResult>;
  deleteAccount(externalAccountId: string): Promise<void>;
}
