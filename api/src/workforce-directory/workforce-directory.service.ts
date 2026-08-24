import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import {
  COGNITO_WORKFORCE_DIRECTORY,
  WORKFORCE_DIRECTORY_REPOSITORY,
} from './workforce-directory.constants.js';
import type {
  ChangeWorkforceMembershipStatusInput,
  CreateWorkforceInvitationInput,
  CognitoWorkforceDirectoryPort,
  WorkforceDirectoryRepositoryPort,
  WorkforceDirectoryResponse,
  WorkforceInvitationResponse,
  WorkforceMembershipStatusResponse,
} from './workforce-directory.types.js';
import {
  WorkforceIdentityConflictError,
  WorkforceInvitationAuthorizationLostError,
  WorkforceMembershipConflictError,
  WorkforceMembershipManagementAuthorizationLostError,
  WorkforceMembershipStateConflictError,
} from './workforce-directory.types.js';

@Injectable()
export class WorkforceDirectoryService {
  private readonly logger = new Logger(WorkforceDirectoryService.name);

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
          membershipId: member.membershipId,
          applicationUserId: member.applicationUserId,
          canChangeMembership: member.cognitoSubject !== principal.subject,
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

  async createInvitation(
    principal: AuthenticatedPrincipal,
    input: CreateWorkforceInvitationInput,
  ): Promise<WorkforceInvitationResponse> {
    const authorization = await this.repository.authorizeInvitation(
      principal.subject,
      input.organizationId,
    );

    if (!authorization) {
      throw new ForbiddenException(
        'Workforce invitation is not permitted for this organization.',
      );
    }

    let account;

    try {
      account = await this.cognito.provisionAccount(
        input.email,
        input.displayName,
      );
    } catch {
      throw new ServiceUnavailableException(
        'Workforce authentication provisioning is temporarily unavailable.',
      );
    }

    if (!account.enabled) {
      throw new ConflictException(
        'The existing Cognito account is disabled and cannot be invited.',
      );
    }

    if (
      !['FORCE_CHANGE_PASSWORD', 'CONFIRMED', 'RESET_REQUIRED'].includes(
        account.status,
      )
    ) {
      throw new ConflictException(
        'The existing Cognito account is not a reusable native workforce account.',
      );
    }

    try {
      return await this.repository.persistInvitation({
        actorCognitoSubject: principal.subject,
        authorization,
        account,
        displayName: input.displayName,
        email: input.email,
        reason: input.reason,
      });
    } catch (error) {
      if (
        account.created &&
        !(error instanceof WorkforceMembershipConflictError) &&
        !(error instanceof WorkforceIdentityConflictError)
      ) {
        await this.compensateNewAccount(account.subject, account.username);
      }

      if (error instanceof WorkforceInvitationAuthorizationLostError) {
        throw new ForbiddenException(
          'Workforce invitation permission changed before completion.',
        );
      }

      if (
        error instanceof WorkforceMembershipConflictError ||
        error instanceof WorkforceIdentityConflictError
      ) {
        throw new ConflictException(error.message);
      }

      throw new ServiceUnavailableException(
        'The workforce invitation could not be completed.',
      );
    }
  }

  async changeMembershipStatus(
    principal: AuthenticatedPrincipal,
    membershipId: string,
    input: ChangeWorkforceMembershipStatusInput,
  ): Promise<WorkforceMembershipStatusResponse> {
    try {
      return await this.repository.changeMembershipStatus({
        actorCognitoSubject: principal.subject,
        membershipId,
        organizationId: input.organizationId,
        status: input.status,
        reason: input.reason,
      });
    } catch (error) {
      if (
        error instanceof WorkforceMembershipManagementAuthorizationLostError
      ) {
        throw new ForbiddenException(
          'Workforce membership management is not permitted for this organization.',
        );
      }

      if (error instanceof WorkforceMembershipStateConflictError) {
        throw new ConflictException(error.message);
      }

      throw new ServiceUnavailableException(
        'The workforce membership could not be changed.',
      );
    }
  }

  private async compensateNewAccount(
    cognitoSubject: string,
    cognitoUsername: string,
  ): Promise<void> {
    try {
      if (await this.repository.isCognitoSubjectBound(cognitoSubject)) {
        this.logger.warn(
          'event=workforce_invitation_compensation outcome=skipped classification=identity_bound',
        );
        return;
      }
    } catch {
      this.logger.error(
        'event=workforce_invitation_compensation outcome=skipped classification=binding_check_failed',
      );
      return;
    }

    try {
      await this.cognito.deleteAccount(cognitoUsername);
      this.logger.log(
        'event=workforce_invitation_compensation outcome=success',
      );
    } catch {
      this.logger.error(
        'event=workforce_invitation_compensation outcome=failure classification=cognito_delete_failed',
      );
    }
  }
}
