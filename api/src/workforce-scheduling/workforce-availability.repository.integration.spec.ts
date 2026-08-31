import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Kysely, sql } from 'kysely';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { AuthorizationRepository } from '../authorization/authorization.repository.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { createDatabaseClient } from '../database/create-database-client.js';
import type { DatabaseService } from '../database/database.service.js';
import type { DatabaseSchema } from '../database/database.types.js';
import * as createFacilities from '../database/migrations/2026-08-23T000000_create_facilities.js';
import * as createIdentityAuthorizationAudit from '../database/migrations/2026-08-24T000000_create_identity_authorization_audit.js';
import * as createWorkforceSessions from '../database/migrations/2026-08-24T010000_create_workforce_sessions.js';
import * as addTenantLocalRoleNameUniqueness from '../database/migrations/2026-08-26T000000_add_tenant_local_role_name_uniqueness.js';
import * as addIdentityProviderSyncStatus from '../database/migrations/2026-08-26T010000_add_identity_provider_sync_status.js';
import * as createPatientPortalIdentity from '../database/migrations/2026-08-26T020000_create_patient_portal_identity.js';
import * as createPatientRegistrationAndInvitations from '../database/migrations/2026-08-27T000000_create_patient_registration_and_invitations.js';
import * as createPatientPortalAppointments from '../database/migrations/2026-08-27T010000_create_patient_portal_appointments.js';
import * as createPractitionerProfiles from '../database/migrations/2026-08-27T020000_create_practitioner_profiles.js';
import * as createProviderSchedulingCatalogue from '../database/migrations/2026-08-27T030000_create_provider_scheduling_catalogue.js';
import * as createProviderAvailability from '../database/migrations/2026-08-27T040000_create_provider_availability.js';
import * as backfillSyntheticProviderAppointments from '../database/migrations/2026-08-27T050000_backfill_synthetic_provider_appointments.js';
import * as createWorkforceSchedulingCommands from '../database/migrations/2026-08-27T060000_create_workforce_scheduling_commands.js';
import * as addDeferredSlotWithdrawal from '../database/migrations/2026-08-27T070000_add_deferred_slot_withdrawal.js';
import type { WorkforceIdentityProviderPort } from '../identity-provider/identity-provider.types.js';
import { PatientAppointmentsService } from '../patient-appointments/patient-appointments.service.js';
import type { PatientPortalSessionContext } from '../patient-portal-auth/patient-portal-auth.types.js';
import {
  addLocalCalendarDays,
  captureAvailabilityHorizon,
  getIsoWeekday,
} from './provider-availability-time.js';
import { WorkforceSchedulingRepository } from './workforce-scheduling.repository.js';
import type { CreateAvailabilityTemplateInput } from './workforce-scheduling.types.js';
import {
  WorkforceSchedulingAuthorizationLostError,
  WorkforceSchedulingConflictError,
  WorkforceSchedulingPersistenceError,
} from './workforce-scheduling.types.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const providerIssuer =
  'https://workforce-idp.example.invalid/availability-repository-tests';

const fixture = {
  tenantId: uuid(1),
  groupId: uuid(2),
  practiceAId: uuid(3),
  practiceBId: uuid(4),
  facilityAId: uuid(5),
  facilityBId: uuid(6),
  bookablePracticeAId: uuid(7),
  bookablePracticeBId: uuid(8),
  identityConnectionId: uuid(9),
  users: {
    schedulerA: {
      applicationUserId: uuid(10),
      identityId: uuid(11),
      membershipId: uuid(12),
      subject: 'synthetic-availability-scheduler-a',
    },
    schedulerB: {
      applicationUserId: uuid(13),
      identityId: uuid(14),
      membershipId: uuid(15),
      subject: 'synthetic-availability-scheduler-b',
    },
    schedulerWithoutFacility: {
      applicationUserId: uuid(16),
      identityId: uuid(17),
      membershipId: uuid(18),
      subject: 'synthetic-availability-scheduler-without-facility',
    },
  },
} as const;

interface PracticeScope {
  organizationId: string;
  facilityId: string;
  bookablePracticeId: string;
  timezone: string;
  principal: AuthenticatedPrincipal;
}

interface ProviderChain extends PracticeScope {
  practitionerId: string;
  specialtyId: string;
  practitionerFacilityAssignmentId: string;
  appointmentServiceId: string;
  practitionerServiceAssignmentId: string;
}

interface StoredSlot {
  id: string;
  source_local_date: string | null;
  starts_at: Date;
  ends_at: Date;
  status: 'available' | 'withdrawn';
  withdrawal_pending: boolean;
}

interface PatientFixture {
  session: PatientPortalSessionContext;
  identityId: string;
  relationshipId: string;
}

const scopeA: PracticeScope = {
  organizationId: fixture.practiceAId,
  facilityId: fixture.facilityAId,
  bookablePracticeId: fixture.bookablePracticeAId,
  timezone: 'Asia/Dubai',
  principal: principal(fixture.users.schedulerA.subject),
};

const scopeB: PracticeScope = {
  organizationId: fixture.practiceBId,
  facilityId: fixture.facilityBId,
  bookablePracticeId: fixture.bookablePracticeBId,
  timezone: 'Asia/Karachi',
  principal: principal(fixture.users.schedulerB.subject),
};

let generatedId = 1_000;

