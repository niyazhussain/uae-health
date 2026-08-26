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
  AssignWorkforceGlobalRoleInput,
  AssignWorkforceTenantLocalRoleInput,
  ChangeWorkforceMembershipStatusInput,
  CreateWorkforceTenantLocalRoleInput,
  CreateWorkforceInvitationInput,
  CognitoWorkforceAccount,
  CognitoWorkforceDirectoryPort,
  RevokeWorkforceRoleAssignmentInput,
  WorkforceDirectoryRepositoryPort,
  WorkforceDirectoryResponse,
  WorkforceInvitationResponse,
  WorkforceMembershipStatusResponse,
  WorkforceRoleAssignment,
  WorkforceTenantLocalRole,
} from './workforce-directory.types.js';
import {
  WorkforceIdentityConflictError,
  WorkforceInvitationAuthorizationLostError,
  WorkforceMembershipConflictError,
  WorkforceMembershipManagementAuthorizationLostError,
  WorkforceMembershipStateConflictError,
  WorkforceRoleAssignmentConflictError,
  WorkforceRoleManagementAuthorizationLostError,
  WorkforceTenantLocalRoleConflictError,
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

    const [members, roleAssignments, roleManagementAuthorization] =
      await Promise.all([
        this.repository.listMembers(
          selectedContext.tenantId,
          selectedContext.organizationId,
        ),
        this.repository.listRoleAssignments(
          selectedContext.tenantId,
          selectedContext.organizationId,
        ),
        this.repository.authorizeRoleManagement(
          principal.subject,
          selectedContext.organizationId,
        ),
      ]);

    let accounts: CognitoWorkforceAccount[] = [];
    let cognitoStatusAvailable = true;

    try {
      accounts = await this.cognito.listAccounts();
    } catch {
      cognitoStatusAvailable = false;
      this.logger.warn(
        'event=workforce_directory_cognito_status outcome=unavailable',
      );
    }

    const accountBySubject = new Map(
      accounts.map((account) => [account.subject, account]),
    );
    const roleAssignmentsByMembership = new Map<
      string,
      WorkforceRoleAssignment[]
    >();

    for (const assignment of roleAssignments) {
      const assignments =
        roleAssignmentsByMembership.get(assignment.membershipId) ?? [];
      assignments.push(assignment);
      roleAssignmentsByMembership.set(assignment.membershipId, assignments);
    }
    const [assignableGlobalRoles, tenantLocalRoles, delegablePermissions] =
      roleManagementAuthorization
        ? await Promise.all([
            this.repository.listAssignableGlobalRoles(),
            this.repository.listTenantLocalRoles(selectedContext.tenantId),
            this.repository.listDelegablePermissions(),
          ])
        : [[], [], []];

    return {
      contexts,
      selectedContext,
      cognitoStatusAvailable,
      canManageRoles: roleManagementAuthorization !== null,
      assignableGlobalRoles,
      tenantLocalRoles,
      delegablePermissions,
      users: members.map((member) => {
        const account = member.cognitoSubject
          ? accountBySubject.get(member.cognitoSubject)
          : undefined;

        return {
          membershipId: member.membershipId,
          applicationUserId: member.applicationUserId,
          canChangeMembership: member.cognitoSubject !== principal.subject,
          roleAssignments:
            roleAssignmentsByMembership.get(member.membershipId) ?? [],
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

  async assignGlobalRole(
    principal: AuthenticatedPrincipal,
    membershipId: string,
    input: AssignWorkforceGlobalRoleInput,
  ): Promise<WorkforceRoleAssignment> {
    try {
      return await this.repository.assignGlobalRole({
        actorCognitoSubject: principal.subject,
        membershipId,
        organizationId: input.organizationId,
        roleId: input.roleId,
        reason: input.reason,
      });
    } catch (error) {
      if (error instanceof WorkforceRoleManagementAuthorizationLostError) {
        throw new ForbiddenException(
          'Workforce role management is not permitted for this organization.',
        );
      }

      if (error instanceof WorkforceRoleAssignmentConflictError) {
        throw new ConflictException(error.message);
      }

      throw new ServiceUnavailableException(
        'The workforce role could not be assigned.',
      );
    }
  }

  async createTenantLocalRole(
    principal: AuthenticatedPrincipal,
    input: CreateWorkforceTenantLocalRoleInput,
  ): Promise<WorkforceTenantLocalRole> {
    try {
      return await this.repository.createTenantLocalRole({
        actorCognitoSubject: principal.subject,
        organizationId: input.organizationId,
        name: input.name,
        description: input.description,
        permissionIds: input.permissionIds,
        reason: input.reason,
      });
    } catch (error) {
      if (error instanceof WorkforceRoleManagementAuthorizationLostError) {
        throw new ForbiddenException(
          'Workforce role management is not permitted for this organization.',
        );
      }

      if (error instanceof WorkforceTenantLocalRoleConflictError) {
        throw new ConflictException(error.message);
      }

      throw new ServiceUnavailableException(
        'The tenant-local role could not be created.',
      );
    }
  }

  async assignTenantLocalRole(
    principal: AuthenticatedPrincipal,
    membershipId: string,
    input: AssignWorkforceTenantLocalRoleInput,
  ): Promise<WorkforceRoleAssignment> {
    try {
      return await this.repository.assignTenantLocalRole({
        actorCognitoSubject: principal.subject,
        membershipId,
        organizationId: input.organizationId,
        roleId: input.roleId,
        reason: input.reason,
      });
    } catch (error) {
      if (error instanceof WorkforceRoleManagementAuthorizationLostError) {
        throw new ForbiddenException(
          'Workforce role management is not permitted for this organization.',
        );
      }

      if (error instanceof WorkforceRoleAssignmentConflictError) {
        throw new ConflictException(error.message);
      }

      throw new ServiceUnavailableException(
        'The tenant-local role could not be assigned.',
      );
    }
  }

  async revokeRoleAssignment(
    principal: AuthenticatedPrincipal,
    assignmentId: string,
    input: RevokeWorkforceRoleAssignmentInput,
  ): Promise<WorkforceRoleAssignment> {
    try {
      return await this.repository.revokeRoleAssignment({
        actorCognitoSubject: principal.subject,
        assignmentId,
        organizationId: input.organizationId,
        reason: input.reason,
      });
    } catch (error) {
      if (error instanceof WorkforceRoleManagementAuthorizationLostError) {
        throw new ForbiddenException(
          'Workforce role management is not permitted for this organization.',
        );
      }

      if (error instanceof WorkforceRoleAssignmentConflictError) {
        throw new ConflictException(error.message);
      }

      throw new ServiceUnavailableException(
        'The workforce role could not be revoked.',
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
