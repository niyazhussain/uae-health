import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { WorkforceSchedulingRepository } from './workforce-scheduling.repository.js';
import type {
  AppointmentServiceMutationResponse,
  ChangePractitionerFacilityAssignmentStatusInput,
  ChangePractitionerServiceAssignmentStatusInput,
  CreateAppointmentServiceInput,
  CreatePractitionerFacilityAssignmentInput,
  CreatePractitionerInput,
  CreatePractitionerServiceAssignmentInput,
  CreateSpecialtyInput,
  LinkPractitionerApplicationUserInput,
  PractitionerFacilityAssignmentMutationResponse,
  PractitionerMutationResponse,
  PractitionerServiceAssignmentMutationResponse,
  SpecialtyMutationResponse,
  UpdateAppointmentServiceInput,
  UpdateSpecialtyInput,
  WorkforceAppointmentServiceView,
  WorkforcePractitionerView,
  WorkforceSchedulingContextsResponse,
  WorkforceSchedulingListQuery,
  WorkforceSchedulingPage,
  WorkforceSpecialtyView,
} from './workforce-scheduling.types.js';
import {
  WorkforceSchedulingAuthorizationLostError,
  WorkforceSchedulingConflictError,
  WorkforceSchedulingPersistenceError,
  WorkforceSchedulingTargetUnavailableError,
} from './workforce-scheduling.types.js';

@Injectable()
export class WorkforceSchedulingService {
  constructor(private readonly repository: WorkforceSchedulingRepository) {}

  listContexts(
    principal: AuthenticatedPrincipal,
  ): Promise<WorkforceSchedulingContextsResponse> {
    return this.repository
      .listContexts(principal)
      .then((contexts) => ({ contexts }))
      .catch((error: unknown) => this.mapReadError(error));
  }

  listPractitioners(
    principal: AuthenticatedPrincipal,
    query: WorkforceSchedulingListQuery,
  ): Promise<WorkforceSchedulingPage<WorkforcePractitionerView>> {
    return this.repository
      .listPractitioners(principal, query)
      .catch((error: unknown) => this.mapReadError(error));
  }

  listSpecialties(
    principal: AuthenticatedPrincipal,
    query: WorkforceSchedulingListQuery,
  ): Promise<WorkforceSchedulingPage<WorkforceSpecialtyView>> {
    return this.repository
      .listSpecialties(principal, query)
      .catch((error: unknown) => this.mapReadError(error));
  }

  listServices(
    principal: AuthenticatedPrincipal,
    query: WorkforceSchedulingListQuery,
  ): Promise<WorkforceSchedulingPage<WorkforceAppointmentServiceView>> {
    return this.repository
      .listServices(principal, query)
      .catch((error: unknown) => this.mapReadError(error));
  }

  createPractitioner(
    principal: AuthenticatedPrincipal,
    idempotencyKey: string | undefined,
    input: CreatePractitionerInput,
  ): Promise<PractitionerMutationResponse> {
    return this.mutate(() =>
      this.repository.createPractitioner({
        principal,
        idempotencyKey: this.normalizeIdempotencyKey(idempotencyKey),
        input,
      }),
    );
  }

  linkPractitionerApplicationUser(
    principal: AuthenticatedPrincipal,
    idempotencyKey: string | undefined,
    practitionerId: string,
    input: LinkPractitionerApplicationUserInput,
  ): Promise<PractitionerMutationResponse> {
    return this.mutate(() =>
      this.repository.linkPractitionerApplicationUser(
        {
          principal,
          idempotencyKey: this.normalizeIdempotencyKey(idempotencyKey),
          input,
        },
        practitionerId,
      ),
    );
  }

  createPractitionerFacilityAssignment(
    principal: AuthenticatedPrincipal,
    idempotencyKey: string | undefined,
    practitionerId: string,
    input: CreatePractitionerFacilityAssignmentInput,
  ): Promise<PractitionerFacilityAssignmentMutationResponse> {
    return this.mutate(() =>
      this.repository.createPractitionerFacilityAssignment(
        {
          principal,
          idempotencyKey: this.normalizeIdempotencyKey(idempotencyKey),
          input,
        },
        practitionerId,
      ),
    );
  }

  changePractitionerFacilityAssignmentStatus(
    principal: AuthenticatedPrincipal,
    idempotencyKey: string | undefined,
    assignmentId: string,
    input: ChangePractitionerFacilityAssignmentStatusInput,
  ): Promise<PractitionerFacilityAssignmentMutationResponse> {
    return this.mutate(() =>
      this.repository.changePractitionerFacilityAssignmentStatus(
        {
          principal,
          idempotencyKey: this.normalizeIdempotencyKey(idempotencyKey),
          input,
        },
        assignmentId,
      ),
    );
  }

