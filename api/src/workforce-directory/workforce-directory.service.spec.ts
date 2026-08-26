import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { jest } from '@jest/globals';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { WorkforceDirectoryService } from './workforce-directory.service.js';
import {
  WorkforceMembershipConflictError,
  WorkforceMembershipManagementAuthorizationLostError,
  WorkforceMembershipStateConflictError,
  WorkforceRoleAssignmentConflictError,
  WorkforceRoleManagementAuthorizationLostError,
  WorkforceTenantLocalRoleConflictError,
  WorkforceInvitationAuthorizationLostError,
  type WorkforceIdentityProviderPort,
  type WorkforceDirectoryRepositoryPort,
} from './workforce-directory.types.js';

const principal: AuthenticatedPrincipal = {
  subject: 'admin-subject',
  clientId: 'client-id',
};

const invitationInput = {
  organizationId: '20000000-0000-4000-8000-000000000001',
  displayName: 'Synthetic Invited Clinician',
  email: 'invited.clinician@example.invalid',
  reason: 'Approved synthetic staging access.',
};

const roleAssignment = {
  assignmentId: '70000000-0000-4000-8000-000000000001',
  membershipId: '60000000-0000-4000-8000-000000000002',
  roleId: '80000000-0000-4000-8000-000000000001',
  roleCode: 'RECEPTION',
  roleName: 'Reception and registration',
  roleDescription: 'Synthetic registration access.',
  organizationId: invitationInput.organizationId,
};

const tenantLocalRole = {
  roleId: '80000000-0000-4000-8000-000000000002',
  code: 'LOCAL_SYNTHETIC_RECEPTION',
  name: 'Synthetic local reception',
  description: 'Synthetic practice-specific registration access.',
  permissions: [
    {
      permissionId: '90000000-0000-4000-8000-000000000001',
      code: 'patients.read',
      name: 'Read patient records',
      description:
        'Read non-confidential patient records in the assigned scope.',
    },
  ],
};

const tenantLocalRoleAssignment = {
  ...roleAssignment,
  assignmentId: '70000000-0000-4000-8000-000000000002',
  roleId: tenantLocalRole.roleId,
  roleCode: tenantLocalRole.code,
  roleName: tenantLocalRole.name,
  roleDescription: tenantLocalRole.description,
};

const roleCatalogueRole = {
  roleId: roleAssignment.roleId,
  code: roleAssignment.roleCode,
  name: roleAssignment.roleName,
  description: roleAssignment.roleDescription,
  source: 'global' as const,
  isDelegable: false,
  assignmentCount: 2,
  permissionCount: 1,
};

const roleCatalogueRoleDetail = {
  ...roleCatalogueRole,
  permissions: [
    {
      ...tenantLocalRole.permissions[0],
      isDelegable: false,
    },
  ],
};

