import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AliasExistsException,
  CognitoIdentityProviderClient,
  UserNotFoundException,
  UsernameExistsException,
  type AttributeType,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  WorkforceIdentityProviderAccount,
  WorkforceIdentityProviderPort,
} from '../workforce-directory/workforce-directory.types.js';

function attribute(
  attributes: AttributeType[] | undefined,
  name: string,
): string | undefined {
  return attributes?.find((candidate) => candidate.Name === name)?.Value;
}

@Injectable()
export class CognitoWorkforceIdentityAdapter implements WorkforceIdentityProviderPort {
  private readonly client: CognitoIdentityProviderClient;
  private readonly userPoolId: string;
  readonly issuer: string;
  readonly protocol = 'cognito' as const;

  constructor(config: ConfigService) {
    this.client = new CognitoIdentityProviderClient({
      region: config.getOrThrow<string>('COGNITO_REGION'),
    });
    this.userPoolId = config.getOrThrow<string>('COGNITO_USER_POOL_ID');
    this.issuer = `https://cognito-idp.${config.getOrThrow<string>('COGNITO_REGION')}.amazonaws.com/${this.userPoolId}`;
  }

  async provisionAccount(
    email: string,
    displayName: string,
  ): Promise<WorkforceIdentityProviderAccount> {
    const existing = await this.getAccount(email);
    if (existing) return { ...existing, created: false };

    try {
      const response = await this.client.send(
        new AdminCreateUserCommand({
          UserPoolId: this.userPoolId,
          Username: email,
          DesiredDeliveryMediums: ['EMAIL'],
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'name', Value: displayName },
          ],
        }),
      );
      const account = this.toAccount(response.User);
      if (account) return { ...account, created: true };

      const created = await this.getAccount(email);
      if (!created) {
        throw new Error('Identity-provider account was not returned.');
      }
      return { ...created, created: true };
    } catch (error) {
      if (
        error instanceof UsernameExistsException ||
        error instanceof AliasExistsException
      ) {
        const racedAccount = await this.getAccount(email);
        if (racedAccount) return { ...racedAccount, created: false };
      }
      throw error;
    }
  }

  async deleteAccount(externalAccountId: string): Promise<void> {
    await this.client.send(
      new AdminDeleteUserCommand({
        UserPoolId: this.userPoolId,
        Username: externalAccountId,
      }),
    );
  }

  private async getAccount(
    usernameOrAlias: string,
  ): Promise<Omit<WorkforceIdentityProviderAccount, 'created'> | null> {
    try {
      const response = await this.client.send(
        new AdminGetUserCommand({
          UserPoolId: this.userPoolId,
          Username: usernameOrAlias,
        }),
      );
      const account = this.toAccount({
        Username: response.Username,
        Attributes: response.UserAttributes,
        Enabled: response.Enabled,
        UserStatus: response.UserStatus,
      });
      if (!account) {
        throw new Error('Identity-provider account has no subject.');
      }
      return account;
    } catch (error) {
      if (error instanceof UserNotFoundException) return null;
      throw error;
    }
  }

  private toAccount(
    user: UserType | undefined,
  ): Omit<WorkforceIdentityProviderAccount, 'created'> | null {
    const subject = attribute(user?.Attributes, 'sub');
    if (!user?.Username || !subject) return null;

    return {
      subject,
      externalAccountId: user.Username,
      availableForWorkforceAccess:
        user.Enabled === true &&
        ['FORCE_CHANGE_PASSWORD', 'CONFIRMED', 'RESET_REQUIRED'].includes(
          user.UserStatus ?? 'UNKNOWN',
        ),
    };
  }
}
