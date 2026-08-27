import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AliasExistsException,
  CognitoIdentityProviderClient,
  UsernameExistsException,
  type AttributeType,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CreatedPatientIdentityProviderAccount,
  PatientIdentityProviderPort,
  PatientIdentityProviderProvisioningResult,
} from './patient-identity-provider.types.js';

function attribute(
  attributes: AttributeType[] | undefined,
  name: string,
): string | undefined {
  return attributes?.find((candidate) => candidate.Name === name)?.Value;
}

@Injectable()
export class CognitoPatientIdentityAdapter implements PatientIdentityProviderPort {
  private readonly client?: CognitoIdentityProviderClient;
  private readonly userPoolId?: string;
  readonly issuer: string = '';
  readonly clientId: string = '';
  readonly protocol = 'cognito' as const;

  constructor(config: ConfigService) {
    if (config.getOrThrow<string>('PATIENT_AUTH_MODE') !== 'cognito') {
      return;
    }

    const region = config.getOrThrow<string>('COGNITO_REGION');
    const userPoolId = config.getOrThrow<string>(
      'PATIENT_COGNITO_USER_POOL_ID',
    );
    const clientId = config.getOrThrow<string>(
      'PATIENT_COGNITO_USER_POOL_CLIENT_ID',
    );

    this.client = new CognitoIdentityProviderClient({ region });
    this.userPoolId = userPoolId;
    this.clientId = clientId;
    this.issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
  }

  async provisionAccount(
    email: string,
    displayName: string,
  ): Promise<PatientIdentityProviderProvisioningResult> {
    const client = this.requireClient();

    try {
      const response = await client.send(
        new AdminCreateUserCommand({
          UserPoolId: this.userPoolId,
          Username: email,
          DesiredDeliveryMediums: ['EMAIL'],
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'name', Value: displayName },
          ],
        }),
      );

      return this.createdAccount(response.User);
    } catch (error) {
      if (
        error instanceof UsernameExistsException ||
        error instanceof AliasExistsException
      ) {
        return { kind: 'already_exists' };
      }
      throw error;
    }
  }

  async deleteAccount(externalAccountId: string): Promise<void> {
    const client = this.requireClient();
    await client.send(
      new AdminDeleteUserCommand({
        UserPoolId: this.userPoolId,
        Username: externalAccountId,
      }),
    );
  }

  private requireClient(): CognitoIdentityProviderClient {
    if (!this.client || !this.userPoolId) {
      throw new Error('Patient identity provisioning is not configured.');
    }

    return this.client;
  }

  private createdAccount(
    user: UserType | undefined,
  ): CreatedPatientIdentityProviderAccount {
    const subject = attribute(user?.Attributes, 'sub');

    if (!user?.Username || !subject) {
      throw new Error(
        'Patient identity provider did not return an immutable subject.',
      );
    }

    return {
      kind: 'created',
      subject,
      externalAccountId: user.Username,
    };
  }
}
