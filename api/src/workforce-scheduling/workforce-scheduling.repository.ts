import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import type {
  AuthorizationRequest,
  AuthorizedAccess,
} from '../authorization/authorization.types.js';
import { DatabaseService } from '../database/database.service.js';
import type {
  DatabaseSchema,
  WorkforceSchedulingCommandOperation,
} from '../database/database.types.js';
import { WORKFORCE_IDENTITY_PROVIDER } from '../identity-provider/identity-provider.constants.js';
import type { WorkforceIdentityProviderPort } from '../identity-provider/identity-provider.types.js';
import { workforceSchedulingAuditReason } from './workforce-scheduling-reasons.js';
import {
  materializeProviderAvailability,
  planProviderAvailabilityReconciliation,
  type ProviderAvailabilityExceptionInterval,
  type ProviderAvailabilityStoredSlot,
  type ProviderAvailabilityTemplateDefinition,
} from './provider-availability-materializer.js';
import {
  AvailabilityMaterializationError,
  captureAvailabilityHorizon,
  parseCanonicalLocalDate,
  parseCanonicalLocalDateTime,
  resolveCanonicalLocalException,
  resolveLocalMinuteBoundary,
} from './provider-availability-time.js';
import type {
  AppointmentServiceDurationMutationResponse,
  AppointmentServiceMutationResponse,
  AvailabilityExceptionMutationResponse,
  AvailabilityMaterializationSummary,
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
  ReplaceAvailabilityTemplateInput,
  SchedulingMutationRequest,
  SpecialtyMutationResponse,
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
  WorkforceSchedulingContext,
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

type DatabaseExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

interface PracticeContext {
  tenantId: string;
  tenantName: string;
  organizationId: string;
  organizationName: string;
}

interface FacilityContext {
  facilityId: string;
  facilityName: string;
  timezone: string;
}

interface AuthorizedPracticeScope {
  practice: PracticeContext;
  organizationAccess: AuthorizedAccess | null;
  facilities: FacilityContext[];
}

interface StoredSchedulingCommand {
  tenantId: string;
  organizationId: string;
  requestHash: string;
  responseData: Record<string, unknown>;
}

interface MutationMetadata {
  correlationId: string;
  frozenNow: Date;
  idempotencyKeyHash: string;
  requestHash: string;
  operation: WorkforceSchedulingCommandOperation;
}

interface AffectedAppointments {
  count: number;
  ids: string[];
}

interface AvailabilityAssignmentScope {
  bookablePracticeId: string;
  facility: FacilityContext;
  practitionerFacilityAssignmentId: string;
  practitionerServiceAssignmentId: string;
  practitionerId: string;
  appointmentServiceId: string;
  durationMinutes: number;
  practitionerStatus: 'active' | 'inactive';
  facilityAssignmentStatus: 'active' | 'inactive';
  serviceAssignmentStatus: 'active' | 'inactive';
  serviceStatus: 'active' | 'inactive';
  specialtyStatus: 'active' | 'retired';
}

interface AvailabilityTemplateRow extends ProviderAvailabilityTemplateDefinition {
  updatedAt: Date;
}

interface AvailabilityExceptionRow extends ProviderAvailabilityExceptionInterval {
  localStartsAt: string;
  localEndsAt: string;
  isAllDay: boolean;
  updatedAt: Date;
}

interface AvailabilityTemplateTarget {
  id: string;
  facilityId: string;
  practitionerServiceAssignmentId: string;
  practitionerId: string;
  status: 'active' | 'inactive';
  updatedAt: Date;
}

interface AvailabilityExceptionTarget {
  id: string;
  facilityId: string;
  practitionerFacilityAssignmentId: string | null;
  practitionerId: string | null;
  kind: 'facility_closed' | 'practitioner_unavailable';
  status: 'active' | 'cancelled';
  updatedAt: Date;
}

interface AvailabilityServiceTarget {
  id: string;
  facility: FacilityContext;
  durationMinutes: number;
  status: 'active' | 'inactive';
  specialtyStatus: 'active' | 'retired';
  updatedAt: Date;
}

interface AvailabilityReconciliationResult {
  summary: AvailabilityMaterializationSummary;
}

class SchedulingAuthorizationDeniedError extends Error {
  constructor(readonly request: AuthorizationRequest) {
    super('Scheduling catalogue authorization was denied.');
  }
}

class SchedulingScopedTargetDeniedError extends Error {
  constructor(readonly request: AuthorizationRequest) {
    super('Scheduling catalogue target was unavailable in the exact scope.');
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object' || value === null) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function databaseErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function isRetryableTransactionError(error: unknown): boolean {
  const code = databaseErrorCode(error);
  return code === '40001' || code === '40P01';
}

function isConstraintConflict(error: unknown): boolean {
  const code = databaseErrorCode(error);
  return (
    code === '23503' || code === '23505' || code === '23514' || code === '23P01'
  );
}

function isUniqueViolation(error: unknown): boolean {
  return databaseErrorCode(error) === '23505';
}

function asCount(value: string | number | bigint | undefined): number {
  if (value === undefined) return 0;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matchesExpectedTimestamp(actual: Date, expected: string): boolean {
  const expectedTime = new Date(expected).getTime();
  return Number.isFinite(expectedTime) && actual.getTime() === expectedTime;
}

@Injectable()
export class WorkforceSchedulingRepository {
  private readonly providerIssuer: string;

  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    @Inject(WORKFORCE_IDENTITY_PROVIDER)
    identityProvider: WorkforceIdentityProviderPort,
  ) {
    this.providerIssuer = identityProvider.issuer;
  }

  async listContexts(
    principal: AuthenticatedPrincipal,
  ): Promise<WorkforceSchedulingContext[]> {
    try {
      const candidates = await sql<{
        tenant_id: string;
        tenant_name: string;
        organization_id: string;
        organization_name: string;
      }>`
        select distinct
          tenant.id as tenant_id,
          tenant.name as tenant_name,
          organization.id as organization_id,
          organization.name as organization_name
        from user_identities identity
        join identity_connections connection
          on connection.id = identity.identity_connection_id
        join application_users actor
          on actor.id = identity.application_user_id
        join organization_memberships membership
          on membership.application_user_id = actor.id
        join tenants tenant
          on tenant.id = membership.tenant_id
         and tenant.id = connection.tenant_id
        join organizations organization
          on organization.id = membership.organization_id
         and organization.tenant_id = tenant.id
        where identity.subject = ${principal.subject}
          and identity.status = 'active'
          and connection.issuer = ${this.providerIssuer}
          and connection.status = 'active'
          and actor.status = 'active'
          and membership.status = 'active'
          and membership.valid_from <= now()
          and (membership.valid_until is null or membership.valid_until > now())
          and tenant.status = 'active'
          and tenant.is_synthetic = true
          and organization.kind = 'practice'
          and organization.is_synthetic = true
        order by tenant.name, organization.name, organization.id
      `.execute(this.database.client);

      const contexts: WorkforceSchedulingContext[] = [];
      for (const candidate of candidates.rows) {
        const practice: PracticeContext = {
          tenantId: candidate.tenant_id,
          tenantName: candidate.tenant_name,
          organizationId: candidate.organization_id,
          organizationName: candidate.organization_name,
        };
        const scope = await this.authorizedPracticeScope(
          principal,
          practice,
          'scheduling.catalogue_contexts.read',
          false,
        );
        if (!scope.organizationAccess && scope.facilities.length === 0)
          continue;

        contexts.push({
          ...practice,
          canManagePracticeCatalogue: scope.organizationAccess !== null,
          facilities: scope.facilities,
        });
      }

      return contexts;
    } catch (error) {
      if (
        error instanceof WorkforceSchedulingAuthorizationLostError ||
        error instanceof WorkforceSchedulingTargetUnavailableError
      ) {
        throw error;
      }
      throw new WorkforceSchedulingPersistenceError();
    }
  }

  async listPractitioners(
    principal: AuthenticatedPrincipal,
    query: WorkforceSchedulingListQuery,
  ): Promise<WorkforceSchedulingPage<WorkforcePractitionerView>> {
    try {
      const practice = await this.requirePractice(
        this.database.client,
        query.organizationId,
      );
      const scope = await this.authorizedPracticeScope(
        principal,
        practice,
        'scheduling.practitioners.read',
        true,
      );
      const facilityIds = scope.facilities.map(
        (facility) => facility.facilityId,
      );
      if (facilityIds.length === 0 || query.status === 'retired') {
        return this.emptyPage(query);
      }

      let base = this.database.client
        .selectFrom('practitioners as practitioner')
        .where('practitioner.tenant_id', '=', practice.tenantId)
        .where('practitioner.is_synthetic', '=', true)
        .where((expression) =>
          expression.exists(
            expression
              .selectFrom(
                'practitioner_facility_assignments as local_assignment',
              )
              .select(sql`1`.as('one'))
              .whereRef(
                'local_assignment.practitioner_id',
                '=',
                'practitioner.id',
              )
              .where('local_assignment.tenant_id', '=', practice.tenantId)
              .where(
                'local_assignment.organization_id',
                '=',
                practice.organizationId,
              )
              .where('local_assignment.facility_id', 'in', facilityIds)
              .where('local_assignment.is_synthetic', '=', true),
          ),
        );
      if (query.status === 'active' || query.status === 'inactive') {
        base = base.where('practitioner.status', '=', query.status);
      }
      if (query.search) {
        const pattern = `%${query.search}%`;
        base = base.where((expression) =>
          expression.or([
            expression('practitioner.display_name', 'ilike', pattern),
            expression('practitioner.professional_title', 'ilike', pattern),
          ]),
        );
      }

      const [countRow, practitioners] = await Promise.all([
        base
          .select((expression) =>
            expression.fn.countAll<string>().as('total_count'),
          )
          .executeTakeFirst(),
        base
          .select([
            'practitioner.id',
            'practitioner.display_name',
            'practitioner.professional_title',
            'practitioner.status',
            'practitioner.application_user_id',
            'practitioner.updated_at',
          ])
          .orderBy('practitioner.display_name', 'asc')
          .orderBy('practitioner.id', 'asc')
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize)
          .execute(),
      ]);
      const practitionerIds = practitioners.map(
        (practitioner) => practitioner.id,
      );
      if (practitionerIds.length === 0) {
        return {
          page: query.page,
          pageSize: query.pageSize,
          total: asCount(countRow?.total_count),
          items: [],
        };
      }

      const [facilityAssignments, serviceAssignments] = await Promise.all([
        this.database.client
          .selectFrom('practitioner_facility_assignments as assignment')
          .innerJoin('facilities as facility', (join) =>
            join
              .onRef('facility.id', '=', 'assignment.facility_id')
              .onRef('facility.tenant_id', '=', 'assignment.tenant_id')
              .onRef(
                'facility.organization_id',
                '=',
                'assignment.organization_id',
              ),
          )
          .select([
            'assignment.id',
            'assignment.practitioner_id',
            'assignment.facility_id',
            'facility.name as facility_name',
            'assignment.status',
            'assignment.updated_at',
          ])
          .where('assignment.tenant_id', '=', practice.tenantId)
          .where('assignment.organization_id', '=', practice.organizationId)
          .where('assignment.facility_id', 'in', facilityIds)
          .where('assignment.practitioner_id', 'in', practitionerIds)
          .where('assignment.is_synthetic', '=', true)
          .where('facility.is_synthetic', '=', true)
          .orderBy('facility.name', 'asc')
          .orderBy('assignment.id', 'asc')
          .execute(),
        this.database.client
          .selectFrom('practitioner_service_assignments as assignment')
          .innerJoin('appointment_services as service', (join) =>
            join
              .onRef('service.id', '=', 'assignment.appointment_service_id')
              .onRef('service.tenant_id', '=', 'assignment.tenant_id')
              .onRef(
                'service.organization_id',
                '=',
                'assignment.organization_id',
              )
              .onRef('service.facility_id', '=', 'assignment.facility_id'),
          )
          .select([
            'assignment.id',
            'assignment.practitioner_id',
            'assignment.practitioner_facility_assignment_id',
            'assignment.appointment_service_id',
            'service.patient_facing_name as service_name',
            'assignment.facility_id',
            'assignment.status',
            'assignment.updated_at',
          ])
          .where('assignment.tenant_id', '=', practice.tenantId)
          .where('assignment.organization_id', '=', practice.organizationId)
          .where('assignment.facility_id', 'in', facilityIds)
          .where('assignment.practitioner_id', 'in', practitionerIds)
          .where('assignment.is_synthetic', '=', true)
          .where('service.is_synthetic', '=', true)
          .orderBy('service.patient_facing_name', 'asc')
          .orderBy('assignment.id', 'asc')
          .execute(),
      ]);

      return {
        page: query.page,
        pageSize: query.pageSize,
        total: asCount(countRow?.total_count),
        items: practitioners.map((practitioner) => ({
          practitionerId: practitioner.id,
          displayName: practitioner.display_name,
          professionalTitle: practitioner.professional_title,
          status: practitioner.status,
          applicationUserLinked: practitioner.application_user_id !== null,
          updatedAt: practitioner.updated_at.toISOString(),
          facilityAssignments: facilityAssignments
            .filter(
              (assignment) => assignment.practitioner_id === practitioner.id,
            )
            .map((assignment) => ({
              assignmentId: assignment.id,
              facilityId: assignment.facility_id,
              facilityName: assignment.facility_name,
              status: assignment.status,
              updatedAt: assignment.updated_at.toISOString(),
            })),
          serviceAssignments: serviceAssignments
            .filter(
              (assignment) => assignment.practitioner_id === practitioner.id,
            )
            .map((assignment) => ({
              assignmentId: assignment.id,
              practitionerFacilityAssignmentId:
                assignment.practitioner_facility_assignment_id,
              appointmentServiceId: assignment.appointment_service_id,
              serviceName: assignment.service_name,
              facilityId: assignment.facility_id,
              status: assignment.status,
              updatedAt: assignment.updated_at.toISOString(),
            })),
        })),
      };
    } catch (error) {
      return this.mapReadFailure(error);
    }
  }

  async listSpecialties(
    principal: AuthenticatedPrincipal,
    query: WorkforceSchedulingListQuery,
  ): Promise<WorkforceSchedulingPage<WorkforceSpecialtyView>> {
    try {
      const practice = await this.requirePractice(
        this.database.client,
        query.organizationId,
      );
      await this.authorizedPracticeScope(
        principal,
        practice,
        'scheduling.specialties.read',
        true,
      );
      if (query.status === 'inactive') return this.emptyPage(query);

      let base = this.database.client
        .selectFrom('specialties as specialty')
        .where('specialty.tenant_id', '=', practice.tenantId)
        .where('specialty.organization_id', '=', practice.organizationId)
        .where('specialty.is_synthetic', '=', true);
      if (query.status === 'active' || query.status === 'retired') {
        base = base.where('specialty.status', '=', query.status);
      }
      if (query.search) {
        const pattern = `%${query.search}%`;
        base = base.where((expression) =>
          expression.or([
            expression('specialty.code', 'ilike', pattern),
            expression('specialty.name', 'ilike', pattern),
          ]),
        );
      }

      const [countRow, specialties] = await Promise.all([
        base
          .select((expression) =>
            expression.fn.countAll<string>().as('total_count'),
          )
          .executeTakeFirst(),
        base
          .select([
            'specialty.id',
            'specialty.code',
            'specialty.name',
            'specialty.status',
            'specialty.updated_at',
          ])
          .orderBy('specialty.name', 'asc')
          .orderBy('specialty.id', 'asc')
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize)
          .execute(),
      ]);

      return {
        page: query.page,
        pageSize: query.pageSize,
        total: asCount(countRow?.total_count),
        items: specialties.map((specialty) => ({
          specialtyId: specialty.id,
          code: specialty.code,
          name: specialty.name,
          status: specialty.status,
          updatedAt: specialty.updated_at.toISOString(),
        })),
      };
    } catch (error) {
      return this.mapReadFailure(error);
    }
  }

  async listServices(
    principal: AuthenticatedPrincipal,
    query: WorkforceSchedulingListQuery,
  ): Promise<WorkforceSchedulingPage<WorkforceAppointmentServiceView>> {
    try {
      const practice = await this.requirePractice(
        this.database.client,
        query.organizationId,
      );
      const scope = await this.authorizedPracticeScope(
        principal,
        practice,
        'scheduling.services.read',
        true,
      );
      const facilityIds = scope.facilities.map(
        (facility) => facility.facilityId,
      );
      if (facilityIds.length === 0 || query.status === 'retired') {
        return this.emptyPage(query);
      }

      let base = this.database.client
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
        .where('service.facility_id', 'in', facilityIds)
        .where('service.is_synthetic', '=', true)
        .where('facility.is_synthetic', '=', true)
        .where('specialty.is_synthetic', '=', true);
      if (query.status === 'active' || query.status === 'inactive') {
        base = base.where('service.status', '=', query.status);
      }
      if (query.search) {
        const pattern = `%${query.search}%`;
        base = base.where((expression) =>
          expression.or([
            expression('service.code', 'ilike', pattern),
            expression('service.patient_facing_name', 'ilike', pattern),
            expression('specialty.name', 'ilike', pattern),
            expression('facility.name', 'ilike', pattern),
          ]),
        );
      }

      const [countRow, services] = await Promise.all([
        base
          .select((expression) =>
            expression.fn.countAll<string>().as('total_count'),
          )
          .executeTakeFirst(),
        base
          .select([
            'service.id',
            'service.facility_id',
            'facility.name as facility_name',
            'service.specialty_id',
            'specialty.name as specialty_name',
            'specialty.status as specialty_status',
            'service.code',
            'service.patient_facing_name',
            'service.duration_minutes',
            'service.allows_any_practitioner',
            'service.status',
            'service.updated_at',
          ])
          .orderBy('service.patient_facing_name', 'asc')
          .orderBy('service.id', 'asc')
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize)
          .execute(),
      ]);
      const serviceIds = services.map((service) => service.id);
      const assignments =
        serviceIds.length === 0
          ? []
          : await this.database.client
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
              .innerJoin('appointment_services as service', (join) =>
                join
                  .onRef(
                    'service.id',
                    '=',
                    'service_assignment.appointment_service_id',
                  )
                  .onRef(
                    'service.tenant_id',
                    '=',
                    'service_assignment.tenant_id',
                  )
                  .onRef(
                    'service.organization_id',
                    '=',
                    'service_assignment.organization_id',
                  )
                  .onRef(
                    'service.facility_id',
                    '=',
                    'service_assignment.facility_id',
                  ),
              )
              .select([
                'service_assignment.id',
                'service_assignment.appointment_service_id',
                'service_assignment.practitioner_facility_assignment_id',
                'service_assignment.practitioner_id',
                'service.patient_facing_name as service_name',
                'service_assignment.facility_id',
                'service_assignment.status',
                'service_assignment.updated_at',
                'facility_assignment.status as facility_assignment_status',
                'facility_assignment.is_synthetic as facility_assignment_synthetic',
                'practitioner.status as practitioner_status',
                'practitioner.is_synthetic as practitioner_synthetic',
              ])
              .where(
                'service_assignment.appointment_service_id',
                'in',
                serviceIds,
              )
              .where('service_assignment.tenant_id', '=', practice.tenantId)
              .where(
                'service_assignment.organization_id',
                '=',
                practice.organizationId,
              )
              .where('service_assignment.is_synthetic', '=', true)
              .where('facility_assignment.is_synthetic', '=', true)
              .where('practitioner.is_synthetic', '=', true)
              .where('service.is_synthetic', '=', true)
              .orderBy('service_assignment.id', 'asc')
              .execute();

      return {
        page: query.page,
        pageSize: query.pageSize,
        total: asCount(countRow?.total_count),
        items: services.map((service) => {
          const serviceAssignments = assignments.filter(
            (assignment) => assignment.appointment_service_id === service.id,
          );
          const activePractitioners = new Set(
            serviceAssignments
              .filter(
                (assignment) =>
                  assignment.status === 'active' &&
                  assignment.facility_assignment_status === 'active' &&
                  assignment.facility_assignment_synthetic &&
                  assignment.practitioner_status === 'active' &&
                  assignment.practitioner_synthetic,
              )
              .map((assignment) => assignment.practitioner_id),
          );
          return {
            appointmentServiceId: service.id,
            facilityId: service.facility_id,
            facilityName: service.facility_name,
            specialtyId: service.specialty_id,
            specialtyName: service.specialty_name,
            code: service.code,
            patientFacingName: service.patient_facing_name,
            durationMinutes: service.duration_minutes,
            allowsAnyPractitioner: service.allows_any_practitioner,
            status: service.status,
            publishable:
              service.status === 'active' &&
              service.specialty_status === 'active' &&
              activePractitioners.size > 0,
            activePractitionerCount: activePractitioners.size,
            updatedAt: service.updated_at.toISOString(),
            practitionerAssignments: serviceAssignments.map((assignment) => ({
              assignmentId: assignment.id,
              practitionerFacilityAssignmentId:
                assignment.practitioner_facility_assignment_id,
              appointmentServiceId: assignment.appointment_service_id,
              serviceName: assignment.service_name,
              facilityId: assignment.facility_id,
              status: assignment.status,
              updatedAt: assignment.updated_at.toISOString(),
            })),
          };
        }),
      };
    } catch (error) {
      return this.mapReadFailure(error);
    }
  }

  async listAvailabilityTemplates(
    principal: AuthenticatedPrincipal,
    query: WorkforceAvailabilityTemplateListQuery,
  ): Promise<WorkforceSchedulingPage<WorkforceAvailabilityTemplateView>> {
    try {
      const practice = await this.requirePractice(
        this.database.client,
        query.organizationId,
      );
      const scope = await this.authorizedPracticeScope(
        principal,
        practice,
        'scheduling.availability_templates.read',
        true,
      );
      const facilityIds = scope.facilities.map(({ facilityId }) => facilityId);
      if (
        facilityIds.length === 0 ||
        (query.facilityId !== undefined &&
          !facilityIds.includes(query.facilityId))
      ) {
        return this.emptyPage(query);
      }

      let base = this.database.client
        .selectFrom('practitioner_availability_templates as template')
        .innerJoin('facilities as facility', (join) =>
          join
            .onRef('facility.id', '=', 'template.facility_id')
            .onRef('facility.tenant_id', '=', 'template.tenant_id')
            .onRef('facility.organization_id', '=', 'template.organization_id'),
        )
        .innerJoin('practitioners as practitioner', (join) =>
          join
            .onRef('practitioner.id', '=', 'template.practitioner_id')
            .onRef('practitioner.tenant_id', '=', 'template.tenant_id'),
        )
        .innerJoin('appointment_services as service', (join) =>
          join
            .onRef('service.id', '=', 'template.appointment_service_id')
            .onRef('service.tenant_id', '=', 'template.tenant_id')
            .onRef('service.organization_id', '=', 'template.organization_id')
            .onRef('service.facility_id', '=', 'template.facility_id'),
        )
        .where('template.tenant_id', '=', practice.tenantId)
        .where('template.organization_id', '=', practice.organizationId)
        .where('template.facility_id', 'in', facilityIds)
        .where('template.is_synthetic', '=', true)
        .where('facility.is_synthetic', '=', true)
        .where('practitioner.is_synthetic', '=', true)
        .where('service.is_synthetic', '=', true);
      if (query.facilityId) {
        base = base.where('template.facility_id', '=', query.facilityId);
      }
      if (query.practitionerFacilityAssignmentId) {
        base = base.where(
          'template.practitioner_facility_assignment_id',
          '=',
          query.practitionerFacilityAssignmentId,
        );
      }
      if (query.practitionerServiceAssignmentId) {
        base = base.where(
          'template.practitioner_service_assignment_id',
          '=',
          query.practitionerServiceAssignmentId,
        );
      }
      if (query.appointmentServiceId) {
        base = base.where(
          'template.appointment_service_id',
          '=',
          query.appointmentServiceId,
        );
      }
      if (query.status) {
        base = base.where('template.status', '=', query.status);
      }

      const [countRow, templates] = await Promise.all([
        base
          .select((expression) =>
            expression.fn.countAll<string>().as('total_count'),
          )
          .executeTakeFirst(),
        base
          .select([
            'template.id',
            'template.facility_id',
            'facility.name as facility_name',
            'template.practitioner_facility_assignment_id',
            'template.practitioner_service_assignment_id',
            'template.practitioner_id',
            'practitioner.display_name as practitioner_display_name',
            'template.appointment_service_id',
            'service.patient_facing_name as service_name',
            'service.duration_minutes',
            'template.iso_weekday',
            'template.local_start_minute',
            'template.local_end_minute',
            'template.effective_from',
            'template.effective_until',
            'template.source_timezone',
            'template.status',
            'template.updated_at',
          ])
          .orderBy('facility.name', 'asc')
          .orderBy('practitioner.display_name', 'asc')
          .orderBy('template.iso_weekday', 'asc')
          .orderBy('template.local_start_minute', 'asc')
          .orderBy('template.id', 'asc')
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize)
          .execute(),
      ]);

      return {
        page: query.page,
        pageSize: query.pageSize,
        total: asCount(countRow?.total_count),
        items: templates.map((template) =>
          this.mapAvailabilityTemplateView(template),
        ),
      };
    } catch (error) {
      return this.mapReadFailure(error);
    }
  }

  async listAvailabilityExceptions(
    principal: AuthenticatedPrincipal,
    query: WorkforceAvailabilityExceptionListQuery,
  ): Promise<WorkforceSchedulingPage<WorkforceAvailabilityExceptionView>> {
    try {
      const practice = await this.requirePractice(
        this.database.client,
        query.organizationId,
      );
      const scope = await this.authorizedPracticeScope(
        principal,
        practice,
        'scheduling.availability_exceptions.read',
        true,
      );
      const facilityIds = scope.facilities.map(({ facilityId }) => facilityId);
      if (
        facilityIds.length === 0 ||
        (query.facilityId !== undefined &&
          !facilityIds.includes(query.facilityId))
      ) {
        return this.emptyPage(query);
      }

      let base = this.database.client
        .selectFrom('provider_availability_exceptions as exception')
        .innerJoin('facilities as facility', (join) =>
          join
            .onRef('facility.id', '=', 'exception.facility_id')
            .onRef('facility.tenant_id', '=', 'exception.tenant_id')
            .onRef(
              'facility.organization_id',
              '=',
              'exception.organization_id',
            ),
        )
        .leftJoin(
          'practitioner_facility_assignments as facility_assignment',
          (join) =>
            join
              .onRef(
                'facility_assignment.id',
                '=',
                'exception.practitioner_facility_assignment_id',
              )
              .onRef(
                'facility_assignment.tenant_id',
                '=',
                'exception.tenant_id',
              )
              .onRef(
                'facility_assignment.organization_id',
                '=',
                'exception.organization_id',
              )
              .onRef(
                'facility_assignment.facility_id',
                '=',
                'exception.facility_id',
              ),
        )
        .leftJoin('practitioners as practitioner', (join) =>
          join
            .onRef('practitioner.id', '=', 'exception.practitioner_id')
            .onRef('practitioner.tenant_id', '=', 'exception.tenant_id'),
        )
        .where('exception.tenant_id', '=', practice.tenantId)
        .where('exception.organization_id', '=', practice.organizationId)
        .where('exception.facility_id', 'in', facilityIds)
        .where('exception.is_synthetic', '=', true)
        .where('facility.is_synthetic', '=', true);
      if (query.facilityId) {
        base = base.where('exception.facility_id', '=', query.facilityId);
      }
      if (query.practitionerFacilityAssignmentId) {
        base = base.where(
          'exception.practitioner_facility_assignment_id',
          '=',
          query.practitionerFacilityAssignmentId,
        );
      }
      if (query.kind) base = base.where('exception.kind', '=', query.kind);
      if (query.status)
        base = base.where('exception.status', '=', query.status);
      if (query.startsBefore) {
        base = base.where(
          'exception.starts_at',
          '<',
          new Date(query.startsBefore),
        );
      }
      if (query.endsAfter) {
        base = base.where('exception.ends_at', '>', new Date(query.endsAfter));
      }

      const [countRow, exceptions] = await Promise.all([
        base
          .select((expression) =>
            expression.fn.countAll<string>().as('total_count'),
          )
          .executeTakeFirst(),
        base
          .select([
            'exception.id',
            'exception.facility_id',
            'facility.name as facility_name',
            'exception.practitioner_facility_assignment_id',
            'exception.practitioner_id',
            'practitioner.display_name as practitioner_display_name',
            'exception.kind',
            'exception.is_all_day',
            'exception.local_starts_at',
            'exception.local_ends_at',
            'exception.starts_at',
            'exception.ends_at',
            'exception.source_timezone',
            'exception.status',
            'exception.updated_at',
          ])
          .orderBy('exception.starts_at', 'desc')
          .orderBy('exception.id', 'asc')
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize)
          .execute(),
      ]);

      return {
        page: query.page,
        pageSize: query.pageSize,
        total: asCount(countRow?.total_count),
        items: exceptions.map((exception) =>
          this.mapAvailabilityExceptionView(exception),
        ),
      };
    } catch (error) {
      return this.mapReadFailure(error);
    }
  }

  async listAvailabilitySlots(
    principal: AuthenticatedPrincipal,
    query: WorkforceAvailabilitySlotListQuery,
  ): Promise<WorkforceSchedulingPage<WorkforceAvailabilitySlotView>> {
    try {
      const practice = await this.requirePractice(
        this.database.client,
        query.organizationId,
      );
      const facility = await this.requireFacility(
        this.database.client,
        practice,
        query.facilityId,
      );
      const scope = await this.authorizedPracticeScope(
        principal,
        practice,
        'scheduling.availability_slots.read',
        true,
      );
      if (
        !scope.facilities.some(
          ({ facilityId }) => facilityId === facility.facilityId,
        )
      ) {
        return this.emptyPage(query);
      }
      const startsAt = new Date(query.startsAt);
      const endsAt = new Date(query.endsAt);
      const horizon = captureAvailabilityHorizon(startsAt, facility.timezone);
      const maximumEnd = resolveLocalMinuteBoundary(
        horizon.localEndDateExclusive,
        0,
        facility.timezone,
      ).instant;
      if (
        !Number.isFinite(startsAt.getTime()) ||
        !Number.isFinite(endsAt.getTime()) ||
        startsAt >= endsAt ||
        endsAt > maximumEnd
      ) {
        throw new WorkforceSchedulingValidationError(
          'The slot range must be an increasing interval of at most 56 facility-local days.',
        );
      }

      let base = this.database.client
        .selectFrom('patient_portal_appointment_slots as slot')
        .where('slot.tenant_id', '=', practice.tenantId)
        .where('slot.organization_id', '=', practice.organizationId)
        .where('slot.facility_id', '=', facility.facilityId)
        .where('slot.starts_at', '>=', startsAt)
        .where('slot.starts_at', '<', endsAt)
        .where('slot.is_synthetic', '=', true)
        .where('slot.practitioner_service_assignment_id', 'is not', null);
      if (query.appointmentServiceId) {
        base = base.where(
          'slot.appointment_service_id',
          '=',
          query.appointmentServiceId,
        );
      }
      if (query.practitionerId) {
        base = base.where('slot.practitioner_id', '=', query.practitionerId);
      }
      if (query.status) base = base.where('slot.status', '=', query.status);

      const [countRow, slots] = await Promise.all([
        base
          .select((expression) =>
            expression.fn.countAll<string>().as('total_count'),
          )
          .executeTakeFirst(),
        base
          .select([
            'slot.id',
            'slot.availability_template_id',
            'slot.facility_id',
            'slot.practitioner_facility_assignment_id',
            'slot.practitioner_service_assignment_id',
            'slot.practitioner_id',
            'slot.appointment_service_id',
            'slot.source_local_date',
            'slot.source_timezone',
            'slot.starts_at',
            'slot.ends_at',
            'slot.status',
            'slot.withdrawal_pending',
            'slot.updated_at',
          ])
          .select(
            sql<boolean>`exists (
              select 1
              from patient_portal_appointments appointment
              where appointment.appointment_slot_id = slot.id
                and appointment.status in ('requested', 'confirmed')
            )`.as('has_live_appointment'),
          )
          .orderBy('slot.starts_at', 'asc')
          .orderBy('slot.id', 'asc')
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize)
          .execute(),
      ]);

      return {
        page: query.page,
        pageSize: query.pageSize,
        total: asCount(countRow?.total_count),
        items: slots.map((slot) => ({
          appointmentSlotId: slot.id,
          availabilityTemplateId: slot.availability_template_id!,
          facilityId: slot.facility_id!,
          practitionerFacilityAssignmentId:
            slot.practitioner_facility_assignment_id!,
          practitionerServiceAssignmentId:
            slot.practitioner_service_assignment_id!,
          practitionerId: slot.practitioner_id!,
          appointmentServiceId: slot.appointment_service_id!,
          sourceLocalDate: slot.source_local_date!,
          sourceTimezone: slot.source_timezone!,
          startsAt: slot.starts_at.toISOString(),
          endsAt: slot.ends_at.toISOString(),
          status: slot.status,
          withdrawalPending: slot.withdrawal_pending,
          hasLiveAppointment: slot.has_live_appointment,
          updatedAt: slot.updated_at.toISOString(),
        })),
      };
    } catch (error) {
      if (error instanceof AvailabilityMaterializationError) {
        throw new WorkforceSchedulingValidationError(error.message);
      }
      return this.mapReadFailure(error);
    }
  }

  createPractitioner(
    request: SchedulingMutationRequest<CreatePractitionerInput>,
  ): Promise<PractitionerMutationResponse> {
    return this.executeMutation(
      request,
      'practitioner_create',
      { input: request.input },
      async (database, metadata) => {
        const practice = await this.requirePractice(
          database,
          request.input.organizationId,
        );
        const reason = workforceSchedulingAuditReason(request.input.reasonCode);
        const facility = await this.requireMutationFacility(
          database,
          practice,
          request.input.facilityId,
          request.principal,
          metadata.correlationId,
          'scheduling.practitioner_created',
          reason,
        );
        const access = await this.requireFacilityAuthorization(
          request.principal,
          practice,
          facility.facilityId,
          metadata.correlationId,
          'scheduling.practitioner_created',
          'facility',
          facility.facilityId,
          reason,
          database,
        );
        const replay = await this.replayCommand<PractitionerMutationResponse>(
          database,
          access,
          practice,
          metadata,
        );
        if (replay) return replay;

        const practitioner = await database
          .insertInto('practitioners')
          .values({
            tenant_id: practice.tenantId,
            application_user_id: null,
            display_name: request.input.displayName,
            professional_title: request.input.professionalTitle,
            status: 'active',
            is_synthetic: true,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const assignment = await database
          .insertInto('practitioner_facility_assignments')
          .values({
            tenant_id: practice.tenantId,
            organization_id: practice.organizationId,
            facility_id: facility.facilityId,
            practitioner_id: practitioner.id,
            status: 'active',
            is_synthetic: true,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const response: PractitionerMutationResponse = {
          practitioner: await this.loadPractitioner(
            database,
            practice,
            practitioner.id,
          ),
        };
        await this.insertSuccessAudit(database, {
          principal: request.principal,
          access,
          practice,
          facilityId: facility.facilityId,
          correlationId: metadata.correlationId,
          action: 'scheduling.practitioner_created',
          targetEntityType: 'practitioner',
          targetEntityId: practitioner.id,
          reason,
          beforeData: null,
          afterData: {
            practitionerId: practitioner.id,
            facilityAssignmentId: assignment.id,
            facilityId: facility.facilityId,
            practitionerStatus: 'active',
            facilityAssignmentStatus: 'active',
          },
        });
        await this.insertCommand(
          database,
          access,
          practice,
          metadata,
          { practitioner: response.practitioner },
          'practitioner',
          practitioner.id,
        );
        return response;
      },
    );
  }

  linkPractitionerApplicationUser(
    request: SchedulingMutationRequest<LinkPractitionerApplicationUserInput>,
    practitionerId: string,
  ): Promise<PractitionerMutationResponse> {
    return this.executeMutation(
      request,
      'practitioner_link_application_user',
      { practitionerId, input: request.input },
      async (database, metadata) => {
        const practice = await this.requirePractice(
          database,
          request.input.organizationId,
        );
        const reason = workforceSchedulingAuditReason(request.input.reasonCode);
        const access = await this.requireOrganizationAuthorization(
          request.principal,
          practice,
          metadata.correlationId,
          'scheduling.practitioner_application_user_linked',
          'practitioner',
          practitionerId,
          reason,
          database,
          false,
        );
        const replay = await this.replayCommand<PractitionerMutationResponse>(
          database,
          access,
          practice,
          metadata,
        );
        if (replay) return replay;

        const practitioner = await database
          .selectFrom('practitioners as practitioner')
          .select([
            'practitioner.id',
            'practitioner.application_user_id',
            'practitioner.updated_at',
          ])
          .where('practitioner.id', '=', practitionerId)
          .where('practitioner.tenant_id', '=', practice.tenantId)
          .where('practitioner.is_synthetic', '=', true)
          .where((expression) =>
            expression.exists(
              expression
                .selectFrom(
                  'practitioner_facility_assignments as local_assignment',
                )
                .select(sql`1`.as('one'))
                .whereRef(
                  'local_assignment.practitioner_id',
                  '=',
                  'practitioner.id',
                )
                .where('local_assignment.tenant_id', '=', practice.tenantId)
                .where(
                  'local_assignment.organization_id',
                  '=',
                  practice.organizationId,
                )
                .where('local_assignment.is_synthetic', '=', true),
            ),
          )
          .forUpdate()
          .executeTakeFirst();
        if (!practitioner) {
          this.scopedTargetUnavailable(
            request.principal,
            practice,
            metadata.correlationId,
            'practitioner',
            practitionerId,
          );
        }
        if (
          !matchesExpectedTimestamp(
            practitioner.updated_at,
            request.input.expectedUpdatedAt,
          )
        ) {
          throw new WorkforceSchedulingConflictError(
            'The practitioner changed before this request was applied.',
          );
        }
        if (practitioner.application_user_id !== null) {
          throw new WorkforceSchedulingConflictError(
            'The practitioner already has an application-user link.',
          );
        }

        const affiliations = await database
          .selectFrom('practitioner_facility_assignments as assignment')
          .select(['assignment.id', 'assignment.organization_id'])
          .where('assignment.tenant_id', '=', practice.tenantId)
          .where('assignment.practitioner_id', '=', practitionerId)
          .forUpdate()
          .execute();
        if (
          affiliations.length === 0 ||
          affiliations.some(
            (affiliation) =>
              affiliation.organization_id !== practice.organizationId,
          )
        ) {
          this.scopedTargetUnavailable(
            request.principal,
            practice,
            metadata.correlationId,
            'practitioner',
            practitionerId,
          );
        }

        const targetUser = await database
          .selectFrom('application_users as application_user')
          .innerJoin('organization_memberships as membership', (join) =>
            join
              .onRef(
                'membership.application_user_id',
                '=',
                'application_user.id',
              )
              .on('membership.tenant_id', '=', practice.tenantId)
              .on('membership.organization_id', '=', practice.organizationId),
          )
          .select('application_user.id')
          .where('application_user.id', '=', request.input.applicationUserId)
          .where('application_user.status', '=', 'active')
          .where('application_user.is_synthetic', '=', true)
          .where('membership.status', '=', 'active')
          .where('membership.valid_from', '<=', new Date())
          .where((expression) =>
            expression.or([
              expression('membership.valid_until', 'is', null),
              expression('membership.valid_until', '>', new Date()),
            ]),
          )
          .forUpdate(['application_user', 'membership'])
          .executeTakeFirst();
        if (!targetUser) {
          this.scopedTargetUnavailable(
            request.principal,
            practice,
            metadata.correlationId,
            'application_user',
            request.input.applicationUserId,
          );
        }

        const updatedAt = new Date();
        await database
          .updateTable('practitioners')
          .set({
            application_user_id: targetUser.id,
            updated_at: updatedAt,
          })
          .where('id', '=', practitioner.id)
          .executeTakeFirstOrThrow();
        const response: PractitionerMutationResponse = {
          practitioner: await this.loadPractitioner(
            database,
            practice,
            practitioner.id,
          ),
        };
        await this.insertSuccessAudit(database, {
          principal: request.principal,
          access,
          practice,
          facilityId: null,
          correlationId: metadata.correlationId,
          action: 'scheduling.practitioner_application_user_linked',
          targetEntityType: 'practitioner',
          targetEntityId: practitioner.id,
          reason,
          beforeData: {
            practitionerId: practitioner.id,
            applicationUserLinked: false,
            updatedAt: practitioner.updated_at.toISOString(),
          },
          afterData: {
            practitionerId: practitioner.id,
            applicationUserLinked: true,
            updatedAt: response.practitioner.updatedAt,
          },
        });
        await this.insertCommand(
          database,
          access,
          practice,
          metadata,
          { practitioner: response.practitioner },
          'practitioner',
          practitioner.id,
        );
        return response;
      },
    );
  }

  createPractitionerFacilityAssignment(
    request: SchedulingMutationRequest<CreatePractitionerFacilityAssignmentInput>,
    practitionerId: string,
  ): Promise<PractitionerFacilityAssignmentMutationResponse> {
    return this.executeMutation(
      request,
      'practitioner_facility_assignment_create',
      { practitionerId, input: request.input },
      async (database, metadata) => {
        const practice = await this.requirePractice(
          database,
          request.input.organizationId,
        );
        const reason = workforceSchedulingAuditReason(request.input.reasonCode);
        const facility = await this.requireMutationFacility(
          database,
          practice,
          request.input.facilityId,
          request.principal,
          metadata.correlationId,
          'scheduling.practitioner_facility_assignment_created',
          reason,
        );
        const access = await this.requireFacilityAuthorization(
          request.principal,
          practice,
          facility.facilityId,
          metadata.correlationId,
          'scheduling.practitioner_facility_assignment_created',
          'practitioner',
          practitionerId,
          reason,
          database,
        );
        const replay =
          await this.replayCommand<PractitionerFacilityAssignmentMutationResponse>(
            database,
            access,
            practice,
            metadata,
          );
        if (replay) return replay;

        const practitioner = await database
          .selectFrom('practitioners as practitioner')
          .select(['practitioner.id', 'practitioner.application_user_id'])
          .where('practitioner.id', '=', practitionerId)
          .where('practitioner.tenant_id', '=', practice.tenantId)
          .where('practitioner.status', '=', 'active')
          .where('practitioner.is_synthetic', '=', true)
          .forUpdate()
          .executeTakeFirst();
        if (!practitioner) {
          this.scopedTargetUnavailable(
            request.principal,
            practice,
            metadata.correlationId,
            'practitioner',
            practitionerId,
            facility.facilityId,
          );
        }
        const existingAffiliations = await database
          .selectFrom('practitioner_facility_assignments as assignment')
          .select([
            'assignment.id',
            'assignment.organization_id',
            'assignment.is_synthetic',
          ])
          .where('assignment.tenant_id', '=', practice.tenantId)
          .where('assignment.practitioner_id', '=', practitioner.id)
          .forUpdate()
          .execute();
        const alreadyLocal = existingAffiliations.some(
          (assignment) =>
            assignment.organization_id === practice.organizationId &&
            assignment.is_synthetic,
        );
        if (!alreadyLocal) {
          if (!practitioner.application_user_id) {
            this.scopedTargetUnavailable(
              request.principal,
              practice,
              metadata.correlationId,
              'practitioner',
              practitionerId,
              facility.facilityId,
            );
          }
          const activeTargetMember = await database
            .selectFrom('application_users as application_user')
            .innerJoin('organization_memberships as membership', (join) =>
              join
                .onRef(
                  'membership.application_user_id',
                  '=',
                  'application_user.id',
                )
                .on('membership.tenant_id', '=', practice.tenantId)
                .on('membership.organization_id', '=', practice.organizationId),
            )
            .select('membership.id')
            .where('application_user.id', '=', practitioner.application_user_id)
            .where('application_user.status', '=', 'active')
            .where('application_user.is_synthetic', '=', true)
            .where('membership.status', '=', 'active')
            .where('membership.valid_from', '<=', new Date())
            .where((expression) =>
              expression.or([
                expression('membership.valid_until', 'is', null),
                expression('membership.valid_until', '>', new Date()),
              ]),
            )
            .forUpdate(['application_user', 'membership'])
            .executeTakeFirst();
          if (!activeTargetMember) {
            this.scopedTargetUnavailable(
              request.principal,
              practice,
              metadata.correlationId,
              'practitioner',
              practitionerId,
              facility.facilityId,
            );
          }
        }

        const assignment = await database
          .insertInto('practitioner_facility_assignments')
          .values({
            tenant_id: practice.tenantId,
            organization_id: practice.organizationId,
            facility_id: facility.facilityId,
            practitioner_id: practitioner.id,
            status: 'inactive',
            is_synthetic: true,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const response: PractitionerFacilityAssignmentMutationResponse = {
          assignment: await this.loadFacilityAssignment(
            database,
            practice,
            assignment.id,
          ),
          affectedAppointmentCount: 0,
          affectedAppointmentIds: [],
          affectedAppointmentIdsTruncated: false,
        };
        await this.insertSuccessAudit(database, {
          principal: request.principal,
          access,
          practice,
          facilityId: facility.facilityId,
          correlationId: metadata.correlationId,
          action: 'scheduling.practitioner_facility_assignment_created',
          targetEntityType: 'practitioner_facility_assignment',
          targetEntityId: assignment.id,
          reason,
          beforeData: null,
          afterData: {
            assignmentId: assignment.id,
            practitionerId: practitioner.id,
            facilityId: facility.facilityId,
            status: 'inactive',
            affectedAppointmentIdsTruncated: false,
          },
        });
        await this.insertCommand(
          database,
          access,
          practice,
          metadata,
          { ...response },
          'practitioner_facility_assignment',
          assignment.id,
        );
        return response;
      },
    );
  }

  changePractitionerFacilityAssignmentStatus(
    request: SchedulingMutationRequest<ChangePractitionerFacilityAssignmentStatusInput>,
    assignmentId: string,
  ): Promise<PractitionerFacilityAssignmentMutationResponse> {
    return this.executeMutation(
      request,
      'practitioner_facility_assignment_status',
      { assignmentId, input: request.input },
      async (database, metadata) => {
        const practice = await this.requirePractice(
          database,
          request.input.organizationId,
        );
        const reason = workforceSchedulingAuditReason(request.input.reasonCode);
        const targetScope = await database
          .selectFrom('practitioner_facility_assignments as assignment')
          .select('assignment.facility_id')
          .where('assignment.id', '=', assignmentId)
          .where('assignment.tenant_id', '=', practice.tenantId)
          .where('assignment.organization_id', '=', practice.organizationId)
          .where('assignment.is_synthetic', '=', true)
          .executeTakeFirst();
        if (!targetScope) {
          await this.requireAnySchedulingAuthorization(
            request.principal,
            practice,
            metadata.correlationId,
            'scheduling.practitioner_facility_assignment_status_changed',
            'practitioner_facility_assignment',
            assignmentId,
            reason,
            database,
          );
          this.scopedTargetUnavailable(
            request.principal,
            practice,
            metadata.correlationId,
            'practitioner_facility_assignment',
            assignmentId,
          );
        }
        await this.requireFacility(database, practice, targetScope.facility_id);
        const access = await this.requireFacilityAuthorization(
          request.principal,
          practice,
          targetScope.facility_id,
          metadata.correlationId,
          'scheduling.practitioner_facility_assignment_status_changed',
          'practitioner_facility_assignment',
          assignmentId,
          reason,
          database,
        );
        const replay =
          await this.replayCommand<PractitionerFacilityAssignmentMutationResponse>(
            database,
            access,
            practice,
            metadata,
          );
        if (replay) return replay;

        const assignment = await database
          .selectFrom('practitioner_facility_assignments as assignment')
          .select([
            'assignment.id',
            'assignment.facility_id',
            'assignment.practitioner_id',
            'assignment.status',
            'assignment.updated_at',
          ])
          .where('assignment.id', '=', assignmentId)
          .where('assignment.tenant_id', '=', practice.tenantId)
          .where('assignment.organization_id', '=', practice.organizationId)
          .where('assignment.facility_id', '=', targetScope.facility_id)
          .where('assignment.is_synthetic', '=', true)
          .forUpdate()
          .executeTakeFirst();
        if (!assignment) {
          this.scopedTargetUnavailable(
            request.principal,
            practice,
            metadata.correlationId,
            'practitioner_facility_assignment',
            assignmentId,
            targetScope.facility_id,
          );
        }
        if (
          !matchesExpectedTimestamp(
            assignment.updated_at,
            request.input.expectedUpdatedAt,
          )
        ) {
          throw new WorkforceSchedulingConflictError(
            'The facility affiliation changed before this request was applied.',
          );
        }
        if (request.input.status === 'active') {
          const practitioner = await database
            .selectFrom('practitioners as practitioner')
            .select('practitioner.id')
            .where('practitioner.id', '=', assignment.practitioner_id)
            .where('practitioner.tenant_id', '=', practice.tenantId)
            .where('practitioner.status', '=', 'active')
            .where('practitioner.is_synthetic', '=', true)
            .forUpdate()
            .executeTakeFirst();
          if (!practitioner) {
            throw new WorkforceSchedulingConflictError(
              'The practitioner is not active for this affiliation.',
            );
          }
        }

        const affected =
          request.input.status === 'inactive'
            ? await this.affectedAppointments(
                database,
                practice,
                'facility-assignment',
                assignment.id,
              )
            : { count: 0, ids: [] };
        const cascadedEligibilityAssignments =
          request.input.status === 'inactive'
            ? await this.activeServiceAssignmentsForFacilityAssignment(
                database,
                practice,
                assignment.facility_id,
                assignment.id,
              )
            : { count: 0, ids: [] };
        const updatedAt = new Date();
        if (request.input.status === 'inactive') {
          await database
            .updateTable('practitioner_service_assignments')
            .set({ status: 'inactive', updated_at: updatedAt })
            .where('tenant_id', '=', practice.tenantId)
            .where('organization_id', '=', practice.organizationId)
            .where('facility_id', '=', assignment.facility_id)
            .where('practitioner_facility_assignment_id', '=', assignment.id)
            .where('status', '=', 'active')
            .where('is_synthetic', '=', true)
            .execute();
        }
        await database
          .updateTable('practitioner_facility_assignments')
          .set({ status: request.input.status, updated_at: updatedAt })
          .where('id', '=', assignment.id)
          .executeTakeFirstOrThrow();
        const response: PractitionerFacilityAssignmentMutationResponse = {
          assignment: await this.loadFacilityAssignment(
            database,
            practice,
            assignment.id,
          ),
          affectedAppointmentCount: affected.count,
          affectedAppointmentIds: affected.ids,
          affectedAppointmentIdsTruncated: affected.count > affected.ids.length,
        };
        await this.insertSuccessAudit(database, {
          principal: request.principal,
          access,
          practice,
          facilityId: assignment.facility_id,
          correlationId: metadata.correlationId,
          action: 'scheduling.practitioner_facility_assignment_status_changed',
          targetEntityType: 'practitioner_facility_assignment',
          targetEntityId: assignment.id,
          reason,
          beforeData: {
            assignmentId: assignment.id,
            status: assignment.status,
            updatedAt: assignment.updated_at.toISOString(),
          },
          afterData: {
            assignmentId: assignment.id,
            status: response.assignment.status,
            updatedAt: response.assignment.updatedAt,
            affectedAppointmentCount: affected.count,
            affectedAppointmentIdsTruncated:
              response.affectedAppointmentIdsTruncated,
            cascadedEligibilityAssignmentCount:
              cascadedEligibilityAssignments.count,
            cascadedEligibilityAssignmentIds:
              cascadedEligibilityAssignments.ids,
            cascadedEligibilityAssignmentIdsTruncated:
              cascadedEligibilityAssignments.count >
              cascadedEligibilityAssignments.ids.length,
          },
        });
        await this.insertCommand(
          database,
          access,
          practice,
          metadata,
          { ...response },
          'practitioner_facility_assignment',
          assignment.id,
        );
        return response;
      },
    );
  }

  createSpecialty(
    request: SchedulingMutationRequest<CreateSpecialtyInput>,
  ): Promise<SpecialtyMutationResponse> {
    return this.executeMutation(
      request,
      'specialty_create',
      { input: request.input },
      async (database, metadata) => {
        const practice = await this.requirePractice(
          database,
          request.input.organizationId,
        );
        const reason = workforceSchedulingAuditReason(request.input.reasonCode);
        const access = await this.requireOrganizationAuthorization(
          request.principal,
          practice,
          metadata.correlationId,
          'scheduling.specialty_created',
          'organization',
          practice.organizationId,
          reason,
          database,
          false,
        );
        const replay = await this.replayCommand<SpecialtyMutationResponse>(
          database,
          access,
          practice,
          metadata,
        );
        if (replay) return replay;

        const specialty = await database
          .insertInto('specialties')
          .values({
            tenant_id: practice.tenantId,
            organization_id: practice.organizationId,
            code: request.input.code,
            name: request.input.name,
            status: 'active',
            is_synthetic: true,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const response: SpecialtyMutationResponse = {
          specialty: await this.loadSpecialty(database, practice, specialty.id),
        };
        await this.insertSuccessAudit(database, {
          principal: request.principal,
          access,
          practice,
          facilityId: null,
          correlationId: metadata.correlationId,
          action: 'scheduling.specialty_created',
          targetEntityType: 'specialty',
          targetEntityId: specialty.id,
          reason,
          beforeData: null,
          afterData: {
            specialtyId: specialty.id,
            status: 'active',
          },
        });
        await this.insertCommand(
          database,
          access,
          practice,
          metadata,
          { specialty: response.specialty },
          'specialty',
          specialty.id,
        );
        return response;
      },
    );
  }

  updateSpecialty(
    request: SchedulingMutationRequest<UpdateSpecialtyInput>,
    specialtyId: string,
  ): Promise<SpecialtyMutationResponse> {
    return this.executeMutation(
      request,
      'specialty_update',
      { specialtyId, input: request.input },
      async (database, metadata) => {
        const practice = await this.requirePractice(
          database,
          request.input.organizationId,
        );
        const reason = workforceSchedulingAuditReason(request.input.reasonCode);
        const access = await this.requireOrganizationAuthorization(
          request.principal,
          practice,
          metadata.correlationId,
          'scheduling.specialty_updated',
          'specialty',
          specialtyId,
          reason,
          database,
          false,
        );
        const replay = await this.replayCommand<SpecialtyMutationResponse>(
          database,
          access,
          practice,
          metadata,
        );
        if (replay) return replay;

        const specialty = await database
          .selectFrom('specialties as specialty')
          .select(['specialty.id', 'specialty.status', 'specialty.updated_at'])
          .where('specialty.id', '=', specialtyId)
          .where('specialty.tenant_id', '=', practice.tenantId)
          .where('specialty.organization_id', '=', practice.organizationId)
          .where('specialty.is_synthetic', '=', true)
          .forUpdate()
          .executeTakeFirst();
        if (!specialty) {
          this.scopedTargetUnavailable(
            request.principal,
            practice,
            metadata.correlationId,
            'specialty',
            specialtyId,
          );
        }
        if (
          !matchesExpectedTimestamp(
            specialty.updated_at,
            request.input.expectedUpdatedAt,
          )
        ) {
          throw new WorkforceSchedulingConflictError(
            'The specialty changed before this request was applied.',
          );
        }
        if (
          specialty.status === 'retired' &&
          request.input.status === 'active'
        ) {
          throw new WorkforceSchedulingConflictError(
            'A retired specialty cannot be restored.',
          );
        }
        if (request.input.status === 'retired') {
          const activeService = await database
            .selectFrom('appointment_services as service')
            .select('service.id')
            .where('service.tenant_id', '=', practice.tenantId)
            .where('service.organization_id', '=', practice.organizationId)
            .where('service.specialty_id', '=', specialty.id)
            .where('service.status', '!=', 'inactive')
            .forUpdate()
            .executeTakeFirst();
          if (activeService) {
            throw new WorkforceSchedulingConflictError(
              'All appointment services must be inactive before retirement.',
            );
          }
        }

        const updatedAt = new Date();
        await database
          .updateTable('specialties')
          .set({
            ...(request.input.name !== undefined
              ? { name: request.input.name }
              : {}),
            ...(request.input.status !== undefined
              ? { status: request.input.status }
              : {}),
            updated_at: updatedAt,
          })
          .where('id', '=', specialty.id)
          .executeTakeFirstOrThrow();
        const response: SpecialtyMutationResponse = {
          specialty: await this.loadSpecialty(database, practice, specialty.id),
        };
        await this.insertSuccessAudit(database, {
          principal: request.principal,
          access,
          practice,
          facilityId: null,
          correlationId: metadata.correlationId,
          action: 'scheduling.specialty_updated',
          targetEntityType: 'specialty',
          targetEntityId: specialty.id,
          reason,
          beforeData: {
            specialtyId: specialty.id,
            status: specialty.status,
            updatedAt: specialty.updated_at.toISOString(),
          },
          afterData: {
            specialtyId: specialty.id,
            status: response.specialty.status,
            updatedAt: response.specialty.updatedAt,
          },
        });
        await this.insertCommand(
          database,
          access,
          practice,
          metadata,
          { specialty: response.specialty },
          'specialty',
          specialty.id,
        );
        return response;
      },
    );
  }

  createService(
    request: SchedulingMutationRequest<CreateAppointmentServiceInput>,
  ): Promise<AppointmentServiceMutationResponse> {
    return this.executeMutation(
      request,
      'service_create',
      { input: request.input },
      async (database, metadata) => {
        const practice = await this.requirePractice(
          database,
          request.input.organizationId,
        );
        const reason = workforceSchedulingAuditReason(request.input.reasonCode);
        const facility = await this.requireMutationFacility(
          database,
          practice,
          request.input.facilityId,
          request.principal,
          metadata.correlationId,
          'scheduling.appointment_service_created',
          reason,
        );
        const access = await this.requireFacilityAuthorization(
          request.principal,
          practice,
          facility.facilityId,
          metadata.correlationId,
          'scheduling.appointment_service_created',
          'facility',
          facility.facilityId,
          reason,
          database,
        );
        const replay =
          await this.replayCommand<AppointmentServiceMutationResponse>(
            database,
            access,
            practice,
            metadata,
          );
        if (replay) return replay;

        const specialty = await database
          .selectFrom('specialties as specialty')
          .select('specialty.id')
          .where('specialty.id', '=', request.input.specialtyId)
          .where('specialty.tenant_id', '=', practice.tenantId)
          .where('specialty.organization_id', '=', practice.organizationId)
          .where('specialty.status', '=', 'active')
          .where('specialty.is_synthetic', '=', true)
          .forUpdate()
          .executeTakeFirst();
        if (!specialty) {
          this.scopedTargetUnavailable(
            request.principal,
            practice,
            metadata.correlationId,
            'specialty',
            request.input.specialtyId,
            facility.facilityId,
          );
        }

        const service = await database
          .insertInto('appointment_services')
          .values({
            tenant_id: practice.tenantId,
            organization_id: practice.organizationId,
            facility_id: facility.facilityId,
            specialty_id: specialty.id,
            code: request.input.code,
            patient_facing_name: request.input.patientFacingName,
            duration_minutes: request.input.durationMinutes,
            allows_any_practitioner: request.input.allowsAnyPractitioner,
            status: 'inactive',
            is_synthetic: true,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const response: AppointmentServiceMutationResponse = {
          service: await this.loadService(database, practice, service.id),
          affectedAppointmentCount: 0,
          affectedAppointmentIds: [],
          affectedAppointmentIdsTruncated: false,
        };
        await this.insertSuccessAudit(database, {
          principal: request.principal,
          access,
          practice,
          facilityId: facility.facilityId,
          correlationId: metadata.correlationId,
          action: 'scheduling.appointment_service_created',
          targetEntityType: 'appointment_service',
          targetEntityId: service.id,
          reason,
          beforeData: null,
          afterData: {
            appointmentServiceId: service.id,
            facilityId: facility.facilityId,
            specialtyId: specialty.id,
            status: 'inactive',
            durationMinutes: request.input.durationMinutes,
            allowsAnyPractitioner: request.input.allowsAnyPractitioner,
            affectedAppointmentIdsTruncated: false,
          },
        });
        await this.insertCommand(
          database,
          access,
          practice,
          metadata,
          { ...response },
          'appointment_service',
          service.id,
        );
        return response;
      },
    );
  }

  updateService(
    request: SchedulingMutationRequest<UpdateAppointmentServiceInput>,
    serviceId: string,
  ): Promise<AppointmentServiceMutationResponse> {
    return this.executeMutation(
      request,
      'service_update',
      { serviceId, input: request.input },
      async (database, metadata) => {
        const practice = await this.requirePractice(
          database,
          request.input.organizationId,
        );
        const reason = workforceSchedulingAuditReason(request.input.reasonCode);
        const targetScope = await database
          .selectFrom('appointment_services as service')
          .select('service.facility_id')
          .where('service.id', '=', serviceId)
          .where('service.tenant_id', '=', practice.tenantId)
          .where('service.organization_id', '=', practice.organizationId)
          .where('service.is_synthetic', '=', true)
          .executeTakeFirst();
        if (!targetScope) {
          await this.requireAnySchedulingAuthorization(
            request.principal,
            practice,
            metadata.correlationId,
            'scheduling.appointment_service_updated',
            'appointment_service',
            serviceId,
            reason,
            database,
          );
          this.scopedTargetUnavailable(
            request.principal,
            practice,
            metadata.correlationId,
            'appointment_service',
            serviceId,
          );
        }
        await this.requireFacility(database, practice, targetScope.facility_id);
        const access = await this.requireFacilityAuthorization(
          request.principal,
          practice,
          targetScope.facility_id,
          metadata.correlationId,
          'scheduling.appointment_service_updated',
          'appointment_service',
          serviceId,
          reason,
          database,
        );
        const replay =
          await this.replayCommand<AppointmentServiceMutationResponse>(
            database,
            access,
            practice,
            metadata,
          );
        if (replay) return replay;

        const service = await database
          .selectFrom('appointment_services as service')
          .select([
            'service.id',
            'service.facility_id',
            'service.specialty_id',
            'service.status',
            'service.allows_any_practitioner',
            'service.updated_at',
          ])
          .where('service.id', '=', serviceId)
          .where('service.tenant_id', '=', practice.tenantId)
          .where('service.organization_id', '=', practice.organizationId)
          .where('service.facility_id', '=', targetScope.facility_id)
          .where('service.is_synthetic', '=', true)
          .forUpdate()
          .executeTakeFirst();
        if (!service) {
          this.scopedTargetUnavailable(
            request.principal,
            practice,
            metadata.correlationId,
            'appointment_service',
            serviceId,
            targetScope.facility_id,
          );
        }
        if (
          !matchesExpectedTimestamp(
            service.updated_at,
            request.input.expectedUpdatedAt,
          )
        ) {
          throw new WorkforceSchedulingConflictError(
            'The appointment service changed before this request was applied.',
          );
        }

        const nextStatus = request.input.status ?? service.status;
        if (nextStatus === 'active') {
          const activeChain = await database
            .selectFrom('specialties as specialty')
            .innerJoin(
              'practitioner_service_assignments as service_assignment',
              (join) =>
                join
                  .on('service_assignment.tenant_id', '=', practice.tenantId)
                  .on(
                    'service_assignment.organization_id',
                    '=',
                    practice.organizationId,
                  )
                  .on(
                    'service_assignment.facility_id',
                    '=',
                    service.facility_id,
                  )
                  .on(
                    'service_assignment.appointment_service_id',
                    '=',
                    service.id,
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
            .select('service_assignment.id')
            .where('specialty.id', '=', service.specialty_id)
            .where('specialty.tenant_id', '=', practice.tenantId)
            .where('specialty.organization_id', '=', practice.organizationId)
            .where('specialty.status', '=', 'active')
            .where('specialty.is_synthetic', '=', true)
            .where('service_assignment.status', '=', 'active')
            .where('service_assignment.is_synthetic', '=', true)
            .where('facility_assignment.status', '=', 'active')
            .where('facility_assignment.is_synthetic', '=', true)
            .where('practitioner.status', '=', 'active')
            .where('practitioner.is_synthetic', '=', true)
            .forUpdate([
              'specialty',
              'service_assignment',
              'facility_assignment',
              'practitioner',
            ])
            .executeTakeFirst();
          if (!activeChain) {
            throw new WorkforceSchedulingConflictError(
              'The appointment service requires a complete active provider chain.',
            );
          }
        }

        const affected =
          request.input.status === 'inactive'
            ? await this.affectedAppointments(
                database,
                practice,
                'service',
                service.id,
              )
            : { count: 0, ids: [] };
        const updatedAt = new Date();
        await database
          .updateTable('appointment_services')
          .set({
            ...(request.input.patientFacingName !== undefined
              ? { patient_facing_name: request.input.patientFacingName }
              : {}),
            ...(request.input.allowsAnyPractitioner !== undefined
              ? {
                  allows_any_practitioner: request.input.allowsAnyPractitioner,
                }
              : {}),
            ...(request.input.status !== undefined
              ? { status: request.input.status }
              : {}),
            updated_at: updatedAt,
          })
          .where('id', '=', service.id)
          .executeTakeFirstOrThrow();
        const response: AppointmentServiceMutationResponse = {
          service: await this.loadService(database, practice, service.id),
          affectedAppointmentCount: affected.count,
          affectedAppointmentIds: affected.ids,
          affectedAppointmentIdsTruncated: affected.count > affected.ids.length,
        };
        await this.insertSuccessAudit(database, {
          principal: request.principal,
          access,
          practice,
          facilityId: service.facility_id,
          correlationId: metadata.correlationId,
          action: 'scheduling.appointment_service_updated',
          targetEntityType: 'appointment_service',
          targetEntityId: service.id,
          reason,
          beforeData: {
            appointmentServiceId: service.id,
            status: service.status,
            allowsAnyPractitioner: service.allows_any_practitioner,
            updatedAt: service.updated_at.toISOString(),
          },
          afterData: {
            appointmentServiceId: service.id,
            status: response.service.status,
            allowsAnyPractitioner: response.service.allowsAnyPractitioner,
            updatedAt: response.service.updatedAt,
            affectedAppointmentCount: affected.count,
            affectedAppointmentIdsTruncated:
              response.affectedAppointmentIdsTruncated,
          },
        });
        await this.insertCommand(
          database,
          access,
          practice,
          metadata,
          { ...response },
          'appointment_service',
          service.id,
        );
        return response;
      },
    );
  }

  createPractitionerServiceAssignment(
    request: SchedulingMutationRequest<CreatePractitionerServiceAssignmentInput>,
    serviceId: string,
  ): Promise<PractitionerServiceAssignmentMutationResponse> {
    return this.executeMutation(
      request,
      'practitioner_service_assignment_create',
      { serviceId, input: request.input },
      async (database, metadata) => {
        const practice = await this.requirePractice(
          database,
          request.input.organizationId,
        );
        const reason = workforceSchedulingAuditReason(request.input.reasonCode);
        const chainScope = await database
          .selectFrom('appointment_services as service')
          .innerJoin(
            'practitioner_facility_assignments as facility_assignment',
            (join) =>
              join
                .on(
                  'facility_assignment.id',
                  '=',
                  request.input.practitionerFacilityAssignmentId,
                )
                .onRef(
                  'facility_assignment.tenant_id',
                  '=',
                  'service.tenant_id',
                )
                .onRef(
                  'facility_assignment.organization_id',
                  '=',
                  'service.organization_id',
                )
                .onRef(
                  'facility_assignment.facility_id',
                  '=',
                  'service.facility_id',
                ),
          )
          .innerJoin('practitioners as practitioner', (join) =>
            join
              .onRef(
                'practitioner.id',
                '=',
                'facility_assignment.practitioner_id',
              )
              .onRef(
                'practitioner.tenant_id',
                '=',
                'facility_assignment.tenant_id',
              ),
          )
          .select([
            'service.id as service_id',
            'service.facility_id',
            'facility_assignment.id as facility_assignment_id',
            'facility_assignment.practitioner_id',
          ])
          .where('service.id', '=', serviceId)
          .where('service.tenant_id', '=', practice.tenantId)
          .where('service.organization_id', '=', practice.organizationId)
          .where('service.is_synthetic', '=', true)
          .where('facility_assignment.is_synthetic', '=', true)
          .where('practitioner.is_synthetic', '=', true)
          .where((expression) =>
            expression.exists(
              expression
                .selectFrom('specialties as specialty')
                .select(sql`1`.as('one'))
                .whereRef('specialty.id', '=', 'service.specialty_id')
                .whereRef('specialty.tenant_id', '=', 'service.tenant_id')
                .whereRef(
                  'specialty.organization_id',
                  '=',
                  'service.organization_id',
                )
                .where('specialty.is_synthetic', '=', true),
            ),
          )
          .executeTakeFirst();
        if (!chainScope) {
          await this.requireAnySchedulingAuthorization(
            request.principal,
            practice,
            metadata.correlationId,
            'scheduling.practitioner_service_assignment_created',
            'appointment_service',
            serviceId,
            reason,
            database,
          );
          this.scopedTargetUnavailable(
            request.principal,
            practice,
            metadata.correlationId,
            'appointment_service',
            serviceId,
          );
        }
        await this.requireFacility(database, practice, chainScope.facility_id);
        const access = await this.requireFacilityAuthorization(
          request.principal,
          practice,
          chainScope.facility_id,
          metadata.correlationId,
          'scheduling.practitioner_service_assignment_created',
          'appointment_service',
          serviceId,
          reason,
          database,
        );
        const replay =
          await this.replayCommand<PractitionerServiceAssignmentMutationResponse>(
            database,
            access,
            practice,
            metadata,
          );
        if (replay) return replay;

        const lockedScope = await database
          .selectFrom('appointment_services as service')
          .innerJoin(
            'practitioner_facility_assignments as facility_assignment',
            (join) =>
              join
                .on(
                  'facility_assignment.id',
                  '=',
                  chainScope.facility_assignment_id,
                )
                .onRef(
                  'facility_assignment.tenant_id',
                  '=',
                  'service.tenant_id',
                )
                .onRef(
                  'facility_assignment.organization_id',
                  '=',
                  'service.organization_id',
                )
                .onRef(
                  'facility_assignment.facility_id',
                  '=',
                  'service.facility_id',
                ),
          )
          .innerJoin('practitioners as practitioner', (join) =>
            join
              .onRef(
                'practitioner.id',
                '=',
                'facility_assignment.practitioner_id',
              )
              .onRef(
                'practitioner.tenant_id',
                '=',
                'facility_assignment.tenant_id',
              ),
          )
          .select([
            'service.id as service_id',
            'service.facility_id',
            'facility_assignment.id as facility_assignment_id',
            'facility_assignment.practitioner_id',
          ])
          .where('service.id', '=', serviceId)
          .where('service.tenant_id', '=', practice.tenantId)
          .where('service.organization_id', '=', practice.organizationId)
          .where('service.facility_id', '=', chainScope.facility_id)
          .where('service.is_synthetic', '=', true)
          .where('facility_assignment.is_synthetic', '=', true)
          .where('practitioner.is_synthetic', '=', true)
          .where((expression) =>
            expression.exists(
              expression
                .selectFrom('specialties as specialty')
                .select(sql`1`.as('one'))
                .whereRef('specialty.id', '=', 'service.specialty_id')
                .whereRef('specialty.tenant_id', '=', 'service.tenant_id')
                .whereRef(
                  'specialty.organization_id',
                  '=',
                  'service.organization_id',
                )
                .where('specialty.is_synthetic', '=', true),
            ),
          )
          .forUpdate(['service', 'facility_assignment', 'practitioner'])
          .executeTakeFirst();
        if (!lockedScope) {
          this.scopedTargetUnavailable(
            request.principal,
            practice,
            metadata.correlationId,
            'appointment_service',
            serviceId,
            chainScope.facility_id,
          );
        }

        const assignment = await database
          .insertInto('practitioner_service_assignments')
          .values({
            tenant_id: practice.tenantId,
            organization_id: practice.organizationId,
            facility_id: lockedScope.facility_id,
            practitioner_facility_assignment_id:
              lockedScope.facility_assignment_id,
            practitioner_id: lockedScope.practitioner_id,
            appointment_service_id: lockedScope.service_id,
            status: 'inactive',
            is_synthetic: true,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const response: PractitionerServiceAssignmentMutationResponse = {
          assignment: await this.loadServiceAssignment(
            database,
            practice,
            assignment.id,
          ),
          affectedAppointmentCount: 0,
          affectedAppointmentIds: [],
          affectedAppointmentIdsTruncated: false,
        };
        await this.insertSuccessAudit(database, {
          principal: request.principal,
          access,
          practice,
          facilityId: lockedScope.facility_id,
          correlationId: metadata.correlationId,
          action: 'scheduling.practitioner_service_assignment_created',
          targetEntityType: 'practitioner_service_assignment',
          targetEntityId: assignment.id,
          reason,
          beforeData: null,
          afterData: {
            assignmentId: assignment.id,
            practitionerFacilityAssignmentId:
              lockedScope.facility_assignment_id,
            appointmentServiceId: lockedScope.service_id,
            practitionerId: lockedScope.practitioner_id,
            facilityId: lockedScope.facility_id,
            status: 'inactive',
            affectedAppointmentIdsTruncated: false,
          },
        });
        await this.insertCommand(
          database,
          access,
          practice,
          metadata,
          { ...response },
          'practitioner_service_assignment',
          assignment.id,
        );
        return response;
      },
    );
  }

  changePractitionerServiceAssignmentStatus(
    request: SchedulingMutationRequest<ChangePractitionerServiceAssignmentStatusInput>,
    assignmentId: string,
  ): Promise<PractitionerServiceAssignmentMutationResponse> {
    return this.executeMutation(
      request,
      'practitioner_service_assignment_status',
      { assignmentId, input: request.input },
      async (database, metadata) => {
        const practice = await this.requirePractice(
          database,
          request.input.organizationId,
        );
        const reason = workforceSchedulingAuditReason(request.input.reasonCode);
        const targetScope = await database
          .selectFrom('practitioner_service_assignments as assignment')
          .select('assignment.facility_id')
          .where('assignment.id', '=', assignmentId)
          .where('assignment.tenant_id', '=', practice.tenantId)
          .where('assignment.organization_id', '=', practice.organizationId)
          .where('assignment.is_synthetic', '=', true)
          .executeTakeFirst();
        if (!targetScope) {
          await this.requireAnySchedulingAuthorization(
            request.principal,
            practice,
            metadata.correlationId,
            'scheduling.practitioner_service_assignment_status_changed',
            'practitioner_service_assignment',
            assignmentId,
            reason,
            database,
          );
          this.scopedTargetUnavailable(
            request.principal,
            practice,
            metadata.correlationId,
            'practitioner_service_assignment',
            assignmentId,
          );
        }
        await this.requireFacility(database, practice, targetScope.facility_id);
        const access = await this.requireFacilityAuthorization(
          request.principal,
          practice,
          targetScope.facility_id,
          metadata.correlationId,
          'scheduling.practitioner_service_assignment_status_changed',
          'practitioner_service_assignment',
          assignmentId,
          reason,
          database,
        );
        const replay =
          await this.replayCommand<PractitionerServiceAssignmentMutationResponse>(
            database,
            access,
            practice,
            metadata,
          );
        if (replay) return replay;

        const assignment = await database
          .selectFrom('practitioner_service_assignments as assignment')
          .select([
            'assignment.id',
            'assignment.facility_id',
            'assignment.practitioner_facility_assignment_id',
            'assignment.practitioner_id',
            'assignment.appointment_service_id',
            'assignment.status',
            'assignment.updated_at',
          ])
          .where('assignment.id', '=', assignmentId)
          .where('assignment.tenant_id', '=', practice.tenantId)
          .where('assignment.organization_id', '=', practice.organizationId)
          .where('assignment.facility_id', '=', targetScope.facility_id)
          .where('assignment.is_synthetic', '=', true)
          .forUpdate()
          .executeTakeFirst();
        if (!assignment) {
          this.scopedTargetUnavailable(
            request.principal,
            practice,
            metadata.correlationId,
            'practitioner_service_assignment',
            assignmentId,
            targetScope.facility_id,
          );
        }
        if (
          !matchesExpectedTimestamp(
            assignment.updated_at,
            request.input.expectedUpdatedAt,
          )
        ) {
          throw new WorkforceSchedulingConflictError(
            'The service eligibility changed before this request was applied.',
          );
        }

        if (request.input.status === 'active') {
          const activeChain = await database
            .selectFrom(
              'practitioner_facility_assignments as facility_assignment',
            )
            .innerJoin('practitioners as practitioner', (join) =>
              join
                .onRef(
                  'practitioner.id',
                  '=',
                  'facility_assignment.practitioner_id',
                )
                .onRef(
                  'practitioner.tenant_id',
                  '=',
                  'facility_assignment.tenant_id',
                ),
            )
            .innerJoin('appointment_services as service', (join) =>
              join
                .on('service.id', '=', assignment.appointment_service_id)
                .onRef(
                  'service.tenant_id',
                  '=',
                  'facility_assignment.tenant_id',
                )
                .onRef(
                  'service.organization_id',
                  '=',
                  'facility_assignment.organization_id',
                )
                .onRef(
                  'service.facility_id',
                  '=',
                  'facility_assignment.facility_id',
                ),
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
            .select('facility_assignment.id')
            .where(
              'facility_assignment.id',
              '=',
              assignment.practitioner_facility_assignment_id,
            )
            .where('facility_assignment.tenant_id', '=', practice.tenantId)
            .where(
              'facility_assignment.organization_id',
              '=',
              practice.organizationId,
            )
            .where(
              'facility_assignment.facility_id',
              '=',
              assignment.facility_id,
            )
            .where(
              'facility_assignment.practitioner_id',
              '=',
              assignment.practitioner_id,
            )
            .where('facility_assignment.status', '=', 'active')
            .where('facility_assignment.is_synthetic', '=', true)
            .where('practitioner.status', '=', 'active')
            .where('practitioner.is_synthetic', '=', true)
            .where('service.is_synthetic', '=', true)
            .where('specialty.status', '=', 'active')
            .where('specialty.is_synthetic', '=', true)
            .forUpdate([
              'facility_assignment',
              'practitioner',
              'service',
              'specialty',
            ])
            .executeTakeFirst();
          if (!activeChain) {
            throw new WorkforceSchedulingConflictError(
              'The service eligibility requires an active practitioner, affiliation, and specialty.',
            );
          }
        }

        const affected =
          request.input.status === 'inactive'
            ? await this.affectedAppointments(
                database,
                practice,
                'service-assignment',
                assignment.id,
              )
            : { count: 0, ids: [] };
        const updatedAt = new Date();
        await database
          .updateTable('practitioner_service_assignments')
          .set({ status: request.input.status, updated_at: updatedAt })
          .where('id', '=', assignment.id)
          .executeTakeFirstOrThrow();
        const response: PractitionerServiceAssignmentMutationResponse = {
          assignment: await this.loadServiceAssignment(
            database,
            practice,
            assignment.id,
          ),
          affectedAppointmentCount: affected.count,
          affectedAppointmentIds: affected.ids,
          affectedAppointmentIdsTruncated: affected.count > affected.ids.length,
        };
        await this.insertSuccessAudit(database, {
          principal: request.principal,
          access,
          practice,
          facilityId: assignment.facility_id,
          correlationId: metadata.correlationId,
          action: 'scheduling.practitioner_service_assignment_status_changed',
          targetEntityType: 'practitioner_service_assignment',
          targetEntityId: assignment.id,
          reason,
          beforeData: {
            assignmentId: assignment.id,
            status: assignment.status,
            updatedAt: assignment.updated_at.toISOString(),
          },
          afterData: {
            assignmentId: assignment.id,
            status: response.assignment.status,
            updatedAt: response.assignment.updatedAt,
            affectedAppointmentCount: affected.count,
            affectedAppointmentIdsTruncated:
              response.affectedAppointmentIdsTruncated,
          },
        });
        await this.insertCommand(
          database,
          access,
          practice,
          metadata,
          { ...response },
          'practitioner_service_assignment',
          assignment.id,
        );
        return response;
      },
    );
  }

  createAvailabilityTemplate(
    request: SchedulingMutationRequest<CreateAvailabilityTemplateInput>,
  ): Promise<AvailabilityTemplateMutationResponse> {
    return this.executeMutation(
      request,
      'availability_template_create',
      { input: request.input },
      async (database, metadata) => {
        const practice = await this.requirePractice(
          database,
          request.input.organizationId,
        );
        const reason = workforceSchedulingAuditReason(request.input.reasonCode);
        const initialScope = await this.findAvailabilityAssignmentScope(
          database,
          practice,
          request.input.practitionerServiceAssignmentId,
        );
        if (!initialScope) {
          await this.requireAnySchedulingAuthorization(
            request.principal,
            practice,
            metadata.correlationId,
            'scheduling.availability_template_created',
            'practitioner_service_assignment',
            request.input.practitionerServiceAssignmentId,
            reason,
            database,
          );
          this.scopedTargetUnavailable(
            request.principal,
            practice,
            metadata.correlationId,
            'practitioner_service_assignment',
            request.input.practitionerServiceAssignmentId,
          );
        }
        const access = await this.requireFacilityAuthorization(
          request.principal,
          practice,
          initialScope.facility.facilityId,
          metadata.correlationId,
          'scheduling.availability_template_created',
          'practitioner_service_assignment',
          initialScope.practitionerServiceAssignmentId,
          reason,
          database,
        );
        const replay =
          await this.replayCommand<AvailabilityTemplateMutationResponse>(
            database,
            access,
            practice,
            metadata,
          );
        if (replay) return replay;
        this.assertTemplateAvailabilityReason(request.input.reasonCode);
        this.validateAvailabilityTemplateDefinition(request.input);

        await this.lockPractitionerMutexes(database, practice, [
          initialScope.practitionerId,
        ]);
        const scope = await this.findAvailabilityAssignmentScope(
          database,
          practice,
          request.input.practitionerServiceAssignmentId,
          'share',
        );
        if (!scope) {
          this.scopedTargetUnavailable(
            request.principal,
            practice,
            metadata.correlationId,
            'practitioner_service_assignment',
            request.input.practitionerServiceAssignmentId,
            initialScope.facility.facilityId,
          );
        }
        if (request.input.status === 'active') {
          this.assertActiveAvailabilityChain(scope);
        }
        const inserted = await database
          .insertInto('practitioner_availability_templates')
          .values({
            tenant_id: practice.tenantId,
            organization_id: practice.organizationId,
            facility_id: scope.facility.facilityId,
            practitioner_facility_assignment_id:
              scope.practitionerFacilityAssignmentId,
            practitioner_service_assignment_id:
              scope.practitionerServiceAssignmentId,
            practitioner_id: scope.practitionerId,
            appointment_service_id: scope.appointmentServiceId,
            iso_weekday: request.input.isoWeekday,
            local_start_minute: request.input.localStartMinute,
            local_end_minute: request.input.localEndMinute,
            effective_from: request.input.effectiveFrom,
            effective_until: request.input.effectiveUntil ?? null,
            source_timezone: scope.facility.timezone,
            status: request.input.status,
            is_synthetic: true,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const materialization =
          request.input.status === 'active'
            ? (
                await this.reconcileAvailability(
                  database,
                  practice,
                  scope.facility,
                  [scope.practitionerId],
                  metadata.frozenNow,
                )
              ).summary
            : this.emptyAvailabilitySummary(
                metadata.frozenNow,
                scope.facility.timezone,
              );
        const response: AvailabilityTemplateMutationResponse = {
          template: await this.loadAvailabilityTemplateView(
            database,
            practice,
            inserted.id,
          ),
          replacedTemplateId: null,
          materialization,
        };
        await this.insertSuccessAudit(database, {
          principal: request.principal,
          access,
          practice,
          facilityId: scope.facility.facilityId,
          correlationId: metadata.correlationId,
          action: 'scheduling.availability_template_created',
          targetEntityType: 'practitioner_availability_template',
          targetEntityId: inserted.id,
          reason,
          beforeData: null,
          afterData: this.availabilityAuditData(response.materialization, {
            templateId: inserted.id,
            status: response.template.status,
          }),
        });
        await this.insertCommand(
          database,
          access,
          practice,
          metadata,
          { ...response },
          'practitioner_availability_template',
          inserted.id,
        );
        return response;
      },
    );
  }

  replaceAvailabilityTemplate(
    request: SchedulingMutationRequest<ReplaceAvailabilityTemplateInput>,
    templateId: string,
  ): Promise<AvailabilityTemplateMutationResponse> {
    return this.executeMutation(
      request,
      'availability_template_replace',
      { templateId, input: request.input },
      async (database, metadata) => {
        const practice = await this.requirePractice(
          database,
          request.input.organizationId,
        );
        const reason = workforceSchedulingAuditReason(request.input.reasonCode);
        const initialTarget = await this.findAvailabilityTemplateTarget(
          database,
          practice,
          templateId,
        );
        if (!initialTarget) {
          await this.requireAnySchedulingAuthorization(
            request.principal,
            practice,
            metadata.correlationId,
            'scheduling.availability_template_replaced',
            'practitioner_availability_template',
            templateId,
            reason,
            database,
          );
          this.scopedTargetUnavailable(
            request.principal,
            practice,
            metadata.correlationId,
            'practitioner_availability_template',
            templateId,
          );
        }
        const facility = await this.requireMutationFacility(
          database,
          practice,
          initialTarget.facilityId,
          request.principal,
          metadata.correlationId,
          'scheduling.availability_template_replaced',
          reason,
        );
        const access = await this.requireFacilityAuthorization(
          request.principal,
          practice,
          facility.facilityId,
          metadata.correlationId,
          'scheduling.availability_template_replaced',
          'practitioner_availability_template',
          templateId,
          reason,
          database,
        );
        const replay =
          await this.replayCommand<AvailabilityTemplateMutationResponse>(
            database,
            access,
            practice,
            metadata,
          );
        if (replay) return replay;
        this.assertTemplateAvailabilityReason(request.input.reasonCode);
        this.validateAvailabilityTemplateDefinition(request.input);
        if (
          request.input.practitionerServiceAssignmentId !==
          initialTarget.practitionerServiceAssignmentId
        ) {
          throw new WorkforceSchedulingConflictError(
            'A replacement must retain the original provider eligibility scope.',
          );
        }

        await this.lockPractitionerMutexes(database, practice, [
          initialTarget.practitionerId,
        ]);
        await this.loadStoredAvailabilitySlots(
          database,
          practice,
          facility,
          [initialTarget.practitionerId],
          metadata.frozenNow,
        );
        const target = await this.findAvailabilityTemplateTarget(
          database,
          practice,
          templateId,
          true,
        );
        if (!target) {
          this.scopedTargetUnavailable(
            request.principal,
            practice,
            metadata.correlationId,
            'practitioner_availability_template',
            templateId,
            facility.facilityId,
          );
        }
        if (
          !matchesExpectedTimestamp(
            target.updatedAt,
            request.input.expectedUpdatedAt,
          )
        ) {
          throw new WorkforceSchedulingConflictError(
            'The availability template changed before this request was applied.',
          );
        }
        const scope = await this.findAvailabilityAssignmentScope(
          database,
          practice,
          target.practitionerServiceAssignmentId,
          'share',
        );
        if (!scope) throw new WorkforceSchedulingPersistenceError();
        if (request.input.status === 'active') {
          this.assertActiveAvailabilityChain(scope);
        }

        const existing = await database
          .selectFrom('practitioner_availability_templates as template')
          .select(['template.id', 'template.status'])
          .where(
            'template.practitioner_service_assignment_id',
            '=',
            scope.practitionerServiceAssignmentId,
          )
          .where('template.iso_weekday', '=', request.input.isoWeekday)
          .where(
            'template.local_start_minute',
            '=',
            request.input.localStartMinute,
          )
          .where('template.local_end_minute', '=', request.input.localEndMinute)
          .where('template.effective_from', '=', request.input.effectiveFrom)
          .where(
            'template.effective_until',
            request.input.effectiveUntil === undefined ? 'is' : '=',
            request.input.effectiveUntil ?? null,
          )
          .where('template.source_timezone', '=', facility.timezone)
          .forUpdate()
          .executeTakeFirst();
        const updatedAt = new Date();
        let replacementId: string;
        if (existing) {
          replacementId = existing.id;
          if (target.id !== existing.id && target.status !== 'inactive') {
            await database
              .updateTable('practitioner_availability_templates')
              .set({ status: 'inactive', updated_at: updatedAt })
              .where('id', '=', target.id)
              .executeTakeFirstOrThrow();
          }
          if (existing.status !== request.input.status) {
            await database
              .updateTable('practitioner_availability_templates')
              .set({ status: request.input.status, updated_at: updatedAt })
              .where('id', '=', existing.id)
              .executeTakeFirstOrThrow();
          }
        } else {
          if (target.status !== 'inactive') {
            await database
              .updateTable('practitioner_availability_templates')
              .set({ status: 'inactive', updated_at: updatedAt })
              .where('id', '=', target.id)
              .executeTakeFirstOrThrow();
          }
          const inserted = await database
            .insertInto('practitioner_availability_templates')
            .values({
              tenant_id: practice.tenantId,
              organization_id: practice.organizationId,
              facility_id: facility.facilityId,
              practitioner_facility_assignment_id:
                scope.practitionerFacilityAssignmentId,
              practitioner_service_assignment_id:
                scope.practitionerServiceAssignmentId,
              practitioner_id: scope.practitionerId,
              appointment_service_id: scope.appointmentServiceId,
              iso_weekday: request.input.isoWeekday,
              local_start_minute: request.input.localStartMinute,
              local_end_minute: request.input.localEndMinute,
              effective_from: request.input.effectiveFrom,
              effective_until: request.input.effectiveUntil ?? null,
              source_timezone: facility.timezone,
              status: request.input.status,
              is_synthetic: true,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          replacementId = inserted.id;
        }
        const materialization = (
          await this.reconcileAvailability(
            database,
            practice,
            facility,
            [scope.practitionerId],
            metadata.frozenNow,
          )
        ).summary;
        const response: AvailabilityTemplateMutationResponse = {
          template: await this.loadAvailabilityTemplateView(
            database,
            practice,
            replacementId,
          ),
          replacedTemplateId: replacementId === target.id ? null : target.id,
          materialization,
        };
        await this.insertSuccessAudit(database, {
          principal: request.principal,
          access,
          practice,
          facilityId: facility.facilityId,
          correlationId: metadata.correlationId,
          action: 'scheduling.availability_template_replaced',
          targetEntityType: 'practitioner_availability_template',
          targetEntityId: replacementId,
          reason,
          beforeData: {
            templateId: target.id,
            status: target.status,
            updatedAt: target.updatedAt.toISOString(),
          },
          afterData: this.availabilityAuditData(materialization, {
            templateId: replacementId,
            replacedTemplateId: replacementId === target.id ? null : target.id,
            status: response.template.status,
          }),
        });
        await this.insertCommand(
          database,
          access,
          practice,
          metadata,
          { ...response },
          'practitioner_availability_template',
          replacementId,
        );
        return response;
      },
    );
  }

  changeAvailabilityTemplateStatus(
    request: SchedulingMutationRequest<ChangeAvailabilityTemplateStatusInput>,
    templateId: string,
  ): Promise<AvailabilityTemplateMutationResponse> {
    return this.executeMutation(
      request,
      'availability_template_status',
      { templateId, input: request.input },
      async (database, metadata) => {
        const practice = await this.requirePractice(
          database,
          request.input.organizationId,
        );
        const reason = workforceSchedulingAuditReason(request.input.reasonCode);
        const initial = await this.findAvailabilityTemplateTarget(
          database,
          practice,
          templateId,
        );
        if (!initial) {
          await this.requireAnySchedulingAuthorization(
            request.principal,
            practice,
            metadata.correlationId,
            'scheduling.availability_template_status_changed',
            'practitioner_availability_template',
            templateId,
            reason,
            database,
          );
          this.scopedTargetUnavailable(
            request.principal,
            practice,
            metadata.correlationId,
            'practitioner_availability_template',
            templateId,
          );
        }
        const facility = await this.requireMutationFacility(
          database,
          practice,
          initial.facilityId,
          request.principal,
          metadata.correlationId,
          'scheduling.availability_template_status_changed',
          reason,
        );
        const access = await this.requireFacilityAuthorization(
          request.principal,
          practice,
          facility.facilityId,
          metadata.correlationId,
          'scheduling.availability_template_status_changed',
          'practitioner_availability_template',
          templateId,
          reason,
          database,
        );
        const replay =
          await this.replayCommand<AvailabilityTemplateMutationResponse>(
            database,
            access,
            practice,
            metadata,
          );
        if (replay) return replay;
        this.assertTemplateAvailabilityReason(request.input.reasonCode);
        await this.lockPractitionerMutexes(database, practice, [
          initial.practitionerId,
        ]);
        await this.loadStoredAvailabilitySlots(
          database,
          practice,
          facility,
          [initial.practitionerId],
          metadata.frozenNow,
        );
        const target = await this.findAvailabilityTemplateTarget(
          database,
          practice,
          templateId,
          true,
        );
        if (!target) {
          this.scopedTargetUnavailable(
            request.principal,
            practice,
            metadata.correlationId,
            'practitioner_availability_template',
            templateId,
            facility.facilityId,
          );
        }
        if (
          !matchesExpectedTimestamp(
            target.updatedAt,
            request.input.expectedUpdatedAt,
          )
        ) {
          throw new WorkforceSchedulingConflictError(
            'The availability template changed before this request was applied.',
          );
        }
        const scope = await this.findAvailabilityAssignmentScope(
          database,
          practice,
          target.practitionerServiceAssignmentId,
          'share',
        );
        if (!scope) throw new WorkforceSchedulingPersistenceError();
        if (request.input.status === 'active') {
          this.assertActiveAvailabilityChain(scope);
        }
        const updatedAt = new Date();
        await database
          .updateTable('practitioner_availability_templates')
          .set({ status: request.input.status, updated_at: updatedAt })
          .where('id', '=', target.id)
          .executeTakeFirstOrThrow();
        const materialization = (
          await this.reconcileAvailability(
            database,
            practice,
            facility,
            [scope.practitionerId],
            metadata.frozenNow,
          )
        ).summary;
        const response: AvailabilityTemplateMutationResponse = {
          template: await this.loadAvailabilityTemplateView(
            database,
            practice,
            target.id,
          ),
          replacedTemplateId: null,
          materialization,
        };
        await this.insertSuccessAudit(database, {
          principal: request.principal,
          access,
          practice,
          facilityId: facility.facilityId,
          correlationId: metadata.correlationId,
          action: 'scheduling.availability_template_status_changed',
          targetEntityType: 'practitioner_availability_template',
          targetEntityId: target.id,
          reason,
          beforeData: {
            templateId: target.id,
            status: target.status,
            updatedAt: target.updatedAt.toISOString(),
          },
          afterData: this.availabilityAuditData(materialization, {
            templateId: target.id,
            status: response.template.status,
            updatedAt: response.template.updatedAt,
          }),
        });
        await this.insertCommand(
          database,
          access,
          practice,
          metadata,
          { ...response },
          'practitioner_availability_template',
          target.id,
        );
        return response;
      },
    );
  }

  materializeAvailabilityTemplate(
    request: SchedulingMutationRequest<MaterializeAvailabilityTemplateInput>,
    templateId: string,
  ): Promise<AvailabilityTemplateMutationResponse> {
    return this.executeMutation(
      request,
      'availability_template_materialize',
      { templateId, input: request.input },
      async (database, metadata) => {
        const practice = await this.requirePractice(
          database,
          request.input.organizationId,
        );
        const reason = workforceSchedulingAuditReason(request.input.reasonCode);
        const initial = await this.findAvailabilityTemplateTarget(
          database,
          practice,
          templateId,
        );
        if (!initial) {
          await this.requireAnySchedulingAuthorization(
            request.principal,
            practice,
            metadata.correlationId,
            'scheduling.availability_template_materialized',
            'practitioner_availability_template',
            templateId,
            reason,
            database,
          );
          this.scopedTargetUnavailable(
            request.principal,
            practice,
            metadata.correlationId,
            'practitioner_availability_template',
            templateId,
          );
        }
        const facility = await this.requireMutationFacility(
          database,
          practice,
          initial.facilityId,
          request.principal,
          metadata.correlationId,
          'scheduling.availability_template_materialized',
          reason,
        );
        const access = await this.requireFacilityAuthorization(
          request.principal,
          practice,
          facility.facilityId,
          metadata.correlationId,
          'scheduling.availability_template_materialized',
          'practitioner_availability_template',
          templateId,
          reason,
          database,
        );
        const replay =
          await this.replayCommand<AvailabilityTemplateMutationResponse>(
            database,
            access,
            practice,
            metadata,
          );
        if (replay) return replay;
        this.assertTemplateAvailabilityReason(request.input.reasonCode);
        await this.lockPractitionerMutexes(database, practice, [
          initial.practitionerId,
        ]);
        await this.loadStoredAvailabilitySlots(
          database,
          practice,
          facility,
          [initial.practitionerId],
          metadata.frozenNow,
        );
        const target = await this.findAvailabilityTemplateTarget(
          database,
          practice,
          templateId,
          true,
        );
        if (!target) throw new WorkforceSchedulingPersistenceError();
        if (
          !matchesExpectedTimestamp(
            target.updatedAt,
            request.input.expectedUpdatedAt,
          )
        ) {
          throw new WorkforceSchedulingConflictError(
            'The availability template changed before this request was applied.',
          );
        }
        if (target.status !== 'active') {
          throw new WorkforceSchedulingConflictError(
            'Only an active availability template can be materialized.',
          );
        }
        const scope = await this.findAvailabilityAssignmentScope(
          database,
          practice,
          target.practitionerServiceAssignmentId,
          'share',
        );
        if (!scope) throw new WorkforceSchedulingPersistenceError();
        this.assertActiveAvailabilityChain(scope);
        const materialization = (
          await this.reconcileAvailability(
            database,
            practice,
            facility,
            [scope.practitionerId],
            metadata.frozenNow,
          )
        ).summary;
        const response: AvailabilityTemplateMutationResponse = {
          template: await this.loadAvailabilityTemplateView(
            database,
            practice,
            target.id,
          ),
          replacedTemplateId: null,
          materialization,
        };
        await this.insertSuccessAudit(database, {
          principal: request.principal,
          access,
          practice,
          facilityId: facility.facilityId,
          correlationId: metadata.correlationId,
          action: 'scheduling.availability_template_materialized',
          targetEntityType: 'practitioner_availability_template',
          targetEntityId: target.id,
          reason,
          beforeData: null,
          afterData: this.availabilityAuditData(materialization, {
            templateId: target.id,
            status: target.status,
          }),
        });
        await this.insertCommand(
          database,
          access,
          practice,
          metadata,
          { ...response },
          'practitioner_availability_template',
          target.id,
        );
        return response;
      },
    );
  }

  createAvailabilityException(
    request: SchedulingMutationRequest<CreateAvailabilityExceptionInput>,
  ): Promise<AvailabilityExceptionMutationResponse> {
    return this.executeMutation(
      request,
      'availability_exception_create',
      { input: request.input },
      async (database, metadata) => {
        const practice = await this.requirePractice(
          database,
          request.input.organizationId,
        );
        const reason = workforceSchedulingAuditReason(request.input.reasonCode);
        const facility = await this.requireMutationFacility(
          database,
          practice,
          request.input.facilityId,
          request.principal,
          metadata.correlationId,
          'scheduling.availability_exception_created',
          reason,
        );
        const access = await this.requireFacilityAuthorization(
          request.principal,
          practice,
          facility.facilityId,
          metadata.correlationId,
          'scheduling.availability_exception_created',
          'facility',
          facility.facilityId,
          reason,
          database,
        );
        const replay =
          await this.replayCommand<AvailabilityExceptionMutationResponse>(
            database,
            access,
            practice,
            metadata,
          );
        if (replay) return replay;

        await this.requireActiveBookablePractice(database, practice);

        const expectedReason =
          request.input.kind === 'facility_closed'
            ? 'facility-availability-change'
            : 'provider-availability-change';
        if (request.input.reasonCode !== expectedReason) {
          throw new WorkforceSchedulingValidationError(
            'The exception reason does not match its immutable scope.',
          );
        }
        const resolved = resolveCanonicalLocalException({
          localStartsAt: request.input.localStartsAt,
          localEndsAt: request.input.localEndsAt,
          sourceTimezone: facility.timezone,
          isAllDay: request.input.isAllDay,
          horizon: captureAvailabilityHorizon(
            metadata.frozenNow,
            facility.timezone,
          ),
        });

        let practitionerFacilityAssignmentId: string | null = null;
        let practitionerId: string | null = null;
        let affectedPractitionerIds: string[];
        if (request.input.kind === 'practitioner_unavailable') {
          if (!request.input.practitionerFacilityAssignmentId) {
            throw new WorkforceSchedulingValidationError(
              'A practitioner-unavailable exception requires an exact active facility affiliation.',
            );
          }
          try {
            const practitioner =
              await this.requireActivePractitionerFacilityScope(
                database,
                practice,
                facility.facilityId,
                request.input.practitionerFacilityAssignmentId,
              );
            practitionerFacilityAssignmentId = practitioner.assignmentId;
            practitionerId = practitioner.practitionerId;
            affectedPractitionerIds = [practitioner.practitionerId];
          } catch (error) {
            if (!(error instanceof WorkforceSchedulingTargetUnavailableError)) {
              throw error;
            }
            this.scopedTargetUnavailable(
              request.principal,
              practice,
              metadata.correlationId,
              'practitioner_facility_assignment',
              request.input.practitionerFacilityAssignmentId,
              facility.facilityId,
            );
          }
        } else {
          if (request.input.practitionerFacilityAssignmentId !== undefined) {
            throw new WorkforceSchedulingValidationError(
              'A facility closure cannot target one practitioner.',
            );
          }
          affectedPractitionerIds =
            await this.availabilityPractitionerIdsForFacility(
              database,
              practice,
              facility.facilityId,
            );
        }
        await this.lockPractitionerMutexes(
          database,
          practice,
          affectedPractitionerIds,
        );
        await this.loadStoredAvailabilitySlots(
          database,
          practice,
          facility,
          affectedPractitionerIds,
          metadata.frozenNow,
        );
        const inserted = await database
          .insertInto('provider_availability_exceptions')
          .values({
            tenant_id: practice.tenantId,
            organization_id: practice.organizationId,
            facility_id: facility.facilityId,
            practitioner_facility_assignment_id:
              practitionerFacilityAssignmentId,
            practitioner_id: practitionerId,
            kind: request.input.kind,
            is_all_day: request.input.isAllDay,
            local_starts_at: resolved.localStartsAt,
            local_ends_at: resolved.localEndsAt,
            starts_at: resolved.startsAt,
            ends_at: resolved.endsAt,
            source_timezone: facility.timezone,
            status: 'active',
            is_synthetic: true,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const materialization = (
          await this.reconcileAvailability(
            database,
            practice,
            facility,
            affectedPractitionerIds,
            metadata.frozenNow,
          )
        ).summary;
        const response: AvailabilityExceptionMutationResponse = {
          exception: await this.loadAvailabilityExceptionView(
            database,
            practice,
            inserted.id,
          ),
          materialization,
        };
        await this.insertSuccessAudit(database, {
          principal: request.principal,
          access,
          practice,
          facilityId: facility.facilityId,
          correlationId: metadata.correlationId,
          action: 'scheduling.availability_exception_created',
          targetEntityType: 'provider_availability_exception',
          targetEntityId: inserted.id,
          reason,
          beforeData: null,
          afterData: this.availabilityAuditData(materialization, {
            exceptionId: inserted.id,
            exceptionKind: request.input.kind,
            status: 'active',
            practitionerScoped: practitionerId !== null,
          }),
        });
        await this.insertCommand(
          database,
          access,
          practice,
          metadata,
          { ...response },
          'provider_availability_exception',
          inserted.id,
        );
        return response;
      },
    );
  }

  cancelAvailabilityException(
    request: SchedulingMutationRequest<CancelAvailabilityExceptionInput>,
    exceptionId: string,
  ): Promise<AvailabilityExceptionMutationResponse> {
    return this.executeMutation(
      request,
      'availability_exception_cancel',
      { exceptionId, input: request.input },
      async (database, metadata) => {
        const practice = await this.requirePractice(
          database,
          request.input.organizationId,
        );
        const reason = workforceSchedulingAuditReason(request.input.reasonCode);
        const initial = await this.findAvailabilityExceptionTarget(
          database,
          practice,
          exceptionId,
        );
        if (!initial) {
          await this.requireAnySchedulingAuthorization(
            request.principal,
            practice,
            metadata.correlationId,
            'scheduling.availability_exception_cancelled',
            'provider_availability_exception',
            exceptionId,
            reason,
            database,
          );
          this.scopedTargetUnavailable(
            request.principal,
            practice,
            metadata.correlationId,
            'provider_availability_exception',
            exceptionId,
          );
        }
        const facility = await this.requireMutationFacility(
          database,
          practice,
          initial.facilityId,
          request.principal,
          metadata.correlationId,
          'scheduling.availability_exception_cancelled',
          reason,
        );
        const access = await this.requireFacilityAuthorization(
          request.principal,
          practice,
          facility.facilityId,
          metadata.correlationId,
          'scheduling.availability_exception_cancelled',
          'provider_availability_exception',
          exceptionId,
          reason,
          database,
        );
        const replay =
          await this.replayCommand<AvailabilityExceptionMutationResponse>(
            database,
            access,
            practice,
            metadata,
          );
        if (replay) return replay;
        const expectedReason =
          initial.kind === 'facility_closed'
            ? 'facility-availability-change'
            : 'provider-availability-change';
        if (request.input.reasonCode !== expectedReason) {
          throw new WorkforceSchedulingValidationError(
            'The exception cancellation reason does not match its immutable scope.',
          );
        }

        const affectedPractitionerIds = initial.practitionerId
          ? [initial.practitionerId]
          : await this.availabilityPractitionerIdsForFacility(
              database,
              practice,
              facility.facilityId,
            );
        await this.lockPractitionerMutexes(
          database,
          practice,
          affectedPractitionerIds,
        );
        await this.loadStoredAvailabilitySlots(
          database,
          practice,
          facility,
          affectedPractitionerIds,
          metadata.frozenNow,
        );
        const target = await this.findAvailabilityExceptionTarget(
          database,
          practice,
          exceptionId,
          true,
        );
        if (!target) {
          this.scopedTargetUnavailable(
            request.principal,
            practice,
            metadata.correlationId,
            'provider_availability_exception',
            exceptionId,
            facility.facilityId,
          );
        }
        if (
          !matchesExpectedTimestamp(
            target.updatedAt,
            request.input.expectedUpdatedAt,
          )
        ) {
          throw new WorkforceSchedulingConflictError(
            'The availability exception changed before this request was applied.',
          );
        }
        if (target.status === 'cancelled') {
          throw new WorkforceSchedulingConflictError(
            'The availability exception is already terminally cancelled.',
          );
        }
        const updatedAt = new Date();
        await database
          .updateTable('provider_availability_exceptions')
          .set({ status: 'cancelled', updated_at: updatedAt })
          .where('id', '=', target.id)
          .executeTakeFirstOrThrow();
        const materialization = (
          await this.reconcileAvailability(
            database,
            practice,
            facility,
            affectedPractitionerIds,
            metadata.frozenNow,
          )
        ).summary;
        const response: AvailabilityExceptionMutationResponse = {
          exception: await this.loadAvailabilityExceptionView(
            database,
            practice,
            target.id,
          ),
          materialization,
        };
        await this.insertSuccessAudit(database, {
          principal: request.principal,
          access,
          practice,
          facilityId: facility.facilityId,
          correlationId: metadata.correlationId,
          action: 'scheduling.availability_exception_cancelled',
          targetEntityType: 'provider_availability_exception',
          targetEntityId: target.id,
          reason,
          beforeData: {
            exceptionId: target.id,
            status: target.status,
            updatedAt: target.updatedAt.toISOString(),
          },
          afterData: this.availabilityAuditData(materialization, {
            exceptionId: target.id,
            status: response.exception.status,
            updatedAt: response.exception.updatedAt,
          }),
        });
        await this.insertCommand(
          database,
          access,
          practice,
          metadata,
          { ...response },
          'provider_availability_exception',
          target.id,
        );
        return response;
      },
    );
  }

  changeServiceDuration(
    request: SchedulingMutationRequest<ChangeAppointmentServiceDurationInput>,
    serviceId: string,
  ): Promise<AppointmentServiceDurationMutationResponse> {
    return this.executeMutation(
      request,
      'service_duration_update',
      { serviceId, input: request.input },
      async (database, metadata) => {
        const practice = await this.requirePractice(
          database,
          request.input.organizationId,
        );
        const reason = workforceSchedulingAuditReason(request.input.reasonCode);
        const initial = await this.findAvailabilityServiceTarget(
          database,
          practice,
          serviceId,
        );
        if (!initial) {
          await this.requireAnySchedulingAuthorization(
            request.principal,
            practice,
            metadata.correlationId,
            'scheduling.service_duration_changed',
            'appointment_service',
            serviceId,
            reason,
            database,
          );
          this.scopedTargetUnavailable(
            request.principal,
            practice,
            metadata.correlationId,
            'appointment_service',
            serviceId,
          );
        }
        const access = await this.requireFacilityAuthorization(
          request.principal,
          practice,
          initial.facility.facilityId,
          metadata.correlationId,
          'scheduling.service_duration_changed',
          'appointment_service',
          serviceId,
          reason,
          database,
        );
        const replay =
          await this.replayCommand<AppointmentServiceDurationMutationResponse>(
            database,
            access,
            practice,
            metadata,
          );
        if (replay) return replay;
        if (request.input.reasonCode !== 'service-duration-change') {
          throw new WorkforceSchedulingValidationError(
            'Service duration changes require the service-duration-change reason.',
          );
        }
        if (
          !Number.isInteger(request.input.durationMinutes) ||
          request.input.durationMinutes < 1 ||
          request.input.durationMinutes > 1440
        ) {
          throw new WorkforceSchedulingValidationError(
            'Appointment service duration must be a whole number from 1 through 1440 minutes.',
          );
        }

        const affected = await this.availabilityPractitionersForService(
          database,
          practice,
          serviceId,
        );
        await this.lockPractitionerMutexes(
          database,
          practice,
          affected.practitionerIds,
        );
        // This command deliberately locks slots before the service row so it
        // shares booking's slot -> provider-chain order.
        await this.loadStoredAvailabilitySlots(
          database,
          practice,
          initial.facility,
          affected.practitionerIds,
          metadata.frozenNow,
        );
        const target = await this.findAvailabilityServiceTarget(
          database,
          practice,
          serviceId,
          true,
        );
        if (!target) {
          this.scopedTargetUnavailable(
            request.principal,
            practice,
            metadata.correlationId,
            'appointment_service',
            serviceId,
            initial.facility.facilityId,
          );
        }
        if (
          !matchesExpectedTimestamp(
            target.updatedAt,
            request.input.expectedUpdatedAt,
          )
        ) {
          throw new WorkforceSchedulingConflictError(
            'The appointment service changed before this request was applied.',
          );
        }
        if (target.durationMinutes === request.input.durationMinutes) {
          throw new WorkforceSchedulingConflictError(
            'The appointment service already uses that duration.',
          );
        }
        for (const assignmentId of affected.activeAssignmentIds) {
          const scope = await this.findAvailabilityAssignmentScope(
            database,
            practice,
            assignmentId,
            'share',
          );
          if (!scope) throw new WorkforceSchedulingPersistenceError();
          this.assertActiveAvailabilityChain(scope);
        }
        const updatedAt = new Date();
        await database
          .updateTable('appointment_services')
          .set({
            duration_minutes: request.input.durationMinutes,
            updated_at: updatedAt,
          })
          .where('id', '=', target.id)
          .executeTakeFirstOrThrow();
        const materialization = (
          await this.reconcileAvailability(
            database,
            practice,
            target.facility,
            affected.practitionerIds,
            metadata.frozenNow,
          )
        ).summary;
        const response: AppointmentServiceDurationMutationResponse = {
          service: await this.loadService(database, practice, target.id),
          materialization,
        };
        await this.insertSuccessAudit(database, {
          principal: request.principal,
          access,
          practice,
          facilityId: target.facility.facilityId,
          correlationId: metadata.correlationId,
          action: 'scheduling.service_duration_changed',
          targetEntityType: 'appointment_service',
          targetEntityId: target.id,
          reason,
          beforeData: {
            serviceId: target.id,
            durationMinutes: target.durationMinutes,
            updatedAt: target.updatedAt.toISOString(),
          },
          afterData: this.availabilityAuditData(materialization, {
            serviceId: target.id,
            durationMinutes: response.service.durationMinutes,
            updatedAt: response.service.updatedAt,
          }),
        });
        await this.insertCommand(
          database,
          access,
          practice,
          metadata,
          { ...response },
          'appointment_service',
          target.id,
        );
        return response;
      },
    );
  }

  private mapAvailabilityTemplateView(template: {
    id: string;
    facility_id: string;
    facility_name: string;
    practitioner_facility_assignment_id: string;
    practitioner_service_assignment_id: string;
    practitioner_id: string;
    practitioner_display_name: string;
    appointment_service_id: string;
    service_name: string;
    duration_minutes: number;
    iso_weekday: number;
    local_start_minute: number;
    local_end_minute: number;
    effective_from: string;
    effective_until: string | null;
    source_timezone: string;
    status: WorkforceAvailabilityTemplateView['status'];
    updated_at: Date;
  }): WorkforceAvailabilityTemplateView {
    return {
      availabilityTemplateId: template.id,
      facilityId: template.facility_id,
      facilityName: template.facility_name,
      practitionerFacilityAssignmentId:
        template.practitioner_facility_assignment_id,
      practitionerServiceAssignmentId:
        template.practitioner_service_assignment_id,
      practitionerId: template.practitioner_id,
      practitionerDisplayName: template.practitioner_display_name,
      appointmentServiceId: template.appointment_service_id,
      serviceName: template.service_name,
      durationMinutes: template.duration_minutes,
      isoWeekday: template.iso_weekday,
      localStartMinute: template.local_start_minute,
      localEndMinute: template.local_end_minute,
      effectiveFrom: template.effective_from,
      effectiveUntil: template.effective_until,
      sourceTimezone: template.source_timezone,
      status: template.status,
      updatedAt: template.updated_at.toISOString(),
    };
  }

  private mapAvailabilityExceptionView(exception: {
    id: string;
    facility_id: string;
    facility_name: string;
    practitioner_facility_assignment_id: string | null;
    practitioner_id: string | null;
    practitioner_display_name: string | null;
    kind: WorkforceAvailabilityExceptionView['kind'];
    is_all_day: boolean;
    local_starts_at: string;
    local_ends_at: string;
    starts_at: Date;
    ends_at: Date;
    source_timezone: string;
    status: WorkforceAvailabilityExceptionView['status'];
    updated_at: Date;
  }): WorkforceAvailabilityExceptionView {
    const localStartsAt = exception.local_starts_at.replace(' ', 'T');
    const localEndsAt = exception.local_ends_at.replace(' ', 'T');
    parseCanonicalLocalDateTime(localStartsAt);
    parseCanonicalLocalDateTime(localEndsAt);
    return {
      availabilityExceptionId: exception.id,
      facilityId: exception.facility_id,
      facilityName: exception.facility_name,
      practitionerFacilityAssignmentId:
        exception.practitioner_facility_assignment_id,
      practitionerId: exception.practitioner_id,
      practitionerDisplayName: exception.practitioner_display_name,
      kind: exception.kind,
      isAllDay: exception.is_all_day,
      localStartsAt,
      localEndsAt,
      startsAt: exception.starts_at.toISOString(),
      endsAt: exception.ends_at.toISOString(),
      sourceTimezone: exception.source_timezone,
      status: exception.status,
      updatedAt: exception.updated_at.toISOString(),
    };
  }

  private async findAvailabilityAssignmentScope(
    database: DatabaseExecutor,
    practice: PracticeContext,
    assignmentId: string,
    lock: 'share' | false = false,
  ): Promise<AvailabilityAssignmentScope | null> {
    let query = database
      .selectFrom('practitioner_service_assignments as service_assignment')
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
      .innerJoin('patient_portal_bookable_practices as bookable', (join) =>
        join
          .onRef('bookable.tenant_id', '=', 'service_assignment.tenant_id')
          .onRef(
            'bookable.organization_id',
            '=',
            'service_assignment.organization_id',
          ),
      )
      .select([
        'bookable.id as bookable_practice_id',
        'facility.id as facility_id',
        'facility.name as facility_name',
        'facility.timezone',
        'facility_assignment.id as facility_assignment_id',
        'service_assignment.id as service_assignment_id',
        'practitioner.id as practitioner_id',
        'service.id as service_id',
        'service.duration_minutes',
        'practitioner.status as practitioner_status',
        'facility_assignment.status as facility_assignment_status',
        'service_assignment.status as service_assignment_status',
        'service.status as service_status',
        'specialty.status as specialty_status',
      ])
      .where('service_assignment.id', '=', assignmentId)
      .where('service_assignment.tenant_id', '=', practice.tenantId)
      .where('service_assignment.organization_id', '=', practice.organizationId)
      .where('service_assignment.is_synthetic', '=', true)
      .where('facility_assignment.is_synthetic', '=', true)
      .where('practitioner.is_synthetic', '=', true)
      .where('service.is_synthetic', '=', true)
      .where('specialty.is_synthetic', '=', true)
      .where('facility.is_synthetic', '=', true)
      .where('bookable.is_synthetic', '=', true)
      .where('bookable.status', '=', 'active');
    if (lock === 'share') {
      query = query.forShare([
        'service_assignment',
        'facility_assignment',
        'practitioner',
        'service',
        'specialty',
        'facility',
        'bookable',
      ]);
    }
    const row = await query.executeTakeFirst();
    if (!row) return null;
    return {
      bookablePracticeId: row.bookable_practice_id,
      facility: {
        facilityId: row.facility_id,
        facilityName: row.facility_name,
        timezone: row.timezone,
      },
      practitionerFacilityAssignmentId: row.facility_assignment_id,
      practitionerServiceAssignmentId: row.service_assignment_id,
      practitionerId: row.practitioner_id,
      appointmentServiceId: row.service_id,
      durationMinutes: row.duration_minutes,
      practitionerStatus: row.practitioner_status,
      facilityAssignmentStatus: row.facility_assignment_status,
      serviceAssignmentStatus: row.service_assignment_status,
      serviceStatus: row.service_status,
      specialtyStatus: row.specialty_status,
    };
  }

  private async findAvailabilityTemplateTarget(
    database: DatabaseExecutor,
    practice: PracticeContext,
    templateId: string,
    lock = false,
  ): Promise<AvailabilityTemplateTarget | null> {
    let query = database
      .selectFrom('practitioner_availability_templates as template')
      .select([
        'template.id',
        'template.facility_id',
        'template.practitioner_service_assignment_id',
        'template.practitioner_id',
        'template.status',
        'template.updated_at',
      ])
      .where('template.id', '=', templateId)
      .where('template.tenant_id', '=', practice.tenantId)
      .where('template.organization_id', '=', practice.organizationId)
      .where('template.is_synthetic', '=', true);
    if (lock) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    return row
      ? {
          id: row.id,
          facilityId: row.facility_id,
          practitionerServiceAssignmentId:
            row.practitioner_service_assignment_id,
          practitionerId: row.practitioner_id,
          status: row.status,
          updatedAt: row.updated_at,
        }
      : null;
  }

  private async findAvailabilityExceptionTarget(
    database: DatabaseExecutor,
    practice: PracticeContext,
    exceptionId: string,
    lock = false,
  ): Promise<AvailabilityExceptionTarget | null> {
    let query = database
      .selectFrom('provider_availability_exceptions as exception')
      .select([
        'exception.id',
        'exception.facility_id',
        'exception.practitioner_facility_assignment_id',
        'exception.practitioner_id',
        'exception.kind',
        'exception.status',
        'exception.updated_at',
      ])
      .where('exception.id', '=', exceptionId)
      .where('exception.tenant_id', '=', practice.tenantId)
      .where('exception.organization_id', '=', practice.organizationId)
      .where('exception.is_synthetic', '=', true);
    if (lock) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    return row
      ? {
          id: row.id,
          facilityId: row.facility_id,
          practitionerFacilityAssignmentId:
            row.practitioner_facility_assignment_id,
          practitionerId: row.practitioner_id,
          kind: row.kind,
          status: row.status,
          updatedAt: row.updated_at,
        }
      : null;
  }

  private async findAvailabilityServiceTarget(
    database: DatabaseExecutor,
    practice: PracticeContext,
    serviceId: string,
    lock = false,
  ): Promise<AvailabilityServiceTarget | null> {
    let query = database
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
      .innerJoin('patient_portal_bookable_practices as bookable', (join) =>
        join
          .onRef('bookable.tenant_id', '=', 'service.tenant_id')
          .onRef('bookable.organization_id', '=', 'service.organization_id'),
      )
      .select([
        'service.id',
        'facility.id as facility_id',
        'facility.name as facility_name',
        'facility.timezone',
        'service.duration_minutes',
        'service.status',
        'specialty.status as specialty_status',
        'service.updated_at',
      ])
      .where('service.id', '=', serviceId)
      .where('service.tenant_id', '=', practice.tenantId)
      .where('service.organization_id', '=', practice.organizationId)
      .where('service.is_synthetic', '=', true)
      .where('facility.is_synthetic', '=', true)
      .where('specialty.is_synthetic', '=', true)
      .where('bookable.is_synthetic', '=', true)
      .where('bookable.status', '=', 'active');
    if (lock) query = query.forUpdate('service');
    const row = await query.executeTakeFirst();
    return row
      ? {
          id: row.id,
          facility: {
            facilityId: row.facility_id,
            facilityName: row.facility_name,
            timezone: row.timezone,
          },
          durationMinutes: row.duration_minutes,
          status: row.status,
          specialtyStatus: row.specialty_status,
          updatedAt: row.updated_at,
        }
      : null;
  }

  private async availabilityPractitionersForService(
    database: DatabaseExecutor,
    practice: PracticeContext,
    serviceId: string,
  ): Promise<{ practitionerIds: string[]; activeAssignmentIds: string[] }> {
    const rows = await database
      .selectFrom('practitioner_service_assignments as assignment')
      .leftJoin('practitioner_availability_templates as template', (join) =>
        join
          .onRef(
            'template.practitioner_service_assignment_id',
            '=',
            'assignment.id',
          )
          .on('template.is_synthetic', '=', true),
      )
      .select([
        'assignment.practitioner_id',
        'assignment.id as practitioner_service_assignment_id',
        'template.status as template_status',
      ])
      .where('assignment.tenant_id', '=', practice.tenantId)
      .where('assignment.organization_id', '=', practice.organizationId)
      .where('assignment.appointment_service_id', '=', serviceId)
      .where('assignment.is_synthetic', '=', true)
      .orderBy('assignment.practitioner_id', 'asc')
      .orderBy('assignment.id', 'asc')
      .execute();
    return {
      practitionerIds: [...new Set(rows.map((row) => row.practitioner_id))],
      activeAssignmentIds: [
        ...new Set(
          rows
            .filter(({ template_status }) => template_status === 'active')
            .map((row) => row.practitioner_service_assignment_id),
        ),
      ],
    };
  }

  private async requireActivePractitionerFacilityScope(
    database: Transaction<DatabaseSchema>,
    practice: PracticeContext,
    facilityId: string,
    assignmentId: string,
  ): Promise<{ assignmentId: string; practitionerId: string }> {
    const row = await database
      .selectFrom('practitioner_facility_assignments as assignment')
      .innerJoin('practitioners as practitioner', (join) =>
        join
          .onRef('practitioner.id', '=', 'assignment.practitioner_id')
          .onRef('practitioner.tenant_id', '=', 'assignment.tenant_id'),
      )
      .select([
        'assignment.id as assignment_id',
        'assignment.practitioner_id',
        'assignment.status as assignment_status',
        'practitioner.status as practitioner_status',
      ])
      .where('assignment.id', '=', assignmentId)
      .where('assignment.tenant_id', '=', practice.tenantId)
      .where('assignment.organization_id', '=', practice.organizationId)
      .where('assignment.facility_id', '=', facilityId)
      .where('assignment.is_synthetic', '=', true)
      .where('practitioner.is_synthetic', '=', true)
      .forShare(['assignment', 'practitioner'])
      .executeTakeFirst();
    if (!row) throw new WorkforceSchedulingTargetUnavailableError();
    if (
      row.assignment_status !== 'active' ||
      row.practitioner_status !== 'active'
    ) {
      throw new WorkforceSchedulingConflictError(
        'A practitioner exception requires an active practitioner and facility affiliation.',
      );
    }
    return {
      assignmentId: row.assignment_id,
      practitionerId: row.practitioner_id,
    };
  }

  private async requireActiveBookablePractice(
    database: DatabaseExecutor,
    practice: PracticeContext,
  ): Promise<string> {
    const bookable = await database
      .selectFrom('patient_portal_bookable_practices as bookable')
      .select('bookable.id')
      .where('bookable.tenant_id', '=', practice.tenantId)
      .where('bookable.organization_id', '=', practice.organizationId)
      .where('bookable.status', '=', 'active')
      .where('bookable.is_synthetic', '=', true)
      .executeTakeFirst();
    if (!bookable) {
      throw new WorkforceSchedulingConflictError(
        'Availability changes require an active synthetic bookable practice.',
      );
    }
    return bookable.id;
  }

  private async availabilityPractitionerIdsForFacility(
    database: DatabaseExecutor,
    practice: PracticeContext,
    facilityId: string,
  ): Promise<string[]> {
    const result = await sql<{ practitioner_id: string }>`
      select distinct candidate.practitioner_id
      from (
        select assignment.practitioner_id
        from practitioner_facility_assignments assignment
        where assignment.tenant_id = ${practice.tenantId}
          and assignment.organization_id = ${practice.organizationId}
          and assignment.facility_id = ${facilityId}
          and assignment.is_synthetic = true
        union
        select template.practitioner_id
        from practitioner_availability_templates template
        where template.tenant_id = ${practice.tenantId}
          and template.organization_id = ${practice.organizationId}
          and template.facility_id = ${facilityId}
          and template.is_synthetic = true
        union
        select slot.practitioner_id
        from patient_portal_appointment_slots slot
        where slot.tenant_id = ${practice.tenantId}
          and slot.organization_id = ${practice.organizationId}
          and slot.facility_id = ${facilityId}
          and slot.practitioner_id is not null
          and slot.is_synthetic = true
      ) candidate
      order by candidate.practitioner_id
    `.execute(database);
    return result.rows.map(({ practitioner_id }) => practitioner_id);
  }

  private assertActiveAvailabilityChain(
    scope: AvailabilityAssignmentScope,
  ): void {
    if (
      scope.practitionerStatus !== 'active' ||
      scope.facilityAssignmentStatus !== 'active' ||
      scope.serviceAssignmentStatus !== 'active' ||
      scope.serviceStatus !== 'active' ||
      scope.specialtyStatus !== 'active'
    ) {
      throw new WorkforceSchedulingConflictError(
        'Availability publication requires one complete active practitioner, affiliation, specialty, service, and eligibility chain.',
      );
    }
  }

  private assertTemplateAvailabilityReason(reasonCode: string): void {
    if (
      reasonCode !== 'availability-configuration' &&
      reasonCode !== 'provider-availability-change'
    ) {
      throw new WorkforceSchedulingValidationError(
        'Availability changes require an availability-specific reason code.',
      );
    }
  }

  private validateAvailabilityTemplateDefinition(input: {
    isoWeekday: number;
    localStartMinute: number;
    localEndMinute: number;
    effectiveFrom: string;
    effectiveUntil?: string;
  }): void {
    parseCanonicalLocalDate(input.effectiveFrom);
    if (input.effectiveUntil !== undefined) {
      parseCanonicalLocalDate(input.effectiveUntil);
    }
    if (
      !Number.isInteger(input.isoWeekday) ||
      input.isoWeekday < 1 ||
      input.isoWeekday > 7 ||
      !Number.isInteger(input.localStartMinute) ||
      input.localStartMinute < 0 ||
      input.localStartMinute > 1439 ||
      !Number.isInteger(input.localEndMinute) ||
      input.localEndMinute < 1 ||
      input.localEndMinute > 1440 ||
      input.localEndMinute <= input.localStartMinute ||
      (input.effectiveUntil !== undefined &&
        input.effectiveUntil < input.effectiveFrom)
    ) {
      throw new WorkforceSchedulingValidationError(
        'The availability template definition is invalid.',
      );
    }
  }

  private async lockPractitionerMutexes(
    database: Transaction<DatabaseSchema>,
    practice: PracticeContext,
    practitionerIds: readonly string[],
  ): Promise<void> {
    const sortedIds = [...new Set(practitionerIds)].sort();
    for (const practitionerId of sortedIds) {
      await sql`
        select pg_advisory_xact_lock(
          hashtextextended(
            ${`${practice.tenantId}:${practitionerId}`},
            0
          )
        )
      `.execute(database);
    }
  }

  private emptyAvailabilitySummary(
    frozenNow: Date,
    sourceTimezone: string,
  ): AvailabilityMaterializationSummary {
    const horizon = captureAvailabilityHorizon(frozenNow, sourceTimezone);
    return {
      horizonStartsOn: horizon.localStartDate,
      horizonEndsBefore: horizon.localEndDateExclusive,
      sourceTimezone,
      createdSlotCount: 0,
      reactivatedSlotCount: 0,
      withdrawnSlotCount: 0,
      preservedLiveSlotCount: 0,
      skippedOverlapCount: 0,
      affectedAppointmentCount: 0,
      affectedAppointmentIds: [],
      affectedAppointmentIdsTruncated: false,
    };
  }

  private availabilityAuditData(
    summary: AvailabilityMaterializationSummary,
    target: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      ...target,
      horizonStartsOn: summary.horizonStartsOn,
      horizonEndsBefore: summary.horizonEndsBefore,
      sourceTimezone: summary.sourceTimezone,
      createdSlotCount: summary.createdSlotCount,
      reactivatedSlotCount: summary.reactivatedSlotCount,
      withdrawnSlotCount: summary.withdrawnSlotCount,
      preservedLiveSlotCount: summary.preservedLiveSlotCount,
      skippedOverlapCount: summary.skippedOverlapCount,
      affectedAppointmentCount: summary.affectedAppointmentCount,
      affectedAppointmentIds: summary.affectedAppointmentIds,
      affectedAppointmentIdsTruncated: summary.affectedAppointmentIdsTruncated,
    };
  }

  private async loadAvailabilityTemplatesForPractitioners(
    database: Transaction<DatabaseSchema>,
    practice: PracticeContext,
    facility: FacilityContext,
    practitionerIds: readonly string[],
  ): Promise<AvailabilityTemplateRow[]> {
    if (practitionerIds.length === 0) return [];
    const rows = await database
      .selectFrom('practitioner_availability_templates as template')
      .innerJoin(
        'practitioner_service_assignments as service_assignment',
        (join) =>
          join
            .onRef(
              'service_assignment.id',
              '=',
              'template.practitioner_service_assignment_id',
            )
            .onRef('service_assignment.tenant_id', '=', 'template.tenant_id')
            .onRef(
              'service_assignment.organization_id',
              '=',
              'template.organization_id',
            )
            .onRef(
              'service_assignment.facility_id',
              '=',
              'template.facility_id',
            ),
      )
      .innerJoin(
        'practitioner_facility_assignments as facility_assignment',
        (join) =>
          join
            .onRef(
              'facility_assignment.id',
              '=',
              'template.practitioner_facility_assignment_id',
            )
            .onRef('facility_assignment.tenant_id', '=', 'template.tenant_id')
            .onRef(
              'facility_assignment.organization_id',
              '=',
              'template.organization_id',
            )
            .onRef(
              'facility_assignment.facility_id',
              '=',
              'template.facility_id',
            ),
      )
      .innerJoin('practitioners as practitioner', (join) =>
        join
          .onRef('practitioner.id', '=', 'template.practitioner_id')
          .onRef('practitioner.tenant_id', '=', 'template.tenant_id'),
      )
      .innerJoin('appointment_services as service', (join) =>
        join
          .onRef('service.id', '=', 'template.appointment_service_id')
          .onRef('service.tenant_id', '=', 'template.tenant_id')
          .onRef('service.organization_id', '=', 'template.organization_id')
          .onRef('service.facility_id', '=', 'template.facility_id'),
      )
      .innerJoin('specialties as specialty', (join) =>
        join
          .onRef('specialty.id', '=', 'service.specialty_id')
          .onRef('specialty.tenant_id', '=', 'service.tenant_id')
          .onRef('specialty.organization_id', '=', 'service.organization_id'),
      )
      .innerJoin('patient_portal_bookable_practices as bookable', (join) =>
        join
          .onRef('bookable.tenant_id', '=', 'template.tenant_id')
          .onRef('bookable.organization_id', '=', 'template.organization_id'),
      )
      .select([
        'template.id',
        'bookable.id as bookable_practice_id',
        'template.tenant_id',
        'template.organization_id',
        'template.facility_id',
        'template.practitioner_facility_assignment_id',
        'template.practitioner_service_assignment_id',
        'template.practitioner_id',
        'template.appointment_service_id',
        'template.iso_weekday',
        'template.local_start_minute',
        'template.local_end_minute',
        'template.effective_from',
        'template.effective_until',
        'template.source_timezone',
        'template.status',
        'template.updated_at',
        'service.duration_minutes',
        'service.status as service_status',
        'service_assignment.status as service_assignment_status',
        'facility_assignment.status as facility_assignment_status',
        'practitioner.status as practitioner_status',
        'specialty.status as specialty_status',
      ])
      .where('template.tenant_id', '=', practice.tenantId)
      .where('template.organization_id', '=', practice.organizationId)
      .where('template.facility_id', '=', facility.facilityId)
      .where('template.practitioner_id', 'in', [...practitionerIds])
      .where('template.is_synthetic', '=', true)
      .where('service_assignment.is_synthetic', '=', true)
      .where('facility_assignment.is_synthetic', '=', true)
      .where('practitioner.is_synthetic', '=', true)
      .where('service.is_synthetic', '=', true)
      .where('specialty.is_synthetic', '=', true)
      .where('bookable.is_synthetic', '=', true)
      .where('bookable.status', '=', 'active')
      .orderBy('template.id', 'asc')
      .forShare([
        'template',
        'service_assignment',
        'facility_assignment',
        'practitioner',
        'service',
        'specialty',
        'bookable',
      ])
      .execute();

    return rows.map((row) => {
      const chainIsActive =
        row.service_status === 'active' &&
        row.service_assignment_status === 'active' &&
        row.facility_assignment_status === 'active' &&
        row.practitioner_status === 'active' &&
        row.specialty_status === 'active';
      return {
        id: row.id,
        bookablePracticeId: row.bookable_practice_id,
        tenantId: row.tenant_id,
        organizationId: row.organization_id,
        facilityId: row.facility_id,
        practitionerFacilityAssignmentId:
          row.practitioner_facility_assignment_id,
        practitionerServiceAssignmentId: row.practitioner_service_assignment_id,
        practitionerId: row.practitioner_id,
        appointmentServiceId: row.appointment_service_id,
        isoWeekday: row.iso_weekday,
        localStartMinute: row.local_start_minute,
        localEndMinute: row.local_end_minute,
        effectiveFrom: row.effective_from,
        effectiveUntil: row.effective_until,
        sourceTimezone: row.source_timezone,
        durationMinutes: row.duration_minutes,
        // Catalogue deactivation preserves immutable template evidence but
        // immediately removes its publication authority.
        status:
          row.status === 'active' && chainIsActive ? 'active' : 'inactive',
        updatedAt: row.updated_at,
      };
    });
  }

  private async loadAvailabilityExceptions(
    database: Transaction<DatabaseSchema>,
    practice: PracticeContext,
    facility: FacilityContext,
  ): Promise<AvailabilityExceptionRow[]> {
    const rows = await database
      .selectFrom('provider_availability_exceptions as exception')
      .selectAll('exception')
      .where('exception.tenant_id', '=', practice.tenantId)
      .where('exception.organization_id', '=', practice.organizationId)
      .where('exception.facility_id', '=', facility.facilityId)
      .where('exception.is_synthetic', '=', true)
      .orderBy('exception.starts_at', 'asc')
      .orderBy('exception.id', 'asc')
      .forUpdate()
      .execute();
    return rows.map((row) => ({
      id: row.id,
      facilityId: row.facility_id,
      practitionerFacilityAssignmentId: row.practitioner_facility_assignment_id,
      practitionerId: row.practitioner_id,
      kind: row.kind,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      sourceTimezone: row.source_timezone,
      status: row.status,
      localStartsAt: row.local_starts_at,
      localEndsAt: row.local_ends_at,
      isAllDay: row.is_all_day,
      updatedAt: row.updated_at,
    }));
  }

  private async loadStoredAvailabilitySlots(
    database: Transaction<DatabaseSchema>,
    practice: PracticeContext,
    facility: FacilityContext,
    practitionerIds: readonly string[],
    frozenNow: Date,
  ): Promise<ProviderAvailabilityStoredSlot[]> {
    if (practitionerIds.length === 0) return [];
    const horizon = captureAvailabilityHorizon(frozenNow, facility.timezone);
    const horizonEnd = resolveLocalMinuteBoundary(
      horizon.localEndDateExclusive,
      0,
      facility.timezone,
    ).instant;
    const rows = await database
      .selectFrom('patient_portal_appointment_slots as slot')
      .select([
        'slot.id',
        'slot.bookable_practice_id',
        'slot.tenant_id',
        'slot.organization_id',
        'slot.facility_id',
        'slot.practitioner_facility_assignment_id',
        'slot.practitioner_service_assignment_id',
        'slot.practitioner_id',
        'slot.appointment_service_id',
        'slot.availability_template_id',
        'slot.generation_key_hash',
        'slot.source_local_date',
        'slot.source_timezone',
        'slot.starts_at',
        'slot.ends_at',
        'slot.status',
        'slot.withdrawal_pending',
      ])
      .where('slot.tenant_id', '=', practice.tenantId)
      .where('slot.organization_id', '=', practice.organizationId)
      .where('slot.facility_id', '=', facility.facilityId)
      .where('slot.practitioner_id', 'in', [...practitionerIds])
      .where('slot.starts_at', '>', frozenNow)
      .where('slot.starts_at', '<', horizonEnd)
      .where('slot.is_synthetic', '=', true)
      .where('slot.practitioner_service_assignment_id', 'is not', null)
      .orderBy('slot.starts_at', 'asc')
      .orderBy('slot.id', 'asc')
      .forUpdate()
      .execute();
    const slotIds = rows.map(({ id }) => id);
    const liveRows =
      slotIds.length === 0
        ? []
        : (
            await sql<{ appointment_slot_id: string; id: string }>`
            select appointment.appointment_slot_id, appointment.id
            from patient_portal_appointments appointment
            where appointment.appointment_slot_id in (${sql.join(slotIds)})
              and appointment.status in ('requested', 'confirmed')
            order by appointment.appointment_slot_id, appointment.id
            for update
          `.execute(database)
          ).rows;
    const liveBySlot = new Map(
      liveRows.map((row) => [row.appointment_slot_id, row.id]),
    );
    return rows.map((row) => {
      if (
        row.facility_id === null ||
        row.practitioner_facility_assignment_id === null ||
        row.practitioner_service_assignment_id === null ||
        row.practitioner_id === null ||
        row.appointment_service_id === null ||
        row.availability_template_id === null ||
        row.generation_key_hash === null ||
        row.source_local_date === null ||
        row.source_timezone === null
      ) {
        throw new WorkforceSchedulingPersistenceError();
      }
      return {
        id: row.id,
        bookablePracticeId: row.bookable_practice_id,
        tenantId: row.tenant_id,
        organizationId: row.organization_id,
        facilityId: row.facility_id,
        practitionerFacilityAssignmentId:
          row.practitioner_facility_assignment_id,
        practitionerServiceAssignmentId: row.practitioner_service_assignment_id,
        practitionerId: row.practitioner_id,
        appointmentServiceId: row.appointment_service_id,
        availabilityTemplateId: row.availability_template_id,
        generationKeyHash: row.generation_key_hash,
        sourceLocalDate: row.source_local_date,
        sourceTimezone: row.source_timezone,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        status: row.status,
        withdrawalPending: row.withdrawal_pending,
        liveAppointmentId: liveBySlot.get(row.id) ?? null,
      };
    });
  }

  private async loadExternalAvailabilityBlockers(
    database: Transaction<DatabaseSchema>,
    practice: PracticeContext,
    facility: FacilityContext,
    practitionerIds: readonly string[],
    frozenNow: Date,
  ): Promise<ProviderAvailabilityStoredSlot[]> {
    if (practitionerIds.length === 0) return [];
    const horizon = captureAvailabilityHorizon(frozenNow, facility.timezone);
    const horizonEnd = resolveLocalMinuteBoundary(
      horizon.localEndDateExclusive,
      0,
      facility.timezone,
    ).instant;
    const result = await sql<{
      id: string;
      bookable_practice_id: string;
      tenant_id: string;
      organization_id: string;
      facility_id: string;
      practitioner_facility_assignment_id: string;
      practitioner_service_assignment_id: string;
      practitioner_id: string;
      appointment_service_id: string;
      availability_template_id: string;
      generation_key_hash: string;
      source_local_date: string;
      source_timezone: string;
      starts_at: Date;
      ends_at: Date;
      status: 'available';
      withdrawal_pending: boolean;
    }>`
      select
        slot.id,
        slot.bookable_practice_id,
        slot.tenant_id,
        slot.organization_id,
        slot.facility_id,
        slot.practitioner_facility_assignment_id,
        slot.practitioner_service_assignment_id,
        slot.practitioner_id,
        slot.appointment_service_id,
        slot.availability_template_id,
        slot.generation_key_hash,
        slot.source_local_date::text,
        slot.source_timezone,
        slot.starts_at,
        slot.ends_at,
        slot.status,
        slot.withdrawal_pending
      from patient_portal_appointment_slots slot
      where slot.tenant_id = ${practice.tenantId}
        and slot.practitioner_id in (${sql.join([...practitionerIds])})
        and (
          slot.organization_id <> ${practice.organizationId}
          or slot.facility_id <> ${facility.facilityId}
        )
        and slot.ends_at > ${frozenNow}
        and slot.starts_at < ${horizonEnd}
        and slot.status = 'available'
        and slot.is_synthetic = true
        and slot.practitioner_service_assignment_id is not null
        and (
          slot.starts_at <= ${frozenNow}
          or slot.withdrawal_pending = true
          or exists (
            select 1
            from patient_portal_appointments appointment
            where appointment.appointment_slot_id = slot.id
              and appointment.status in ('requested', 'confirmed')
          )
        )
      order by slot.starts_at, slot.id
    `.execute(database);
    return result.rows.map((row) => ({
      id: row.id,
      bookablePracticeId: row.bookable_practice_id,
      tenantId: row.tenant_id,
      organizationId: row.organization_id,
      facilityId: row.facility_id,
      practitionerFacilityAssignmentId: row.practitioner_facility_assignment_id,
      practitionerServiceAssignmentId: row.practitioner_service_assignment_id,
      practitionerId: row.practitioner_id,
      appointmentServiceId: row.appointment_service_id,
      availabilityTemplateId: row.availability_template_id,
      generationKeyHash: row.generation_key_hash,
      sourceLocalDate: row.source_local_date,
      sourceTimezone: row.source_timezone,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      status: row.status,
      withdrawalPending: row.withdrawal_pending,
      liveAppointmentId: 'private-scope-blocker',
    }));
  }

  private async loadStartedLocalAvailabilityBlockers(
    database: Transaction<DatabaseSchema>,
    practice: PracticeContext,
    facility: FacilityContext,
    practitionerIds: readonly string[],
    frozenNow: Date,
  ): Promise<ProviderAvailabilityStoredSlot[]> {
    if (practitionerIds.length === 0) return [];
    const result = await sql<{
      id: string;
      bookable_practice_id: string;
      tenant_id: string;
      organization_id: string;
      facility_id: string;
      practitioner_facility_assignment_id: string;
      practitioner_service_assignment_id: string;
      practitioner_id: string;
      appointment_service_id: string;
      availability_template_id: string;
      generation_key_hash: string;
      source_local_date: string;
      source_timezone: string;
      starts_at: Date;
      ends_at: Date;
      status: 'available';
      withdrawal_pending: boolean;
      live_appointment_id: string | null;
    }>`
      select
        slot.id,
        slot.bookable_practice_id,
        slot.tenant_id,
        slot.organization_id,
        slot.facility_id,
        slot.practitioner_facility_assignment_id,
        slot.practitioner_service_assignment_id,
        slot.practitioner_id,
        slot.appointment_service_id,
        slot.availability_template_id,
        slot.generation_key_hash,
        slot.source_local_date::text,
        slot.source_timezone,
        slot.starts_at,
        slot.ends_at,
        slot.status,
        slot.withdrawal_pending,
        (
          select appointment.id
          from patient_portal_appointments appointment
          where appointment.appointment_slot_id = slot.id
            and appointment.status in ('requested', 'confirmed')
          order by appointment.id
          limit 1
        ) as live_appointment_id
      from patient_portal_appointment_slots slot
      where slot.tenant_id = ${practice.tenantId}
        and slot.organization_id = ${practice.organizationId}
        and slot.facility_id = ${facility.facilityId}
        and slot.practitioner_id in (${sql.join([...practitionerIds])})
        and slot.starts_at <= ${frozenNow}
        and slot.ends_at > ${frozenNow}
        and slot.status = 'available'
        and slot.is_synthetic = true
        and slot.practitioner_service_assignment_id is not null
      order by slot.starts_at, slot.id
    `.execute(database);
    return result.rows.map((row) => ({
      id: row.id,
      bookablePracticeId: row.bookable_practice_id,
      tenantId: row.tenant_id,
      organizationId: row.organization_id,
      facilityId: row.facility_id,
      practitionerFacilityAssignmentId: row.practitioner_facility_assignment_id,
      practitionerServiceAssignmentId: row.practitioner_service_assignment_id,
      practitionerId: row.practitioner_id,
      appointmentServiceId: row.appointment_service_id,
      availabilityTemplateId: row.availability_template_id,
      generationKeyHash: row.generation_key_hash,
      sourceLocalDate: row.source_local_date,
      sourceTimezone: row.source_timezone,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      status: row.status,
      withdrawalPending: row.withdrawal_pending,
      liveAppointmentId: row.live_appointment_id ?? 'current-started-blocker',
    }));
  }

  private async reconcileAvailability(
    database: Transaction<DatabaseSchema>,
    practice: PracticeContext,
    facility: FacilityContext,
    practitionerIds: readonly string[],
    frozenNow: Date,
  ): Promise<AvailabilityReconciliationResult> {
    const uniquePractitionerIds = [...new Set(practitionerIds)].sort();
    // Appointment commands lock a slot before reading provider-chain rows.
    // Follow that order here, after the workforce-only advisory mutex.
    const existingSlots = await this.loadStoredAvailabilitySlots(
      database,
      practice,
      facility,
      uniquePractitionerIds,
      frozenNow,
    );
    const templates = await this.loadAvailabilityTemplatesForPractitioners(
      database,
      practice,
      facility,
      uniquePractitionerIds,
    );
    const exceptions = await this.loadAvailabilityExceptions(
      database,
      practice,
      facility,
    );
    const generated = materializeProviderAvailability({
      frozenNow,
      sourceTimezone: facility.timezone,
      templates,
      exceptions,
    });
    const externalBlockers = await this.loadExternalAvailabilityBlockers(
      database,
      practice,
      facility,
      uniquePractitionerIds,
      frozenNow,
    );
    const startedLocalBlockers =
      await this.loadStartedLocalAvailabilityBlockers(
        database,
        practice,
        facility,
        uniquePractitionerIds,
        frozenNow,
      );
    const plan = planProviderAvailabilityReconciliation({
      desiredOccurrences: generated.occurrences,
      existingSlots: [
        ...existingSlots,
        ...startedLocalBlockers,
        ...externalBlockers,
      ],
    });
    const mutableLocalSlotIds = new Set(existingSlots.map(({ id }) => id));
    // Immediate GiST exclusion means obsolete available rows must leave the
    // overlap set before replacement rows can be reactivated or inserted.
    // Live rows stay available+pending and already caused overlapping desired
    // occurrences to be skipped above.
    await this.updateSlotLifecycle(
      database,
      plan.preservedLive
        .map(({ id }) => id)
        .filter((id) => mutableLocalSlotIds.has(id)),
      'available',
      true,
    );
    await this.updateSlotLifecycle(
      database,
      plan.withdrawn
        .map(({ id }) => id)
        .filter((id) => mutableLocalSlotIds.has(id)),
      'withdrawn',
      false,
    );
    await this.updateSlotLifecycle(
      database,
      plan.reactivated
        .map(({ slot }) => slot.id)
        .filter((id) => mutableLocalSlotIds.has(id)),
      'available',
      false,
    );
    await this.updateSlotLifecycle(
      database,
      plan.clearedWithdrawalPending
        .map(({ id }) => id)
        .filter((id) => mutableLocalSlotIds.has(id)),
      'available',
      false,
    );
    for (let index = 0; index < plan.created.length; index += 400) {
      const batch = plan.created.slice(index, index + 400);
      await database
        .insertInto('patient_portal_appointment_slots')
        .values(
          batch.map((occurrence) => ({
            bookable_practice_id: occurrence.bookablePracticeId,
            tenant_id: occurrence.tenantId,
            organization_id: occurrence.organizationId,
            starts_at: occurrence.startsAt,
            ends_at: occurrence.endsAt,
            facility_id: occurrence.facilityId,
            practitioner_facility_assignment_id:
              occurrence.practitionerFacilityAssignmentId,
            practitioner_service_assignment_id:
              occurrence.practitionerServiceAssignmentId,
            practitioner_id: occurrence.practitionerId,
            appointment_service_id: occurrence.appointmentServiceId,
            availability_template_id: occurrence.availabilityTemplateId,
            generation_key_hash: occurrence.generationKeyHash,
            source_local_date: occurrence.sourceLocalDate,
            source_timezone: occurrence.sourceTimezone,
            status: 'available' as const,
            withdrawal_pending: false,
            is_synthetic: true,
          })),
        )
        .execute();
    }

    const affectedIds = [
      ...plan.preservedLive
        .filter(({ id }) => mutableLocalSlotIds.has(id))
        .map(({ liveAppointmentId }) => liveAppointmentId),
      ...plan.skippedLive.map(({ liveAppointmentId }) => liveAppointmentId),
    ]
      .filter(
        (id): id is string =>
          id !== null &&
          id !== 'private-scope-blocker' &&
          id !== 'current-started-blocker',
      )
      .filter((id, index, ids) => ids.indexOf(id) === index)
      .sort();
    return {
      summary: {
        horizonStartsOn: generated.horizon.localStartDate,
        horizonEndsBefore: generated.horizon.localEndDateExclusive,
        sourceTimezone: generated.horizon.sourceTimezone,
        createdSlotCount: plan.created.length,
        reactivatedSlotCount: plan.reactivated.length,
        withdrawnSlotCount: plan.withdrawn.length,
        preservedLiveSlotCount: plan.preservedLive.filter(({ id }) =>
          mutableLocalSlotIds.has(id),
        ).length,
        skippedOverlapCount: plan.skippedLive.length,
        affectedAppointmentCount: affectedIds.length,
        affectedAppointmentIds: affectedIds.slice(0, 100),
        affectedAppointmentIdsTruncated: affectedIds.length > 100,
      },
    };
  }

  private async updateSlotLifecycle(
    database: Transaction<DatabaseSchema>,
    slotIds: readonly string[],
    status: 'available' | 'withdrawn',
    withdrawalPending: boolean,
  ): Promise<void> {
    if (slotIds.length === 0) return;
    await database
      .updateTable('patient_portal_appointment_slots')
      .set({
        status,
        withdrawal_pending: withdrawalPending,
        updated_at: new Date(),
      })
      .where('id', 'in', [...slotIds])
      .execute();
  }

  private async loadAvailabilityTemplateView(
    database: DatabaseExecutor,
    practice: PracticeContext,
    templateId: string,
  ): Promise<WorkforceAvailabilityTemplateView> {
    const row = await database
      .selectFrom('practitioner_availability_templates as template')
      .innerJoin('facilities as facility', (join) =>
        join
          .onRef('facility.id', '=', 'template.facility_id')
          .onRef('facility.tenant_id', '=', 'template.tenant_id')
          .onRef('facility.organization_id', '=', 'template.organization_id'),
      )
      .innerJoin('practitioners as practitioner', (join) =>
        join
          .onRef('practitioner.id', '=', 'template.practitioner_id')
          .onRef('practitioner.tenant_id', '=', 'template.tenant_id'),
      )
      .innerJoin('appointment_services as service', (join) =>
        join
          .onRef('service.id', '=', 'template.appointment_service_id')
          .onRef('service.tenant_id', '=', 'template.tenant_id')
          .onRef('service.organization_id', '=', 'template.organization_id')
          .onRef('service.facility_id', '=', 'template.facility_id'),
      )
      .select([
        'template.id',
        'template.facility_id',
        'facility.name as facility_name',
        'template.practitioner_facility_assignment_id',
        'template.practitioner_service_assignment_id',
        'template.practitioner_id',
        'practitioner.display_name as practitioner_display_name',
        'template.appointment_service_id',
        'service.patient_facing_name as service_name',
        'service.duration_minutes',
        'template.iso_weekday',
        'template.local_start_minute',
        'template.local_end_minute',
        'template.effective_from',
        'template.effective_until',
        'template.source_timezone',
        'template.status',
        'template.updated_at',
      ])
      .where('template.id', '=', templateId)
      .where('template.tenant_id', '=', practice.tenantId)
      .where('template.organization_id', '=', practice.organizationId)
      .where('template.is_synthetic', '=', true)
      .executeTakeFirst();
    if (!row) throw new WorkforceSchedulingPersistenceError();
    return this.mapAvailabilityTemplateView(row);
  }

  private async loadAvailabilityExceptionView(
    database: DatabaseExecutor,
    practice: PracticeContext,
    exceptionId: string,
  ): Promise<WorkforceAvailabilityExceptionView> {
    const row = await database
      .selectFrom('provider_availability_exceptions as exception')
      .innerJoin('facilities as facility', (join) =>
        join
          .onRef('facility.id', '=', 'exception.facility_id')
          .onRef('facility.tenant_id', '=', 'exception.tenant_id')
          .onRef('facility.organization_id', '=', 'exception.organization_id'),
      )
      .leftJoin('practitioners as practitioner', (join) =>
        join
          .onRef('practitioner.id', '=', 'exception.practitioner_id')
          .onRef('practitioner.tenant_id', '=', 'exception.tenant_id'),
      )
      .select([
        'exception.id',
        'exception.facility_id',
        'facility.name as facility_name',
        'exception.practitioner_facility_assignment_id',
        'exception.practitioner_id',
        'practitioner.display_name as practitioner_display_name',
        'exception.kind',
        'exception.is_all_day',
        'exception.local_starts_at',
        'exception.local_ends_at',
        'exception.starts_at',
        'exception.ends_at',
        'exception.source_timezone',
        'exception.status',
        'exception.updated_at',
      ])
      .where('exception.id', '=', exceptionId)
      .where('exception.tenant_id', '=', practice.tenantId)
      .where('exception.organization_id', '=', practice.organizationId)
      .where('exception.is_synthetic', '=', true)
      .executeTakeFirst();
    if (!row) throw new WorkforceSchedulingPersistenceError();
    return this.mapAvailabilityExceptionView(row);
  }

  private async requirePractice(
    database: DatabaseExecutor,
    organizationId: string,
  ): Promise<PracticeContext> {
    const practice = await database
      .selectFrom('organizations as organization')
      .innerJoin('tenants as tenant', 'tenant.id', 'organization.tenant_id')
      .select([
        'tenant.id as tenant_id',
        'tenant.name as tenant_name',
        'organization.id as organization_id',
        'organization.name as organization_name',
      ])
      .where('organization.id', '=', organizationId)
      .where('organization.kind', '=', 'practice')
      .where('organization.is_synthetic', '=', true)
      .where('tenant.status', '=', 'active')
      .where('tenant.is_synthetic', '=', true)
      .executeTakeFirst();

    if (!practice) throw new WorkforceSchedulingTargetUnavailableError();
    return {
      tenantId: practice.tenant_id,
      tenantName: practice.tenant_name,
      organizationId: practice.organization_id,
      organizationName: practice.organization_name,
    };
  }

  private async requireFacility(
    database: DatabaseExecutor,
    practice: PracticeContext,
    facilityId: string,
  ): Promise<FacilityContext> {
    const facility = await database
      .selectFrom('facilities as facility')
      .select(['facility.id', 'facility.name', 'facility.timezone'])
      .where('facility.id', '=', facilityId)
      .where('facility.tenant_id', '=', practice.tenantId)
      .where('facility.organization_id', '=', practice.organizationId)
      .where('facility.is_synthetic', '=', true)
      .executeTakeFirst();
    if (!facility) throw new WorkforceSchedulingTargetUnavailableError();
    return {
      facilityId: facility.id,
      facilityName: facility.name,
      timezone: facility.timezone,
    };
  }

  private async requireMutationFacility(
    database: DatabaseExecutor,
    practice: PracticeContext,
    facilityId: string,
    principal: AuthenticatedPrincipal,
    correlationId: string,
    action: string,
    reason: string,
  ): Promise<FacilityContext> {
    try {
      return await this.requireFacility(database, practice, facilityId);
    } catch (error) {
      if (!(error instanceof WorkforceSchedulingTargetUnavailableError)) {
        throw error;
      }
    }

    await this.requireAnySchedulingAuthorization(
      principal,
      practice,
      correlationId,
      action,
      'facility',
      facilityId,
      reason,
      database,
    );
    this.scopedTargetUnavailable(
      principal,
      practice,
      correlationId,
      'facility',
      facilityId,
    );
  }

  private listSyntheticFacilities(
    database: DatabaseExecutor,
    practice: PracticeContext,
  ): Promise<FacilityContext[]> {
    return database
      .selectFrom('facilities as facility')
      .select([
        'facility.id as facilityId',
        'facility.name as facilityName',
        'facility.timezone',
      ])
      .where('facility.tenant_id', '=', practice.tenantId)
      .where('facility.organization_id', '=', practice.organizationId)
      .where('facility.is_synthetic', '=', true)
      .orderBy('facility.name', 'asc')
      .orderBy('facility.id', 'asc')
      .execute();
  }

  private authorizationRequest(
    principal: AuthenticatedPrincipal,
    practice: PracticeContext,
    correlationId: string,
    action: string,
    targetEntityType: string,
    targetEntityId: string,
    reason: string,
    facilityId?: string,
  ): AuthorizationRequest {
    return {
      principal,
      tenantId: practice.tenantId,
      organizationId: practice.organizationId,
      ...(facilityId ? { facilityId } : {}),
      permissionCode: 'scheduling.manage',
      confidential: false,
      action,
      targetEntityType,
      targetEntityId,
      correlationId,
      reason,
    };
  }

  private async requireOrganizationAuthorization(
    principal: AuthenticatedPrincipal,
    practice: PracticeContext,
    correlationId: string,
    action: string,
    targetEntityType: string,
    targetEntityId: string,
    reason: string,
    database: DatabaseExecutor,
    recordDenial: boolean,
  ): Promise<AuthorizedAccess> {
    const authorizationRequest = this.authorizationRequest(
      principal,
      practice,
      correlationId,
      action,
      targetEntityType,
      targetEntityId,
      reason,
    );
    const access = await this.authorization.evaluate(
      authorizationRequest,
      database,
    );
    if (access) return access;

    if (recordDenial) {
      await this.authorization.recordDenied(authorizationRequest);
      throw new WorkforceSchedulingAuthorizationLostError();
    }
    throw new SchedulingAuthorizationDeniedError(authorizationRequest);
  }

  private async requireFacilityAuthorization(
    principal: AuthenticatedPrincipal,
    practice: PracticeContext,
    facilityId: string,
    correlationId: string,
    action: string,
    targetEntityType: string,
    targetEntityId: string,
    reason: string,
    database: DatabaseExecutor,
  ): Promise<AuthorizedAccess> {
    const facilityRequest = this.authorizationRequest(
      principal,
      practice,
      correlationId,
      action,
      targetEntityType,
      targetEntityId,
      reason,
      facilityId,
    );
    const facilityAccess = await this.authorization.evaluate(
      facilityRequest,
      database,
    );
    if (facilityAccess) return facilityAccess;
    throw new SchedulingAuthorizationDeniedError(facilityRequest);
  }

  private async requireAnySchedulingAuthorization(
    principal: AuthenticatedPrincipal,
    practice: PracticeContext,
    correlationId: string,
    action: string,
    targetEntityType: string,
    targetEntityId: string,
    reason: string,
    database: DatabaseExecutor,
  ): Promise<AuthorizedAccess> {
    const organizationRequest = this.authorizationRequest(
      principal,
      practice,
      correlationId,
      action,
      targetEntityType,
      targetEntityId,
      reason,
    );
    // A facility-owned target cannot use an organization-wide assignment by
    // itself: at least one exact membership_facilities row is still required.
    const facilities = await this.listSyntheticFacilities(database, practice);
    for (const facility of facilities) {
      const facilityRequest = this.authorizationRequest(
        principal,
        practice,
        correlationId,
        action,
        targetEntityType,
        targetEntityId,
        reason,
        facility.facilityId,
      );
      const access = await this.authorization.evaluate(
        facilityRequest,
        database,
      );
      if (access) return access;
    }
    throw new SchedulingAuthorizationDeniedError(organizationRequest);
  }

  private scopedTargetUnavailable(
    principal: AuthenticatedPrincipal,
    practice: PracticeContext,
    correlationId: string,
    targetEntityType: string,
    targetEntityId: string,
    facilityId?: string,
  ): never {
    throw new SchedulingScopedTargetDeniedError(
      this.authorizationRequest(
        principal,
        practice,
        correlationId,
        'scheduling.catalogue_target_unavailable',
        targetEntityType,
        targetEntityId,
        'The requested scheduling catalogue target was unavailable in the exact practice scope.',
        facilityId,
      ),
    );
  }

  private async authorizedPracticeScope(
    principal: AuthenticatedPrincipal,
    practice: PracticeContext,
    action: string,
    recordDenial: boolean,
  ): Promise<AuthorizedPracticeScope> {
    const correlationId = randomUUID();
    const reason = 'Review the synthetic scheduling catalogue.';
    const organizationRequest = this.authorizationRequest(
      principal,
      practice,
      correlationId,
      action,
      'organization',
      practice.organizationId,
      reason,
    );
    const organizationAccess = await this.authorization.evaluate(
      organizationRequest,
      this.database.client,
    );
    const allFacilities = await this.listSyntheticFacilities(
      this.database.client,
      practice,
    );
    const facilities: FacilityContext[] = [];
    for (const facility of allFacilities) {
      const request = this.authorizationRequest(
        principal,
        practice,
        correlationId,
        action,
        'facility',
        facility.facilityId,
        reason,
        facility.facilityId,
      );
      if (await this.authorization.evaluate(request, this.database.client)) {
        facilities.push(facility);
      }
    }
    if (organizationAccess || facilities.length > 0 || !recordDenial) {
      return { practice, organizationAccess, facilities };
    }

    await this.authorization.recordDenied(organizationRequest);
    throw new WorkforceSchedulingAuthorizationLostError();
  }

  private emptyPage<T>(
    query: WorkforceSchedulingListQuery,
  ): WorkforceSchedulingPage<T> {
    return {
      page: query.page,
      pageSize: query.pageSize,
      total: 0,
      items: [],
    };
  }

  private mapReadFailure(error: unknown): never {
    if (
      error instanceof WorkforceSchedulingAuthorizationLostError ||
      error instanceof WorkforceSchedulingTargetUnavailableError
    ) {
      throw error;
    }
    throw new WorkforceSchedulingPersistenceError();
  }

  private async executeMutation<TInput, TResponse>(
    request: SchedulingMutationRequest<TInput>,
    operation: WorkforceSchedulingCommandOperation,
    fingerprint: Record<string, unknown>,
    work: (
      database: Transaction<DatabaseSchema>,
      metadata: MutationMetadata,
    ) => Promise<TResponse>,
  ): Promise<TResponse> {
    const metadata: MutationMetadata = {
      correlationId: randomUUID(),
      frozenNow: new Date(),
      idempotencyKeyHash: sha256(request.idempotencyKey),
      requestHash: sha256(stableJson({ operation, ...fingerprint })),
      operation,
    };
    let transactionRetryCount = 0;
    let uniqueRetryUsed = false;

    for (;;) {
      try {
        return await this.database.client
          .transaction()
          .setIsolationLevel('serializable')
          .execute((transaction) => work(transaction, metadata));
      } catch (error) {
        if (error instanceof SchedulingAuthorizationDeniedError) {
          try {
            await this.authorization.recordDenied(error.request);
          } catch {
            throw new WorkforceSchedulingPersistenceError();
          }
          throw new WorkforceSchedulingAuthorizationLostError();
        }
        if (error instanceof SchedulingScopedTargetDeniedError) {
          try {
            await this.authorization.recordDenied(error.request);
          } catch {
            throw new WorkforceSchedulingPersistenceError();
          }
          throw new WorkforceSchedulingTargetUnavailableError();
        }
        if (
          error instanceof WorkforceSchedulingAuthorizationLostError ||
          error instanceof WorkforceSchedulingTargetUnavailableError ||
          error instanceof WorkforceSchedulingConflictError ||
          error instanceof WorkforceSchedulingPersistenceError ||
          error instanceof WorkforceSchedulingValidationError
        ) {
          throw error;
        }
        if (error instanceof AvailabilityMaterializationError) {
          if (
            error.code === 'OVERLAPPING_DESIRED_OCCURRENCES' ||
            error.code === 'GENERATION_KEY_CONFLICT'
          ) {
            throw new WorkforceSchedulingConflictError(error.message);
          }
          throw new WorkforceSchedulingValidationError(error.message);
        }
        if (isRetryableTransactionError(error)) {
          if (transactionRetryCount < 3) {
            transactionRetryCount += 1;
            continue;
          }
          throw new WorkforceSchedulingPersistenceError();
        }
        // Concurrent equivalent first attempts can collide on the durable
        // command key. One fresh serializable attempt reauthorizes and replays.
        if (isUniqueViolation(error) && !uniqueRetryUsed) {
          uniqueRetryUsed = true;
          continue;
        }
        if (isConstraintConflict(error)) {
          throw new WorkforceSchedulingConflictError();
        }
        throw new WorkforceSchedulingPersistenceError();
      }
    }
  }

  private async replayCommand<TResponse>(
    database: Transaction<DatabaseSchema>,
    access: AuthorizedAccess,
    practice: PracticeContext,
    metadata: MutationMetadata,
  ): Promise<TResponse | null> {
    const command = await database
      .selectFrom('workforce_scheduling_commands as command')
      .select([
        'command.tenant_id',
        'command.organization_id',
        'command.request_hash',
        'command.response_data',
      ])
      .where('command.actor_user_id', '=', access.applicationUserId)
      .where('command.tenant_id', '=', practice.tenantId)
      .where('command.organization_id', '=', practice.organizationId)
      .where('command.operation', '=', metadata.operation)
      .where('command.idempotency_key_hash', '=', metadata.idempotencyKeyHash)
      .executeTakeFirst();
    if (!command) return null;

    const stored: StoredSchedulingCommand = {
      tenantId: command.tenant_id,
      organizationId: command.organization_id,
      requestHash: command.request_hash,
      responseData: command.response_data,
    };
    if (
      stored.tenantId !== practice.tenantId ||
      stored.organizationId !== practice.organizationId ||
      stored.requestHash !== metadata.requestHash
    ) {
      throw new WorkforceSchedulingConflictError(
        'Idempotency-Key was already used for a different scheduling change.',
      );
    }
    if (!isRecord(stored.responseData)) {
      throw new WorkforceSchedulingPersistenceError();
    }
    return stored.responseData as TResponse;
  }

  private async insertCommand(
    database: Transaction<DatabaseSchema>,
    access: AuthorizedAccess,
    practice: PracticeContext,
    metadata: MutationMetadata,
    response: Record<string, unknown>,
    targetEntityType: string,
    targetEntityId: string,
  ): Promise<void> {
    await database
      .insertInto('workforce_scheduling_commands')
      .values({
        actor_user_id: access.applicationUserId,
        tenant_id: practice.tenantId,
        organization_id: practice.organizationId,
        operation: metadata.operation,
        idempotency_key_hash: metadata.idempotencyKeyHash,
        request_hash: metadata.requestHash,
        response_data: response,
        target_entity_type: targetEntityType,
        target_entity_id: targetEntityId,
      })
      .execute();
  }

  private async insertSuccessAudit(
    database: Transaction<DatabaseSchema>,
    input: {
      principal: AuthenticatedPrincipal;
      access: AuthorizedAccess;
      practice: PracticeContext;
      facilityId: string | null;
      correlationId: string;
      action: string;
      targetEntityType: string;
      targetEntityId: string;
      reason: string;
      beforeData: Record<string, unknown> | null;
      afterData: Record<string, unknown> | null;
    },
  ): Promise<void> {
    await database
      .insertInto('audit_events')
      .values({
        actor_type: 'user',
        actor_identifier: input.principal.subject,
        actor_user_id: input.access.applicationUserId,
        effective_user_id: input.access.applicationUserId,
        tenant_id: input.practice.tenantId,
        organization_id: input.practice.organizationId,
        facility_id: input.facilityId,
        action: input.action,
        target_entity_type: input.targetEntityType,
        target_entity_id: input.targetEntityId,
        outcome: 'success',
        correlation_id: input.correlationId,
        reason: input.reason,
        before_data: input.beforeData,
        after_data: input.afterData,
      })
      .execute();
  }

  private async affectedAppointments(
    database: Transaction<DatabaseSchema>,
    practice: PracticeContext,
    condition: 'facility-assignment' | 'service' | 'service-assignment',
    targetId: string,
  ): Promise<AffectedAppointments> {
    const predicate =
      condition === 'facility-assignment'
        ? sql`appointment.practitioner_facility_assignment_id = ${targetId}`
        : condition === 'service'
          ? sql`appointment.appointment_service_id = ${targetId}`
          : sql`appointment.practitioner_service_assignment_id = ${targetId}`;
    const countResult = await sql<{ count: string }>`
      select count(*)::text as count
      from patient_portal_appointments appointment
      where appointment.tenant_id = ${practice.tenantId}
        and appointment.organization_id = ${practice.organizationId}
        and appointment.status in ('requested', 'confirmed')
        and ${predicate}
    `.execute(database);
    const idResult = await sql<{ id: string }>`
      select appointment.id
      from patient_portal_appointments appointment
      where appointment.tenant_id = ${practice.tenantId}
        and appointment.organization_id = ${practice.organizationId}
        and appointment.status in ('requested', 'confirmed')
        and ${predicate}
      order by appointment.id
      limit 100
    `.execute(database);
    return {
      count: asCount(countResult.rows[0]?.count),
      ids: idResult.rows.map((row) => row.id),
    };
  }

  private async activeServiceAssignmentsForFacilityAssignment(
    database: Transaction<DatabaseSchema>,
    practice: PracticeContext,
    facilityId: string,
    facilityAssignmentId: string,
  ): Promise<AffectedAppointments> {
    const result = await sql<{ count: string; ids: string[] }>`
      with affected as materialized (
        select assignment.id
        from practitioner_service_assignments assignment
        where assignment.tenant_id = ${practice.tenantId}
          and assignment.organization_id = ${practice.organizationId}
          and assignment.facility_id = ${facilityId}
          and assignment.practitioner_facility_assignment_id = ${facilityAssignmentId}
          and assignment.status = 'active'
          and assignment.is_synthetic = true
        order by assignment.id
        for update
      )
      select
        (select count(*)::text from affected) as count,
        coalesce(
          (
            select array_agg(bounded.id order by bounded.id)
            from (
              select affected.id
              from affected
              order by affected.id
              limit 100
            ) bounded
          ),
          array[]::uuid[]
        ) as ids
    `.execute(database);
    return {
      count: asCount(result.rows[0]?.count),
      ids: result.rows[0]?.ids ?? [],
    };
  }

  private async loadPractitioner(
    database: DatabaseExecutor,
    practice: PracticeContext,
    practitionerId: string,
  ): Promise<WorkforcePractitionerView> {
    const practitioner = await database
      .selectFrom('practitioners as practitioner')
      .select([
        'practitioner.id',
        'practitioner.display_name',
        'practitioner.professional_title',
        'practitioner.status',
        'practitioner.application_user_id',
        'practitioner.updated_at',
      ])
      .where('practitioner.id', '=', practitionerId)
      .where('practitioner.tenant_id', '=', practice.tenantId)
      .where('practitioner.is_synthetic', '=', true)
      .where((expression) =>
        expression.exists(
          expression
            .selectFrom('practitioner_facility_assignments as assignment')
            .select(sql`1`.as('one'))
            .whereRef('assignment.practitioner_id', '=', 'practitioner.id')
            .where('assignment.tenant_id', '=', practice.tenantId)
            .where('assignment.organization_id', '=', practice.organizationId)
            .where('assignment.is_synthetic', '=', true),
        ),
      )
      .executeTakeFirst();
    if (!practitioner) throw new WorkforceSchedulingPersistenceError();

    const facilityAssignments = await database
      .selectFrom('practitioner_facility_assignments as assignment')
      .innerJoin('facilities as facility', (join) =>
        join
          .onRef('facility.id', '=', 'assignment.facility_id')
          .onRef('facility.tenant_id', '=', 'assignment.tenant_id')
          .onRef('facility.organization_id', '=', 'assignment.organization_id'),
      )
      .select([
        'assignment.id',
        'assignment.facility_id',
        'facility.name as facility_name',
        'assignment.status',
        'assignment.updated_at',
      ])
      .where('assignment.tenant_id', '=', practice.tenantId)
      .where('assignment.organization_id', '=', practice.organizationId)
      .where('assignment.practitioner_id', '=', practitionerId)
      .where('assignment.is_synthetic', '=', true)
      .where('facility.is_synthetic', '=', true)
      .orderBy('facility.name', 'asc')
      .orderBy('assignment.id', 'asc')
      .execute();
    const serviceAssignments = await database
      .selectFrom('practitioner_service_assignments as assignment')
      .innerJoin('appointment_services as service', (join) =>
        join
          .onRef('service.id', '=', 'assignment.appointment_service_id')
          .onRef('service.tenant_id', '=', 'assignment.tenant_id')
          .onRef('service.organization_id', '=', 'assignment.organization_id')
          .onRef('service.facility_id', '=', 'assignment.facility_id'),
      )
      .select([
        'assignment.id',
        'assignment.practitioner_facility_assignment_id',
        'assignment.appointment_service_id',
        'service.patient_facing_name as service_name',
        'assignment.facility_id',
        'assignment.status',
        'assignment.updated_at',
      ])
      .where('assignment.tenant_id', '=', practice.tenantId)
      .where('assignment.organization_id', '=', practice.organizationId)
      .where('assignment.practitioner_id', '=', practitionerId)
      .where('assignment.is_synthetic', '=', true)
      .where('service.is_synthetic', '=', true)
      .orderBy('service.patient_facing_name', 'asc')
      .orderBy('assignment.id', 'asc')
      .execute();

    return {
      practitionerId: practitioner.id,
      displayName: practitioner.display_name,
      professionalTitle: practitioner.professional_title,
      status: practitioner.status,
      applicationUserLinked: practitioner.application_user_id !== null,
      updatedAt: practitioner.updated_at.toISOString(),
      facilityAssignments: facilityAssignments.map((assignment) => ({
        assignmentId: assignment.id,
        facilityId: assignment.facility_id,
        facilityName: assignment.facility_name,
        status: assignment.status,
        updatedAt: assignment.updated_at.toISOString(),
      })),
      serviceAssignments: serviceAssignments.map((assignment) => ({
        assignmentId: assignment.id,
        practitionerFacilityAssignmentId:
          assignment.practitioner_facility_assignment_id,
        appointmentServiceId: assignment.appointment_service_id,
        serviceName: assignment.service_name,
        facilityId: assignment.facility_id,
        status: assignment.status,
        updatedAt: assignment.updated_at.toISOString(),
      })),
    };
  }

  private async loadFacilityAssignment(
    database: DatabaseExecutor,
    practice: PracticeContext,
    assignmentId: string,
  ): Promise<PractitionerFacilityAssignmentMutationResponse['assignment']> {
    const assignment = await database
      .selectFrom('practitioner_facility_assignments as assignment')
      .innerJoin('facilities as facility', (join) =>
        join
          .onRef('facility.id', '=', 'assignment.facility_id')
          .onRef('facility.tenant_id', '=', 'assignment.tenant_id')
          .onRef('facility.organization_id', '=', 'assignment.organization_id'),
      )
      .select([
        'assignment.id',
        'assignment.facility_id',
        'facility.name as facility_name',
        'assignment.status',
        'assignment.updated_at',
      ])
      .where('assignment.id', '=', assignmentId)
      .where('assignment.tenant_id', '=', practice.tenantId)
      .where('assignment.organization_id', '=', practice.organizationId)
      .where('assignment.is_synthetic', '=', true)
      .where('facility.is_synthetic', '=', true)
      .executeTakeFirst();
    if (!assignment) throw new WorkforceSchedulingPersistenceError();
    return {
      assignmentId: assignment.id,
      facilityId: assignment.facility_id,
      facilityName: assignment.facility_name,
      status: assignment.status,
      updatedAt: assignment.updated_at.toISOString(),
    };
  }

  private async loadSpecialty(
    database: DatabaseExecutor,
    practice: PracticeContext,
    specialtyId: string,
  ): Promise<WorkforceSpecialtyView> {
    const specialty = await database
      .selectFrom('specialties as specialty')
      .select([
        'specialty.id',
        'specialty.code',
        'specialty.name',
        'specialty.status',
        'specialty.updated_at',
      ])
      .where('specialty.id', '=', specialtyId)
      .where('specialty.tenant_id', '=', practice.tenantId)
      .where('specialty.organization_id', '=', practice.organizationId)
      .where('specialty.is_synthetic', '=', true)
      .executeTakeFirst();
    if (!specialty) throw new WorkforceSchedulingPersistenceError();
    return {
      specialtyId: specialty.id,
      code: specialty.code,
      name: specialty.name,
      status: specialty.status,
      updatedAt: specialty.updated_at.toISOString(),
    };
  }

  private async loadService(
    database: DatabaseExecutor,
    practice: PracticeContext,
    serviceId: string,
  ): Promise<WorkforceAppointmentServiceView> {
    const service = await database
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
      .select([
        'service.id',
        'service.facility_id',
        'facility.name as facility_name',
        'service.specialty_id',
        'specialty.name as specialty_name',
        'specialty.status as specialty_status',
        'service.code',
        'service.patient_facing_name',
        'service.duration_minutes',
        'service.allows_any_practitioner',
        'service.status',
        'service.updated_at',
      ])
      .where('service.id', '=', serviceId)
      .where('service.tenant_id', '=', practice.tenantId)
      .where('service.organization_id', '=', practice.organizationId)
      .where('service.is_synthetic', '=', true)
      .where('facility.is_synthetic', '=', true)
      .where('specialty.is_synthetic', '=', true)
      .executeTakeFirst();
    if (!service) throw new WorkforceSchedulingPersistenceError();

    const assignments = await database
      .selectFrom('practitioner_service_assignments as assignment')
      .innerJoin(
        'practitioner_facility_assignments as facility_assignment',
        (join) =>
          join
            .onRef(
              'facility_assignment.id',
              '=',
              'assignment.practitioner_facility_assignment_id',
            )
            .onRef('facility_assignment.tenant_id', '=', 'assignment.tenant_id')
            .onRef(
              'facility_assignment.organization_id',
              '=',
              'assignment.organization_id',
            )
            .onRef(
              'facility_assignment.facility_id',
              '=',
              'assignment.facility_id',
            )
            .onRef(
              'facility_assignment.practitioner_id',
              '=',
              'assignment.practitioner_id',
            ),
      )
      .innerJoin('practitioners as practitioner', (join) =>
        join
          .onRef('practitioner.id', '=', 'assignment.practitioner_id')
          .onRef('practitioner.tenant_id', '=', 'assignment.tenant_id'),
      )
      .select([
        'assignment.id',
        'assignment.practitioner_facility_assignment_id',
        'assignment.appointment_service_id',
        'assignment.facility_id',
        'assignment.status',
        'assignment.updated_at',
        'facility_assignment.status as facility_assignment_status',
        'facility_assignment.is_synthetic as facility_assignment_synthetic',
        'practitioner.id as practitioner_id',
        'practitioner.status as practitioner_status',
        'practitioner.is_synthetic as practitioner_synthetic',
      ])
      .where('assignment.appointment_service_id', '=', service.id)
      .where('assignment.tenant_id', '=', practice.tenantId)
      .where('assignment.organization_id', '=', practice.organizationId)
      .where('assignment.facility_id', '=', service.facility_id)
      .where('assignment.is_synthetic', '=', true)
      .where('facility_assignment.is_synthetic', '=', true)
      .where('practitioner.is_synthetic', '=', true)
      .orderBy('assignment.id', 'asc')
      .execute();
    const activePractitioners = new Set(
      assignments
        .filter(
          (assignment) =>
            assignment.status === 'active' &&
            assignment.facility_assignment_status === 'active' &&
            assignment.facility_assignment_synthetic &&
            assignment.practitioner_status === 'active' &&
            assignment.practitioner_synthetic,
        )
        .map((assignment) => assignment.practitioner_id),
    );

    return {
      appointmentServiceId: service.id,
      facilityId: service.facility_id,
      facilityName: service.facility_name,
      specialtyId: service.specialty_id,
      specialtyName: service.specialty_name,
      code: service.code,
      patientFacingName: service.patient_facing_name,
      durationMinutes: service.duration_minutes,
      allowsAnyPractitioner: service.allows_any_practitioner,
      status: service.status,
      publishable:
        service.status === 'active' &&
        service.specialty_status === 'active' &&
        activePractitioners.size > 0,
      activePractitionerCount: activePractitioners.size,
      updatedAt: service.updated_at.toISOString(),
      practitionerAssignments: assignments.map((assignment) => ({
        assignmentId: assignment.id,
        practitionerFacilityAssignmentId:
          assignment.practitioner_facility_assignment_id,
        appointmentServiceId: assignment.appointment_service_id,
        serviceName: service.patient_facing_name,
        facilityId: assignment.facility_id,
        status: assignment.status,
        updatedAt: assignment.updated_at.toISOString(),
      })),
    };
  }

  private async loadServiceAssignment(
    database: DatabaseExecutor,
    practice: PracticeContext,
    assignmentId: string,
  ): Promise<PractitionerServiceAssignmentMutationResponse['assignment']> {
    const assignment = await database
      .selectFrom('practitioner_service_assignments as assignment')
      .innerJoin('appointment_services as service', (join) =>
        join
          .onRef('service.id', '=', 'assignment.appointment_service_id')
          .onRef('service.tenant_id', '=', 'assignment.tenant_id')
          .onRef('service.organization_id', '=', 'assignment.organization_id')
          .onRef('service.facility_id', '=', 'assignment.facility_id'),
      )
      .select([
        'assignment.id',
        'assignment.practitioner_facility_assignment_id',
        'assignment.appointment_service_id',
        'service.patient_facing_name as service_name',
        'assignment.facility_id',
        'assignment.status',
        'assignment.updated_at',
      ])
      .where('assignment.id', '=', assignmentId)
      .where('assignment.tenant_id', '=', practice.tenantId)
      .where('assignment.organization_id', '=', practice.organizationId)
      .where('assignment.is_synthetic', '=', true)
      .where('service.is_synthetic', '=', true)
      .executeTakeFirst();
    if (!assignment) throw new WorkforceSchedulingPersistenceError();
    return {
      assignmentId: assignment.id,
      practitionerFacilityAssignmentId:
        assignment.practitioner_facility_assignment_id,
      appointmentServiceId: assignment.appointment_service_id,
      serviceName: assignment.service_name,
      facilityId: assignment.facility_id,
      status: assignment.status,
      updatedAt: assignment.updated_at.toISOString(),
    };
  }
}
