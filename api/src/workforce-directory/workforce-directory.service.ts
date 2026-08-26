import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import {
  WORKFORCE_IDENTITY_PROVIDER,
  WORKFORCE_DIRECTORY_REPOSITORY,
} from './workforce-directory.constants.js';
import type {
  AssignWorkforceGlobalRoleInput,
  AssignWorkforceTenantLocalRoleInput,
  ChangeWorkforceMembershipStatusInput,
  CreateWorkforceTenantLocalRoleInput,
  CreateWorkforceInvitationInput,
  WorkforceIdentityProviderPort,
  RevokeWorkforceRoleAssignmentInput,
  WorkforceDirectoryRepositoryPort,
  WorkforceDirectoryResponse,
  WorkforceInvitationResponse,
  WorkforceMembershipStatusResponse,
  WorkforceRoleCatalogueResponse,
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
  constructor(
    @Inject(WORKFORCE_DIRECTORY_REPOSITORY)
    private readonly repository: WorkforceDirectoryRepositoryPort,
    @Inject(WORKFORCE_IDENTITY_PROVIDER)
    private readonly identityProvider: WorkforceIdentityProviderPort,
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
      canManageRoles: roleManagementAuthorization !== null,
      assignableGlobalRoles,
      tenantLocalRoles,
      delegablePermissions,
      users: members.map((member) => {
        return {
          membershipId: member.membershipId,
          applicationUserId: member.applicationUserId,
          canChangeMembership: member.identitySubject !== principal.subject,
          roleAssignments:
            roleAssignmentsByMembership.get(member.membershipId) ?? [],
          displayName: member.displayName,
          email: member.email,
          membershipStatus: member.membershipStatus,
          accountStatus: member.accountStatus,
          identityStatus: member.identityStatus,
          providerSyncStatus: member.providerSyncStatus,
          isSynthetic: member.isSynthetic,
        };
      }),
    };
  }

  async getRoleCatalogue(
    principal: AuthenticatedPrincipal,
    requestedOrganizationId?: string,
  ): Promise<WorkforceRoleCatalogueResponse> {
    const contexts = await this.repository.listRoleManageableContexts(
      principal.subject,
    );
    const selectedContext = requestedOrganizationId
      ? contexts.find(
          (context) => context.organizationId === requestedOrganizationId,
        )
      : contexts[0];

    if (!selectedContext) {
      throw new ForbiddenException(
        'Role catalogue access is not permitted for this organization.',
      );
    }

    const authorization = await this.repository.authorizeRoleManagement(
      principal.subject,
      selectedContext.organizationId,
    );

    if (!authorization) {
      throw new ForbiddenException(
        'Role catalogue access is not permitted for this organization.',
      );
    }

    const roles = await this.repository.listRoleCatalogue(
      selectedContext.tenantId,
      selectedContext.organizationId,
    );

    return { contexts, selectedContext, roles };
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
      account = await this.identityProvider.provisionAccount(
        input.email,
        input.displayName,
      );
    } catch {
      throw new ServiceUnavailableException(
        'Workforce authentication provisioning is temporarily unavailable.',
      );
    }

    if (!account.availableForWorkforceAccess) {
      throw new ConflictException(
        'The existing identity-provider account cannot be invited.',
      );
    }

    try {
      return await this.repository.persistInvitation({
        actorSubject: principal.subject,
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
        await this.compensateNewAccount(
          account.subject,
          account.externalAccountId,
        );
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
        actorSubject: principal.subject,
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
        actorSubject: principal.subject,
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
        actorSubject: principal.subject,
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
        actorSubject: principal.subject,
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
        actorSubject: principal.subject,
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
    subject: string,
    externalAccountId: string,
  ): Promise<void> {
    try {
      if (await this.repository.isIdentitySubjectBound(subject)) {
        return;
      }
    } catch {
      return;
    }

    try {
      await this.identityProvider.deleteAccount(externalAccountId);
    } catch {
      return;
    }
  }
}
