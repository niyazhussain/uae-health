import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CognitoWorkforceAccount,
  CognitoWorkforceDirectoryPort,
} from './workforce-directory.types.js';

function attribute(user: UserType, name: string): string | undefined {
  return user.Attributes?.find((candidate) => candidate.Name === name)?.Value;
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
        const subject = attribute(user, 'sub');

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
}
