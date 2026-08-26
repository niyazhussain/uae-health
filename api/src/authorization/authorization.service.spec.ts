import { jest } from '@jest/globals';
import { AuthorizationService } from './authorization.service.js';
import {
  AuthorizationDeniedError,
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
  it('returns the current database authorization decision', async () => {
    const { repository, findAuthorizedAccess, recordDeniedAccess } =
      createDependencies();
    const service = new AuthorizationService(repository);

    await expect(service.assertAuthorized(request)).resolves.toEqual({
      applicationUserId: '60000000-0000-4000-8000-000000000001',
      membershipId: '70000000-0000-4000-8000-000000000001',
    });
    expect(findAuthorizedAccess).toHaveBeenCalledWith(request);
    expect(recordDeniedAccess).not.toHaveBeenCalled();
  });

  it('fails closed and records safe denial evidence', async () => {
    const { repository, findAuthorizedAccess, recordDeniedAccess } =
      createDependencies();
    findAuthorizedAccess.mockResolvedValue(null);
    const service = new AuthorizationService(repository);

    await expect(service.assertAuthorized(request)).rejects.toBeInstanceOf(
      AuthorizationDeniedError,
    );
    expect(recordDeniedAccess).toHaveBeenCalledWith(request);
  });

  it('does not permit access if denied-audit evidence cannot be written', async () => {
    const { repository, findAuthorizedAccess, recordDeniedAccess } =
      createDependencies();
    findAuthorizedAccess.mockResolvedValue(null);
    recordDeniedAccess.mockRejectedValue(new Error('Audit write failed.'));
    const service = new AuthorizationService(repository);

    await expect(service.assertAuthorized(request)).rejects.toThrow(
      'Audit write failed.',
    );
  });
});
