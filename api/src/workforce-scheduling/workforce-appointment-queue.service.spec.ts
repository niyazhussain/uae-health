import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { jest } from '@jest/globals';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { WorkforceAppointmentQueueRepository } from './workforce-appointment-queue.repository.js';
import { WorkforceAppointmentQueueService } from './workforce-appointment-queue.service.js';
import {
  WorkforceAppointmentAuthorizationError,
  WorkforceAppointmentConflictError,
  WorkforceAppointmentPersistenceError,
  WorkforceAppointmentTargetUnavailableError,
  WorkforceAppointmentValidationError,
} from './workforce-appointment-queue.types.js';

const principal: AuthenticatedPrincipal = {
  subject: 'synthetic-workforce-subject',
  clientId: 'synthetic-client',
};

const organizationId = '20000000-0000-4000-8000-000000000001';
const facilityId = '21000000-0000-4000-8000-000000000001';
const appointmentId = '70000000-0000-4000-8000-000000000001';
const idempotencyKey = '12345678-1234-4234-8234-123456789012';

function createFixture() {
  const listAppointments = jest.fn().mockResolvedValue({
    page: 1,
    pageSize: 25,
    total: 0,
    items: [],
  });
  const changeAppointmentStatus = jest.fn().mockResolvedValue({
    appointment: {
      appointmentId,
      status: 'confirmed',
      version: 2,
    },
  });
  const repository = {
    listAppointments,
    changeAppointmentStatus,
  } as unknown as jest.Mocked<WorkforceAppointmentQueueRepository>;

  return {
    repository,
    service: new WorkforceAppointmentQueueService(repository),
    listAppointments,
    changeAppointmentStatus,
  };
}

describe('WorkforceAppointmentQueueService', () => {
  it('forwards one exact-facility bounded queue query', async () => {
    const { service, listAppointments } = createFixture();
    const query = {
      organizationId,
      facilityId,
      page: 2,
      pageSize: 100,
      practitionerId: '30000000-0000-4000-8000-000000000001',
      appointmentServiceId: '40000000-0000-4000-8000-000000000001',
    };

    await service.listAppointments(principal, query);

    expect(listAppointments).toHaveBeenCalledWith(principal, query);
  });

  it('normalizes and forwards a confirmation decision', async () => {
    const { service, changeAppointmentStatus } = createFixture();
    const input = {
      organizationId,
      facilityId,
      status: 'confirmed' as const,
      expectedVersion: 1,
      reasonCode: 'appointment-request-confirmed' as const,
    };

    await service.changeAppointmentStatus(
      principal,
      ` ${idempotencyKey} `,
      appointmentId,
      input,
    );

    expect(changeAppointmentStatus).toHaveBeenCalledWith(
      { principal, idempotencyKey, input },
      appointmentId,
    );
  });

  it.each([
    'appointment-request-provider-unavailable',
    'appointment-request-service-unavailable',
    'appointment-request-scheduling-conflict',
  ] as const)('accepts the closed decline reason %s', async (reasonCode) => {
    const { service, changeAppointmentStatus } = createFixture();
    const input = {
      organizationId,
      facilityId,
      status: 'declined' as const,
      expectedVersion: 1,
      reasonCode,
    };

    await service.changeAppointmentStatus(
      principal,
      idempotencyKey,
      appointmentId,
      input,
    );

    expect(changeAppointmentStatus).toHaveBeenCalledWith(
      { principal, idempotencyKey, input },
      appointmentId,
    );
  });

  it('rejects a decision whose reason does not match its state', () => {
    const { service, changeAppointmentStatus } = createFixture();

    expect(() =>
      service.changeAppointmentStatus(
        principal,
        idempotencyKey,
        appointmentId,
        {
          organizationId,
          facilityId,
          status: 'confirmed',
          expectedVersion: 1,
          reasonCode: 'appointment-request-provider-unavailable',
        },
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      service.changeAppointmentStatus(
        principal,
        idempotencyKey,
        appointmentId,
        {
          organizationId,
          facilityId,
          status: 'declined',
          expectedVersion: 1,
          reasonCode: 'appointment-request-confirmed',
        },
      ),
    ).toThrow(BadRequestException);
    expect(changeAppointmentStatus).not.toHaveBeenCalled();
  });

  it('rejects invalid optimistic versions and idempotency keys', async () => {
    const { service, changeAppointmentStatus } = createFixture();
    const input = {
      organizationId,
      facilityId,
      status: 'confirmed' as const,
      expectedVersion: 0,
      reasonCode: 'appointment-request-confirmed' as const,
    };

    expect(() =>
      service.changeAppointmentStatus(
        principal,
        idempotencyKey,
        appointmentId,
        input,
      ),
    ).toThrow(BadRequestException);
    await expect(
      service.changeAppointmentStatus(principal, undefined, appointmentId, {
        ...input,
        expectedVersion: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(changeAppointmentStatus).not.toHaveBeenCalled();
  });

  it.each([
    [new WorkforceAppointmentAuthorizationError(), ForbiddenException],
    [new WorkforceAppointmentTargetUnavailableError(), NotFoundException],
    [new WorkforceAppointmentConflictError(), ConflictException],
    [new WorkforceAppointmentValidationError(), BadRequestException],
    [new WorkforceAppointmentPersistenceError(), ServiceUnavailableException],
    [new Error('private persistence diagnostic'), ServiceUnavailableException],
  ])('maps decision failures without leaking details', async (error, type) => {
    const { service, changeAppointmentStatus } = createFixture();
    changeAppointmentStatus.mockRejectedValue(error);

    await expect(
      service.changeAppointmentStatus(
        principal,
        idempotencyKey,
        appointmentId,
        {
          organizationId,
          facilityId,
          status: 'confirmed',
          expectedVersion: 1,
          reasonCode: 'appointment-request-confirmed',
        },
      ),
    ).rejects.toBeInstanceOf(type);
  });

  it.each([
    [new WorkforceAppointmentAuthorizationError(), ForbiddenException],
    [new WorkforceAppointmentTargetUnavailableError(), ForbiddenException],
    [new WorkforceAppointmentPersistenceError(), ServiceUnavailableException],
  ])('maps queue read failures safely', async (error, type) => {
    const { service, listAppointments } = createFixture();
    listAppointments.mockRejectedValue(error);

    await expect(
      service.listAppointments(principal, {
        organizationId,
        facilityId,
        page: 1,
        pageSize: 25,
      }),
    ).rejects.toBeInstanceOf(type);
  });
});