function uuid(value: number): string {
  return `f0000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

function nextUuid(): string {
  generatedId += 1;
  return uuid(generatedId);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function principal(subject: string): AuthenticatedPrincipal {
  return { subject, clientId: 'synthetic-workforce-availability-client' };
}

function identityProvider(): WorkforceIdentityProviderPort {
  return {
    issuer: providerIssuer,
    protocol: 'oidc',
    provisionAccount: () => Promise.reject(new Error('Not used by this test.')),
    deleteAccount: () => Promise.reject(new Error('Not used by this test.')),
  };
}

async function migrateDatabase(
  database: Kysely<DatabaseSchema>,
): Promise<void> {
  const migrationDatabase = database as unknown as Kysely<unknown>;
  await createFacilities.up(migrationDatabase);
  await createIdentityAuthorizationAudit.up(migrationDatabase);
  await createWorkforceSessions.up(migrationDatabase);
  await addTenantLocalRoleNameUniqueness.up(migrationDatabase);
  await addIdentityProviderSyncStatus.up(migrationDatabase);
  await createPatientPortalIdentity.up(migrationDatabase);
  await createPatientRegistrationAndInvitations.up(migrationDatabase);
  await createPatientPortalAppointments.up(migrationDatabase);
  await createPractitionerProfiles.up(migrationDatabase);
  await createProviderSchedulingCatalogue.up(migrationDatabase);
  await createProviderAvailability.up(migrationDatabase);
  await database
    .transaction()
    .execute((transaction) =>
      backfillSyntheticProviderAppointments.up(
        transaction as unknown as Kysely<unknown>,
      ),
    );
  await createWorkforceSchedulingCommands.up(migrationDatabase);
  await addDeferredSlotWithdrawal.up(migrationDatabase);
}

async function insertBaseFixture(
  database: Kysely<DatabaseSchema>,
): Promise<void> {
  await database
    .insertInto('tenants')
    .values({
      id: fixture.tenantId,
      code: 'AVAILABILITY-INTEGRATION',
      name: 'Synthetic Availability Integration Tenant',
      status: 'active',
      is_synthetic: true,
    })
    .execute();
  await database
    .insertInto('organizations')
    .values([
      {
        id: fixture.groupId,
        tenant_id: fixture.tenantId,
        parent_organization_id: null,
        kind: 'group',
        code: 'AVAILABILITY-GROUP',
        name: 'Synthetic Availability Group',
        is_synthetic: true,
      },
      {
        id: fixture.practiceAId,
        tenant_id: fixture.tenantId,
        parent_organization_id: fixture.groupId,
        kind: 'practice',
        code: 'AVAILABILITY-A',
        name: 'Synthetic Availability Practice A',
        is_synthetic: true,
      },
      {
        id: fixture.practiceBId,
        tenant_id: fixture.tenantId,
        parent_organization_id: fixture.groupId,
        kind: 'practice',
        code: 'AVAILABILITY-B',
        name: 'Synthetic Availability Practice B',
        is_synthetic: true,
      },
    ])
    .execute();
  await database
    .insertInto('facilities')
    .values([
      {
        id: fixture.facilityAId,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceAId,
        code: 'AVAILABILITY-A',
        name: 'Synthetic Availability Facility A',
        timezone: scopeA.timezone,
        is_synthetic: true,
      },
      {
        id: fixture.facilityBId,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceBId,
        code: 'AVAILABILITY-B',
        name: 'Synthetic Availability Facility B',
        timezone: scopeB.timezone,
        is_synthetic: true,
      },
    ])
    .execute();
  await database
    .insertInto('patient_portal_bookable_practices')
    .values([
      {
        id: fixture.bookablePracticeAId,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceAId,
        timezone: scopeA.timezone,
        status: 'active',
        is_synthetic: true,
      },
      {
        id: fixture.bookablePracticeBId,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceBId,
        timezone: scopeB.timezone,
        status: 'active',
        is_synthetic: true,
      },
    ])
    .execute();

  const users = Object.values(fixture.users);
  await database
    .insertInto('application_users')
    .values(
      users.map((user, index) => ({
        id: user.applicationUserId,
        display_name: `Synthetic availability scheduler ${index + 1}`,
        primary_email: `availability-scheduler-${index + 1}@example.invalid`,
        status: 'active' as const,
        is_synthetic: true,
      })),
    )
    .execute();
  await database
    .insertInto('identity_connections')
    .values({
      id: fixture.identityConnectionId,
      tenant_id: fixture.tenantId,
      code: 'availability-integration',
      name: 'Synthetic availability identity connection',
      protocol: 'oidc',
      issuer: providerIssuer,
      status: 'active',
      jit_provisioning_enabled: false,
    })
    .execute();
  await database
    .insertInto('user_identities')
    .values(
      users.map((user) => ({
        id: user.identityId,
        application_user_id: user.applicationUserId,
        identity_connection_id: fixture.identityConnectionId,
        subject: user.subject,
        status: 'active' as const,
      })),
    )
    .execute();
  await database
    .insertInto('organization_memberships')
    .values([
      {
        id: fixture.users.schedulerA.membershipId,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceAId,
        application_user_id: fixture.users.schedulerA.applicationUserId,
        status: 'active',
        provisioning_method: 'admin_invite',
      },
      {
        id: fixture.users.schedulerB.membershipId,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceBId,
        application_user_id: fixture.users.schedulerB.applicationUserId,
        status: 'active',
        provisioning_method: 'admin_invite',
      },
      {
        id: fixture.users.schedulerWithoutFacility.membershipId,
        tenant_id: fixture.tenantId,
        organization_id: fixture.practiceAId,
        application_user_id:
          fixture.users.schedulerWithoutFacility.applicationUserId,
        status: 'active',
        provisioning_method: 'admin_invite',
      },
    ])
    .execute();
  await database
    .insertInto('membership_facilities')
    .values([
      {
        tenant_id: fixture.tenantId,
        membership_id: fixture.users.schedulerA.membershipId,
        facility_id: fixture.facilityAId,
      },
      {
        tenant_id: fixture.tenantId,
        membership_id: fixture.users.schedulerB.membershipId,
        facility_id: fixture.facilityBId,
      },
    ])
    .execute();

  const schedulerRole = await database
    .selectFrom('roles')
    .select('id')
    .where('tenant_id', 'is', null)
    .where('code', '=', 'SCHEDULER')
    .executeTakeFirstOrThrow();
  await database
    .insertInto('role_assignments')
    .values([
      {
        tenant_id: fixture.tenantId,
        membership_id: fixture.users.schedulerA.membershipId,
        role_id: schedulerRole.id,
        scope_organization_id: fixture.practiceAId,
        facility_id: null,
        include_descendants: false,
        assignment_source: 'system_bootstrap',
      },
      {
        tenant_id: fixture.tenantId,
        membership_id: fixture.users.schedulerB.membershipId,
        role_id: schedulerRole.id,
        scope_organization_id: fixture.practiceBId,
        facility_id: null,
        include_descendants: false,
        assignment_source: 'system_bootstrap',
      },
      {
        tenant_id: fixture.tenantId,
        membership_id: fixture.users.schedulerWithoutFacility.membershipId,
        role_id: schedulerRole.id,
        scope_organization_id: fixture.practiceAId,
        facility_id: null,
        include_descendants: false,
        assignment_source: 'system_bootstrap',
      },
    ])
    .execute();
}

async function insertProviderChain(
  database: Kysely<DatabaseSchema>,
  scope: PracticeScope,
  label: string,
  existingPractitionerId?: string,
): Promise<ProviderChain> {
  const codeLabel = label.toUpperCase().replace(/[^A-Z0-9-]/g, '-');
  const practitionerId = existingPractitionerId ?? nextUuid();
  const specialtyId = nextUuid();
  const practitionerFacilityAssignmentId = nextUuid();
  const appointmentServiceId = nextUuid();
  const practitionerServiceAssignmentId = nextUuid();

  if (!existingPractitionerId) {
    await database
      .insertInto('practitioners')
      .values({
        id: practitionerId,
        tenant_id: fixture.tenantId,
        application_user_id: null,
        display_name: `Synthetic ${label} practitioner`,
        professional_title: 'General physician',
        status: 'active',
        is_synthetic: true,
      })
      .execute();
  }
  await database
    .insertInto('specialties')
    .values({
      id: specialtyId,
      tenant_id: fixture.tenantId,
      organization_id: scope.organizationId,
      code: `S-${codeLabel}`,
      name: `Synthetic ${label} specialty`,
      status: 'active',
      is_synthetic: true,
    })
    .execute();
  await database
    .insertInto('practitioner_facility_assignments')
    .values({
      id: practitionerFacilityAssignmentId,
      tenant_id: fixture.tenantId,
      organization_id: scope.organizationId,
      facility_id: scope.facilityId,
      practitioner_id: practitionerId,
      status: 'active',
      is_synthetic: true,
    })
    .execute();
  await database
    .insertInto('appointment_services')
    .values({
      id: appointmentServiceId,
      tenant_id: fixture.tenantId,
      organization_id: scope.organizationId,
      facility_id: scope.facilityId,
      specialty_id: specialtyId,
      code: `SV-${codeLabel}`,
      patient_facing_name: `Synthetic ${label} consultation`,
      duration_minutes: 30,
      allows_any_practitioner: false,
      status: 'active',
      is_synthetic: true,
    })
    .execute();
  await database
    .insertInto('practitioner_service_assignments')
    .values({
      id: practitionerServiceAssignmentId,
      tenant_id: fixture.tenantId,
      organization_id: scope.organizationId,
      facility_id: scope.facilityId,
      practitioner_facility_assignment_id: practitionerFacilityAssignmentId,
      practitioner_id: practitionerId,
      appointment_service_id: appointmentServiceId,
      status: 'active',
      is_synthetic: true,
    })
    .execute();

  return {
    ...scope,
    practitionerId,
    specialtyId,
    practitionerFacilityAssignmentId,
    appointmentServiceId,
    practitionerServiceAssignmentId,
  };
}

function templateInput(
  chain: ProviderChain,
  input: {
    localStartMinute?: number;
    localEndMinute?: number;
    status?: 'active' | 'inactive';
  } = {},
): CreateAvailabilityTemplateInput {
  const effectiveFrom = addLocalCalendarDays(
    captureAvailabilityHorizon(new Date(), chain.timezone).localStartDate,
    1,
  );
  return {
    organizationId: chain.organizationId,
    practitionerServiceAssignmentId: chain.practitionerServiceAssignmentId,
    isoWeekday: getIsoWeekday(effectiveFrom),
    localStartMinute: input.localStartMinute ?? 540,
    localEndMinute: input.localEndMinute ?? 660,
    effectiveFrom,
    status: input.status ?? 'active',
    reasonCode: 'availability-configuration',
  };
}

async function templateSlots(
  database: Kysely<DatabaseSchema>,
  templateId: string,
): Promise<StoredSlot[]> {
  return database
    .selectFrom('patient_portal_appointment_slots')
    .select([
      'id',
      'source_local_date',
      'starts_at',
      'ends_at',
      'status',
      'withdrawal_pending',
    ])
    .where('availability_template_id', '=', templateId)
    .orderBy('starts_at', 'asc')
    .orderBy('id', 'asc')
    .execute();
}

function canonicalLocalTimestamp(localDate: string, minute: number): string {
  const hour = Math.floor(minute / 60);
  const minuteOfHour = minute % 60;
  return `${localDate}T${String(hour).padStart(2, '0')}:${String(minuteOfHour).padStart(2, '0')}:00`;
}

async function insertPatient(
  database: Kysely<DatabaseSchema>,
  scope: PracticeScope,
  label: string,
): Promise<PatientFixture> {
  const applicationUserId = nextUuid();
  const identityId = nextUuid();
  const relationshipId = nextUuid();
  const sessionId = nextUuid();
  const csrfToken = `synthetic-csrf-${label}`;
  const subject = `synthetic-availability-patient-${label}`;
  const issuer = 'https://patient-idp.example.invalid/availability-tests';
  const clientId = 'synthetic-patient-availability-client';
  await database
    .insertInto('application_users')
    .values({
      id: applicationUserId,
      display_name: `Synthetic availability patient ${label}`,
      primary_email: `availability-patient-${label}@example.invalid`,
      status: 'active',
      is_synthetic: true,
    })
    .execute();
  await database
    .insertInto('patient_portal_identities')
    .values({
      id: identityId,
      application_user_id: applicationUserId,
      issuer,
      subject,
      client_id: clientId,
      username: `availability-patient-${label}@example.invalid`,
      status: 'active',
      provider_sync_attempted_at: null,
      provider_sync_completed_at: null,
      provider_sync_error_code: null,
      last_authenticated_at: null,
    })
    .execute();
  await database
    .insertInto('patient_portal_appointment_relationships')
    .values({
      id: relationshipId,
      tenant_id: fixture.tenantId,
      organization_id: scope.organizationId,
      patient_portal_identity_id: identityId,
      status: 'pending',
    })
    .execute();

  const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await database
    .insertInto('patient_portal_sessions')
    .values({
      id: sessionId,
      session_token_hash: sha256(
        `synthetic-availability-session-${label}-${sessionId}`,
      ),
      csrf_token_hash: sha256(csrfToken),
      patient_portal_identity_id: identityId,
      patient_portal_profile_id: null,
      patient_portal_appointment_relationship_id: relationshipId,
      identity_issuer: issuer,
      identity_subject: subject,
      identity_client_id: clientId,
      identity_username: `availability-patient-${label}@example.invalid`,
      idle_expires_at: future,
      absolute_expires_at: future,
      revoked_at: null,
    })
    .execute();

  return {
    identityId,
    relationshipId,
    session: {
      sessionId,
      principal: { issuer, subject, clientId },
      patientPortalIdentityId: identityId,
      applicationUserId,
      displayName: `Synthetic availability patient ${label}`,
      context: {
        kind: 'appointment-onboarding',
        appointmentRelationshipId: relationshipId,
        practiceName:
          scope.organizationId === fixture.practiceAId
            ? 'Synthetic Availability Practice A'
            : 'Synthetic Availability Practice B',
        tenantId: fixture.tenantId,
        organizationId: scope.organizationId,
      },
      availablePractices: [],
      appointmentOnboardingPractices: [
        {
          appointmentRelationshipId: relationshipId,
          practiceName:
            scope.organizationId === fixture.practiceAId
              ? 'Synthetic Availability Practice A'
              : 'Synthetic Availability Practice B',
        },
      ],
      csrfToken,
      idleExpiresAt: future,
      absoluteExpiresAt: future,
      renewed: false,
    },
  };
}

async function currentServiceTimestamp(
  database: Kysely<DatabaseSchema>,
  serviceId: string,
): Promise<string> {
  const service = await database
    .selectFrom('appointment_services')
    .select('updated_at')
    .where('id', '=', serviceId)
    .executeTakeFirstOrThrow();
  return service.updated_at.toISOString();
}

describeWithDatabase('workforce availability repository integration', () => {
  const schemaName = `workforce_availability_${process.pid}_${Date.now()}`;
  let adminDatabase: Kysely<unknown>;
  let database: Kysely<DatabaseSchema>;
  let concurrentDatabase: Kysely<DatabaseSchema>;
  let repository: WorkforceSchedulingRepository;
  let concurrentRepository: WorkforceSchedulingRepository;
  let patientAppointments: PatientAppointmentsService;
  let concurrentPatientAppointments: PatientAppointmentsService;

  beforeAll(async () => {
    adminDatabase = createDatabaseClient<unknown>({
      connectionString: databaseUrl!,
      maxConnections: 1,
      ssl: false,
    });
    database = createDatabaseClient<DatabaseSchema>({
      connectionString: databaseUrl!,
      maxConnections: 1,
      ssl: false,
    });
    await sql`create schema ${sql.id(schemaName)}`.execute(adminDatabase);
    await sql`set search_path to ${sql.id(schemaName)}, public`.execute(
      database,
    );
    await migrateDatabase(database);
    await insertBaseFixture(database);

    const provider = identityProvider();
    const databaseService = { client: database } as DatabaseService;
    repository = new WorkforceSchedulingRepository(
      databaseService,
      new AuthorizationService(
        new AuthorizationRepository(databaseService, provider),
      ),
      provider,
    );
    patientAppointments = new PatientAppointmentsService(databaseService);

    concurrentDatabase = createDatabaseClient<DatabaseSchema>({
      connectionString: databaseUrl!,
      maxConnections: 1,
      ssl: false,
    });
    await sql`set search_path to ${sql.id(schemaName)}, public`.execute(
      concurrentDatabase,
    );
    const concurrentDatabaseService = {
      client: concurrentDatabase,
    } as DatabaseService;
    concurrentRepository = new WorkforceSchedulingRepository(
      concurrentDatabaseService,
      new AuthorizationService(
        new AuthorizationRepository(concurrentDatabaseService, provider),
      ),
      provider,
    );
    concurrentPatientAppointments = new PatientAppointmentsService(
      concurrentDatabaseService,
    );
  });

  afterAll(async () => {
    if (concurrentDatabase) await concurrentDatabase.destroy();
    if (database) await database.destroy();
    if (adminDatabase) {
      await sql`drop schema if exists ${sql.id(schemaName)} cascade`.execute(
        adminDatabase,
      );
      await adminDatabase.destroy();
    }
  });

  it('requires exact facility membership, records a generic denial, and publishes only after activation', async () => {
    const chain = await insertProviderChain(database, scopeA, 'authority');
    const input = templateInput(chain, { status: 'inactive' });
    await expect(
      repository.createAvailabilityTemplate({
        principal: principal(fixture.users.schedulerWithoutFacility.subject),
        idempotencyKey: 'availability-authority-denied',
        input,
      }),
    ).rejects.toBeInstanceOf(WorkforceSchedulingAuthorizationLostError);

    const denial = await database
      .selectFrom('audit_events')
      .select([
        'actor_user_id',
        'organization_id',
        'facility_id',
        'action',
        'target_entity_type',
        'target_entity_id',
        'outcome',
      ])
      .where('action', '=', 'scheduling.availability_template_created')
      .where('outcome', '=', 'denied')
      .where(
        'actor_user_id',
        '=',
        fixture.users.schedulerWithoutFacility.applicationUserId,
      )
      .executeTakeFirstOrThrow();
    expect(denial).toEqual({
      actor_user_id: fixture.users.schedulerWithoutFacility.applicationUserId,
      organization_id: fixture.practiceAId,
      facility_id: fixture.facilityAId,
      action: 'scheduling.availability_template_created',
      target_entity_type: 'practitioner_service_assignment',
      target_entity_id: chain.practitionerServiceAssignmentId,
      outcome: 'denied',
    });

    const created = await repository.createAvailabilityTemplate({
      principal: chain.principal,
      idempotencyKey: 'availability-authority-create-inactive',
      input,
    });
    expect(created.template.status).toBe('inactive');
    expect(created.materialization.createdSlotCount).toBe(0);
    expect(
      await templateSlots(database, created.template.availabilityTemplateId),
    ).toEqual([]);

    const published = await repository.changeAvailabilityTemplateStatus(
      {
        principal: chain.principal,
        idempotencyKey: 'availability-authority-publish',
        input: {
          organizationId: chain.organizationId,
          status: 'active',
          expectedUpdatedAt: created.template.updatedAt,
          reasonCode: 'availability-configuration',
        },
      },
      created.template.availabilityTemplateId,
    );
    expect(published.template.status).toBe('active');
    expect(published.materialization.createdSlotCount).toBeGreaterThan(0);
    expect(
      await templateSlots(database, created.template.availabilityTemplateId),
    ).not.toHaveLength(0);
  });

  it('rolls back incomplete-chain publication and audit persistence failures atomically', async () => {
    const chain = await insertProviderChain(database, scopeA, 'rollback');
    const created = await repository.createAvailabilityTemplate({
      principal: chain.principal,
      idempotencyKey: 'availability-chain-create',
      input: templateInput(chain, { status: 'inactive' }),
    });
    await database
      .updateTable('practitioner_service_assignments')
      .set({ status: 'inactive' })
      .where('id', '=', chain.practitionerServiceAssignmentId)
      .execute();

    const incompleteKey = 'availability-chain-publish-incomplete';
    await expect(
      repository.changeAvailabilityTemplateStatus(
        {
          principal: chain.principal,
          idempotencyKey: incompleteKey,
          input: {
            organizationId: chain.organizationId,
            status: 'active',
            expectedUpdatedAt: created.template.updatedAt,
            reasonCode: 'availability-configuration',
          },
        },
        created.template.availabilityTemplateId,
      ),
    ).rejects.toBeInstanceOf(WorkforceSchedulingConflictError);
    expect(
      await database
        .selectFrom('practitioner_availability_templates')
        .select('status')
        .where('id', '=', created.template.availabilityTemplateId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: 'inactive' });
    expect(
      await database
        .selectFrom('workforce_scheduling_commands')
        .select('id')
        .where('idempotency_key_hash', '=', sha256(incompleteKey))
        .execute(),
    ).toHaveLength(0);
    expect(
      await database
        .selectFrom('audit_events')
        .select('id')
        .where('action', '=', 'scheduling.availability_template_status_changed')
        .where('target_entity_id', '=', created.template.availabilityTemplateId)
        .where('outcome', '=', 'success')
        .execute(),
    ).toHaveLength(0);

    await database
      .updateTable('practitioner_service_assignments')
      .set({ status: 'active' })
      .where('id', '=', chain.practitionerServiceAssignmentId)
      .execute();
    await sql`
      create function reject_availability_status_audit()
      returns trigger
      language plpgsql
      as $function$
      begin
        if new.action = 'scheduling.availability_template_status_changed'
           and new.outcome = 'success' then
          raise exception 'Synthetic availability audit failure.';
        end if;
        return new;
      end;
      $function$
    `.execute(database);
    await sql`
      create trigger reject_availability_status_audit
      before insert on audit_events
      for each row execute function reject_availability_status_audit()
    `.execute(database);
    const auditFailureKey = 'availability-status-audit-failure';
    try {
      await expect(
        repository.changeAvailabilityTemplateStatus(
          {
            principal: chain.principal,
            idempotencyKey: auditFailureKey,
            input: {
              organizationId: chain.organizationId,
              status: 'active',
              expectedUpdatedAt: created.template.updatedAt,
              reasonCode: 'availability-configuration',
            },
          },
          created.template.availabilityTemplateId,
        ),
      ).rejects.toBeInstanceOf(WorkforceSchedulingPersistenceError);
    } finally {
      await sql`
        drop trigger if exists reject_availability_status_audit on audit_events
      `.execute(database);
      await sql`drop function if exists reject_availability_status_audit()`.execute(
        database,
      );
    }
    expect(
      await database
        .selectFrom('practitioner_availability_templates')
        .select('status')
        .where('id', '=', created.template.availabilityTemplateId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: 'inactive' });
    expect(
      await templateSlots(database, created.template.availabilityTemplateId),
    ).toEqual([]);
    expect(
      await database
        .selectFrom('workforce_scheduling_commands')
        .select('id')
        .where('idempotency_key_hash', '=', sha256(auditFailureKey))
        .execute(),
    ).toHaveLength(0);
    expect(
      await database
        .selectFrom('audit_events')
        .select('id')
        .where('action', '=', 'scheduling.availability_template_status_changed')
        .where('target_entity_id', '=', created.template.availabilityTemplateId)
        .where('outcome', '=', 'success')
        .execute(),
    ).toHaveLength(0);
  });

  it('persists one result for equivalent concurrent replay and rejects a changed payload', async () => {
    const chain = await insertProviderChain(database, scopeA, 'idempotency');
    const idempotencyKey = 'availability-equivalent-concurrent-create';
    const request = {
      principal: chain.principal,
      idempotencyKey,
      input: templateInput(chain, { status: 'inactive' }),
    };
    const [first, second] = await Promise.all([
      repository.createAvailabilityTemplate(request),
      concurrentRepository.createAvailabilityTemplate(request),
    ]);
    expect(second).toEqual(first);
    expect(
      await database
        .selectFrom('practitioner_availability_templates')
        .select('id')
        .where(
          'practitioner_service_assignment_id',
          '=',
          chain.practitionerServiceAssignmentId,
        )
        .execute(),
    ).toHaveLength(1);
    expect(
      await database
        .selectFrom('workforce_scheduling_commands')
        .select('id')
        .where('operation', '=', 'availability_template_create')
        .where('idempotency_key_hash', '=', sha256(idempotencyKey))
        .execute(),
    ).toHaveLength(1);
    expect(
      await database
        .selectFrom('audit_events')
        .select('id')
        .where('action', '=', 'scheduling.availability_template_created')
        .where('target_entity_id', '=', first.template.availabilityTemplateId)
        .where('outcome', '=', 'success')
        .execute(),
    ).toHaveLength(1);

    await expect(
      repository.createAvailabilityTemplate({
        ...request,
        input: { ...request.input, localEndMinute: 690 },
      }),
    ).rejects.toBeInstanceOf(WorkforceSchedulingConflictError);

    const actorAssignment = await database
      .selectFrom('role_assignments')
      .select('id')
      .where('membership_id', '=', fixture.users.schedulerA.membershipId)
      .where('scope_organization_id', '=', fixture.practiceAId)
      .executeTakeFirstOrThrow();
    await database
      .updateTable('role_assignments')
      .set({
        revoked_at: new Date(),
        revocation_reason: 'Synthetic availability replay authorization test.',
      })
      .where('id', '=', actorAssignment.id)
      .execute();
    try {
      await expect(
        repository.createAvailabilityTemplate(request),
      ).rejects.toBeInstanceOf(WorkforceSchedulingAuthorizationLostError);
    } finally {
      await database
        .updateTable('role_assignments')
        .set({
          revoked_at: null,
          revoked_by_user_id: null,
          revocation_reason: null,
        })
        .where('id', '=', actorAssignment.id)
        .execute();
    }
    expect(
      await database
        .selectFrom('workforce_scheduling_commands')
        .select('id')
        .where('operation', '=', 'availability_template_create')
        .where('idempotency_key_hash', '=', sha256(idempotencyKey))
        .execute(),
    ).toHaveLength(1);
  });

  it('applies exception unions, terminal cancellation, duration regeneration, and deferred live-slot withdrawal', async () => {
    const chain = await insertProviderChain(database, scopeA, 'lifecycle');
    const created = await repository.createAvailabilityTemplate({
      principal: chain.principal,
      idempotencyKey: 'availability-lifecycle-publish',
      input: templateInput(chain),
    });
    const templateId = created.template.availabilityTemplateId;
    const initialSlots = await templateSlots(database, templateId);
    const localDate = initialSlots[0]?.source_local_date;
    if (!localDate) throw new Error('Expected a generated local slot date.');
    const daySlots = initialSlots.filter(
      (slot) => slot.source_local_date === localDate,
    );
    expect(daySlots).toHaveLength(4);

    const patient = await insertPatient(database, scopeA, 'lifecycle');
    const appointment = await patientAppointments.createAppointment(
      patient.session,
      'availability-lifecycle-booking',
      daySlots[0].id,
    );
    const firstException = await repository.createAvailabilityException({
      principal: chain.principal,
      idempotencyKey: 'availability-lifecycle-exception-one',
      input: {
        organizationId: chain.organizationId,
        facilityId: chain.facilityId,
        practitionerFacilityAssignmentId:
          chain.practitionerFacilityAssignmentId,
        kind: 'practitioner_unavailable',
        isAllDay: false,
        localStartsAt: canonicalLocalTimestamp(localDate, 540),
        localEndsAt: canonicalLocalTimestamp(localDate, 630),
        reasonCode: 'provider-availability-change',
      },
    });
    const secondException = await repository.createAvailabilityException({
      principal: chain.principal,
      idempotencyKey: 'availability-lifecycle-exception-two',
      input: {
        organizationId: chain.organizationId,
        facilityId: chain.facilityId,
        practitionerFacilityAssignmentId:
          chain.practitionerFacilityAssignmentId,
        kind: 'practitioner_unavailable',
        isAllDay: false,
        localStartsAt: canonicalLocalTimestamp(localDate, 570),
        localEndsAt: canonicalLocalTimestamp(localDate, 660),
        reasonCode: 'provider-availability-change',
      },
    });
    expect(firstException.materialization.affectedAppointmentIds).toEqual([
      appointment.appointment.appointmentId,
    ]);
    const afterUnion = await templateSlots(database, templateId);
    const unionDaySlots = afterUnion.filter(
      (slot) => slot.source_local_date === localDate,
    );
    expect(unionDaySlots[0]).toMatchObject({
      status: 'available',
      withdrawal_pending: true,
    });
    expect(
      unionDaySlots
        .slice(1)
        .every(
          (slot) => slot.status === 'withdrawn' && !slot.withdrawal_pending,
        ),
    ).toBe(true);

    const firstCancellation = await repository.cancelAvailabilityException(
      {
        principal: chain.principal,
        idempotencyKey: 'availability-lifecycle-cancel-one',
        input: {
          organizationId: chain.organizationId,
          status: 'cancelled',
          expectedUpdatedAt: firstException.exception.updatedAt,
          reasonCode: 'provider-availability-change',
        },
      },
      firstException.exception.availabilityExceptionId,
    );
    await expect(
      repository.cancelAvailabilityException(
        {
          principal: chain.principal,
          idempotencyKey: 'availability-lifecycle-recancel-one',
          input: {
            organizationId: chain.organizationId,
            status: 'cancelled',
            expectedUpdatedAt: firstCancellation.exception.updatedAt,
            reasonCode: 'provider-availability-change',
          },
        },
        firstException.exception.availabilityExceptionId,
      ),
    ).rejects.toBeInstanceOf(WorkforceSchedulingConflictError);
    const afterFirstCancellation = await templateSlots(database, templateId);
    expect(
      afterFirstCancellation.find(({ id }) => id === daySlots[0].id),
    ).toMatchObject({ status: 'available', withdrawal_pending: false });
    expect(
      afterFirstCancellation.find(({ id }) => id === daySlots[1].id),
    ).toMatchObject({ status: 'withdrawn', withdrawal_pending: false });

    await repository.cancelAvailabilityException(
      {
        principal: chain.principal,
        idempotencyKey: 'availability-lifecycle-cancel-two',
        input: {
          organizationId: chain.organizationId,
          status: 'cancelled',
          expectedUpdatedAt: secondException.exception.updatedAt,
          reasonCode: 'provider-availability-change',
        },
      },
      secondException.exception.availabilityExceptionId,
    );
    const afterUnionCancelled = await templateSlots(database, templateId);
    expect(
      afterUnionCancelled
        .filter((slot) => slot.source_local_date === localDate)
        .every((slot) => slot.status === 'available'),
    ).toBe(true);

    const changedDuration = await repository.changeServiceDuration(
      {
        principal: chain.principal,
        idempotencyKey: 'availability-lifecycle-duration-change',
        input: {
          organizationId: chain.organizationId,
          durationMinutes: 20,
          expectedUpdatedAt: await currentServiceTimestamp(
            database,
            chain.appointmentServiceId,
          ),
          reasonCode: 'service-duration-change',
        },
      },
      chain.appointmentServiceId,
    );
    expect(changedDuration.service.durationMinutes).toBe(20);
    expect(changedDuration.materialization.affectedAppointmentIds).toEqual([
      appointment.appointment.appointmentId,
    ]);
    expect(
      await database
        .selectFrom('patient_portal_appointment_slots')
        .select(['status', 'withdrawal_pending'])
        .where('id', '=', daySlots[0].id)
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: 'available', withdrawal_pending: true });
    const replacedThirtyMinuteSlots = await database
      .selectFrom('patient_portal_appointment_slots')
      .select(['id', 'status', 'withdrawal_pending'])
      .where(
        'id',
        'in',
        daySlots.slice(1).map(({ id }) => id),
      )
      .execute();
    expect(
      replacedThirtyMinuteSlots.every(
        (slot) => slot.status === 'withdrawn' && !slot.withdrawal_pending,
      ),
    ).toBe(true);
    expect(
      (await templateSlots(database, templateId)).some(
        (slot) =>
          slot.ends_at.getTime() - slot.starts_at.getTime() === 20 * 60_000,
      ),
    ).toBe(true);

    await patientAppointments.cancelAppointment(
      patient.session,
      'availability-lifecycle-release-pending-slot',
      appointment.appointment.appointmentId,
      appointment.appointment.version,
    );
    expect(
      await database
        .selectFrom('patient_portal_appointment_slots')
        .select(['status', 'withdrawal_pending'])
        .where('id', '=', daySlots[0].id)
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: 'withdrawn', withdrawal_pending: false });
  });

  it('allows only the legal booking-versus-exception outcomes', async () => {
    const chain = await insertProviderChain(database, scopeA, 'race-exception');
    const created = await repository.createAvailabilityTemplate({
      principal: chain.principal,
      idempotencyKey: 'availability-race-exception-publish',
      input: templateInput(chain, { localEndMinute: 600 }),
    });
    const slot = (
      await templateSlots(database, created.template.availabilityTemplateId)
    )[0];
    if (!slot.source_local_date) throw new Error('Expected a local slot date.');
    const patient = await insertPatient(database, scopeA, 'race-exception');

    const [bookingResult, exceptionResult] = await Promise.allSettled([
      concurrentPatientAppointments.createAppointment(
        patient.session,
        'availability-race-exception-booking',
        slot.id,
      ),
      repository.createAvailabilityException({
        principal: chain.principal,
        idempotencyKey: 'availability-race-exception-command',
        input: {
          organizationId: chain.organizationId,
          facilityId: chain.facilityId,
          practitionerFacilityAssignmentId:
            chain.practitionerFacilityAssignmentId,
          kind: 'practitioner_unavailable',
          isAllDay: false,
          localStartsAt: canonicalLocalTimestamp(slot.source_local_date, 540),
          localEndsAt: canonicalLocalTimestamp(slot.source_local_date, 570),
          reasonCode: 'provider-availability-change',
        },
      }),
    ]);
    expect(exceptionResult.status).toBe('fulfilled');
    const storedSlot = await database
      .selectFrom('patient_portal_appointment_slots')
      .select(['status', 'withdrawal_pending'])
      .where('id', '=', slot.id)
      .executeTakeFirstOrThrow();
    const liveAppointments = await database
      .selectFrom('patient_portal_appointments')
      .select('id')
      .where('appointment_slot_id', '=', slot.id)
      .where('status', '=', 'requested')
      .execute();
    if (bookingResult.status === 'fulfilled') {
      expect(storedSlot).toEqual({
        status: 'available',
        withdrawal_pending: true,
      });
      expect(liveAppointments).toHaveLength(1);
    } else {
      expect(bookingResult.reason).toBeInstanceOf(ConflictException);
      expect(storedSlot).toEqual({
        status: 'withdrawn',
        withdrawal_pending: false,
      });
      expect(liveAppointments).toHaveLength(0);
    }
  });

  it('allows only the legal booking-versus-duration outcomes', async () => {
    const chain = await insertProviderChain(database, scopeA, 'race-duration');
    const created = await repository.createAvailabilityTemplate({
      principal: chain.principal,
      idempotencyKey: 'availability-race-duration-publish',
      input: templateInput(chain, {
        localStartMinute: 690,
        localEndMinute: 750,
      }),
    });
    const slot = (
      await templateSlots(database, created.template.availabilityTemplateId)
    )[0];
    const patient = await insertPatient(database, scopeA, 'race-duration');
    const expectedUpdatedAt = await currentServiceTimestamp(
      database,
      chain.appointmentServiceId,
    );

    const [bookingResult, durationResult] = await Promise.allSettled([
      concurrentPatientAppointments.createAppointment(
        patient.session,
        'availability-race-duration-booking',
        slot.id,
      ),
      repository.changeServiceDuration(
        {
          principal: chain.principal,
          idempotencyKey: 'availability-race-duration-command',
          input: {
            organizationId: chain.organizationId,
            durationMinutes: 20,
            expectedUpdatedAt,
            reasonCode: 'service-duration-change',
          },
        },
        chain.appointmentServiceId,
      ),
    ]);
    expect(durationResult.status).toBe('fulfilled');
    const storedSlot = await database
      .selectFrom('patient_portal_appointment_slots')
      .select(['status', 'withdrawal_pending'])
      .where('id', '=', slot.id)
      .executeTakeFirstOrThrow();
    if (bookingResult.status === 'fulfilled') {
      expect(storedSlot).toEqual({
        status: 'available',
        withdrawal_pending: true,
      });
      if (durationResult.status === 'fulfilled') {
        expect(
          durationResult.value.materialization.affectedAppointmentIds,
        ).toEqual([bookingResult.value.appointment.appointmentId]);
      }
    } else {
      expect(bookingResult.reason).toBeInstanceOf(ConflictException);
      expect(storedSlot).toEqual({
        status: 'withdrawn',
        withdrawal_pending: false,
      });
    }
  });

  it('serializes shared doctors by tenant and practitioner without leaking a sibling appointment id', async () => {
    const chainA = await insertProviderChain(database, scopeA, 'shared-a');
    const chainB = await insertProviderChain(
      database,
      scopeB,
      'shared-b',
      chainA.practitionerId,
    );
    const inputA = templateInput(chainA, {
      localStartMinute: 780,
      localEndMinute: 840,
      status: 'inactive',
    });
    const inputB = templateInput(chainB, {
      localStartMinute: 840,
      localEndMinute: 900,
      status: 'inactive',
    });
    const [createdA, createdB] = await Promise.all([
      repository.createAvailabilityTemplate({
        principal: chainA.principal,
        idempotencyKey: 'availability-shared-create-a',
        input: inputA,
      }),
      repository.createAvailabilityTemplate({
        principal: chainB.principal,
        idempotencyKey: 'availability-shared-create-b',
        input: inputB,
      }),
    ]);

    const [publishA, publishB] = await Promise.allSettled([
      repository.changeAvailabilityTemplateStatus(
        {
          principal: chainA.principal,
          idempotencyKey: 'availability-shared-publish-a',
          input: {
            organizationId: chainA.organizationId,
            status: 'active',
            expectedUpdatedAt: createdA.template.updatedAt,
            reasonCode: 'availability-configuration',
          },
        },
        createdA.template.availabilityTemplateId,
      ),
      concurrentRepository.changeAvailabilityTemplateStatus(
        {
          principal: chainB.principal,
          idempotencyKey: 'availability-shared-publish-b',
          input: {
            organizationId: chainB.organizationId,
            status: 'active',
            expectedUpdatedAt: createdB.template.updatedAt,
            reasonCode: 'availability-configuration',
          },
        },
        createdB.template.availabilityTemplateId,
      ),
    ]);
    expect([publishA.status, publishB.status].sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    if (publishA.status === 'rejected') {
      expect(publishA.reason).toBeInstanceOf(WorkforceSchedulingConflictError);
    } else if (publishB.status === 'rejected') {
      expect(publishB.reason).toBeInstanceOf(WorkforceSchedulingConflictError);
    }
    const winner =
      publishA.status === 'fulfilled'
        ? { scope: chainA, response: publishA.value }
        : publishB.status === 'fulfilled'
          ? { scope: chainB, response: publishB.value }
          : null;
    const loser =
      publishA.status === 'rejected'
        ? { scope: chainA, template: createdA.template }
        : publishB.status === 'rejected'
          ? { scope: chainB, template: createdB.template }
          : null;
    if (!winner || !loser) {
      throw new Error('Expected one serialized shared-practitioner winner.');
    }
    expect(winner.response.materialization.skippedOverlapCount).toBe(0);
    const winnerSlot = (
      await templateSlots(
        database,
        winner.response.template.availabilityTemplateId,
      )
    )[0];
    const siblingPatient = await insertPatient(
      database,
      winner.scope,
      'shared-winner',
    );
    const siblingAppointment = await patientAppointments.createAppointment(
      siblingPatient.session,
      'availability-shared-winner-booking',
      winnerSlot.id,
    );
    const winnerWithdrawn = await repository.changeAvailabilityTemplateStatus(
      {
        principal: winner.scope.principal,
        idempotencyKey: 'availability-shared-winner-withdraw',
        input: {
          organizationId: winner.scope.organizationId,
          status: 'inactive',
          expectedUpdatedAt: winner.response.template.updatedAt,
          reasonCode: 'availability-configuration',
        },
      },
      winner.response.template.availabilityTemplateId,
    );
    expect(winnerWithdrawn.materialization.affectedAppointmentIds).toEqual([
      siblingAppointment.appointment.appointmentId,
    ]);
    expect(
      await database
        .selectFrom('patient_portal_appointment_slots')
        .select(['status', 'withdrawal_pending'])
        .where('id', '=', winnerSlot.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: 'available', withdrawal_pending: true });

    const loserPublished = await repository.changeAvailabilityTemplateStatus(
      {
        principal: loser.scope.principal,
        idempotencyKey: 'availability-shared-loser-retry',
        input: {
          organizationId: loser.scope.organizationId,
          status: 'active',
          expectedUpdatedAt: loser.template.updatedAt,
          reasonCode: 'availability-configuration',
        },
      },
      loser.template.availabilityTemplateId,
    );
    expect(loserPublished.template.status).toBe('active');
    expect(loserPublished.materialization.skippedOverlapCount).toBeGreaterThan(
      0,
    );
    expect(loserPublished.materialization.affectedAppointmentIds).toEqual([]);
    expect(JSON.stringify(loserPublished)).not.toContain(
      siblingAppointment.appointment.appointmentId,
    );

    const storedSlots = await database
      .selectFrom('patient_portal_appointment_slots')
      .select(['starts_at', 'ends_at'])
      .where('tenant_id', '=', fixture.tenantId)
      .where('practitioner_id', '=', chainA.practitionerId)
      .where('status', '=', 'available')
      .orderBy('starts_at', 'asc')
      .execute();
    for (let index = 1; index < storedSlots.length; index += 1) {
      expect(
        storedSlots[index - 1].ends_at <= storedSlots[index].starts_at,
      ).toBe(true);
    }

    const activeTemplates = await database
      .selectFrom('practitioner_availability_templates')
      .select(['id', 'status'])
      .where('practitioner_id', '=', chainA.practitionerId)
      .execute();
    expect(activeTemplates.map(({ status }) => status).sort()).toEqual([
      'active',
      'inactive',
    ]);
  });
});
