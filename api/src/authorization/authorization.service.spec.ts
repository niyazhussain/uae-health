import { jest } from '@jest/globals';
import { AuthorizationService } from './authorization.service.js';
import {
  AuthorizationDeniedError,
  type AuthorizationDatabaseExecutor,
  type AuthorizationRepositoryPort,
} from './authorization.types.js';

const request = {
  principal: {
    subject: 'test-subject',
    clientId: 'test-client',
  },
  tenantId: '10000000-0000-4000-8000-000000000001',
  organizationId: '20000000-0000-4000-8000-000000000001',
  facilityId: '30000000-0000-4000-8000-000000000001',
  permissionCode: 'patients.read',
  confidential: false,
  action: 'clinical.patient_record_read',
  targetEntityType: 'patient_record',
  targetEntityId: '40000000-0000-4000-8000-000000000001',
  correlationId: '50000000-0000-4000-8000-000000000001',
  reason: 'Evaluate a synthetic protected-record access request.',
};

function createDependencies() {
  const findAuthorizedAccess = jest.fn().mockResolvedValue({
    applicationUserId: '60000000-0000-4000-8000-000000000001',
    membershipId: '70000000-0000-4000-8000-000000000001',
  });
  const recordDeniedAccess = jest.fn().mockResolvedValue(undefined);
  const repository: AuthorizationRepositoryPort = {
    findAuthorizedAccess,
    recordDeniedAccess,
  };

  return { repository, findAuthorizedAccess, recordDeniedAccess };
}

describe('AuthorizationService', () => {
  const executor = {} as AuthorizationDatabaseExecutor;

  it('evaluates current database authorization with the supplied executor', async () => {
    const { repository, findAuthorizedAccess } = createDependencies();
    const service = new AuthorizationService(repository);

    await expect(service.evaluate(request, executor)).resolves.toEqual({
      applicationUserId: '60000000-0000-4000-8000-000000000001',
      membershipId: '70000000-0000-4000-8000-000000000001',
    });
    expect(findAuthorizedAccess).toHaveBeenCalledWith(request, executor);
  });

  it('records denied evidence with the supplied executor', async () => {
    const { repository, recordDeniedAccess } = createDependencies();
    const service = new AuthorizationService(repository);

    await expect(
      service.recordDenied(request, executor),
    ).resolves.toBeUndefined();
    expect(recordDeniedAccess).toHaveBeenCalledWith(request, executor);
  });

  it('preserves assertAuthorized without an explicit executor', async () => {
    const { repository, findAuthorizedAccess, recordDeniedAccess } =
      createDependencies();
    const service = new AuthorizationService(repository);

    await expect(service.assertAuthorized(request)).resolves.toEqual({
      applicationUserId: '60000000-0000-4000-8000-000000000001',
      membershipId: '70000000-0000-4000-8000-000000000001',
    });
    expect(findAuthorizedAccess).toHaveBeenCalledWith(request, undefined);
    expect(recordDeniedAccess).not.toHaveBeenCalled();
  });

  it('fails closed and records safe denial evidence', async () => {
    const { repository, findAuthorizedAccess, recordDeniedAccess } =
      createDependencies();
    findAuthorizedAccess.mockResolvedValue(null);
    const service = new AuthorizationService(repository);

    await expect(
      service.assertAuthorized(request, executor),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    expect(findAuthorizedAccess).toHaveBeenCalledWith(request, executor);
    expect(recordDeniedAccess).toHaveBeenCalledWith(request, executor);
  });

  it('does not permit access if denied-audit evidence cannot be written', async () => {
    const { repository, findAuthorizedAccess, recordDeniedAccess } =
      createDependencies();
    findAuthorizedAccess.mockResolvedValue(null);
    recordDeniedAccess.mockRejectedValue(new Error('Audit write failed.'));
    const service = new AuthorizationService(repository);

    await expect(service.assertAuthorized(request, executor)).rejects.toThrow(
      'Audit write failed.',
    );
    expect(recordDeniedAccess).toHaveBeenCalledWith(request, executor);
  });
});