function createDependencies() {
  const listManageableContexts = jest.fn().mockResolvedValue([
    {
      tenantId: '10000000-0000-4000-8000-000000000001',
      tenantName: 'Synthetic Practice Group',
      organizationId: '20000000-0000-4000-8000-000000000001',
      organizationName: 'Synthetic Care Practice',
    },
  ]);
  const listRoleManageableContexts = jest.fn().mockResolvedValue([
    {
      tenantId: '10000000-0000-4000-8000-000000000001',
      tenantName: 'Synthetic Practice Group',
      organizationId: '20000000-0000-4000-8000-000000000001',
      organizationName: 'Synthetic Care Practice',
    },
  ]);
  const listMembers = jest.fn().mockResolvedValue([
    {
      membershipId: '60000000-0000-4000-8000-000000000001',
      applicationUserId: '30000000-0000-4000-8000-000000000001',
      displayName: 'Synthetic Practice Administrator',
      email: 'practice.admin@example.invalid',
      membershipStatus: 'active',
      accountStatus: 'active',
      identityStatus: 'active',
      identitySubject: 'admin-subject',
      providerSyncStatus: 'synchronized',
      isSynthetic: true,
    },
    {
      membershipId: '60000000-0000-4000-8000-000000000002',
      applicationUserId: '30000000-0000-4000-8000-000000000002',
      displayName: 'Pending Synthetic User',
      email: 'pending.user@example.invalid',
      membershipStatus: 'pending',
      accountStatus: 'active',
      identityStatus: null,
      identitySubject: null,
      providerSyncStatus: null,
      isSynthetic: true,
    },
  ]);
  const authorizeInvitation = jest.fn().mockResolvedValue({
    actorUserId: '30000000-0000-4000-8000-000000000001',
    tenantId: '10000000-0000-4000-8000-000000000001',
    tenantName: 'Synthetic Practice Group',
    tenantIsSynthetic: true,
    organizationId: invitationInput.organizationId,
    organizationName: 'Synthetic Care Practice',
  });
  const authorizeRoleManagement = jest.fn().mockResolvedValue({
    actorUserId: '30000000-0000-4000-8000-000000000001',
    tenantId: '10000000-0000-4000-8000-000000000001',
    tenantName: 'Synthetic Practice Group',
    tenantIsSynthetic: true,
    organizationId: invitationInput.organizationId,
    organizationName: 'Synthetic Care Practice',
  });
  const listRoleAssignments = jest.fn().mockResolvedValue([roleAssignment]);
  const listAssignableGlobalRoles = jest.fn().mockResolvedValue([
    {
      roleId: roleAssignment.roleId,
      code: roleAssignment.roleCode,
      name: roleAssignment.roleName,
      description: roleAssignment.roleDescription,
    },
  ]);
  const listTenantLocalRoles = jest.fn().mockResolvedValue([tenantLocalRole]);
  const listDelegablePermissions = jest
    .fn()
    .mockResolvedValue(tenantLocalRole.permissions);
  const listRoleCatalogue = jest.fn().mockResolvedValue({
    roles: [roleCatalogueRole],
    total: 1,
  });
  const getRoleCatalogueRole = jest
    .fn()
    .mockResolvedValue(roleCatalogueRoleDetail);
  const isIdentitySubjectBound = jest.fn().mockResolvedValue(false);
  const persistInvitation = jest.fn().mockResolvedValue({
    applicationUserId: '30000000-0000-4000-8000-000000000003',
    membershipId: '60000000-0000-4000-8000-000000000003',
    organizationId: invitationInput.organizationId,
    email: invitationInput.email,
    membershipStatus: 'active',
    accountCreated: true,
    delivery: 'email',
  });
  const changeMembershipStatus = jest.fn().mockResolvedValue({
    membershipId: '60000000-0000-4000-8000-000000000002',
    organizationId: invitationInput.organizationId,
    membershipStatus: 'suspended',
    sessionsRevoked: 2,
  });
  const assignGlobalRole = jest.fn().mockResolvedValue(roleAssignment);
  const createTenantLocalRole = jest.fn().mockResolvedValue(tenantLocalRole);
  const assignTenantLocalRole = jest
    .fn()
    .mockResolvedValue(tenantLocalRoleAssignment);
  const revokeRoleAssignment = jest.fn().mockResolvedValue(roleAssignment);
  const repository: WorkforceDirectoryRepositoryPort = {
    listManageableContexts,
    listRoleManageableContexts,
    listMembers,
    authorizeInvitation,
    authorizeRoleManagement,
    listRoleAssignments,
    listAssignableGlobalRoles,
    listTenantLocalRoles,
    listDelegablePermissions,
    listRoleCatalogue,
    getRoleCatalogueRole,
    isIdentitySubjectBound,
    persistInvitation,
    changeMembershipStatus,
    assignGlobalRole,
    createTenantLocalRole,
    assignTenantLocalRole,
    revokeRoleAssignment,
  };
  const provisionAccount = jest.fn().mockResolvedValue({
    subject: 'invited-subject',
    externalAccountId: 'invited-provider-account',
    availableForWorkforceAccess: true,
    created: true,
  });
  const deleteAccount = jest.fn().mockResolvedValue(undefined);
  const cognito: WorkforceIdentityProviderPort = {
    issuer: 'https://identity-provider.example.invalid/native',
    protocol: 'cognito',
    provisionAccount,
    deleteAccount,
  };

  return {
    repository,
    cognito,
    listManageableContexts,
    listRoleManageableContexts,
    listMembers,
    authorizeInvitation,
    authorizeRoleManagement,
    listRoleAssignments,
    listAssignableGlobalRoles,
    listTenantLocalRoles,
    listDelegablePermissions,
    listRoleCatalogue,
    getRoleCatalogueRole,
    isIdentitySubjectBound,
    persistInvitation,
    changeMembershipStatus,
    assignGlobalRole,
    createTenantLocalRole,
    assignTenantLocalRole,
    revokeRoleAssignment,
    provisionAccount,
    deleteAccount,
  };
}

