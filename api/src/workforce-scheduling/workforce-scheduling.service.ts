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
import {
  AvailabilityMaterializationError,
  parseCanonicalLocalDate,
} from './provider-availability-time.js';
import type {
  AppointmentServiceMutationResponse,
  AppointmentServiceDurationMutationResponse,
  AvailabilityExceptionMutationResponse,
  AvailabilityTemplateMutationResponse,
  CancelAvailabilityExceptionInput,
  ChangeAppointmentServiceDurationInput,
  ChangeAvailabilityTemplateStatusInput,
  ChangePractitionerFacilityAssignmentStatusInput,
  ChangePractitionerServiceAssignmentStatusInput,
  CreateAvailabilityExceptionInput,
  CreateAvailabilityTemplateInput,
  CreateAppointmentServiceInput,
  CreatePractitionerFacilityAssignmentInput,
  CreatePractitionerInput,
  CreatePractitionerServiceAssignmentInput,
  CreateSpecialtyInput,
  LinkPractitionerApplicationUserInput,
  MaterializeAvailabilityTemplateInput,
  PractitionerFacilityAssignmentMutationResponse,
  PractitionerMutationResponse,
  PractitionerServiceAssignmentMutationResponse,
  SpecialtyMutationResponse,
  ReplaceAvailabilityTemplateInput,
  UpdateAppointmentServiceInput,
  UpdateSpecialtyInput,
  WorkforceAppointmentServiceView,
  WorkforceAvailabilityExceptionListQuery,
  WorkforceAvailabilityExceptionView,
  WorkforceAvailabilitySlotListQuery,
  WorkforceAvailabilitySlotView,
  WorkforceAvailabilityTemplateListQuery,
  WorkforceAvailabilityTemplateView,
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
  WorkforceSchedulingValidationError,
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

  listAvailabilityTemplates(
    principal: AuthenticatedPrincipal,
    query: WorkforceAvailabilityTemplateListQuery,
  ): Promise<WorkforceSchedulingPage<WorkforceAvailabilityTemplateView>> {
    return this.repository
      .listAvailabilityTemplates(principal, query)
      .catch((error: unknown) => this.mapReadError(error));
  }

  listAvailabilityExceptions(
    principal: AuthenticatedPrincipal,
    query: WorkforceAvailabilityExceptionListQuery,
  ): Promise<WorkforceSchedulingPage<WorkforceAvailabilityExceptionView>> {
    return this.repository
      .listAvailabilityExceptions(principal, query)
      .catch((error: unknown) => this.mapReadError(error));
  }

  listAvailabilitySlots(
    principal: AuthenticatedPrincipal,
    query: WorkforceAvailabilitySlotListQuery,
  ): Promise<WorkforceSchedulingPage<WorkforceAvailabilitySlotView>> {
    const startsAt = new Date(query.startsAt);
    const endsAt = new Date(query.endsAt);
    if (
      !Number.isFinite(startsAt.getTime()) ||
      !Number.isFinite(endsAt.getTime()) ||
      startsAt >= endsAt
    ) {
      throw new BadRequestException(
        'The slot range must be a valid increasing half-open UTC interval.',
      );
    }
    return this.repository
      .listAvailabilitySlots(principal, query)
      .catch((error: unknown) => this.mapReadError(error));
  }

  createAvailabilityTemplate(
    principal: AuthenticatedPrincipal,
    idempotencyKey: string | undefined,
    input: Omit<CreateAvailabilityTemplateInput, 'status'> & {
      status?: CreateAvailabilityTemplateInput['status'];
    },
  ): Promise<AvailabilityTemplateMutationResponse> {
    this.requireAvailabilityReason(input.reasonCode);
    this.validateAvailabilityTemplate(input);
    return this.mutate(() =>
      this.repository.createAvailabilityTemplate({
        principal,
        idempotencyKey: this.normalizeIdempotencyKey(idempotencyKey),
        input: { ...input, status: input.status ?? 'inactive' },
      }),
    );
  }

  replaceAvailabilityTemplate(
    principal: AuthenticatedPrincipal,
    idempotencyKey: string | undefined,
    templateId: string,
    input: ReplaceAvailabilityTemplateInput,
  ): Promise<AvailabilityTemplateMutationResponse> {
    if (input.status !== 'active' && input.status !== 'inactive') {
      throw new BadRequestException(
        'A replacement availability template requires an explicit status.',
      );
    }
    this.requireAvailabilityReason(input.reasonCode);
    this.validateAvailabilityTemplate(input);
    return this.mutate(() =>
      this.repository.replaceAvailabilityTemplate(
        {
          principal,
          idempotencyKey: this.normalizeIdempotencyKey(idempotencyKey),
          input,
        },
        templateId,
      ),
    );
  }

  changeAvailabilityTemplateStatus(
    principal: AuthenticatedPrincipal,
    idempotencyKey: string | undefined,
    templateId: string,
    input: ChangeAvailabilityTemplateStatusInput,
  ): Promise<AvailabilityTemplateMutationResponse> {
    this.requireAvailabilityReason(input.reasonCode);
    return this.mutate(() =>
      this.repository.changeAvailabilityTemplateStatus(
        {
          principal,
          idempotencyKey: this.normalizeIdempotencyKey(idempotencyKey),
          input,
        },
        templateId,
      ),
    );
  }

  materializeAvailabilityTemplate(
    principal: AuthenticatedPrincipal,
    idempotencyKey: string | undefined,
    templateId: string,
    input: MaterializeAvailabilityTemplateInput,
  ): Promise<AvailabilityTemplateMutationResponse> {
    this.requireAvailabilityReason(input.reasonCode);
    return this.mutate(() =>
      this.repository.materializeAvailabilityTemplate(
        {
          principal,
          idempotencyKey: this.normalizeIdempotencyKey(idempotencyKey),
          input,
        },
        templateId,
      ),
    );
  }

  createAvailabilityException(
    principal: AuthenticatedPrincipal,
    idempotencyKey: string | undefined,
    input: CreateAvailabilityExceptionInput,
  ): Promise<AvailabilityExceptionMutationResponse> {
    if (
      (input.kind === 'facility_closed' &&
        input.practitionerFacilityAssignmentId !== undefined) ||
      (input.kind === 'practitioner_unavailable' &&
        input.practitionerFacilityAssignmentId === undefined)
    ) {
      throw new BadRequestException(
        'The exception target does not match its exception kind.',
      );
    }
    if (
      (input.kind === 'facility_closed' &&
        input.reasonCode !== 'facility-availability-change') ||
      (input.kind === 'practitioner_unavailable' &&
        input.reasonCode !== 'provider-availability-change')
    ) {
      throw new BadRequestException(
        'The reason code does not match the availability exception kind.',
      );
    }
    return this.mutate(() =>
      this.repository.createAvailabilityException({
        principal,
        idempotencyKey: this.normalizeIdempotencyKey(idempotencyKey),
        input,
      }),
    );
  }

  cancelAvailabilityException(
    principal: AuthenticatedPrincipal,
    idempotencyKey: string | undefined,
    exceptionId: string,
    input: CancelAvailabilityExceptionInput,
  ): Promise<AvailabilityExceptionMutationResponse> {
    if (
      input.reasonCode !== 'facility-availability-change' &&
      input.reasonCode !== 'provider-availability-change'
    ) {
      throw new BadRequestException(
        'Exception cancellation requires an exception-specific reason code.',
      );
    }
    return this.mutate(() =>
      this.repository.cancelAvailabilityException(
        {
          principal,
          idempotencyKey: this.normalizeIdempotencyKey(idempotencyKey),
          input,
        },
        exceptionId,
      ),
    );
  }

  changeServiceDuration(
    principal: AuthenticatedPrincipal,
    idempotencyKey: string | undefined,
    serviceId: string,
    input: ChangeAppointmentServiceDurationInput,
  ): Promise<AppointmentServiceDurationMutationResponse> {
    if (input.reasonCode !== 'service-duration-change') {
      throw new BadRequestException(
        'Service duration changes require the service-duration-change reason.',
      );
    }
    return this.mutate(() =>
      this.repository.changeServiceDuration(
        {
          principal,
          idempotencyKey: this.normalizeIdempotencyKey(idempotencyKey),
          input,
        },
        serviceId,
      ),
    );
  }

  private validateAvailabilityTemplate(
    input: Pick<
      CreateAvailabilityTemplateInput,
      'localStartMinute' | 'localEndMinute' | 'effectiveFrom' | 'effectiveUntil'
    >,
  ): void {
    try {
      parseCanonicalLocalDate(input.effectiveFrom);
      if (input.effectiveUntil !== undefined) {
        parseCanonicalLocalDate(input.effectiveUntil);
      }
    } catch (error) {
      if (error instanceof AvailabilityMaterializationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    if (input.localEndMinute <= input.localStartMinute) {
      throw new BadRequestException(
        'Availability template end must be after its start.',
      );
    }
    if (
      input.effectiveUntil !== undefined &&
      input.effectiveUntil < input.effectiveFrom
    ) {
      throw new BadRequestException(
        'Availability effective-until must not precede effective-from.',
      );
    }
  }

  private requireAvailabilityReason(reasonCode: string): void {
    if (
      reasonCode !== 'availability-configuration' &&
      reasonCode !== 'provider-availability-change'
    ) {
      throw new BadRequestException(
        'Availability changes require an availability-specific reason code.',
      );
    }
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
      if (error instanceof WorkforceSchedulingValidationError) {
        throw new BadRequestException(error.message);
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
    if (error instanceof WorkforceSchedulingValidationError) {
      throw new BadRequestException(error.message);
    }
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
