import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { jest } from '@jest/globals';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { WorkforceSchedulingRepository } from './workforce-scheduling.repository.js';
import { WorkforceSchedulingService } from './workforce-scheduling.service.js';
import {
  WorkforceSchedulingAuthorizationLostError,
  WorkforceSchedulingConflictError,
  WorkforceSchedulingPersistenceError,
  WorkforceSchedulingTargetUnavailableError,
  WorkforceSchedulingValidationError,
} from './workforce-scheduling.types.js';

const principal: AuthenticatedPrincipal = {
  subject: 'synthetic-workforce-subject',
  clientId: 'synthetic-client',
};

function createFixture() {
  const listContexts = jest.fn().mockResolvedValue([]);
  const createPractitioner = jest.fn().mockResolvedValue({
    practitioner: { practitionerId: '10000000-0000-4000-8000-000000000001' },
  });
  const updateSpecialty = jest.fn();
  const updateService = jest.fn();
  const createAvailabilityTemplate = jest.fn().mockResolvedValue({});
  const replaceAvailabilityTemplate = jest.fn();
  const createAvailabilityException = jest.fn().mockResolvedValue({});
  const changeServiceDuration = jest.fn().mockResolvedValue({});
  const repository = {
    listContexts,
    listPractitioners: jest.fn(),
    listSpecialties: jest.fn(),
    listServices: jest.fn(),
    createPractitioner,
    linkPractitionerApplicationUser: jest.fn(),
    createPractitionerFacilityAssignment: jest.fn(),
    changePractitionerFacilityAssignmentStatus: jest.fn(),
    createSpecialty: jest.fn(),
    updateSpecialty,
    createService: jest.fn(),
    updateService,
    createPractitionerServiceAssignment: jest.fn(),
    changePractitionerServiceAssignmentStatus: jest.fn(),
    listAvailabilityTemplates: jest.fn(),
    listAvailabilityExceptions: jest.fn(),
    listAvailabilitySlots: jest.fn(),
    createAvailabilityTemplate,
    replaceAvailabilityTemplate,
    changeAvailabilityTemplateStatus: jest.fn(),
    materializeAvailabilityTemplate: jest.fn(),
    createAvailabilityException,
    cancelAvailabilityException: jest.fn(),
    changeServiceDuration,
  } as unknown as jest.Mocked<WorkforceSchedulingRepository>;

  return {
    repository,
    service: new WorkforceSchedulingService(repository),
    listContexts,
    createPractitioner,
    updateSpecialty,
    updateService,
    createAvailabilityTemplate,
    replaceAvailabilityTemplate,
    createAvailabilityException,
    changeServiceDuration,
  };
}