describe('WorkforceDirectoryService', () => {
  it('returns only the selected authorized context and reconciles Cognito status', async () => {
    const { repository, cognito, listManageableContexts } =
      createDependencies();
    const service = new WorkforceDirectoryService(repository, cognito);

    await expect(
      service.getDirectory(principal, '20000000-0000-4000-8000-000000000001'),
    ).resolves.toEqual({
      contexts: [
        {
          tenantId: '10000000-0000-4000-8000-000000000001',
          tenantName: 'Synthetic Practice Group',
          organizationId: '20000000-0000-4000-8000-000000000001',
          organizationName: 'Synthetic Care Practice',
        },
      ],
      selectedContext: {
        tenantId: '10000000-0000-4000-8000-000000000001',
        tenantName: 'Synthetic Practice Group',
        organizationId: '20000000-0000-4000-8000-000000000001',
        organizationName: 'Synthetic Care Practice',
      },
      canManageRoles: true,
      assignableGlobalRoles: [
        {
          roleId: roleAssignment.roleId,
          code: roleAssignment.roleCode,
          name: roleAssignment.roleName,
          description: roleAssignment.roleDescription,
        },
      ],
      tenantLocalRoles: [tenantLocalRole],
      delegablePermissions: tenantLocalRole.permissions,
      users: [
        {
          membershipId: '60000000-0000-4000-8000-000000000001',
          applicationUserId: '30000000-0000-4000-8000-000000000001',
          canChangeMembership: false,
          roleAssignments: [],
          displayName: 'Synthetic Practice Administrator',
          email: 'practice.admin@example.invalid',
          membershipStatus: 'active',
          accountStatus: 'active',
          identityStatus: 'active',
          providerSyncStatus: 'synchronized',
          isSynthetic: true,
        },
        {
          membershipId: '60000000-0000-4000-8000-000000000002',
          applicationUserId: '30000000-0000-4000-8000-000000000002',
          canChangeMembership: true,
          roleAssignments: [roleAssignment],
          displayName: 'Pending Synthetic User',
          email: 'pending.user@example.invalid',
          membershipStatus: 'pending',
          accountStatus: 'active',
          identityStatus: null,
          providerSyncStatus: null,
          isSynthetic: true,
        },
      ],
    });
    expect(listManageableContexts).toHaveBeenCalledWith('admin-subject');
  });

  it('fails closed when the requested organization is outside actor scope', async () => {
    const { repository, cognito, listMembers, provisionAccount } =
      createDependencies();
    const service = new WorkforceDirectoryService(repository, cognito);

    await expect(
      service.getDirectory(principal, '20000000-0000-4000-8000-000000000099'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(listMembers).not.toHaveBeenCalled();
    expect(provisionAccount).not.toHaveBeenCalled();
  });

  it('returns the scoped read-only role catalogue only to a role manager', async () => {
    const {
      repository,
      cognito,
      listRoleManageableContexts,
      authorizeRoleManagement,
      listRoleCatalogue,
    } = createDependencies();
    const service = new WorkforceDirectoryService(repository, cognito);

    await expect(
      service.getRoleCatalogue(principal, {
        organizationId: invitationInput.organizationId,
        page: 2,
        pageSize: 25,
        source: 'global',
        search: 'reception',
      }),
    ).resolves.toEqual({
      contexts: [
        {
          tenantId: '10000000-0000-4000-8000-000000000001',
          tenantName: 'Synthetic Practice Group',
          organizationId: invitationInput.organizationId,
          organizationName: 'Synthetic Care Practice',
        },
      ],
      selectedContext: {
        tenantId: '10000000-0000-4000-8000-000000000001',
        tenantName: 'Synthetic Practice Group',
        organizationId: invitationInput.organizationId,
        organizationName: 'Synthetic Care Practice',
      },
      page: 2,
      pageSize: 25,
      total: 1,
      roles: [roleCatalogueRole],
    });
    expect(listRoleManageableContexts).toHaveBeenCalledWith(principal.subject);
    expect(authorizeRoleManagement).toHaveBeenCalledWith(
      principal.subject,
      invitationInput.organizationId,
    );
    expect(listRoleCatalogue).toHaveBeenCalledWith(
      '10000000-0000-4000-8000-000000000001',
      invitationInput.organizationId,
      {
        organizationId: invitationInput.organizationId,
        page: 2,
        pageSize: 25,
        source: 'global',
        search: 'reception',
      },
    );
  });

  it('does not disclose a role catalogue outside the role-management scope', async () => {
    const { repository, cognito, listRoleCatalogue, authorizeRoleManagement } =
      createDependencies();
    authorizeRoleManagement.mockResolvedValue(null);
    const service = new WorkforceDirectoryService(repository, cognito);

    await expect(
      service.getRoleCatalogue(principal, {
        organizationId: invitationInput.organizationId,
        page: 1,
        pageSize: 25,
        source: 'all',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(listRoleCatalogue).not.toHaveBeenCalled();
  });

  it('reads one role detail only after the same scoped role-management check', async () => {
    const {
      repository,
      cognito,
      authorizeRoleManagement,
      getRoleCatalogueRole,
    } = createDependencies();
    const service = new WorkforceDirectoryService(repository, cognito);

    await expect(
      service.getRoleCatalogueRole(
        principal,
        roleCatalogueRole.roleId,
        invitationInput.organizationId,
      ),
    ).resolves.toEqual(roleCatalogueRoleDetail);
    expect(authorizeRoleManagement).toHaveBeenCalledWith(
      principal.subject,
      invitationInput.organizationId,
    );
    expect(getRoleCatalogueRole).toHaveBeenCalledWith(
      '10000000-0000-4000-8000-000000000001',
      invitationInput.organizationId,
      roleCatalogueRole.roleId,
    );
  });

  it('does not disclose a missing or other-tenant role detail', async () => {
    const { repository, cognito, getRoleCatalogueRole } = createDependencies();
    getRoleCatalogueRole.mockResolvedValue(null);
    const service = new WorkforceDirectoryService(repository, cognito);

    await expect(
      service.getRoleCatalogueRole(
        principal,
        roleCatalogueRole.roleId,
        invitationInput.organizationId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists database-authoritative users without calling the identity provider', async () => {
    const { repository, cognito, provisionAccount } = createDependencies();
    const service = new WorkforceDirectoryService(repository, cognito);

    const directory = await service.getDirectory(principal);

    expect(provisionAccount).not.toHaveBeenCalled();
    expect(directory.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          membershipId: '60000000-0000-4000-8000-000000000001',
          roleAssignments: [],
          providerSyncStatus: 'synchronized',
        }),
      ]),
    );
  });

  it('creates an administrator-approved invitation after checking scope', async () => {
    const {
      repository,
      cognito,
      authorizeInvitation,
      provisionAccount,
      persistInvitation,
      deleteAccount,
    } = createDependencies();
    const service = new WorkforceDirectoryService(repository, cognito);

    await expect(
      service.createInvitation(principal, invitationInput),
    ).resolves.toMatchObject({
      email: invitationInput.email,
      membershipStatus: 'active',
      accountCreated: true,
      delivery: 'email',
    });
    expect(authorizeInvitation).toHaveBeenCalledWith(
      principal.subject,
      invitationInput.organizationId,
    );
    expect(provisionAccount).toHaveBeenCalledWith(
      invitationInput.email,
      invitationInput.displayName,
    );
    expect(persistInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        actorSubject: principal.subject,
        displayName: invitationInput.displayName,
        email: invitationInput.email,
        reason: invitationInput.reason,
      }),
    );
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('does not call Cognito when invitation scope is unauthorized', async () => {
    const { repository, cognito, authorizeInvitation, provisionAccount } =
      createDependencies();
    authorizeInvitation.mockResolvedValue(null);
    const service = new WorkforceDirectoryService(repository, cognito);

    await expect(
      service.createInvitation(principal, invitationInput),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(provisionAccount).not.toHaveBeenCalled();
  });

  it('compensates a newly created Cognito account when persistence fails', async () => {
    const { repository, cognito, persistInvitation, deleteAccount } =
      createDependencies();
    persistInvitation.mockRejectedValue(new Error('database unavailable'));
    const service = new WorkforceDirectoryService(repository, cognito);

    await expect(
      service.createInvitation(principal, invitationInput),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(deleteAccount).toHaveBeenCalledWith('invited-provider-account');
  });

  it('never deletes a pre-existing Cognito account after a HIS conflict', async () => {
    const {
      repository,
      cognito,
      provisionAccount,
      persistInvitation,
      deleteAccount,
    } = createDependencies();
    provisionAccount.mockResolvedValue({
      subject: 'existing-subject',
      username: 'existing-cognito-username',
      enabled: true,
      status: 'CONFIRMED',
      created: false,
    });
    persistInvitation.mockRejectedValue(new WorkforceMembershipConflictError());
    const service = new WorkforceDirectoryService(repository, cognito);

    await expect(
      service.createInvitation(principal, invitationInput),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('does not delete a newly created account after a concurrency conflict', async () => {
    const {
      repository,
      cognito,
      persistInvitation,
      isIdentitySubjectBound,
      deleteAccount,
    } = createDependencies();
    persistInvitation.mockRejectedValue(new WorkforceMembershipConflictError());
    const service = new WorkforceDirectoryService(repository, cognito);

    await expect(
      service.createInvitation(principal, invitationInput),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(isIdentitySubjectBound).not.toHaveBeenCalled();
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('does not compensate a generic failure when the subject became bound', async () => {
    const {
      repository,
      cognito,
      persistInvitation,
      isIdentitySubjectBound,
      deleteAccount,
    } = createDependencies();
    persistInvitation.mockRejectedValue(new Error('database unavailable'));
    isIdentitySubjectBound.mockResolvedValue(true);
    const service = new WorkforceDirectoryService(repository, cognito);

    await expect(
      service.createInvitation(principal, invitationInput),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('rejects an invitation when its database authorization changed', async () => {
    const { repository, cognito, persistInvitation } = createDependencies();
    persistInvitation.mockRejectedValue(
      new WorkforceInvitationAuthorizationLostError(),
    );
    const service = new WorkforceDirectoryService(repository, cognito);

    await expect(
      service.createInvitation(principal, invitationInput),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an external-provider account in the native invitation flow', async () => {
    const { repository, cognito, provisionAccount, persistInvitation } =
      createDependencies();
    provisionAccount.mockResolvedValue({
      subject: 'federated-subject',
      username: 'entra_federated-subject',
      enabled: true,
      status: 'EXTERNAL_PROVIDER',
      created: false,
    });
    const service = new WorkforceDirectoryService(repository, cognito);

    await expect(
      service.createInvitation(principal, invitationInput),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(persistInvitation).not.toHaveBeenCalled();
  });

  it("changes another user's scoped membership without calling Cognito", async () => {
    const {
      repository,
      cognito,
      changeMembershipStatus,
      provisionAccount,
      deleteAccount,
    } = createDependencies();
    const service = new WorkforceDirectoryService(repository, cognito);

    await expect(
      service.changeMembershipStatus(
        principal,
        '60000000-0000-4000-8000-000000000002',
        {
          organizationId: invitationInput.organizationId,
          status: 'suspended',
          reason: 'Synthetic access suspension for testing.',
        },
      ),
    ).resolves.toEqual({
      membershipId: '60000000-0000-4000-8000-000000000002',
      organizationId: invitationInput.organizationId,
      membershipStatus: 'suspended',
      sessionsRevoked: 2,
    });
    expect(changeMembershipStatus).toHaveBeenCalledWith({
      actorSubject: principal.subject,
      membershipId: '60000000-0000-4000-8000-000000000002',
      organizationId: invitationInput.organizationId,
      status: 'suspended',
      reason: 'Synthetic access suspension for testing.',
    });
    expect(provisionAccount).not.toHaveBeenCalled();
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('maps an invalid membership-state transition to a conflict', async () => {
    const { repository, cognito, changeMembershipStatus } =
      createDependencies();
    changeMembershipStatus.mockRejectedValue(
      new WorkforceMembershipStateConflictError(
        'Administrators cannot change their own membership state.',
      ),
    );
    const service = new WorkforceDirectoryService(repository, cognito);

    await expect(
      service.changeMembershipStatus(
        principal,
        '60000000-0000-4000-8000-000000000001',
        {
          organizationId: invitationInput.organizationId,
          status: 'suspended',
          reason: 'Synthetic test reason.',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a membership state change when its database authorization changed', async () => {
    const { repository, cognito, changeMembershipStatus } =
      createDependencies();
    changeMembershipStatus.mockRejectedValue(
      new WorkforceMembershipManagementAuthorizationLostError(),
    );
    const service = new WorkforceDirectoryService(repository, cognito);

    await expect(
      service.changeMembershipStatus(
        principal,
        '60000000-0000-4000-8000-000000000002',
        {
          organizationId: invitationInput.organizationId,
          status: 'suspended',
          reason: 'Synthetic authorization rejection test.',
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('assigns an approved global role after checking current database authority', async () => {
    const { repository, cognito, assignGlobalRole } = createDependencies();
    const service = new WorkforceDirectoryService(repository, cognito);

    await expect(
      service.assignGlobalRole(principal, roleAssignment.membershipId, {
        organizationId: invitationInput.organizationId,
        roleId: roleAssignment.roleId,
        reason: 'Synthetic role-assignment test.',
      }),
    ).resolves.toEqual(roleAssignment);
    expect(assignGlobalRole).toHaveBeenCalledWith({
      actorSubject: principal.subject,
      membershipId: roleAssignment.membershipId,
      organizationId: invitationInput.organizationId,
      roleId: roleAssignment.roleId,
      reason: 'Synthetic role-assignment test.',
    });
  });

  it('maps an unsafe role assignment to a conflict', async () => {
    const { repository, cognito, assignGlobalRole } = createDependencies();
    assignGlobalRole.mockRejectedValue(
      new WorkforceRoleAssignmentConflictError(
        'Administrators cannot change their own role assignments.',
      ),
    );
    const service = new WorkforceDirectoryService(repository, cognito);

    await expect(
      service.assignGlobalRole(principal, roleAssignment.membershipId, {
        organizationId: invitationInput.organizationId,
        roleId: roleAssignment.roleId,
        reason: 'Synthetic role conflict test.',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates a delegable tenant-local role after checking current database authority', async () => {
    const { repository, cognito, createTenantLocalRole } = createDependencies();
    const service = new WorkforceDirectoryService(repository, cognito);

    await expect(
      service.createTenantLocalRole(principal, {
        organizationId: invitationInput.organizationId,
        name: tenantLocalRole.name,
        description: tenantLocalRole.description,
        permissionIds: tenantLocalRole.permissions.map(
          (permission) => permission.permissionId,
        ),
        reason: 'Synthetic local role creation test.',
      }),
    ).resolves.toEqual(tenantLocalRole);
    expect(createTenantLocalRole).toHaveBeenCalledWith({
      actorSubject: principal.subject,
      organizationId: invitationInput.organizationId,
      name: tenantLocalRole.name,
      description: tenantLocalRole.description,
      permissionIds: tenantLocalRole.permissions.map(
        (permission) => permission.permissionId,
      ),
      reason: 'Synthetic local role creation test.',
    });
  });

  it('maps an unsafe tenant-local role definition to a conflict', async () => {
    const { repository, cognito, createTenantLocalRole } = createDependencies();
    createTenantLocalRole.mockRejectedValue(
      new WorkforceTenantLocalRoleConflictError(
        'Tenant-local roles can contain only active delegable permissions.',
      ),
    );
    const service = new WorkforceDirectoryService(repository, cognito);

    await expect(
      service.createTenantLocalRole(principal, {
        organizationId: invitationInput.organizationId,
        name: tenantLocalRole.name,
        description: tenantLocalRole.description,
        permissionIds: tenantLocalRole.permissions.map(
          (permission) => permission.permissionId,
        ),
        reason: 'Synthetic local role conflict test.',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('assigns an approved tenant-local role after checking current database authority', async () => {
    const { repository, cognito, assignTenantLocalRole } = createDependencies();
    const service = new WorkforceDirectoryService(repository, cognito);

    await expect(
      service.assignTenantLocalRole(principal, roleAssignment.membershipId, {
        organizationId: invitationInput.organizationId,
        roleId: tenantLocalRole.roleId,
        reason: 'Synthetic local role assignment test.',
      }),
    ).resolves.toEqual(tenantLocalRoleAssignment);
    expect(assignTenantLocalRole).toHaveBeenCalledWith({
      actorSubject: principal.subject,
      membershipId: roleAssignment.membershipId,
      organizationId: invitationInput.organizationId,
      roleId: tenantLocalRole.roleId,
      reason: 'Synthetic local role assignment test.',
    });
  });

  it('rejects role revocation when current database authority changed', async () => {
    const { repository, cognito, revokeRoleAssignment } = createDependencies();
    revokeRoleAssignment.mockRejectedValue(
      new WorkforceRoleManagementAuthorizationLostError(),
    );
    const service = new WorkforceDirectoryService(repository, cognito);

    await expect(
      service.revokeRoleAssignment(principal, roleAssignment.assignmentId, {
        organizationId: invitationInput.organizationId,
        reason: 'Synthetic role authorization rejection test.',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
