import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import { DatabaseService } from '../database/database.service.js';
import type {
  DatabaseSchema,
  PatientPortalAppointmentStatus,
  PatientPortalAppointmentCommandOperation,
} from '../database/database.types.js';
import type { PatientPortalSessionContext } from '../patient-portal-auth/patient-portal-auth.types.js';
import type {
  PatientAppointmentAvailabilityQuery,
  PatientAppointmentAvailabilityResponse,
  PatientAppointmentContext,
  PatientAppointmentPageQuery,
  PatientAppointmentPractitionerOptionView,
  PatientAppointmentPractitionerOptionsQuery,
  PatientAppointmentPractitionerOptionsResponse,
  PatientAppointmentServicesResponse,
  PatientAppointmentServiceView,
  PatientAppointmentView,
} from './patient-appointments.types.js';
import { reconcileReleasedPendingProviderSlot } from './provider-slot-release.js';

type DatabaseExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

interface BookablePractice {
  bookablePracticeId: string;
  tenantId: string;
  organizationId: string;
  practiceName: string;
  timezone: string;
}

interface AppointmentRecord {
  id: string;
  status: PatientPortalAppointmentStatus;
  version: number;
  startsAt: Date;
  endsAt: Date;
  slotId: string;
}

interface ResolvedAvailableSlot {
  id: string;
  starts_at: Date;
  ends_at: Date;
  facility_id: string;
  practitioner_facility_assignment_id: string;
  practitioner_service_assignment_id: string;
  practitioner_id: string;
  appointment_service_id: string;
}

interface StoredCommand {
  requestHash: string;
  appointmentRelationshipId: string | null;
  appointmentId: string | null;
  responseData: Record<string, unknown>;
}

interface PublishedAppointmentServiceRecord {
  id: string;
  patient_facing_name: string;
  duration_minutes: number;
  allows_any_practitioner: boolean;
  specialty_id: string;
  specialty_name: string;
  facility_id: string;
  facility_name: string;
  facility_timezone: string;
}

interface PublishedPractitionerOptionRecord {
  id: string;
  display_name: string;
  professional_title: string;
}

type PatientAvailabilitySelection =
  | { kind: 'compatibility' }
  | {
      kind: 'named';
      service: PublishedAppointmentServiceRecord;
      practitionerOption: PublishedPractitionerOptionRecord;
    }
  | { kind: 'any'; service: PublishedAppointmentServiceRecord };

const DEFAULT_DISCOVERY_PAGE = 1;
const DEFAULT_DISCOVERY_PAGE_SIZE = 25;
const MAX_DISCOVERY_PAGE_SIZE = 100;
const INVALID_DISCOVERY_SELECTION_MESSAGE =
  'Choose a valid appointment service and practitioner selection.';
const UNAVAILABLE_DISCOVERY_MESSAGE = 'Appointment discovery is unavailable.';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

function isRetryableTransactionError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ((error as { code?: unknown }).code === '40001' ||
      (error as { code?: unknown }).code === '40P01')
  );
}

function hasExpectedBusinessError(error: unknown): boolean {
  return (
    error instanceof BadRequestException ||
    error instanceof ConflictException ||
    error instanceof ForbiddenException ||
    error instanceof NotFoundException ||
    error instanceof ServiceUnavailableException
  );
}

