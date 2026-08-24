import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AliasExistsException,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  UserNotFoundException,
  UsernameExistsException,
  type AttributeType,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CognitoWorkforceAccount,
  CognitoProvisionedWorkforceAccount,
  CognitoWorkforceDirectoryPort,
} from './workforce-directory.types.js';

function attribute(
  attributes: AttributeType[] | undefined,
  name: string,
): string | undefined {
  return attributes?.find((candidate) => candidate.Name === name)?.Value;
}

@Injectable()
export class CognitoWorkforceDirectoryAdapter implements CognitoWorkforceDirectoryPort {
  private readonly client: CognitoIdentityProviderClient;
  private readonly userPoolId: string;

  constructor(config: ConfigService) {
    this.client = new CognitoIdentityProviderClient({
      region: config.getOrThrow<string>('COGNITO_REGION'),
    });
    this.userPoolId = config.getOrThrow<string>('COGNITO_USER_POOL_ID');
  }

  async listAccounts(): Promise<CognitoWorkforceAccount[]> {
    const accounts: CognitoWorkforceAccount[] = [];
    let paginationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListUsersCommand({
          UserPoolId: this.userPoolId,
          Limit: 60,
          PaginationToken: paginationToken,
        }),
      );

      for (const user of response.Users ?? []) {
        const subject = attribute(user.Attributes, 'sub');

        if (!subject) {
          continue;
        }

        accounts.push({
          subject,
          enabled: user.Enabled === true,
          status: user.UserStatus ?? 'UNKNOWN',
          createdAt: user.UserCreateDate?.toISOString() ?? null,
          updatedAt: user.UserLastModifiedDate?.toISOString() ?? null,
        });
      }

      paginationToken = response.PaginationToken;
    } while (paginationToken);

    return accounts;
  }

  async provisionAccount(
    email: string,
    displayName: string,
  ): Promise<CognitoProvisionedWorkforceAccount> {
    const existing = await this.getAccount(email);

    if (existing) {
      return { ...existing, created: false };
    }

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
      const account = this.toProvisionedAccount(response.User);

      if (account) {
        return { ...account, created: true };
      }

      const created = await this.getAccount(email);

      if (!created) {
        throw new Error(
          'Cognito did not return the created workforce account.',
        );
      }

      return { ...created, created: true };
    } catch (error) {
      if (
        error instanceof UsernameExistsException ||
        error instanceof AliasExistsException
      ) {
        const racedAccount = await this.getAccount(email);

        if (racedAccount) {
          return { ...racedAccount, created: false };
        }
      }

      throw error;
    }
  }

  async deleteAccount(username: string): Promise<void> {
    await this.client.send(
      new AdminDeleteUserCommand({
        UserPoolId: this.userPoolId,
        Username: username,
      }),
    );
  }

  private async getAccount(
    usernameOrAlias: string,
  ): Promise<Omit<CognitoProvisionedWorkforceAccount, 'created'> | null> {
    try {
      const response = await this.client.send(
        new AdminGetUserCommand({
          UserPoolId: this.userPoolId,
          Username: usernameOrAlias,
        }),
      );
      const account = this.toProvisionedAccount({
        Username: response.Username,
        Attributes: response.UserAttributes,
        Enabled: response.Enabled,
        UserStatus: response.UserStatus,
      });

      if (!account) {
        throw new Error('Cognito workforce account is missing its subject.');
      }

      return account;
    } catch (error) {
      if (error instanceof UserNotFoundException) {
        return null;
      }

      throw error;
    }
  }

  private toProvisionedAccount(
    user: UserType | undefined,
  ): Omit<CognitoProvisionedWorkforceAccount, 'created'> | null {
    const subject = attribute(user?.Attributes, 'sub');

    if (!user?.Username || !subject) {
      return null;
    }

    return {
      subject,
      username: user.Username,
      enabled: user.Enabled === true,
      status: user.UserStatus ?? 'UNKNOWN',
    };
  }
}