describe('WorkforceSchedulingService', () => {
  it('wraps exact scheduling contexts without adding browser-owned scope', async () => {
    const { service, listContexts } = createFixture();
    listContexts.mockResolvedValue([
      {
        tenantId: '10000000-0000-4000-8000-000000000001',
        tenantName: 'Synthetic tenant',
        organizationId: '20000000-0000-4000-8000-000000000001',
        organizationName: 'Synthetic practice',
        canManagePracticeCatalogue: true,
        facilities: [],
      },
    ]);

    await expect(service.listContexts(principal)).resolves.toEqual({
      contexts: [
        expect.objectContaining({
          organizationName: 'Synthetic practice',
        }),
      ],
    });
    expect(listContexts).toHaveBeenCalledWith(principal);
  });

  it('normalizes and forwards a durable practitioner command', async () => {
    const { service, createPractitioner } = createFixture();
    const input = {
      organizationId: '20000000-0000-4000-8000-000000000001',
      facilityId: '21000000-0000-4000-8000-000000000001',
      displayName: 'Synthetic Physician',
      professionalTitle: 'General physician',
      reasonCode: 'catalogue-setup' as const,
    };

    await service.createPractitioner(
      principal,
      ' 12345678-1234-4234-8234-123456789012 ',
      input,
    );

    expect(createPractitioner).toHaveBeenCalledWith({
      principal,
      idempotencyKey: '12345678-1234-4234-8234-123456789012',
      input,
    });
  });

  it('rejects a missing idempotency key before persistence', async () => {
    const { service, createPractitioner } = createFixture();

    await expect(
      service.createPractitioner(principal, undefined, {
        organizationId: '20000000-0000-4000-8000-000000000001',
        facilityId: '21000000-0000-4000-8000-000000000001',
        displayName: 'Synthetic Physician',
        professionalTitle: 'General physician',
        reasonCode: 'catalogue-setup',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createPractitioner).not.toHaveBeenCalled();
  });

  it('rejects empty specialty and service updates before persistence', async () => {
    const { service, updateSpecialty, updateService } = createFixture();
    const common = {
      organizationId: '20000000-0000-4000-8000-000000000001',
      expectedUpdatedAt: '2026-08-29T00:00:00.000Z',
      reasonCode: 'service-configuration' as const,
    };

    await expect(
      service.updateSpecialty(
        principal,
        '12345678-1234-4234-8234-123456789012',
        '31000000-0000-4000-8000-000000000001',
        common,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateService(
        principal,
        '12345678-1234-4234-8234-123456789012',
        '32000000-0000-4000-8000-000000000001',
        common,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updateSpecialty).not.toHaveBeenCalled();
    expect(updateService).not.toHaveBeenCalled();
  });

  it('normalizes an omitted template status to inactive before fingerprinting', async () => {
    const { service, createAvailabilityTemplate } = createFixture();
    const input = {
      organizationId: '20000000-0000-4000-8000-000000000001',
      practitionerServiceAssignmentId: '35000000-0000-4000-8000-000000000001',
      isoWeekday: 1,
      localStartMinute: 540,
      localEndMinute: 1020,
      effectiveFrom: '2026-08-31',
      reasonCode: 'availability-configuration' as const,
    };

    await service.createAvailabilityTemplate(
      principal,
      '12345678-1234-4234-8234-123456789012',
      input,
    );

    expect(createAvailabilityTemplate).toHaveBeenCalledWith({
      principal,
      idempotencyKey: '12345678-1234-4234-8234-123456789012',
      input: { ...input, status: 'inactive' },
    });
  });

  it('rejects invalid canonical dates and unrelated template reasons', () => {
    const { service, createAvailabilityTemplate } = createFixture();
    const base = {
      organizationId: '20000000-0000-4000-8000-000000000001',
      practitionerServiceAssignmentId: '35000000-0000-4000-8000-000000000001',
      isoWeekday: 1,
      localStartMinute: 540,
      localEndMinute: 1020,
      effectiveFrom: '2026-99-99',
      reasonCode: 'availability-configuration' as const,
    };

    expect(() =>
      service.createAvailabilityTemplate(
        principal,
        '12345678-1234-4234-8234-123456789012',
        base,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      service.createAvailabilityTemplate(
        principal,
        '12345678-1234-4234-8234-123456789012',
        {
          ...base,
          effectiveFrom: '2026-08-31',
          reasonCode: 'catalogue-setup',
        },
      ),
    ).toThrow(BadRequestException);
    expect(createAvailabilityTemplate).not.toHaveBeenCalled();
  });

  it('rejects a replacement whose inherited DTO omitted status', () => {
    const { service, replaceAvailabilityTemplate } = createFixture();

    expect(() =>
      service.replaceAvailabilityTemplate(
        principal,
        '12345678-1234-4234-8234-123456789012',
        '36000000-0000-4000-8000-000000000001',
        {
          organizationId: '20000000-0000-4000-8000-000000000001',
          practitionerServiceAssignmentId:
            '35000000-0000-4000-8000-000000000001',
          isoWeekday: 1,
          localStartMinute: 540,
          localEndMinute: 1020,
          effectiveFrom: '2026-08-31',
          expectedUpdatedAt: '2026-08-29T00:00:00.000Z',
          reasonCode: 'availability-configuration',
        } as Parameters<
          WorkforceSchedulingService['replaceAvailabilityTemplate']
        >[3],
      ),
    ).toThrow(BadRequestException);
    expect(replaceAvailabilityTemplate).not.toHaveBeenCalled();
  });

  it('enforces closed exception scope and reason semantics', () => {
    const { service, createAvailabilityException } = createFixture();
    const base = {
      organizationId: '20000000-0000-4000-8000-000000000001',
      facilityId: '21000000-0000-4000-8000-000000000001',
      kind: 'facility_closed' as const,
      isAllDay: true,
      localStartsAt: '2026-09-01T00:00:00',
      localEndsAt: '2026-09-02T00:00:00',
      reasonCode: 'provider-availability-change' as const,
    };

    expect(() =>
      service.createAvailabilityException(
        principal,
        '12345678-1234-4234-8234-123456789012',
        base,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      service.createAvailabilityException(
        principal,
        '12345678-1234-4234-8234-123456789012',
        {
          ...base,
          reasonCode: 'facility-availability-change',
          practitionerFacilityAssignmentId:
            '34000000-0000-4000-8000-000000000001',
        },
      ),
    ).toThrow(BadRequestException);
    expect(createAvailabilityException).not.toHaveBeenCalled();
  });

  it('maps repository availability validation to a safe bad request', async () => {
    const { service, changeServiceDuration } = createFixture();
    changeServiceDuration.mockRejectedValue(
      new WorkforceSchedulingValidationError(),
    );

    await expect(
      service.changeServiceDuration(
        principal,
        '12345678-1234-4234-8234-123456789012',
        '32000000-0000-4000-8000-000000000001',
        {
          organizationId: '20000000-0000-4000-8000-000000000001',
          durationMinutes: 45,
          expectedUpdatedAt: '2026-08-29T00:00:00.000Z',
          reasonCode: 'service-duration-change',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    [new WorkforceSchedulingAuthorizationLostError(), ForbiddenException],
    [new WorkforceSchedulingTargetUnavailableError(), NotFoundException],
    [new WorkforceSchedulingConflictError(), ConflictException],
    [new WorkforceSchedulingPersistenceError(), ServiceUnavailableException],
    [new Error('provider diagnostic'), ServiceUnavailableException],
  ])(
    'maps repository failures without leaking details',
    async (error, type) => {
      const { service, createPractitioner } = createFixture();
      createPractitioner.mockRejectedValue(error);

      await expect(
        service.createPractitioner(
          principal,
          '12345678-1234-4234-8234-123456789012',
          {
            organizationId: '20000000-0000-4000-8000-000000000001',
            facilityId: '21000000-0000-4000-8000-000000000001',
            displayName: 'Synthetic Physician',
            professionalTitle: 'General physician',
            reasonCode: 'catalogue-setup',
          },
        ),
      ).rejects.toBeInstanceOf(type);
    },
  );
});