function isAppointmentUnavailableError(error: unknown): boolean {
  return (
    error instanceof NotFoundException &&
    error.message === 'Appointment is unavailable.'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function databaseCount(value: unknown): number {
  const count = Number(value ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new ServiceUnavailableException(
      'Appointment discovery is temporarily unavailable.',
    );
  }
  return count;
}

@Injectable()
export class PatientAppointmentsService {
  constructor(private readonly database: DatabaseService) {}

  async listBookablePractices(session: PatientPortalSessionContext): Promise<{
    bookablePractices: Array<{
      bookablePracticeId: string;
      practiceName: string;
      timezone: string;
    }>;
  }> {
    const now = new Date();
    const practices = await this.database.client
      .selectFrom('patient_portal_bookable_practices as bookable')
      .innerJoin('tenants as tenant', 'tenant.id', 'bookable.tenant_id')
      .innerJoin('organizations as organization', (join) =>
        join
          .onRef('organization.id', '=', 'bookable.organization_id')
          .onRef('organization.tenant_id', '=', 'bookable.tenant_id'),
      )
      .select([
        'bookable.id as bookable_practice_id',
        'organization.name as practice_name',
        'bookable.timezone',
      ])
      .where('bookable.status', '=', 'active')
      .where('bookable.is_synthetic', '=', true)
      .where('tenant.status', '=', 'active')
      .where('tenant.is_synthetic', '=', true)
      .where('organization.kind', '=', 'practice')
      .where('organization.is_synthetic', '=', true)
      .where(
        sql<boolean>`not exists (
          select 1
          from patient_portal_profile_links profile_link
          join patient_portal_profiles profile
            on profile.id = profile_link.patient_portal_profile_id
          where profile_link.patient_portal_identity_id = ${session.patientPortalIdentityId}
            and profile_link.status = 'active'
            and profile.status = 'active'
            and profile.tenant_id = bookable.tenant_id
            and profile.organization_id = bookable.organization_id
        )`,
      )
      .where((expression) =>
        expression.exists(
          expression
            .selectFrom('patient_portal_appointment_slots as slot')
            .innerJoin('facilities as facility', (join) =>
              join
                .onRef('facility.id', '=', 'slot.facility_id')
                .onRef('facility.tenant_id', '=', 'slot.tenant_id')
                .onRef('facility.organization_id', '=', 'slot.organization_id'),
            )
            .innerJoin(
              'practitioner_facility_assignments as facility_assignment',
              (join) =>
                join
                  .onRef(
                    'facility_assignment.id',
                    '=',
                    'slot.practitioner_facility_assignment_id',
                  )
                  .onRef('facility_assignment.tenant_id', '=', 'slot.tenant_id')
                  .onRef(
                    'facility_assignment.organization_id',
                    '=',
                    'slot.organization_id',
                  )
                  .onRef(
                    'facility_assignment.facility_id',
                    '=',
                    'slot.facility_id',
                  )
                  .onRef(
                    'facility_assignment.practitioner_id',
                    '=',
                    'slot.practitioner_id',
                  ),
            )
            .innerJoin('practitioners as practitioner', (join) =>
              join
                .onRef('practitioner.id', '=', 'slot.practitioner_id')
                .onRef('practitioner.tenant_id', '=', 'slot.tenant_id'),
            )
            .innerJoin('appointment_services as service', (join) =>
              join
                .onRef('service.id', '=', 'slot.appointment_service_id')
                .onRef('service.tenant_id', '=', 'slot.tenant_id')
                .onRef('service.organization_id', '=', 'slot.organization_id')
                .onRef('service.facility_id', '=', 'slot.facility_id'),
            )
            .innerJoin('specialties as specialty', (join) =>
              join
                .onRef('specialty.id', '=', 'service.specialty_id')
                .onRef('specialty.tenant_id', '=', 'service.tenant_id')
                .onRef(
                  'specialty.organization_id',
                  '=',
                  'service.organization_id',
                ),
            )
            .innerJoin(
              'practitioner_service_assignments as service_assignment',
              (join) =>
                join
                  .onRef(
                    'service_assignment.id',
                    '=',
                    'slot.practitioner_service_assignment_id',
                  )
                  .onRef('service_assignment.tenant_id', '=', 'slot.tenant_id')
                  .onRef(
                    'service_assignment.organization_id',
                    '=',
                    'slot.organization_id',
                  )
                  .onRef(
                    'service_assignment.facility_id',
                    '=',
                    'slot.facility_id',
                  )
                  .onRef(
                    'service_assignment.practitioner_facility_assignment_id',
                    '=',
                    'slot.practitioner_facility_assignment_id',
                  )
                  .onRef(
                    'service_assignment.practitioner_id',
                    '=',
                    'slot.practitioner_id',
                  )
                  .onRef(
                    'service_assignment.appointment_service_id',
                    '=',
                    'slot.appointment_service_id',
                  ),
            )
            .select(sql`1`.as('one'))
            .whereRef('slot.bookable_practice_id', '=', 'bookable.id')
            .whereRef('slot.tenant_id', '=', 'bookable.tenant_id')
            .whereRef('slot.organization_id', '=', 'bookable.organization_id')
            .where('slot.status', '=', 'available')
            .where('slot.withdrawal_pending', '=', false)
            .where('slot.is_synthetic', '=', true)
            .where('slot.starts_at', '>', now)
            .where('facility.is_synthetic', '=', true)
            .where('facility_assignment.status', '=', 'active')
            .where('facility_assignment.is_synthetic', '=', true)
            .where('practitioner.status', '=', 'active')
            .where('practitioner.is_synthetic', '=', true)
            .where('specialty.status', '=', 'active')
            .where('specialty.is_synthetic', '=', true)
            .where('service.status', '=', 'active')
            .where('service.is_synthetic', '=', true)
            .where('service_assignment.status', '=', 'active')
            .where('service_assignment.is_synthetic', '=', true)
            .where(sql<boolean>`not exists (
                select 1
                from patient_portal_appointments appointment
                where appointment.appointment_slot_id = slot.id
                  and appointment.status in ('requested', 'confirmed')
              )`),
        ),
      )
      .orderBy('organization.name', 'asc')
      .orderBy('bookable.id', 'asc')
      .limit(25)
      .execute();

    return {
      bookablePractices: practices.map((practice) => ({
        bookablePracticeId: practice.bookable_practice_id,
        practiceName: practice.practice_name,
        timezone: practice.timezone,
      })),
    };
  }

  async createRelationship(
    session: PatientPortalSessionContext,
    rawIdempotencyKey: string,
    bookablePracticeId: string,
  ): Promise<{ appointmentRelationshipId: string; practiceName: string }> {
    const idempotencyKey = this.normalizedIdempotencyKey(rawIdempotencyKey);
    const requestHash = sha256(`relationship\n${bookablePracticeId}`);
    const idempotencyKeyHash = sha256(idempotencyKey);

    try {
      return await this.withSerializableTransaction(async (trx) => {
        const existing = await this.findStoredCommand(
          trx,
          session.patientPortalIdentityId,
          'relationship_create',
          idempotencyKeyHash,
        );
        if (existing) {
          this.assertMatchingIdempotencyRequest(existing, requestHash);
          return this.storedRelationshipResponse(existing);
        }

        const bookable = await this.resolveBookablePractice(
          trx,
          bookablePracticeId,
        );
        if (!bookable) {
          throw new NotFoundException('This bookable practice is unavailable.');
        }

        const activeProfileLink = await trx
          .selectFrom('patient_portal_profile_links as profile_link')
          .innerJoin(
            'patient_portal_profiles as profile',
            'profile.id',
            'profile_link.patient_portal_profile_id',
          )
          .select('profile_link.id')
          .where(
            'profile_link.patient_portal_identity_id',
            '=',
            session.patientPortalIdentityId,
          )
          .where('profile_link.status', '=', 'active')
          .where('profile.status', '=', 'active')
          .where('profile.application_user_id', '=', session.applicationUserId)
          .where('profile.tenant_id', '=', bookable.tenantId)
          .where('profile.organization_id', '=', bookable.organizationId)
          .forUpdate()
          .executeTakeFirst();
        if (activeProfileLink) {
          throw new ConflictException(
            'This practice is already available. Select it from My practices.',
          );
        }

        const existingRelationship = await trx
          .selectFrom('patient_portal_appointment_relationships')
          .select('id')
          .where(
            'patient_portal_identity_id',
            '=',
            session.patientPortalIdentityId,
          )
          .where('organization_id', '=', bookable.organizationId)
          .where('tenant_id', '=', bookable.tenantId)
          .where('status', '=', 'pending')
          .forUpdate()
          .executeTakeFirst();
        const relationshipWrite = existingRelationship
          ? null
          : await trx
              .insertInto('patient_portal_appointment_relationships')
              .values({
                tenant_id: bookable.tenantId,
                organization_id: bookable.organizationId,
                patient_portal_identity_id: session.patientPortalIdentityId,
                status: 'pending',
              })
              // A distinct idempotency key may race for the same explicit
              // identity/practice relationship. The unique relationship is
              // the shared business fact, while each caller still records
              // its own command below. PostgreSQL locks the conflict row;
              // the serializable wrapper retries any serialization abort.
              .onConflict((conflict) =>
                conflict
                  .columns(['patient_portal_identity_id', 'organization_id'])
                  .doUpdateSet({ updated_at: new Date() }),
              )
              // PostgreSQL reports xmax = 0 only for the insert branch. That
              // lets the safe creation audit remain exactly once even when a
              // concurrent caller reuses this relationship with a distinct
              // idempotency key.
              .returning(['id', sql<boolean>`xmax = 0`.as('was_inserted')])
              .executeTakeFirst();
        const relationship = existingRelationship ?? relationshipWrite;
        if (!relationship) {
          throw new ServiceUnavailableException(
            'The appointment relationship is temporarily unavailable.',
          );
        }

        const response = {
          appointmentRelationshipId: relationship.id,
          practiceName: bookable.practiceName,
        };
        await this.insertStoredCommand(trx, {
          patientPortalIdentityId: session.patientPortalIdentityId,
          operation: 'relationship_create',
          idempotencyKeyHash,
          requestHash,
          responseData: response,
          appointmentRelationshipId: relationship.id,
          appointmentId: null,
        });

        if (relationshipWrite?.was_inserted) {
          await this.insertAudit(trx, {
            session,
            tenantId: bookable.tenantId,
            organizationId: bookable.organizationId,
            action: 'patient.appointment_relationship_requested',
            targetEntityType: 'patient_portal_appointment_relationship',
            targetEntityId: relationship.id,
            outcome: 'success',
            reason:
              'Create a pending patient-owned appointment relationship for one bookable practice.',
            beforeData: null,
            afterData: { status: 'pending' },
          });
        }

        return response;
      });
    } catch (error) {
      const replay = await this.replayRelationshipCommand(
        session,
        idempotencyKeyHash,
        requestHash,
      );
      if (replay) return replay;
      if (hasExpectedBusinessError(error)) throw error;
      if (isUniqueViolation(error)) {
        return this.resolveConcurrentRelationshipCommand(
          session,
          idempotencyKeyHash,
          requestHash,
        );
      }
      throw new ServiceUnavailableException(
        'The appointment relationship is temporarily unavailable.',
      );
    }
  }

  async listServices(
    session: PatientPortalSessionContext,
    query: PatientAppointmentPageQuery = {
      page: DEFAULT_DISCOVERY_PAGE,
      pageSize: DEFAULT_DISCOVERY_PAGE_SIZE,
    },
  ): Promise<PatientAppointmentServicesResponse> {
    const { page, pageSize } = this.discoveryPage(query);
    const context = this.appointmentContext(session);
    const bookable = await this.resolveBookablePracticeForContext(
      this.database.client,
      context,
      session.patientPortalIdentityId,
      session.applicationUserId,
    );
    if (!bookable) throw new NotFoundException(UNAVAILABLE_DISCOVERY_MESSAGE);

    const base = this.publishedAppointmentServicesQuery(
      this.database.client,
      bookable,
    );
    const [countRow, services] = await Promise.all([
      base
        .select((expression) =>
          expression.fn.countAll<string>().as('total_count'),
        )
        .executeTakeFirst(),
      base
        .select([
          'service.id',
          'service.patient_facing_name',
          'service.duration_minutes',
          'service.allows_any_practitioner',
          'specialty.id as specialty_id',
          'specialty.name as specialty_name',
          'facility.id as facility_id',
          'facility.name as facility_name',
          'facility.timezone as facility_timezone',
        ])
        .orderBy('service.patient_facing_name', 'asc')
        .orderBy('service.id', 'asc')
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .execute(),
    ]);

    return {
      practiceName: bookable.practiceName,
      timezone: bookable.timezone,
      page,
      pageSize,
      total: databaseCount(countRow?.total_count),
      services: services.map((service) =>
        this.toPatientAppointmentServiceView(service),
      ),
    };
  }

  async listPractitionerOptions(
    session: PatientPortalSessionContext,
    query: PatientAppointmentPractitionerOptionsQuery,
  ): Promise<PatientAppointmentPractitionerOptionsResponse> {
    const { page, pageSize } = this.discoveryPage(query);
    const context = this.appointmentContext(session);
    const bookable = await this.resolveBookablePracticeForContext(
      this.database.client,
      context,
      session.patientPortalIdentityId,
      session.applicationUserId,
    );
    if (!bookable) throw new NotFoundException(UNAVAILABLE_DISCOVERY_MESSAGE);

    const service = await this.findPublishedAppointmentService(
      this.database.client,
      bookable,
      query.appointmentServiceId,
    );
    if (!service) throw new NotFoundException(UNAVAILABLE_DISCOVERY_MESSAGE);

    const base = this.publishedPractitionerOptionsQuery(
      this.database.client,
      bookable,
      service.id,
    );
    const [countRow, options] = await Promise.all([
      base
        .select((expression) =>
          expression.fn.countAll<string>().as('total_count'),
        )
        .executeTakeFirst(),
      base
        .select([
          'service_assignment.id',
          'practitioner.display_name',
          'practitioner.professional_title',
        ])
        .orderBy('practitioner.display_name', 'asc')
        .orderBy('practitioner.professional_title', 'asc')
        .orderBy('service_assignment.id', 'asc')
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .execute(),
    ]);

    return {
      practiceName: bookable.practiceName,
      timezone: bookable.timezone,
      page,
      pageSize,
      total: databaseCount(countRow?.total_count),
      practitionerOptions: options.map((option) =>
        this.toPatientAppointmentPractitionerOptionView(option),
      ),
    };
  }

  async listAvailability(
    session: PatientPortalSessionContext,
    query: PatientAppointmentAvailabilityQuery = {
      page: DEFAULT_DISCOVERY_PAGE,
      pageSize: DEFAULT_DISCOVERY_PAGE_SIZE,
    },
  ): Promise<PatientAppointmentAvailabilityResponse> {
    const { page, pageSize } = this.discoveryPage(query);
    const context = this.appointmentContext(session);
    const bookable = await this.resolveBookablePracticeForContext(
      this.database.client,
      context,
      session.patientPortalIdentityId,
      session.applicationUserId,
    );
    if (!bookable) throw new NotFoundException(UNAVAILABLE_DISCOVERY_MESSAGE);

    const selection = await this.resolvePatientAvailabilitySelection(
      this.database.client,
      bookable,
      query,
    );

    const now = new Date();
    let base = this.availablePatientAppointmentSlotsQuery(
      this.database.client,
      bookable,
      now,
    );
    if (selection.kind === 'named') {
      base = base
        .where('service.id', '=', selection.service.id)
        .where('service_assignment.id', '=', selection.practitionerOption.id);
    } else if (selection.kind === 'any') {
      base = base
        .where('service.id', '=', selection.service.id)
        .where('service.allows_any_practitioner', '=', true);
    }

    const [countRow, slots] = await Promise.all([
      base
        .select((expression) =>
          expression.fn.countAll<string>().as('total_count'),
        )
        .executeTakeFirst(),
      base
        .select([
          'slot.id',
          'slot.starts_at',
          'slot.ends_at',
          'service.id as appointment_service_id',
          'service.patient_facing_name',
          'service.duration_minutes',
          'service.allows_any_practitioner',
          'specialty.id as specialty_id',
          'specialty.name as specialty_name',
          'facility.id as facility_id',
          'facility.name as facility_name',
          'facility.timezone as facility_timezone',
          'service_assignment.id as practitioner_option_id',
          'practitioner.display_name as practitioner_display_name',
          'practitioner.professional_title as practitioner_professional_title',
        ])
        .orderBy('slot.starts_at', 'asc')
        .orderBy('service_assignment.id', 'asc')
        .orderBy('slot.id', 'asc')
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .execute(),
    ]);

    return {
      practiceName: bookable.practiceName,
      timezone: bookable.timezone,
      page,
      pageSize,
      total: databaseCount(countRow?.total_count),
      slots: slots.map((slot) => ({
        slotId: slot.id,
        startsAt: slot.starts_at.toISOString(),
        endsAt: slot.ends_at.toISOString(),
        service: this.toPatientAppointmentServiceView({
          id: slot.appointment_service_id,
          patient_facing_name: slot.patient_facing_name,
          duration_minutes: slot.duration_minutes,
          allows_any_practitioner: slot.allows_any_practitioner,
          specialty_id: slot.specialty_id,
          specialty_name: slot.specialty_name,
          facility_id: slot.facility_id,
          facility_name: slot.facility_name,
          facility_timezone: slot.facility_timezone,
        }),
        practitionerOption: this.toPatientAppointmentPractitionerOptionView({
          id: slot.practitioner_option_id,
          display_name: slot.practitioner_display_name,
          professional_title: slot.practitioner_professional_title,
        }),
      })),
    };
  }

  async listAppointments(session: PatientPortalSessionContext): Promise<{
    practiceName: string;
    timezone: string;
    appointments: PatientAppointmentView[];
  }> {
    const context = this.appointmentContext(session);
    const bookable = await this.resolveBookablePracticeForContext(
      this.database.client,
      context,
      session.patientPortalIdentityId,
      session.applicationUserId,
    );
    if (!bookable) throw new NotFoundException('Appointments are unavailable.');

    const query = this.database.client
      .selectFrom('patient_portal_appointments as appointment')
      .innerJoin(
        'patient_portal_appointment_slots as slot',
        'slot.id',
        'appointment.appointment_slot_id',
      )
      .select([
        'appointment.id',
        'appointment.status',
        'appointment.version',
        'slot.id as slot_id',
        'slot.starts_at',
        'slot.ends_at',
      ])
      .where('appointment.tenant_id', '=', bookable.tenantId)
      .where('appointment.organization_id', '=', bookable.organizationId)
      .where(
        'appointment.patient_portal_identity_id',
        '=',
        session.patientPortalIdentityId,
      )
      .where('slot.bookable_practice_id', '=', bookable.bookablePracticeId)
      .where('slot.is_synthetic', '=', true);

    const scopedQuery =
      context.kind === 'practice'
        ? query.where(
            'appointment.patient_portal_profile_id',
            '=',
            context.portalProfileId,
          )
        : query.where(
            'appointment.patient_portal_appointment_relationship_id',
            '=',
            context.appointmentRelationshipId,
          );
    const appointments = await scopedQuery
      .orderBy('slot.starts_at', 'asc')
      .orderBy('appointment.id', 'asc')
      .limit(50)
      .execute();
    const now = new Date();

    return {
      practiceName: bookable.practiceName,
      timezone: bookable.timezone,
      appointments: appointments.map((appointment) =>
        this.toAppointmentView(
          {
            id: appointment.id,
            status: appointment.status,
            version: appointment.version,
            startsAt: appointment.starts_at,
            endsAt: appointment.ends_at,
            slotId: appointment.slot_id,
          },
          now,
        ),
      ),
    };
  }

  async createAppointment(
    session: PatientPortalSessionContext,
    rawIdempotencyKey: string,
    slotId: string,
  ): Promise<{ appointment: PatientAppointmentView }> {
    const context = this.appointmentContext(session);
    const idempotencyKey = this.normalizedIdempotencyKey(rawIdempotencyKey);
    const requestHash = sha256(
      `appointment_create\n${this.contextKey(context)}\n${slotId}`,
    );
    const idempotencyKeyHash = sha256(idempotencyKey);

    try {
      return await this.withSerializableTransaction(async (trx) => {
        await this.assertMutationContextStillActive(trx, session, context);
        const existing = await this.findStoredCommand(
          trx,
          session.patientPortalIdentityId,
          'appointment_create',
          idempotencyKeyHash,
        );
        if (existing) {
          this.assertMatchingIdempotencyRequest(existing, requestHash);
          return this.storedAppointmentResponse(existing);
        }

        const bookable = await this.resolveBookablePracticeForContext(
          trx,
          context,
          session.patientPortalIdentityId,
          session.applicationUserId,
        );
        if (!bookable) {
          throw new NotFoundException(
            'Appointment availability is unavailable.',
          );
        }
        const slot = await this.resolveAvailableSlot(trx, bookable, slotId);
        if (!slot) {
          throw new ConflictException(
            'The selected appointment time is no longer available.',
          );
        }

        const appointment = await trx
          .insertInto('patient_portal_appointments')
          .values({
            tenant_id: bookable.tenantId,
            organization_id: bookable.organizationId,
            patient_portal_identity_id: session.patientPortalIdentityId,
            patient_portal_profile_id:
              context.kind === 'practice' ? context.portalProfileId : null,
            patient_portal_appointment_relationship_id:
              context.kind === 'appointment-onboarding'
                ? context.appointmentRelationshipId
                : null,
            appointment_slot_id: slot.id,
            facility_id: slot.facility_id,
            practitioner_facility_assignment_id:
              slot.practitioner_facility_assignment_id,
            practitioner_service_assignment_id:
              slot.practitioner_service_assignment_id,
            practitioner_id: slot.practitioner_id,
            appointment_service_id: slot.appointment_service_id,
            status: 'requested',
            version: 1,
            cancelled_at: null,
          })
          .returning(['id', 'status', 'version'])
          .executeTakeFirstOrThrow();

        const response = {
          appointment: this.toAppointmentView(
            {
              id: appointment.id,
              status: appointment.status,
              version: appointment.version,
              startsAt: slot.starts_at,
              endsAt: slot.ends_at,
              slotId: slot.id,
            },
            new Date(),
          ),
        };
        await this.insertStoredCommand(trx, {
          patientPortalIdentityId: session.patientPortalIdentityId,
          operation: 'appointment_create',
          idempotencyKeyHash,
          requestHash,
          responseData: response,
          appointmentRelationshipId: null,
          appointmentId: appointment.id,
        });
        await this.insertAudit(trx, {
          session,
          tenantId: bookable.tenantId,
          organizationId: bookable.organizationId,
          action: 'patient.appointment_requested',
          targetEntityType: 'patient_portal_appointment',
          targetEntityId: appointment.id,
          outcome: 'success',
          reason:
            'Request one synthetic appointment slot in the current patient context.',
          beforeData: null,
          afterData: {
            status: appointment.status,
            version: appointment.version,
            slotId: slot.id,
            facilityId: slot.facility_id,
            practitionerFacilityAssignmentId:
              slot.practitioner_facility_assignment_id,
            practitionerServiceAssignmentId:
              slot.practitioner_service_assignment_id,
            practitionerId: slot.practitioner_id,
            appointmentServiceId: slot.appointment_service_id,
          },
        });

        return response;
      });
    } catch (error) {
      if (isAppointmentUnavailableError(error)) throw error;
      const replay = await this.replayAppointmentCommand(
        session,
        'appointment_create',
        idempotencyKeyHash,
        requestHash,
      );
      if (replay) return replay;
      if (hasExpectedBusinessError(error)) throw error;
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'The selected appointment time is no longer available.',
        );
      }
      throw new ServiceUnavailableException(
        'The appointment request is temporarily unavailable.',
      );
    }
  }

  async cancelAppointment(
    session: PatientPortalSessionContext,
    rawIdempotencyKey: string,
    appointmentId: string,
    version: number,
  ): Promise<{ appointment: PatientAppointmentView }> {
    const context = this.appointmentContext(session);
    const idempotencyKey = this.normalizedIdempotencyKey(rawIdempotencyKey);
    const requestHash = sha256(
      `appointment_cancellation\n${this.contextKey(context)}\n${appointmentId}\n${version}`,
    );
    const idempotencyKeyHash = sha256(idempotencyKey);

    try {
      return await this.withSerializableTransaction(async (trx) => {
        await this.assertMutationContextStillActive(trx, session, context);
        const existing = await this.findStoredCommand(
          trx,
          session.patientPortalIdentityId,
          'appointment_cancellation',
          idempotencyKeyHash,
        );
        if (existing) {
          this.assertMatchingIdempotencyRequest(existing, requestHash);
          return {
            kind: 'success',
            appointment: this.storedAppointmentResponse(existing).appointment,
          } as const;
        }

        const bookable = await this.resolveBookablePracticeForContext(
          trx,
          context,
          session.patientPortalIdentityId,
          session.applicationUserId,
        );
        if (!bookable)
          throw new NotFoundException('Appointment is unavailable.');
        const appointment = await this.findScopedAppointmentForUpdate(
          trx,
          session.patientPortalIdentityId,
          context,
          bookable,
          appointmentId,
        );
        if (!appointment) {
          await this.recordDeniedAppointmentAccess(
            trx,
            session,
            bookable,
            appointmentId,
            'patient.appointment_cancellation_denied',
          );
          return { kind: 'unavailable' } as const;
        }
        if (appointment.version !== version) {
          throw new ConflictException(
            'This appointment changed. Refresh and try again.',
          );
        }
        if (
          appointment.status !== 'requested' ||
          appointment.startsAt <= new Date()
        ) {
          throw new ConflictException('This appointment cannot be cancelled.');
        }

        const now = new Date();
        const updated = await trx
          .updateTable('patient_portal_appointments')
          .set({
            status: 'cancelled',
            version: appointment.version + 1,
            cancelled_at: now,
            updated_at: now,
          })
          .where('id', '=', appointment.id)
          .where('status', '=', 'requested')
          .where('version', '=', version)
          .returning(['id', 'status', 'version'])
          .executeTakeFirst();
        if (!updated) {
          throw new ConflictException(
            'This appointment changed. Refresh and try again.',
          );
        }

        const releasedSlot = await reconcileReleasedPendingProviderSlot(
          trx,
          appointment.slotId,
          now,
        );

        const response = {
          appointment: this.toAppointmentView(
            {
              ...appointment,
              status: updated.status,
              version: updated.version,
            },
            now,
          ),
        };
        await this.insertStoredCommand(trx, {
          patientPortalIdentityId: session.patientPortalIdentityId,
          operation: 'appointment_cancellation',
          idempotencyKeyHash,
          requestHash,
          responseData: response,
          appointmentRelationshipId: null,
          appointmentId: updated.id,
        });
        await this.insertAudit(trx, {
          session,
          tenantId: bookable.tenantId,
          organizationId: bookable.organizationId,
          action: 'patient.appointment_cancelled',
          targetEntityType: 'patient_portal_appointment',
          targetEntityId: updated.id,
          outcome: 'success',
          reason:
            'Cancel one synthetic appointment request in the current patient context.',
          beforeData: {
            status: appointment.status,
            version: appointment.version,
          },
          afterData: {
            status: updated.status,
            version: updated.version,
            releasedSlotId: appointment.slotId,
            releasedSlotDisposition: releasedSlot.disposition,
            releasedSlotValidityReason: releasedSlot.validityReason,
          },
        });
        return {
          kind: 'success',
          appointment: response.appointment,
        } as const;
      }).then((result) => {
        if (result.kind === 'unavailable') {
          throw new NotFoundException('Appointment is unavailable.');
        }
        return { appointment: result.appointment };
      });
    } catch (error) {
      if (isAppointmentUnavailableError(error)) throw error;
      const replay = await this.replayAppointmentCommand(
        session,
        'appointment_cancellation',
        idempotencyKeyHash,
        requestHash,
      );
      if (replay) return replay;
      if (hasExpectedBusinessError(error)) throw error;
      throw new ServiceUnavailableException(
        'The appointment cancellation is temporarily unavailable.',
      );
    }
  }

  async rescheduleAppointment(
    session: PatientPortalSessionContext,
    rawIdempotencyKey: string,
    appointmentId: string,
    slotId: string,
    version: number,
  ): Promise<{ appointment: PatientAppointmentView }> {
    const context = this.appointmentContext(session);
    const idempotencyKey = this.normalizedIdempotencyKey(rawIdempotencyKey);
    const requestHash = sha256(
      `appointment_reschedule\n${this.contextKey(context)}\n${appointmentId}\n${slotId}\n${version}`,
    );
    const idempotencyKeyHash = sha256(idempotencyKey);

    try {
      return await this.withSerializableTransaction(async (trx) => {
        await this.assertMutationContextStillActive(trx, session, context);
        const existing = await this.findStoredCommand(
          trx,
          session.patientPortalIdentityId,
          'appointment_reschedule',
          idempotencyKeyHash,
        );
        if (existing) {
          this.assertMatchingIdempotencyRequest(existing, requestHash);
          return {
            kind: 'success',
            appointment: this.storedAppointmentResponse(existing).appointment,
          } as const;
        }

        const bookable = await this.resolveBookablePracticeForContext(
          trx,
          context,
          session.patientPortalIdentityId,
          session.applicationUserId,
        );
        if (!bookable)
          throw new NotFoundException('Appointment is unavailable.');
        const appointment = await this.findScopedAppointmentForUpdate(
          trx,
          session.patientPortalIdentityId,
          context,
          bookable,
          appointmentId,
        );
        if (!appointment) {
          await this.recordDeniedAppointmentAccess(
            trx,
            session,
            bookable,
            appointmentId,
            'patient.appointment_reschedule_denied',
          );
          return { kind: 'unavailable' } as const;
        }
        if (appointment.version !== version) {
          throw new ConflictException(
            'This appointment changed. Refresh and try again.',
          );
        }
        if (
          appointment.status !== 'requested' ||
          appointment.startsAt <= new Date()
        ) {
          throw new ConflictException(
            'This appointment cannot be rescheduled.',
          );
        }
        if (appointment.slotId === slotId) {
          throw new ConflictException('Choose a different appointment time.');
        }

        const slot = await this.resolveAvailableSlot(trx, bookable, slotId);
        if (!slot) {
          throw new ConflictException(
            'The selected appointment time is no longer available.',
          );
        }
        const now = new Date();
        const updated = await trx
          .updateTable('patient_portal_appointments')
          .set({
            appointment_slot_id: slot.id,
            facility_id: slot.facility_id,
            practitioner_facility_assignment_id:
              slot.practitioner_facility_assignment_id,
            practitioner_service_assignment_id:
              slot.practitioner_service_assignment_id,
            practitioner_id: slot.practitioner_id,
            appointment_service_id: slot.appointment_service_id,
            version: appointment.version + 1,
            updated_at: now,
          })
          .where('id', '=', appointment.id)
          .where('status', '=', 'requested')
          .where('version', '=', version)
          .returning(['id', 'status', 'version'])
          .executeTakeFirst();
        if (!updated) {
          throw new ConflictException(
            'This appointment changed. Refresh and try again.',
          );
        }

        const releasedSlot = await reconcileReleasedPendingProviderSlot(
          trx,
          appointment.slotId,
          now,
        );

        const response = {
          appointment: this.toAppointmentView(
            {
              id: updated.id,
              status: updated.status,
              version: updated.version,
              startsAt: slot.starts_at,
              endsAt: slot.ends_at,
              slotId: slot.id,
            },
            now,
          ),
        };
        await this.insertStoredCommand(trx, {
          patientPortalIdentityId: session.patientPortalIdentityId,
          operation: 'appointment_reschedule',
          idempotencyKeyHash,
          requestHash,
          responseData: response,
          appointmentRelationshipId: null,
          appointmentId: updated.id,
        });
        await this.insertAudit(trx, {
          session,
          tenantId: bookable.tenantId,
          organizationId: bookable.organizationId,
          action: 'patient.appointment_reschedule_requested',
          targetEntityType: 'patient_portal_appointment',
          targetEntityId: updated.id,
          outcome: 'success',
          reason:
            'Reschedule one synthetic appointment request in the current patient context.',
          beforeData: {
            status: appointment.status,
            version: appointment.version,
            slotId: appointment.slotId,
          },
          afterData: {
            status: updated.status,
            version: updated.version,
            slotId: slot.id,
            facilityId: slot.facility_id,
            practitionerFacilityAssignmentId:
              slot.practitioner_facility_assignment_id,
            practitionerServiceAssignmentId:
              slot.practitioner_service_assignment_id,
            practitionerId: slot.practitioner_id,
            appointmentServiceId: slot.appointment_service_id,
            releasedSlotId: appointment.slotId,
            releasedSlotDisposition: releasedSlot.disposition,
            releasedSlotValidityReason: releasedSlot.validityReason,
          },
        });
        return {
          kind: 'success',
          appointment: response.appointment,
        } as const;
      }).then((result) => {
        if (result.kind === 'unavailable') {
          throw new NotFoundException('Appointment is unavailable.');
        }
        return { appointment: result.appointment };
      });
    } catch (error) {
      if (isAppointmentUnavailableError(error)) throw error;
      const replay = await this.replayAppointmentCommand(
        session,
        'appointment_reschedule',
        idempotencyKeyHash,
        requestHash,
      );
      if (replay) return replay;
      if (hasExpectedBusinessError(error)) throw error;
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'The selected appointment time is no longer available.',
        );
      }
      throw new ServiceUnavailableException(
        'The appointment reschedule is temporarily unavailable.',
      );
    }
  }

  private appointmentContext(
    session: PatientPortalSessionContext,
  ): PatientAppointmentContext {
    if (
      session.context.kind !== 'practice' &&
      session.context.kind !== 'appointment-onboarding'
    ) {
      throw new ForbiddenException(
        'Select an active practice or appointment relationship before accessing appointments.',
      );
    }

    return session.context;
  }

  private normalizedIdempotencyKey(rawKey: string): string {
    const key = rawKey.trim();

    if (key.length < 16 || key.length > 200) {
      throw new BadRequestException(
        'Idempotency-Key must contain between 16 and 200 characters.',
      );
    }

    return key;
  }

  private contextKey(context: PatientAppointmentContext): string {
    return context.kind === 'practice'
      ? `practice:${context.portalProfileId}`
      : `appointment-onboarding:${context.appointmentRelationshipId}`;
  }

  private async withSerializableTransaction<T>(
    work: (transaction: Transaction<DatabaseSchema>) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.database.client
          .transaction()
          .setIsolationLevel('serializable')
          .execute(work);
      } catch (error) {
        lastError = error;
        if (!isRetryableTransactionError(error) || attempt === 2) throw error;
      }
    }

    throw lastError;
  }

  private async findStoredCommand(
    database: Transaction<DatabaseSchema>,
    patientPortalIdentityId: string,
    operation: PatientPortalAppointmentCommandOperation,
    idempotencyKeyHash: string,
  ): Promise<StoredCommand | null> {
    const command = await database
      .selectFrom('patient_portal_appointment_commands')
      .select([
        'request_hash',
        'response_data',
        'patient_portal_appointment_relationship_id',
        'patient_portal_appointment_id',
      ])
      .where('patient_portal_identity_id', '=', patientPortalIdentityId)
      .where('operation', '=', operation)
      .where('idempotency_key_hash', '=', idempotencyKeyHash)
      .forUpdate()
      .executeTakeFirst();

    return command
      ? {
          requestHash: command.request_hash,
          appointmentRelationshipId:
            command.patient_portal_appointment_relationship_id,
          appointmentId: command.patient_portal_appointment_id,
          responseData: command.response_data,
        }
      : null;
  }

  /**
   * Read a committed command outcome after a concurrent command transaction
   * lost its race. This intentionally does not lock: it is only used after
   * the losing transaction has rolled back, and the command row itself is
   * immutable once written.
   */
  private async findStoredCommandForReplay(
    patientPortalIdentityId: string,
    operation: PatientPortalAppointmentCommandOperation,
    idempotencyKeyHash: string,
  ): Promise<StoredCommand | null> {
    const command = await this.database.client
      .selectFrom('patient_portal_appointment_commands')
      .select([
        'request_hash',
        'response_data',
        'patient_portal_appointment_relationship_id',
        'patient_portal_appointment_id',
      ])
      .where('patient_portal_identity_id', '=', patientPortalIdentityId)
      .where('operation', '=', operation)
      .where('idempotency_key_hash', '=', idempotencyKeyHash)
      .executeTakeFirst();

    return command
      ? {
          requestHash: command.request_hash,
          appointmentRelationshipId:
            command.patient_portal_appointment_relationship_id,
          appointmentId: command.patient_portal_appointment_id,
          responseData: command.response_data,
        }
      : null;
  }

  private async replayAppointmentCommand(
    session: PatientPortalSessionContext,
    operation: Extract<
      PatientPortalAppointmentCommandOperation,
      | 'appointment_create'
      | 'appointment_cancellation'
      | 'appointment_reschedule'
    >,
    idempotencyKeyHash: string,
    requestHash: string,
  ): Promise<{ appointment: PatientAppointmentView } | null> {
    const command = await this.findStoredCommandForReplay(
      session.patientPortalIdentityId,
      operation,
      idempotencyKeyHash,
    );
    if (!command) return null;

    this.assertMatchingIdempotencyRequest(command, requestHash);
    return this.storedAppointmentResponse(command);
  }

  private async replayRelationshipCommand(
    session: PatientPortalSessionContext,
    idempotencyKeyHash: string,
    requestHash: string,
  ): Promise<{
    appointmentRelationshipId: string;
    practiceName: string;
  } | null> {
    const command = await this.findStoredCommandForReplay(
      session.patientPortalIdentityId,
      'relationship_create',
      idempotencyKeyHash,
    );
    if (!command) return null;

    this.assertMatchingIdempotencyRequest(command, requestHash);
    return this.storedRelationshipResponse(command);
  }

  private assertMatchingIdempotencyRequest(
    command: StoredCommand,
    requestHash: string,
  ): void {
    if (command.requestHash !== requestHash) {
      throw new ConflictException(
        'Idempotency-Key cannot be reused with a different appointment request.',
      );
    }
  }

  private async insertStoredCommand(
    database: Transaction<DatabaseSchema>,
    command: {
      patientPortalIdentityId: string;
      operation: PatientPortalAppointmentCommandOperation;
      idempotencyKeyHash: string;
      requestHash: string;
      responseData: Record<string, unknown>;
      appointmentRelationshipId: string | null;
      appointmentId: string | null;
    },
  ): Promise<void> {
    await database
      .insertInto('patient_portal_appointment_commands')
      .values({
        patient_portal_identity_id: command.patientPortalIdentityId,
        operation: command.operation,
        idempotency_key_hash: command.idempotencyKeyHash,
        request_hash: command.requestHash,
        response_data: command.responseData,
        patient_portal_appointment_relationship_id:
          command.appointmentRelationshipId,
        patient_portal_appointment_id: command.appointmentId,
      })
      .execute();
  }

  private storedRelationshipResponse(command: StoredCommand): {
    appointmentRelationshipId: string;
    practiceName: string;
  } {
    const response = command.responseData;
    if (
      typeof response.appointmentRelationshipId !== 'string' ||
      typeof response.practiceName !== 'string'
    ) {
      throw new ServiceUnavailableException(
        'The appointment relationship is temporarily unavailable.',
      );
    }

    return {
      appointmentRelationshipId: response.appointmentRelationshipId,
      practiceName: response.practiceName,
    };
  }

  private storedAppointmentResponse(command: StoredCommand): {
    appointment: PatientAppointmentView;
  } {
    const appointment = command.responseData.appointment;
    const version = isRecord(appointment) ? appointment.version : undefined;
    if (
      !isRecord(appointment) ||
      typeof appointment.appointmentId !== 'string' ||
      (appointment.status !== 'requested' &&
        appointment.status !== 'confirmed' &&
        appointment.status !== 'declined' &&
        appointment.status !== 'cancelled') ||
      typeof appointment.startsAt !== 'string' ||
      typeof appointment.endsAt !== 'string' ||
      !isInteger(version) ||
      typeof appointment.canCancel !== 'boolean' ||
      typeof appointment.canReschedule !== 'boolean'
    ) {
      throw new ServiceUnavailableException(
        'The appointment request is temporarily unavailable.',
      );
    }

    const {
      appointmentId,
      status,
      startsAt,
      endsAt,
      canCancel,
      canReschedule,
    } = appointment;

    return {
      appointment: {
        appointmentId,
        status,
        startsAt,
        endsAt,
        version,
        canCancel,
        canReschedule,
      },
    };
  }

  private discoveryPage(query: Partial<PatientAppointmentPageQuery>): {
    page: number;
    pageSize: number;
  } {
    const page = query.page ?? DEFAULT_DISCOVERY_PAGE;
    const pageSize = query.pageSize ?? DEFAULT_DISCOVERY_PAGE_SIZE;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > MAX_DISCOVERY_PAGE_SIZE ||
      !Number.isSafeInteger((page - 1) * pageSize)
    ) {
      throw new BadRequestException(
        'Appointment discovery pagination is invalid.',
      );
    }
    return { page, pageSize };
  }

  private publishedAppointmentServicesQuery(
    database: DatabaseExecutor,
    practice: BookablePractice,
  ) {
    return database
      .selectFrom('appointment_services as service')
      .innerJoin('facilities as facility', (join) =>
        join
          .onRef('facility.id', '=', 'service.facility_id')
          .onRef('facility.tenant_id', '=', 'service.tenant_id')
          .onRef('facility.organization_id', '=', 'service.organization_id'),
      )
      .innerJoin('specialties as specialty', (join) =>
        join
          .onRef('specialty.id', '=', 'service.specialty_id')
          .onRef('specialty.tenant_id', '=', 'service.tenant_id')
          .onRef('specialty.organization_id', '=', 'service.organization_id'),
      )
      .where('service.tenant_id', '=', practice.tenantId)
      .where('service.organization_id', '=', practice.organizationId)
      .where('service.status', '=', 'active')
      .where('service.is_synthetic', '=', true)
      .where('specialty.status', '=', 'active')
      .where('specialty.is_synthetic', '=', true)
      .where('facility.is_synthetic', '=', true)
      .where((expression) =>
        expression.exists(
          expression
            .selectFrom(
              'practitioner_service_assignments as service_assignment',
            )
            .innerJoin(
              'practitioner_facility_assignments as facility_assignment',
              (join) =>
                join
                  .onRef(
                    'facility_assignment.id',
                    '=',
                    'service_assignment.practitioner_facility_assignment_id',
                  )
                  .onRef(
                    'facility_assignment.tenant_id',
                    '=',
                    'service_assignment.tenant_id',
                  )
                  .onRef(
                    'facility_assignment.organization_id',
                    '=',
                    'service_assignment.organization_id',
                  )
                  .onRef(
                    'facility_assignment.facility_id',
                    '=',
                    'service_assignment.facility_id',
                  )
                  .onRef(
                    'facility_assignment.practitioner_id',
                    '=',
                    'service_assignment.practitioner_id',
                  ),
            )
            .innerJoin('practitioners as practitioner', (join) =>
              join
                .onRef(
                  'practitioner.id',
                  '=',
                  'service_assignment.practitioner_id',
                )
                .onRef(
                  'practitioner.tenant_id',
                  '=',
                  'service_assignment.tenant_id',
                ),
            )
            .select(sql`1`.as('one'))
            .whereRef(
              'service_assignment.appointment_service_id',
              '=',
              'service.id',
            )
            .whereRef('service_assignment.tenant_id', '=', 'service.tenant_id')
            .whereRef(
              'service_assignment.organization_id',
              '=',
              'service.organization_id',
            )
            .whereRef(
              'service_assignment.facility_id',
              '=',
              'service.facility_id',
            )
            .where('service_assignment.status', '=', 'active')
            .where('service_assignment.is_synthetic', '=', true)
            .where('facility_assignment.status', '=', 'active')
            .where('facility_assignment.is_synthetic', '=', true)
            .where('practitioner.status', '=', 'active')
            .where('practitioner.is_synthetic', '=', true),
        ),
      );
  }

  private publishedPractitionerOptionsQuery(
    database: DatabaseExecutor,
    practice: BookablePractice,
    appointmentServiceId: string,
  ) {
    return database
      .selectFrom('practitioner_service_assignments as service_assignment')
      .innerJoin('appointment_services as service', (join) =>
        join
          .onRef('service.id', '=', 'service_assignment.appointment_service_id')
          .onRef('service.tenant_id', '=', 'service_assignment.tenant_id')
          .onRef(
            'service.organization_id',
            '=',
            'service_assignment.organization_id',
          )
          .onRef('service.facility_id', '=', 'service_assignment.facility_id'),
      )
      .innerJoin('specialties as specialty', (join) =>
        join
          .onRef('specialty.id', '=', 'service.specialty_id')
          .onRef('specialty.tenant_id', '=', 'service.tenant_id')
          .onRef('specialty.organization_id', '=', 'service.organization_id'),
      )
      .innerJoin('facilities as facility', (join) =>
        join
          .onRef('facility.id', '=', 'service_assignment.facility_id')
          .onRef('facility.tenant_id', '=', 'service_assignment.tenant_id')
          .onRef(
            'facility.organization_id',
            '=',
            'service_assignment.organization_id',
          ),
      )
      .innerJoin(
        'practitioner_facility_assignments as facility_assignment',
        (join) =>
          join
            .onRef(
              'facility_assignment.id',
              '=',
              'service_assignment.practitioner_facility_assignment_id',
            )
            .onRef(
              'facility_assignment.tenant_id',
              '=',
              'service_assignment.tenant_id',
            )
            .onRef(
              'facility_assignment.organization_id',
              '=',
              'service_assignment.organization_id',
            )
            .onRef(
              'facility_assignment.facility_id',
              '=',
              'service_assignment.facility_id',
            )
            .onRef(
              'facility_assignment.practitioner_id',
              '=',
              'service_assignment.practitioner_id',
            ),
      )
      .innerJoin('practitioners as practitioner', (join) =>
        join
          .onRef('practitioner.id', '=', 'service_assignment.practitioner_id')
          .onRef('practitioner.tenant_id', '=', 'service_assignment.tenant_id'),
      )
      .where('service_assignment.tenant_id', '=', practice.tenantId)
      .where('service_assignment.organization_id', '=', practice.organizationId)
      .where(
        'service_assignment.appointment_service_id',
        '=',
        appointmentServiceId,
      )
      .where('service_assignment.status', '=', 'active')
      .where('service_assignment.is_synthetic', '=', true)
      .where('facility_assignment.status', '=', 'active')
      .where('facility_assignment.is_synthetic', '=', true)
      .where('practitioner.status', '=', 'active')
      .where('practitioner.is_synthetic', '=', true)
      .where('service.status', '=', 'active')
      .where('service.is_synthetic', '=', true)
      .where('specialty.status', '=', 'active')
      .where('specialty.is_synthetic', '=', true)
      .where('facility.is_synthetic', '=', true);
  }

  private availablePatientAppointmentSlotsQuery(
    database: DatabaseExecutor,
    practice: BookablePractice,
    now: Date,
  ) {
    return database
      .selectFrom('patient_portal_appointment_slots as slot')
      .innerJoin('facilities as facility', (join) =>
        join
          .onRef('facility.id', '=', 'slot.facility_id')
          .onRef('facility.tenant_id', '=', 'slot.tenant_id')
          .onRef('facility.organization_id', '=', 'slot.organization_id'),
      )
      .innerJoin(
        'practitioner_facility_assignments as facility_assignment',
        (join) =>
          join
            .onRef(
              'facility_assignment.id',
              '=',
              'slot.practitioner_facility_assignment_id',
            )
            .onRef('facility_assignment.tenant_id', '=', 'slot.tenant_id')
            .onRef(
              'facility_assignment.organization_id',
              '=',
              'slot.organization_id',
            )
            .onRef('facility_assignment.facility_id', '=', 'slot.facility_id')
            .onRef(
              'facility_assignment.practitioner_id',
              '=',
              'slot.practitioner_id',
            ),
      )
      .innerJoin('practitioners as practitioner', (join) =>
        join
          .onRef('practitioner.id', '=', 'slot.practitioner_id')
          .onRef('practitioner.tenant_id', '=', 'slot.tenant_id'),
      )
      .innerJoin('appointment_services as service', (join) =>
        join
          .onRef('service.id', '=', 'slot.appointment_service_id')
          .onRef('service.tenant_id', '=', 'slot.tenant_id')
          .onRef('service.organization_id', '=', 'slot.organization_id')
          .onRef('service.facility_id', '=', 'slot.facility_id'),
      )
      .innerJoin('specialties as specialty', (join) =>
        join
          .onRef('specialty.id', '=', 'service.specialty_id')
          .onRef('specialty.tenant_id', '=', 'service.tenant_id')
          .onRef('specialty.organization_id', '=', 'service.organization_id'),
      )
      .innerJoin(
        'practitioner_service_assignments as service_assignment',
        (join) =>
          join
            .onRef(
              'service_assignment.id',
              '=',
              'slot.practitioner_service_assignment_id',
            )
            .onRef('service_assignment.tenant_id', '=', 'slot.tenant_id')
            .onRef(
              'service_assignment.organization_id',
              '=',
              'slot.organization_id',
            )
            .onRef('service_assignment.facility_id', '=', 'slot.facility_id')
            .onRef(
              'service_assignment.practitioner_facility_assignment_id',
              '=',
              'slot.practitioner_facility_assignment_id',
            )
            .onRef(
              'service_assignment.practitioner_id',
              '=',
              'slot.practitioner_id',
            )
            .onRef(
              'service_assignment.appointment_service_id',
              '=',
              'slot.appointment_service_id',
            ),
      )
      .where('slot.bookable_practice_id', '=', practice.bookablePracticeId)
      .where('slot.tenant_id', '=', practice.tenantId)
      .where('slot.organization_id', '=', practice.organizationId)
      .where('slot.status', '=', 'available')
      .where('slot.withdrawal_pending', '=', false)
      .where('slot.is_synthetic', '=', true)
      .where('slot.starts_at', '>', now)
      .where(
        sql<boolean>`
          slot.source_local_date >=
            (${now}::timestamptz at time zone facility.timezone)::date
          and slot.source_local_date <
            ((${now}::timestamptz at time zone facility.timezone)::date + 56)
        `,
      )
      .where('facility.is_synthetic', '=', true)
      .where('facility_assignment.status', '=', 'active')
      .where('facility_assignment.is_synthetic', '=', true)
      .where('practitioner.status', '=', 'active')
      .where('practitioner.is_synthetic', '=', true)
      .where('specialty.status', '=', 'active')
      .where('specialty.is_synthetic', '=', true)
      .where('service.status', '=', 'active')
      .where('service.is_synthetic', '=', true)
      .where('service_assignment.status', '=', 'active')
      .where('service_assignment.is_synthetic', '=', true)
      .where(
        sql<boolean>`not exists (
          select 1
          from patient_portal_appointments appointment
          where appointment.appointment_slot_id = slot.id
            and appointment.status in ('requested', 'confirmed')
        )`,
      );
  }

  private async findPublishedAppointmentService(
    database: DatabaseExecutor,
    practice: BookablePractice,
    appointmentServiceId: string,
  ): Promise<PublishedAppointmentServiceRecord | null> {
    const service = await this.publishedAppointmentServicesQuery(
      database,
      practice,
    )
      .select([
        'service.id',
        'service.patient_facing_name',
        'service.duration_minutes',
        'service.allows_any_practitioner',
        'specialty.id as specialty_id',
        'specialty.name as specialty_name',
        'facility.id as facility_id',
        'facility.name as facility_name',
        'facility.timezone as facility_timezone',
      ])
      .where('service.id', '=', appointmentServiceId)
      .executeTakeFirst();
    return service ?? null;
  }

  private async findPublishedPractitionerOption(
    database: DatabaseExecutor,
    practice: BookablePractice,
    appointmentServiceId: string,
    practitionerOptionId: string,
  ): Promise<PublishedPractitionerOptionRecord | null> {
    const option = await this.publishedPractitionerOptionsQuery(
      database,
      practice,
      appointmentServiceId,
    )
      .select([
        'service_assignment.id',
        'practitioner.display_name',
        'practitioner.professional_title',
      ])
      .where('service_assignment.id', '=', practitionerOptionId)
      .executeTakeFirst();
    return option ?? null;
  }

  private async resolvePatientAvailabilitySelection(
    database: DatabaseExecutor,
    practice: BookablePractice,
    query: PatientAppointmentAvailabilityQuery,
  ): Promise<PatientAvailabilitySelection> {
    const hasService = query.appointmentServiceId !== undefined;
    const hasMode = query.selectionMode !== undefined;
    const hasOption = query.practitionerOptionId !== undefined;
    if (!hasService && !hasMode && !hasOption) {
      return { kind: 'compatibility' };
    }
    if (
      !hasService ||
      !hasMode ||
      (query.selectionMode !== 'named' && query.selectionMode !== 'any')
    ) {
      throw new BadRequestException(INVALID_DISCOVERY_SELECTION_MESSAGE);
    }

    const service = await this.findPublishedAppointmentService(
      database,
      practice,
      query.appointmentServiceId!,
    );
    if (!service) throw new NotFoundException(UNAVAILABLE_DISCOVERY_MESSAGE);

    if (query.selectionMode === 'any') {
      if (hasOption) {
        throw new BadRequestException(INVALID_DISCOVERY_SELECTION_MESSAGE);
      }
      if (!service.allows_any_practitioner) {
        throw new NotFoundException(UNAVAILABLE_DISCOVERY_MESSAGE);
      }
      return { kind: 'any', service };
    }
    if (!hasOption) {
      throw new BadRequestException(INVALID_DISCOVERY_SELECTION_MESSAGE);
    }

    const practitionerOption = await this.findPublishedPractitionerOption(
      database,
      practice,
      service.id,
      query.practitionerOptionId!,
    );
    if (!practitionerOption) {
      throw new NotFoundException(UNAVAILABLE_DISCOVERY_MESSAGE);
    }
    return { kind: 'named', service, practitionerOption };
  }

  private toPatientAppointmentServiceView(
    service: PublishedAppointmentServiceRecord,
  ): PatientAppointmentServiceView {
    return {
      appointmentServiceId: service.id,
      patientFacingName: service.patient_facing_name,
      durationMinutes: service.duration_minutes,
      allowsAnyPractitioner: service.allows_any_practitioner,
      specialty: {
        specialtyId: service.specialty_id,
        name: service.specialty_name,
      },
      facility: {
        facilityId: service.facility_id,
        name: service.facility_name,
        timezone: service.facility_timezone,
      },
    };
  }

  private toPatientAppointmentPractitionerOptionView(
    option: PublishedPractitionerOptionRecord,
  ): PatientAppointmentPractitionerOptionView {
    return {
      practitionerOptionId: option.id,
      displayName: option.display_name,
      professionalTitle: option.professional_title,
    };
  }

  private async resolveBookablePractice(
    database: DatabaseExecutor,
    bookablePracticeId: string,
  ): Promise<BookablePractice | null> {
    const now = new Date();
    const practice = await database
      .selectFrom('patient_portal_bookable_practices as bookable')
      .innerJoin('tenants as tenant', 'tenant.id', 'bookable.tenant_id')
      .innerJoin('organizations as organization', (join) =>
        join
          .onRef('organization.id', '=', 'bookable.organization_id')
          .onRef('organization.tenant_id', '=', 'bookable.tenant_id'),
      )
      .select([
        'bookable.id',
        'bookable.tenant_id',
        'bookable.organization_id',
        'bookable.timezone',
        'organization.name as practice_name',
      ])
      .where('bookable.id', '=', bookablePracticeId)
      .where('bookable.status', '=', 'active')
      .where('bookable.is_synthetic', '=', true)
      .where('tenant.status', '=', 'active')
      .where('tenant.is_synthetic', '=', true)
      .where('organization.kind', '=', 'practice')
      .where('organization.is_synthetic', '=', true)
      .where(
        sql<boolean>`exists (
        select 1
        from patient_portal_appointment_slots slot
        join facilities facility
          on facility.id = slot.facility_id
         and facility.tenant_id = slot.tenant_id
         and facility.organization_id = slot.organization_id
         and facility.is_synthetic = true
        join practitioner_facility_assignments facility_assignment
          on facility_assignment.id = slot.practitioner_facility_assignment_id
         and facility_assignment.tenant_id = slot.tenant_id
         and facility_assignment.organization_id = slot.organization_id
         and facility_assignment.facility_id = slot.facility_id
         and facility_assignment.practitioner_id = slot.practitioner_id
         and facility_assignment.status = 'active'
         and facility_assignment.is_synthetic = true
        join practitioners practitioner
          on practitioner.id = slot.practitioner_id
         and practitioner.tenant_id = slot.tenant_id
         and practitioner.status = 'active'
         and practitioner.is_synthetic = true
        join appointment_services service
          on service.id = slot.appointment_service_id
         and service.tenant_id = slot.tenant_id
         and service.organization_id = slot.organization_id
         and service.facility_id = slot.facility_id
         and service.status = 'active'
         and service.is_synthetic = true
        join specialties specialty
          on specialty.id = service.specialty_id
         and specialty.tenant_id = service.tenant_id
         and specialty.organization_id = service.organization_id
         and specialty.status = 'active'
         and specialty.is_synthetic = true
        join practitioner_service_assignments service_assignment
          on service_assignment.id = slot.practitioner_service_assignment_id
         and service_assignment.tenant_id = slot.tenant_id
         and service_assignment.organization_id = slot.organization_id
         and service_assignment.facility_id = slot.facility_id
         and service_assignment.practitioner_facility_assignment_id =
             slot.practitioner_facility_assignment_id
         and service_assignment.practitioner_id = slot.practitioner_id
         and service_assignment.appointment_service_id =
             slot.appointment_service_id
         and service_assignment.status = 'active'
         and service_assignment.is_synthetic = true
        where slot.bookable_practice_id = bookable.id
          and slot.tenant_id = bookable.tenant_id
          and slot.organization_id = bookable.organization_id
          and slot.status = 'available'
          and slot.withdrawal_pending = false
          and slot.is_synthetic = true
          and slot.starts_at > ${now}
          and not exists (
            select 1
            from patient_portal_appointments appointment
            where appointment.appointment_slot_id = slot.id
              and appointment.status in ('requested', 'confirmed')
          )
      )`,
      )
      .executeTakeFirst();

    return practice
      ? {
          bookablePracticeId: practice.id,
          tenantId: practice.tenant_id,
          organizationId: practice.organization_id,
          practiceName: practice.practice_name,
          timezone: practice.timezone,
        }
      : null;
  }

  private async resolveBookablePracticeForContext(
    database: DatabaseExecutor,
    context: PatientAppointmentContext,
    patientPortalIdentityId: string,
    applicationUserId: string,
  ): Promise<BookablePractice | null> {
    const practice = await database
      .selectFrom('patient_portal_bookable_practices as bookable')
      .innerJoin('tenants as tenant', 'tenant.id', 'bookable.tenant_id')
      .innerJoin('organizations as organization', (join) =>
        join
          .onRef('organization.id', '=', 'bookable.organization_id')
          .onRef('organization.tenant_id', '=', 'bookable.tenant_id'),
      )
      .select([
        'bookable.id',
        'bookable.tenant_id',
        'bookable.organization_id',
        'bookable.timezone',
        'organization.name as practice_name',
      ])
      .where('bookable.tenant_id', '=', context.tenantId)
      .where('bookable.organization_id', '=', context.organizationId)
      .where('bookable.status', '=', 'active')
      .where('bookable.is_synthetic', '=', true)
      .where('tenant.status', '=', 'active')
      .where('tenant.is_synthetic', '=', true)
      .where('organization.kind', '=', 'practice')
      .where('organization.is_synthetic', '=', true)
      .where(
        context.kind === 'practice'
          ? sql<boolean>`exists (
              select 1
              from patient_portal_profile_links profile_link
              join patient_portal_profiles profile
                on profile.id = profile_link.patient_portal_profile_id
              where profile_link.patient_portal_identity_id = ${patientPortalIdentityId}
                and profile_link.patient_portal_profile_id = ${context.portalProfileId}
                and profile_link.status = 'active'
                and profile.status = 'active'
                and profile.application_user_id = ${applicationUserId}
                and profile.tenant_id = bookable.tenant_id
                and profile.organization_id = bookable.organization_id
            )`
          : sql<boolean>`exists (
              select 1
              from patient_portal_appointment_relationships relationship
              where relationship.id = ${context.appointmentRelationshipId}
                and relationship.patient_portal_identity_id = ${patientPortalIdentityId}
                and relationship.status = 'pending'
                and relationship.tenant_id = bookable.tenant_id
                and relationship.organization_id = bookable.organization_id
            )`,
      )
      .executeTakeFirst();

    return practice
      ? {
          bookablePracticeId: practice.id,
          tenantId: practice.tenant_id,
          organizationId: practice.organization_id,
          practiceName: practice.practice_name,
          timezone: practice.timezone,
        }
      : null;
  }

  private async assertMutationContextStillActive(
    database: Transaction<DatabaseSchema>,
    session: PatientPortalSessionContext,
    context: PatientAppointmentContext,
  ): Promise<void> {
    if (context.kind === 'practice') {
      const activeLink = await database
        .selectFrom('patient_portal_profile_links as profile_link')
        .innerJoin(
          'patient_portal_profiles as profile',
          'profile.id',
          'profile_link.patient_portal_profile_id',
        )
        .innerJoin('tenants as tenant', 'tenant.id', 'profile.tenant_id')
        .select('profile_link.id')
        .where(
          'profile_link.patient_portal_identity_id',
          '=',
          session.patientPortalIdentityId,
        )
        .where(
          'profile_link.patient_portal_profile_id',
          '=',
          context.portalProfileId,
        )
        .where('profile_link.status', '=', 'active')
        .where('profile.application_user_id', '=', session.applicationUserId)
        .where('profile.status', '=', 'active')
        .where('profile.tenant_id', '=', context.tenantId)
        .where('profile.organization_id', '=', context.organizationId)
        .where('tenant.status', '=', 'active')
        .forUpdate()
        .executeTakeFirst();
      if (activeLink) return;
    } else {
      const pendingRelationship = await database
        .selectFrom('patient_portal_appointment_relationships as relationship')
        .innerJoin('tenants as tenant', 'tenant.id', 'relationship.tenant_id')
        .select('relationship.id')
        .where('relationship.id', '=', context.appointmentRelationshipId)
        .where(
          'relationship.patient_portal_identity_id',
          '=',
          session.patientPortalIdentityId,
        )
        .where('relationship.tenant_id', '=', context.tenantId)
        .where('relationship.organization_id', '=', context.organizationId)
        .where('relationship.status', '=', 'pending')
        .where('tenant.status', '=', 'active')
        .forUpdate()
        .executeTakeFirst();
      if (pendingRelationship) return;
    }

    throw new NotFoundException('Appointment is unavailable.');
  }

  private async resolveAvailableSlot(
    database: Transaction<DatabaseSchema>,
    practice: BookablePractice,
    slotId: string,
  ): Promise<ResolvedAvailableSlot | null> {
    const now = new Date();
    const slot = await database
      .selectFrom('patient_portal_appointment_slots as slot')
      .innerJoin('facilities as facility', (join) =>
        join
          .onRef('facility.id', '=', 'slot.facility_id')
          .onRef('facility.tenant_id', '=', 'slot.tenant_id')
          .onRef('facility.organization_id', '=', 'slot.organization_id'),
      )
      .innerJoin(
        'practitioner_facility_assignments as facility_assignment',
        (join) =>
          join
            .onRef(
              'facility_assignment.id',
              '=',
              'slot.practitioner_facility_assignment_id',
            )
            .onRef('facility_assignment.tenant_id', '=', 'slot.tenant_id')
            .onRef(
              'facility_assignment.organization_id',
              '=',
              'slot.organization_id',
            )
            .onRef('facility_assignment.facility_id', '=', 'slot.facility_id')
            .onRef(
              'facility_assignment.practitioner_id',
              '=',
              'slot.practitioner_id',
            ),
      )
      .innerJoin('practitioners as practitioner', (join) =>
        join
          .onRef('practitioner.id', '=', 'slot.practitioner_id')
          .onRef('practitioner.tenant_id', '=', 'slot.tenant_id'),
      )
      .innerJoin('appointment_services as service', (join) =>
        join
          .onRef('service.id', '=', 'slot.appointment_service_id')
          .onRef('service.tenant_id', '=', 'slot.tenant_id')
          .onRef('service.organization_id', '=', 'slot.organization_id')
          .onRef('service.facility_id', '=', 'slot.facility_id'),
      )
      .innerJoin('specialties as specialty', (join) =>
        join
          .onRef('specialty.id', '=', 'service.specialty_id')
          .onRef('specialty.tenant_id', '=', 'service.tenant_id')
          .onRef('specialty.organization_id', '=', 'service.organization_id'),
      )
      .innerJoin(
        'practitioner_service_assignments as service_assignment',
        (join) =>
          join
            .onRef(
              'service_assignment.id',
              '=',
              'slot.practitioner_service_assignment_id',
            )
            .onRef('service_assignment.tenant_id', '=', 'slot.tenant_id')
            .onRef(
              'service_assignment.organization_id',
              '=',
              'slot.organization_id',
            )
            .onRef('service_assignment.facility_id', '=', 'slot.facility_id')
            .onRef(
              'service_assignment.practitioner_facility_assignment_id',
              '=',
              'slot.practitioner_facility_assignment_id',
            )
            .onRef(
              'service_assignment.practitioner_id',
              '=',
              'slot.practitioner_id',
            )
            .onRef(
              'service_assignment.appointment_service_id',
              '=',
              'slot.appointment_service_id',
            ),
      )
      .select([
        'slot.id',
        'slot.starts_at',
        'slot.ends_at',
        'slot.facility_id',
        'slot.practitioner_facility_assignment_id',
        'slot.practitioner_service_assignment_id',
        'slot.practitioner_id',
        'slot.appointment_service_id',
      ])
      .where('slot.id', '=', slotId)
      .where('slot.bookable_practice_id', '=', practice.bookablePracticeId)
      .where('slot.tenant_id', '=', practice.tenantId)
      .where('slot.organization_id', '=', practice.organizationId)
      .where('slot.status', '=', 'available')
      .where('slot.withdrawal_pending', '=', false)
      .where('slot.is_synthetic', '=', true)
      .where('slot.starts_at', '>', now)
      .where('facility.is_synthetic', '=', true)
      .where('facility_assignment.status', '=', 'active')
      .where('facility_assignment.is_synthetic', '=', true)
      .where('practitioner.status', '=', 'active')
      .where('practitioner.is_synthetic', '=', true)
      .where('specialty.status', '=', 'active')
      .where('specialty.is_synthetic', '=', true)
      .where('service.status', '=', 'active')
      .where('service.is_synthetic', '=', true)
      .where('service_assignment.status', '=', 'active')
      .where('service_assignment.is_synthetic', '=', true)
      .where(
        sql<boolean>`not exists (
        select 1
        from patient_portal_appointments appointment
        where appointment.appointment_slot_id = slot.id
          and appointment.status in ('requested', 'confirmed')
      )`,
      )
      // Serialize commands for the same slot while allowing different slots
      // to share the stable provider chain. Catalogue deactivation still needs
      // an exclusive row lock and therefore waits for these shared locks.
      .forUpdate('slot')
      .forShare([
        'facility',
        'facility_assignment',
        'practitioner',
        'service',
        'specialty',
        'service_assignment',
      ])
      .executeTakeFirst();

    if (
      !slot?.facility_id ||
      !slot.practitioner_facility_assignment_id ||
      !slot.practitioner_service_assignment_id ||
      !slot.practitioner_id ||
      !slot.appointment_service_id
    ) {
      return null;
    }

    return {
      id: slot.id,
      starts_at: slot.starts_at,
      ends_at: slot.ends_at,
      facility_id: slot.facility_id,
      practitioner_facility_assignment_id:
        slot.practitioner_facility_assignment_id,
      practitioner_service_assignment_id:
        slot.practitioner_service_assignment_id,
      practitioner_id: slot.practitioner_id,
      appointment_service_id: slot.appointment_service_id,
    };
  }

  private async findScopedAppointmentForUpdate(
    database: Transaction<DatabaseSchema>,
    patientPortalIdentityId: string,
    context: PatientAppointmentContext,
    practice: BookablePractice,
    appointmentId: string,
  ): Promise<AppointmentRecord | null> {
    const query = database
      .selectFrom('patient_portal_appointments as appointment')
      .innerJoin(
        'patient_portal_appointment_slots as slot',
        'slot.id',
        'appointment.appointment_slot_id',
      )
      .select([
        'appointment.id',
        'appointment.status',
        'appointment.version',
        'slot.id as slot_id',
        'slot.starts_at',
        'slot.ends_at',
      ])
      .where('appointment.id', '=', appointmentId)
      .where('appointment.tenant_id', '=', practice.tenantId)
      .where('appointment.organization_id', '=', practice.organizationId)
      .where(
        'appointment.patient_portal_identity_id',
        '=',
        patientPortalIdentityId,
      )
      .where('slot.bookable_practice_id', '=', practice.bookablePracticeId)
      .where('slot.is_synthetic', '=', true);
    const scopedQuery =
      context.kind === 'practice'
        ? query.where(
            'appointment.patient_portal_profile_id',
            '=',
            context.portalProfileId,
          )
        : query.where(
            'appointment.patient_portal_appointment_relationship_id',
            '=',
            context.appointmentRelationshipId,
          );
    const appointment = await scopedQuery.forUpdate().executeTakeFirst();

    return appointment
      ? {
          id: appointment.id,
          status: appointment.status,
          version: appointment.version,
          startsAt: appointment.starts_at,
          endsAt: appointment.ends_at,
          slotId: appointment.slot_id,
        }
      : null;
  }

  private async relationshipResponse(
    database: DatabaseExecutor,
    patientPortalIdentityId: string,
    relationshipId: string,
  ): Promise<{ appointmentRelationshipId: string; practiceName: string }> {
    const relationship = await database
      .selectFrom('patient_portal_appointment_relationships as relationship')
      .innerJoin('tenants as tenant', 'tenant.id', 'relationship.tenant_id')
      .innerJoin('organizations as organization', (join) =>
        join
          .onRef('organization.id', '=', 'relationship.organization_id')
          .onRef('organization.tenant_id', '=', 'relationship.tenant_id'),
      )
      .select(['relationship.id', 'organization.name as practice_name'])
      .where('relationship.id', '=', relationshipId)
      .where(
        'relationship.patient_portal_identity_id',
        '=',
        patientPortalIdentityId,
      )
      .where('relationship.status', '=', 'pending')
      .where('tenant.status', '=', 'active')
      .executeTakeFirst();

    if (!relationship) {
      throw new NotFoundException(
        'The appointment relationship is unavailable.',
      );
    }

    return {
      appointmentRelationshipId: relationship.id,
      practiceName: relationship.practice_name,
    };
  }

  private async resolveConcurrentRelationshipCommand(
    session: PatientPortalSessionContext,
    idempotencyKeyHash: string,
    requestHash: string,
  ): Promise<{ appointmentRelationshipId: string; practiceName: string }> {
    const response = await this.replayRelationshipCommand(
      session,
      idempotencyKeyHash,
      requestHash,
    );

    if (!response) {
      throw new ServiceUnavailableException(
        'The appointment relationship is temporarily unavailable.',
      );
    }
    return response;
  }

  private async recordDeniedAppointmentAccess(
    database: Transaction<DatabaseSchema>,
    session: PatientPortalSessionContext,
    practice: BookablePractice,
    appointmentId: string,
    action: string,
  ): Promise<void> {
    await this.insertAudit(database, {
      session,
      tenantId: practice.tenantId,
      organizationId: practice.organizationId,
      action,
      targetEntityType: 'patient_portal_appointment',
      targetEntityId: appointmentId,
      outcome: 'denied',
      reason:
        'The requested appointment is not available in the current patient context.',
      beforeData: null,
      afterData: { classification: 'unavailable_or_outside_current_context' },
    });
  }

  private async insertAudit(
    database: Transaction<DatabaseSchema>,
    input: {
      session: PatientPortalSessionContext;
      tenantId: string;
      organizationId: string;
      action: string;
      targetEntityType: string;
      targetEntityId: string;
      outcome: 'success' | 'denied';
      reason: string;
      beforeData: Record<string, unknown> | null;
      afterData: Record<string, unknown> | null;
    },
  ): Promise<void> {
    await database
      .insertInto('audit_events')
      .values({
        actor_type: 'user',
        actor_identifier: input.session.principal.subject,
        actor_user_id: input.session.applicationUserId,
        effective_user_id: input.session.applicationUserId,
        tenant_id: input.tenantId,
        organization_id: input.organizationId,
        facility_id: null,
        action: input.action,
        target_entity_type: input.targetEntityType,
        target_entity_id: input.targetEntityId,
        outcome: input.outcome,
        correlation_id: randomUUID(),
        reason: input.reason,
        before_data: input.beforeData,
        after_data: input.afterData,
      })
      .execute();
  }

  private toAppointmentView(
    appointment: AppointmentRecord,
    now: Date,
  ): PatientAppointmentView {
    const canChange =
      appointment.status === 'requested' && appointment.startsAt > now;

    return {
      appointmentId: appointment.id,
      status: appointment.status,
      startsAt: appointment.startsAt.toISOString(),
      endsAt: appointment.endsAt.toISOString(),
      version: appointment.version,
      canCancel: canChange,
      canReschedule: canChange,
    };
  }
}
