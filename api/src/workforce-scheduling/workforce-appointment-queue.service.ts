import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { workforceAppointmentDeclineReasonCodes } from './workforce-appointment-decision-reasons.js';
import { WorkforceAppointmentQueueRepository } from './workforce-appointment-queue.repository.js';
import type {
  ChangeWorkforceAppointmentStatusInput,
  WorkforceAppointmentDecisionResponse,
  WorkforceAppointmentPage,
  WorkforceAppointmentQueueQuery,
} from './workforce-appointment-queue.types.js';
import {
  WorkforceAppointmentAuthorizationError,
  WorkforceAppointmentConflictError,
  WorkforceAppointmentPersistenceError,
  WorkforceAppointmentTargetUnavailableError,
  WorkforceAppointmentValidationError,
} from './workforce-appointment-queue.types.js';

@Injectable()
export class WorkforceAppointmentQueueService {
  constructor(
    private readonly repository: WorkforceAppointmentQueueRepository,
  ) {}

  listAppointments(
    principal: AuthenticatedPrincipal,
    query: WorkforceAppointmentQueueQuery,
  ): Promise<WorkforceAppointmentPage> {
    return this.repository
      .listAppointments(principal, query)
      .catch((error: unknown) => this.mapReadError(error));
  }

  changeAppointmentStatus(
    principal: AuthenticatedPrincipal,
    idempotencyKey: string | undefined,
    appointmentId: string,
    input: ChangeWorkforceAppointmentStatusInput,
  ): Promise<WorkforceAppointmentDecisionResponse> {
    this.assertDecisionReason(input);
    return this.mutate(() =>
      this.repository.changeAppointmentStatus(
        {
          principal,
          idempotencyKey: this.normalizeIdempotencyKey(idempotencyKey),
          input,
        },
        appointmentId,
      ),
    );
  }

  private assertDecisionReason(
    input: ChangeWorkforceAppointmentStatusInput,
  ): void {
    if (
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      input.expectedVersion > 2147483647
    ) {
      throw new BadRequestException(
        'The expected appointment version must be a positive integer.',
      );
    }
    if (input.status === 'confirmed') {
      if (input.reasonCode !== 'appointment-request-confirmed') {
        throw new BadRequestException(
          'Appointment confirmation requires the confirmation reason code.',
        );
      }
      return;
    }

    if (
      input.status !== 'declined' ||
      !workforceAppointmentDeclineReasonCodes.includes(
        input.reasonCode as (typeof workforceAppointmentDeclineReasonCodes)[number],
      )
    ) {
      throw new BadRequestException(
        'Appointment decline requires an approved decline reason code.',
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
      if (error instanceof BadRequestException) throw error;
      if (error instanceof WorkforceAppointmentAuthorizationError) {
        throw new ForbiddenException(
          'Appointment access is not permitted for this facility.',
        );
      }
      if (error instanceof WorkforceAppointmentTargetUnavailableError) {
        throw new NotFoundException('The appointment request is unavailable.');
      }
      if (error instanceof WorkforceAppointmentConflictError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof WorkforceAppointmentValidationError) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof WorkforceAppointmentPersistenceError) {
        throw new ServiceUnavailableException(
          'The appointment decision is temporarily unavailable.',
        );
      }
      throw new ServiceUnavailableException(
        'The appointment decision is temporarily unavailable.',
      );
    }
  }

  private mapReadError(error: unknown): never {
    if (error instanceof WorkforceAppointmentValidationError) {
      throw new BadRequestException(error.message);
    }
    if (
      error instanceof WorkforceAppointmentAuthorizationError ||
      error instanceof WorkforceAppointmentTargetUnavailableError
    ) {
      throw new ForbiddenException(
        'Appointment queue access is not permitted for this facility.',
      );
    }
    throw new ServiceUnavailableException(
      'The appointment queue is temporarily unavailable.',
    );
  }
}
