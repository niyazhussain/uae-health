import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { jest } from '@jest/globals';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { WorkforceDirectoryService } from './workforce-directory.service.js';
import type {
  CognitoWorkforceDirectoryPort,
  WorkforceDirectoryRepositoryPort,
} from './workforce-directory.types.js';

const principal: AuthenticatedPrincipal = {
  subject: 'admin-subject',
  clientId: 'client-id',
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
  const listMembers = jest.fn().mockResolvedValue([
    {
      applicationUserId: '30000000-0000-4000-8000-000000000001',
      displayName: 'Synthetic Practice Administrator',
      email: 'practice.admin@example.invalid',
      membershipStatus: 'active',
      identityStatus: 'active',
      cognitoSubject: 'admin-subject',
      isSynthetic: true,
    },
    {
      applicationUserId: '30000000-0000-4000-8000-000000000002',
      displayName: 'Pending Synthetic User',
      email: 'pending.user@example.invalid',
      membershipStatus: 'pending',
      identityStatus: null,
      cognitoSubject: null,
      isSynthetic: true,
    },
  ]);
  const repository: WorkforceDirectoryRepositoryPort = {
    listManageableContexts,
    listMembers,
  };
  const listAccounts = jest.fn().mockResolvedValue([
    {
      subject: 'admin-subject',
      enabled: true,
      status: 'CONFIRMED',
      createdAt: '2026-08-24T10:00:00.000Z',
      updatedAt: '2026-08-24T10:30:00.000Z',
    },
  ]);
  const cognito: CognitoWorkforceDirectoryPort = {
    listAccounts,
  };

  return {
    repository,
    cognito,
    listManageableContexts,
    listMembers,
    listAccounts,
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
      users: [
        {
          applicationUserId: '30000000-0000-4000-8000-000000000001',
          displayName: 'Synthetic Practice Administrator',
          email: 'practice.admin@example.invalid',
          membershipStatus: 'active',
          identityStatus: 'active',
          cognitoStatus: 'CONFIRMED',
          cognitoEnabled: true,
          cognitoCreatedAt: '2026-08-24T10:00:00.000Z',
          cognitoUpdatedAt: '2026-08-24T10:30:00.000Z',
          isSynthetic: true,
        },
        {
          applicationUserId: '30000000-0000-4000-8000-000000000002',
          displayName: 'Pending Synthetic User',
          email: 'pending.user@example.invalid',
          membershipStatus: 'pending',
          identityStatus: null,
          cognitoStatus: null,
          cognitoEnabled: null,
          cognitoCreatedAt: null,
          cognitoUpdatedAt: null,
          isSynthetic: true,
        },
      ],
    });
    expect(listManageableContexts).toHaveBeenCalledWith('admin-subject');
  });

  it('fails closed when the requested organization is outside actor scope', async () => {
    const { repository, cognito, listMembers, listAccounts } =
      createDependencies();
    const service = new WorkforceDirectoryService(repository, cognito);

    await expect(
      service.getDirectory(principal, '20000000-0000-4000-8000-000000000099'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(listMembers).not.toHaveBeenCalled();
    expect(listAccounts).not.toHaveBeenCalled();
  });

  it('returns a safe dependency error when Cognito cannot be read', async () => {
    const { repository, cognito } = createDependencies();
    cognito.listAccounts = jest
      .fn()
      .mockRejectedValue(new Error('AWS diagnostic details'));
    const service = new WorkforceDirectoryService(repository, cognito);

    await expect(service.getDirectory(principal)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