  createSpecialty(
    principal: AuthenticatedPrincipal,
    idempotencyKey: string | undefined,
    input: CreateSpecialtyInput,
  ): Promise<SpecialtyMutationResponse> {
    return this.mutate(() =>
      this.repository.createSpecialty({
        principal,
        idempotencyKey: this.normalizeIdempotencyKey(idempotencyKey),
        input,
      }),
    );
  }

  async updateSpecialty(
    principal: AuthenticatedPrincipal,
    idempotencyKey: string | undefined,
    specialtyId: string,
    input: UpdateSpecialtyInput,
  ): Promise<SpecialtyMutationResponse> {
    if (input.name === undefined && input.status === undefined) {
      throw new BadRequestException(
        'At least one specialty change is required.',
      );
    }

    return this.mutate(() =>
      this.repository.updateSpecialty(
        {
          principal,
          idempotencyKey: this.normalizeIdempotencyKey(idempotencyKey),
          input,
        },
        specialtyId,
      ),
    );
  }

  createService(
    principal: AuthenticatedPrincipal,
    idempotencyKey: string | undefined,
    input: CreateAppointmentServiceInput,
  ): Promise<AppointmentServiceMutationResponse> {
    return this.mutate(() =>
      this.repository.createService({
        principal,
        idempotencyKey: this.normalizeIdempotencyKey(idempotencyKey),
        input,
      }),
    );
  }

  async updateService(
    principal: AuthenticatedPrincipal,
    idempotencyKey: string | undefined,
    serviceId: string,
    input: UpdateAppointmentServiceInput,
  ): Promise<AppointmentServiceMutationResponse> {
    if (
      input.patientFacingName === undefined &&
      input.allowsAnyPractitioner === undefined &&
      input.status === undefined
    ) {
      throw new BadRequestException('At least one service change is required.');
    }

    return this.mutate(() =>
      this.repository.updateService(
        {
          principal,
          idempotencyKey: this.normalizeIdempotencyKey(idempotencyKey),
          input,
        },
        serviceId,
      ),
    );
  }

  createPractitionerServiceAssignment(
    principal: AuthenticatedPrincipal,
    idempotencyKey: string | undefined,
    serviceId: string,
    input: CreatePractitionerServiceAssignmentInput,
  ): Promise<PractitionerServiceAssignmentMutationResponse> {
    return this.mutate(() =>
      this.repository.createPractitionerServiceAssignment(
        {
          principal,
          idempotencyKey: this.normalizeIdempotencyKey(idempotencyKey),
          input,
        },
        serviceId,
      ),
    );
  }

  changePractitionerServiceAssignmentStatus(
    principal: AuthenticatedPrincipal,
    idempotencyKey: string | undefined,
    assignmentId: string,
    input: ChangePractitionerServiceAssignmentStatusInput,
  ): Promise<PractitionerServiceAssignmentMutationResponse> {
    return this.mutate(() =>
      this.repository.changePractitionerServiceAssignmentStatus(
        {
          principal,
          idempotencyKey: this.normalizeIdempotencyKey(idempotencyKey),
          input,
        },
        assignmentId,
      ),
    );
  }

  private normalizeIdempotencyKey(rawKey: string | undefined): string {
    const key = rawKey?.trim() ?? '';
    if (key.length < 16 || key.length > 200) {
      throw new BadRequestException(
        'Idempotency-Key must contain between 16 and 200 characters.',
      );
    }
    return key;
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      if (error instanceof WorkforceSchedulingAuthorizationLostError) {
        throw new ForbiddenException(
          'Scheduling catalogue access is not permitted for this practice.',
        );
      }
      if (error instanceof WorkforceSchedulingTargetUnavailableError) {
        throw new NotFoundException(
          'The scheduling catalogue target is unavailable.',
        );
      }
      if (error instanceof WorkforceSchedulingConflictError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof WorkforceSchedulingPersistenceError) {
        throw new ServiceUnavailableException(
          'The scheduling catalogue is temporarily unavailable.',
        );
      }
      throw new ServiceUnavailableException(
        'The scheduling catalogue is temporarily unavailable.',
      );
    }
  }

  private mapReadError(error: unknown): never {
    if (
      error instanceof WorkforceSchedulingAuthorizationLostError ||
      error instanceof WorkforceSchedulingTargetUnavailableError
    ) {
      throw new ForbiddenException(
        'Scheduling catalogue access is not permitted for this practice.',
      );
    }
    throw new ServiceUnavailableException(
      'The scheduling catalogue is temporarily unavailable.',
    );
  }
}
