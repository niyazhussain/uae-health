import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import {
  COGNITO_WORKFORCE_DIRECTORY,
  WORKFORCE_DIRECTORY_REPOSITORY,
} from './workforce-directory.constants.js';
import type {
  CognitoWorkforceDirectoryPort,
  WorkforceDirectoryRepositoryPort,
  WorkforceDirectoryResponse,
} from './workforce-directory.types.js';

@Injectable()
export class WorkforceDirectoryService {
  constructor(
    @Inject(WORKFORCE_DIRECTORY_REPOSITORY)
    private readonly repository: WorkforceDirectoryRepositoryPort,
    @Inject(COGNITO_WORKFORCE_DIRECTORY)
    private readonly cognito: CognitoWorkforceDirectoryPort,
  ) {}

  async getDirectory(
    principal: AuthenticatedPrincipal,
    requestedOrganizationId?: string,
  ): Promise<WorkforceDirectoryResponse> {
    const contexts = await this.repository.listManageableContexts(
      principal.subject,
    );
    const selectedContext = requestedOrganizationId
      ? contexts.find(
          (context) => context.organizationId === requestedOrganizationId,
        )
      : contexts[0];

    if (!selectedContext) {
      throw new ForbiddenException(
        'Workforce directory access is not permitted for this organization.',
      );
    }

    const members = await this.repository.listMembers(
      selectedContext.tenantId,
      selectedContext.organizationId,
    );

    let accounts;

    try {
      accounts = await this.cognito.listAccounts();
    } catch {
      throw new ServiceUnavailableException(
        'Workforce authentication status is temporarily unavailable.',
      );
    }

    const accountBySubject = new Map(
      accounts.map((account) => [account.subject, account]),
    );

    return {
      contexts,
      selectedContext,
      users: members.map((member) => {
        const account = member.cognitoSubject
          ? accountBySubject.get(member.cognitoSubject)
          : undefined;

        return {
          applicationUserId: member.applicationUserId,
          displayName: member.displayName,
          email: member.email,
          membershipStatus: member.membershipStatus,
          identityStatus: member.identityStatus,
          cognitoStatus: account?.status ?? null,
          cognitoEnabled: account?.enabled ?? null,
          cognitoCreatedAt: account?.createdAt ?? null,
          cognitoUpdatedAt: account?.updatedAt ?? null,
          isSynthetic: member.isSynthetic,
        };
      }),
    };
  }
}
