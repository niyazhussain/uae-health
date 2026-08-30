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
  SchedulingMutationRequest,
  SpecialtyMutationResponse,
  UpdateAppointmentServiceInput,
  UpdateSpecialtyInput,
  WorkforceAppointmentServiceView,
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
  idempotencyKeyHash: string;
  requestHash: string;
  operation: WorkforceSchedulingCommandOperation;
}

interface AffectedAppointments {
  count: number;
  ids: string[];
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
  return code === '23503' || code === '23505' || code === '23514';
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
          error instanceof WorkforceSchedulingPersistenceError
        ) {
          throw error;
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
