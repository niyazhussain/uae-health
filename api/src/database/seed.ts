import type { Kysely } from 'kysely';
import { createDatabaseClient } from './create-database-client.js';
import type { DatabaseSchema } from './database.types.js';
import { loadScriptEnvironment } from './load-script-environment.js';
import {
  assertSyntheticAppointmentSlotMatch,
  assertSyntheticAvailabilityTemplateMatch,
  assertSyntheticSchedulingFacilityScope,
  buildSyntheticAppointmentFixtures,
  buildSyntheticFacilityCode,
  buildSyntheticProviderFixtureId,
  inferSyntheticAppointmentDurationMinutes,
  type SyntheticAppointmentFixtures,
  type SyntheticAppointmentSlotSeed,
  type SyntheticAvailabilityTemplateSeed,
} from './synthetic-appointment-slots.js';

async function seed(): Promise<void> {
  loadScriptEnvironment();

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Synthetic seed data is prohibited in production.');
  }

  if (process.env.ALLOW_SYNTHETIC_SEED !== 'true') {
    throw new Error('Set ALLOW_SYNTHETIC_SEED=true to seed local fake data.');
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to seed data.');
  }

  const client = createDatabaseClient<DatabaseSchema>({
    connectionString: databaseUrl,
    maxConnections: 1,
    ssl: process.env.DATABASE_SSL === 'true',
  });
  const cognitoRegion = process.env.COGNITO_REGION ?? 'ap-south-1';
  const cognitoPoolId = process.env.COGNITO_USER_POOL_ID;
  const cognitoIssuer = cognitoPoolId
    ? `https://cognito-idp.${cognitoRegion}.amazonaws.com/${cognitoPoolId}`
    : 'https://cognito-idp.ap-south-1.amazonaws.com/synthetic';
  const syntheticAdminSubject =
    process.env.SYNTHETIC_ADMIN_COGNITO_SUBJECT?.trim() ||
    'synthetic-practice-admin';

  try {
    await client.transaction().execute(async (database) => {
      const tenant = await database
        .insertInto('tenants')
        .values({
          id: '10000000-0000-4000-8000-000000000001',
          code: 'DEMO-UAE',
          name: 'Synthetic Practice Group',
          status: 'active',
          is_synthetic: true,
        })
        .onConflict((conflict) =>
          conflict.column('code').doUpdateSet({
            name: 'Synthetic Practice Group',
            status: 'active',
            is_synthetic: true,
            updated_at: new Date(),
          }),
        )
        .returning(['id', 'code'])
        .executeTakeFirstOrThrow();

      const organization = await database
        .insertInto('organizations')
        .values({
          id: '20000000-0000-4000-8000-000000000001',
          tenant_id: tenant.id,
          parent_organization_id: null,
          kind: 'practice',
          code: 'DEMO-PRACTICE',
          name: 'Synthetic Care Practice',
          is_synthetic: true,
        })
        .onConflict((conflict) =>
          conflict.columns(['tenant_id', 'code']).doUpdateSet({
            name: 'Synthetic Care Practice',
            is_synthetic: true,
            updated_at: new Date(),
          }),
        )
        .returning(['id', 'code'])
        .executeTakeFirstOrThrow();

      const appointmentPractice = await database
        .insertInto('organizations')
        .values({
          id: '20000000-0000-4000-8000-000000000002',
          tenant_id: tenant.id,
          parent_organization_id: null,
          kind: 'practice',
          code: 'DEMO-APPOINTMENTS',
          name: 'Synthetic Appointments Practice',
          is_synthetic: true,
        })
        .onConflict((conflict) =>
          conflict.columns(['tenant_id', 'code']).doUpdateSet({
            name: 'Synthetic Appointments Practice',
            is_synthetic: true,
            updated_at: new Date(),
          }),
        )
        .returning(['id', 'code'])
        .executeTakeFirstOrThrow();

      const primaryBookablePracticeId = 'a0000000-0000-4000-8000-000000000001';
      const appointmentBookablePracticeId =
        'a0000000-0000-4000-8000-000000000002';
      const primaryBookablePractice = await ensureSyntheticBookablePractice(
        database,
        {
          id: primaryBookablePracticeId,
          tenantId: tenant.id,
          organizationId: organization.id,
          defaultTimezone: 'Asia/Dubai',
        },
      );
      const appointmentBookablePractice = await ensureSyntheticBookablePractice(
        database,
        {
          id: appointmentBookablePracticeId,
          tenantId: tenant.id,
          organizationId: appointmentPractice.id,
          defaultTimezone: 'Asia/Dubai',
        },
      );

      const facility = await ensureSyntheticFacilityByCode(database, {
        tenantId: tenant.id,
        organizationId: organization.id,
        code: 'DEMO-DXB',
        name: 'Synthetic Care Centre',
        defaultTimezone: primaryBookablePractice.timezone,
      });

      const user = await database
        .insertInto('application_users')
        .values({
          id: '30000000-0000-4000-8000-000000000001',
          display_name: 'Synthetic Practice Administrator',
          primary_email: 'practice.admin@example.invalid',
          status: 'active',
          is_synthetic: true,
        })
        .onConflict((conflict) =>
          conflict.column('id').doUpdateSet({
            display_name: 'Synthetic Practice Administrator',
            primary_email: 'practice.admin@example.invalid',
            status: 'active',
            is_synthetic: true,
            updated_at: new Date(),
          }),
        )
        .returning(['id'])
        .executeTakeFirstOrThrow();

      const identityConnection = await database
        .insertInto('identity_connections')
        .values({
          id: '40000000-0000-4000-8000-000000000001',
          tenant_id: tenant.id,
          code: 'synthetic-cognito',
          name: 'Synthetic Cognito Connection',
          protocol: 'cognito',
          issuer: cognitoIssuer,
          status: 'active',
          jit_provisioning_enabled: false,
        })
        .onConflict((conflict) =>
          conflict.columns(['tenant_id', 'code']).doUpdateSet({
            name: 'Synthetic Cognito Connection',
            issuer: cognitoIssuer,
            status: 'active',
            jit_provisioning_enabled: false,
            updated_at: new Date(),
          }),
        )
        .returning(['id'])
        .executeTakeFirstOrThrow();

      await database
        .insertInto('user_identities')
        .values({
          id: '50000000-0000-4000-8000-000000000001',
          application_user_id: user.id,
          identity_connection_id: identityConnection.id,
          subject: syntheticAdminSubject,
          status: 'active',
          last_authenticated_at: null,
        })
        .onConflict((conflict) =>
          conflict.column('id').doUpdateSet({
            application_user_id: user.id,
            identity_connection_id: identityConnection.id,
            subject: syntheticAdminSubject,
            status: 'active',
            updated_at: new Date(),
          }),
        )
        .execute();

      const membership = await database
        .insertInto('organization_memberships')
        .values({
          id: '60000000-0000-4000-8000-000000000001',
          tenant_id: tenant.id,
          organization_id: organization.id,
          application_user_id: user.id,
          status: 'active',
          provisioning_method: 'admin_invite',
          external_id: null,
          valid_until: null,
        })
        .onConflict((conflict) =>
          conflict
            .columns(['application_user_id', 'organization_id'])
            .doUpdateSet({
              status: 'active',
              provisioning_method: 'admin_invite',
              valid_until: null,
              updated_at: new Date(),
            }),
        )
        .returning(['id'])
        .executeTakeFirstOrThrow();

      await database
        .insertInto('membership_facilities')
        .values({
          tenant_id: tenant.id,
          membership_id: membership.id,
          facility_id: facility.id,
        })
        .onConflict((conflict) =>
          conflict.columns(['membership_id', 'facility_id']).doNothing(),
        )
        .execute();

      const practiceAdminRole = await database
        .selectFrom('roles')
        .select('id')
        .where('tenant_id', 'is', null)
        .where('code', '=', 'PRACTICE_ADMIN')
        .executeTakeFirstOrThrow();

      await database
        .insertInto('role_assignments')
        .values({
          id: '70000000-0000-4000-8000-000000000001',
          tenant_id: tenant.id,
          membership_id: membership.id,
          role_id: practiceAdminRole.id,
          scope_organization_id: organization.id,
          facility_id: null,
          include_descendants: false,
          assignment_source: 'system_bootstrap',
          assigned_by_user_id: null,
          source_role_request_id: null,
          valid_until: null,
          revoked_at: null,
          revoked_by_user_id: null,
          revocation_reason: null,
        })
        .onConflict((conflict) => conflict.column('id').doNothing())
        .execute();

      const providerFixtureScopes = [
        {
          bookablePractice: primaryBookablePractice,
          offsetHours: [0, 1] as const,
        },
        {
          bookablePractice: appointmentBookablePractice,
          offsetHours: [2, 3] as const,
        },
      ].map(({ bookablePractice, offsetHours }) => ({
        bookablePracticeId: bookablePractice.id,
        organizationId: bookablePractice.organizationId,
        bookableTimezone: bookablePractice.timezone,
        offsetHours,
        practitionerId: buildSyntheticProviderFixtureId(
          'practitioner',
          bookablePractice.id,
        ),
        specialtyId: buildSyntheticProviderFixtureId(
          'specialty',
          bookablePractice.id,
        ),
        practitionerFacilityAssignmentId: buildSyntheticProviderFixtureId(
          'practitioner-facility-assignment',
          bookablePractice.id,
        ),
        appointmentServiceId: buildSyntheticProviderFixtureId(
          'appointment-service',
          bookablePractice.id,
        ),
        practitionerServiceAssignmentId: buildSyntheticProviderFixtureId(
          'practitioner-service-assignment',
          bookablePractice.id,
        ),
      }));

      const providerFixtures: Array<
        (typeof providerFixtureScopes)[number] & {
          facilityId: string;
          sourceTimezone: string;
          durationMinutes: number;
        }
      > = [];
      for (const practice of providerFixtureScopes) {
        const persistedFixture = await resolvePersistedProviderFixture(
          database,
          tenant.id,
          practice,
        );
        if (persistedFixture) {
          providerFixtures.push({ ...practice, ...persistedFixture });
        } else {
          const schedulingFacility = await resolveSyntheticSchedulingFacility(
            database,
            {
              bookablePracticeId: practice.bookablePracticeId,
              tenantId: tenant.id,
              organizationId: practice.organizationId,
              timezone: practice.bookableTimezone,
            },
          );
          const legacySlots = await database
            .selectFrom('patient_portal_appointment_slots')
            .select(['starts_at', 'ends_at', 'is_synthetic'])
            .where('bookable_practice_id', '=', practice.bookablePracticeId)
            .where('practitioner_service_assignment_id', 'is', null)
            .execute();
          if (legacySlots.some((slot) => !slot.is_synthetic)) {
            throw new Error(
              'Synthetic appointment duration cannot be inferred from non-synthetic slots.',
            );
          }
          const durationMinutes = inferSyntheticAppointmentDurationMinutes(
            legacySlots.map((slot) => ({
              startsAt: slot.starts_at,
              endsAt: slot.ends_at,
            })),
          );
          providerFixtures.push({
            ...practice,
            facilityId: schedulingFacility.id,
            sourceTimezone: schedulingFacility.timezone,
            durationMinutes,
          });
        }
      }

      const appointmentFixtures = buildSyntheticAppointmentFixtures({
        now: new Date(),
        tenantId: tenant.id,
        templates: providerFixtures.flatMap((practice) =>
          practice.offsetHours.map((offsetHours) => ({
            bookablePracticeId: practice.bookablePracticeId,
            organizationId: practice.organizationId,
            facilityId: practice.facilityId,
            practitionerFacilityAssignmentId:
              practice.practitionerFacilityAssignmentId,
            practitionerServiceAssignmentId:
              practice.practitionerServiceAssignmentId,
            practitionerId: practice.practitionerId,
            appointmentServiceId: practice.appointmentServiceId,
            sourceTimezone: practice.sourceTimezone,
            durationMinutes: practice.durationMinutes,
            offsetHours,
          })),
        ),
      });

      // Validate every deterministic identity and generation-key collision before
      // any provider scheduling row can be inserted. The transaction rolls back
      // the surrounding base seed as well if any existing row is not an exact
      // synthetic fixture match.
      await preflightProviderFixtures(database, tenant.id, providerFixtures);
      await preflightAvailabilityFixtures(database, appointmentFixtures);

      await database
        .insertInto('practitioners')
        .values(
          providerFixtures.map((practice) => ({
            id: practice.practitionerId,
            tenant_id: tenant.id,
            application_user_id: null,
            display_name: 'Synthetic Physician',
            professional_title: 'General physician',
            status: 'active' as const,
            is_synthetic: true,
          })),
        )
        .onConflict((conflict) => conflict.column('id').doNothing())
        .execute();

      await database
        .insertInto('specialties')
        .values(
          providerFixtures.map((practice) => ({
            id: practice.specialtyId,
            tenant_id: tenant.id,
            organization_id: practice.organizationId,
            organization_kind: 'practice' as const,
            code: 'GENERAL-MEDICINE',
            name: 'General medicine',
            status: 'active' as const,
            is_synthetic: true,
          })),
        )
        .onConflict((conflict) => conflict.column('id').doNothing())
        .execute();

      await database
        .insertInto('practitioner_facility_assignments')
        .values(
          providerFixtures.map((practice) => ({
            id: practice.practitionerFacilityAssignmentId,
            tenant_id: tenant.id,
            organization_id: practice.organizationId,
            organization_kind: 'practice' as const,
            facility_id: practice.facilityId,
            practitioner_id: practice.practitionerId,
            status: 'active' as const,
            is_synthetic: true,
          })),
        )
        .onConflict((conflict) => conflict.column('id').doNothing())
        .execute();

      await database
        .insertInto('appointment_services')
        .values(
          providerFixtures.map((practice) => ({
            id: practice.appointmentServiceId,
            tenant_id: tenant.id,
            organization_id: practice.organizationId,
            organization_kind: 'practice' as const,
            facility_id: practice.facilityId,
            specialty_id: practice.specialtyId,
            code: 'GENERAL-CONSULTATION',
            patient_facing_name: 'General consultation',
            duration_minutes: practice.durationMinutes,
            allows_any_practitioner: true,
            status: 'active' as const,
            is_synthetic: true,
          })),
        )
        .onConflict((conflict) => conflict.column('id').doNothing())
        .execute();

      await database
        .insertInto('practitioner_service_assignments')
        .values(
          providerFixtures.map((practice) => ({
            id: practice.practitionerServiceAssignmentId,
            tenant_id: tenant.id,
            organization_id: practice.organizationId,
            facility_id: practice.facilityId,
            practitioner_facility_assignment_id:
              practice.practitionerFacilityAssignmentId,
            practitioner_id: practice.practitionerId,
            appointment_service_id: practice.appointmentServiceId,
            status: 'active' as const,
            is_synthetic: true,
          })),
        )
        .onConflict((conflict) => conflict.column('id').doNothing())
        .execute();

      // Re-read after conflict handling so a concurrent colliding insert cannot
      // be trusted merely because ON CONFLICT preserved it.
      await preflightProviderFixtures(
        database,
        tenant.id,
        providerFixtures,
        true,
      );

      await database
        .insertInto('practitioner_availability_templates')
        .values(appointmentFixtures.availabilityTemplates)
        .onConflict((conflict) => conflict.column('id').doNothing())
        .execute();

      await preflightAvailabilityTemplates(
        database,
        appointmentFixtures.availabilityTemplates,
        true,
      );

      await database
        .insertInto('patient_portal_appointment_slots')
        .values(appointmentFixtures.slots)
        .onConflict((conflict) =>
          conflict
            .columns(['availability_template_id', 'generation_key_hash'])
            .where('availability_template_id', 'is not', null)
            .doNothing(),
        )
        .execute();

      await preflightAppointmentSlots(
        database,
        appointmentFixtures.slots,
        true,
      );

      await database
        .insertInto('audit_events')
        .values({
          id: '80000000-0000-4000-8000-000000000001',
          actor_type: 'system',
          actor_identifier: 'synthetic-seed',
          actor_user_id: null,
          effective_user_id: user.id,
          tenant_id: tenant.id,
          organization_id: organization.id,
          facility_id: facility.id,
          action: 'identity.synthetic_seeded',
          target_entity_type: 'application_user',
          target_entity_id: user.id,
          outcome: 'success',
          correlation_id: '90000000-0000-4000-8000-000000000001',
          reason: 'Create deterministic local synthetic identity data.',
          before_data: null,
          after_data: { status: 'active', synthetic: true },
        })
        .onConflict((conflict) => conflict.column('id').doNothing())
        .execute();

      console.info(
        `Seeded ${tenant.code}/${organization.code}/${facility.code}, ${appointmentPractice.code}, and a synthetic practice administrator.`,
      );
    });
  } finally {
    await client.destroy();
  }
}

type SeedDatabase = Kysely<DatabaseSchema>;

interface ProviderFixtureIdentity {
  bookablePracticeId: string;
  organizationId: string;
  bookableTimezone: string;
  practitionerId: string;
  specialtyId: string;
  practitionerFacilityAssignmentId: string;
  appointmentServiceId: string;
  practitionerServiceAssignmentId: string;
}

interface ProviderFixtureSeed extends ProviderFixtureIdentity {
  facilityId: string;
  sourceTimezone: string;
  durationMinutes: number;
}

async function ensureSyntheticBookablePractice(
  database: SeedDatabase,
  input: {
    id: string;
    tenantId: string;
    organizationId: string;
    defaultTimezone: string;
  },
): Promise<{
  id: string;
  tenantId: string;
  organizationId: string;
  timezone: string;
}> {
  let bookable = await database
    .selectFrom('patient_portal_bookable_practices')
    .select(['id', 'tenant_id', 'organization_id', 'timezone', 'is_synthetic'])
    .where('id', '=', input.id)
    .executeTakeFirst();

  if (!bookable) {
    bookable = await database
      .insertInto('patient_portal_bookable_practices')
      .values({
        id: input.id,
        tenant_id: input.tenantId,
        organization_id: input.organizationId,
        timezone: input.defaultTimezone,
        status: 'active',
        is_synthetic: true,
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .returning([
        'id',
        'tenant_id',
        'organization_id',
        'timezone',
        'is_synthetic',
      ])
      .executeTakeFirst();
  }

  if (
    !bookable ||
    bookable.tenant_id !== input.tenantId ||
    bookable.organization_id !== input.organizationId ||
    !bookable.is_synthetic
  ) {
    throw new Error(
      'Deterministic synthetic bookable practice scope is invalid.',
    );
  }
  assertIanaTimezone(bookable.timezone, 'bookable practice');

  return {
    id: bookable.id,
    tenantId: bookable.tenant_id,
    organizationId: bookable.organization_id,
    timezone: bookable.timezone,
  };
}

async function ensureSyntheticFacilityByCode(
  database: SeedDatabase,
  input: {
    tenantId: string;
    organizationId: string;
    code: string;
    name: string;
    defaultTimezone: string;
  },
): Promise<{ id: string; code: string; timezone: string }> {
  let facility = await database
    .selectFrom('facilities')
    .select([
      'id',
      'tenant_id',
      'organization_id',
      'code',
      'timezone',
      'is_synthetic',
    ])
    .where('code', '=', input.code)
    .executeTakeFirst();

  if (!facility) {
    facility = await database
      .insertInto('facilities')
      .values({
        tenant_id: input.tenantId,
        organization_id: input.organizationId,
        code: input.code,
        name: input.name,
        timezone: input.defaultTimezone,
        is_synthetic: true,
      })
      .onConflict((conflict) => conflict.column('code').doNothing())
      .returning([
        'id',
        'tenant_id',
        'organization_id',
        'code',
        'timezone',
        'is_synthetic',
      ])
      .executeTakeFirst();
  }

  if (
    !facility ||
    facility.tenant_id !== input.tenantId ||
    facility.organization_id !== input.organizationId ||
    !facility.is_synthetic
  ) {
    throw new Error('Synthetic seed facility scope is invalid.');
  }
  assertIanaTimezone(facility.timezone, 'facility');

  return {
    id: facility.id,
    code: facility.code,
    timezone: facility.timezone,
  };
}

async function resolveSyntheticSchedulingFacility(
  database: SeedDatabase,
  input: {
    bookablePracticeId: string;
    tenantId: string;
    organizationId: string;
    timezone: string;
  },
): Promise<{ id: string; timezone: string }> {
  const deterministicFacilityId = buildSyntheticProviderFixtureId(
    'facility',
    input.bookablePracticeId,
  );
  let selected = await database
    .selectFrom('facilities')
    .select(['id', 'tenant_id', 'organization_id', 'timezone', 'is_synthetic'])
    .where('id', '=', deterministicFacilityId)
    .executeTakeFirst();

  if (!selected) {
    const candidates = await database
      .selectFrom('facilities')
      .select([
        'id',
        'tenant_id',
        'organization_id',
        'timezone',
        'is_synthetic',
      ])
      .where('tenant_id', '=', input.tenantId)
      .where('organization_id', '=', input.organizationId)
      .execute();
    if (candidates.some((facility) => !facility.is_synthetic)) {
      throw new Error(
        'Synthetic scheduling cannot select a non-synthetic facility.',
      );
    }
    if (candidates.length > 1) {
      throw new Error('Synthetic scheduling facility scope is ambiguous.');
    }
    selected = candidates[0];
  }

  if (!selected) {
    selected = await database
      .insertInto('facilities')
      .values({
        id: deterministicFacilityId,
        tenant_id: input.tenantId,
        organization_id: input.organizationId,
        code: buildSyntheticFacilityCode(deterministicFacilityId),
        name: 'Synthetic Appointment Centre',
        timezone: input.timezone,
        is_synthetic: true,
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .returning([
        'id',
        'tenant_id',
        'organization_id',
        'timezone',
        'is_synthetic',
      ])
      .executeTakeFirst();
  }

  if (!selected) {
    throw new Error(
      'Synthetic scheduling facility could not be resolved safely.',
    );
  }
  assertSyntheticSchedulingFacilityScope({
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    bookableTimezone: input.timezone,
    facility: {
      tenantId: selected.tenant_id,
      organizationId: selected.organization_id,
      timezone: selected.timezone,
      isSynthetic: selected.is_synthetic,
    },
  });

  return { id: selected.id, timezone: selected.timezone };
}

async function resolvePersistedProviderFixture(
  database: SeedDatabase,
  tenantId: string,
  fixture: ProviderFixtureIdentity,
): Promise<{
  facilityId: string;
  sourceTimezone: string;
  durationMinutes: number;
} | null> {
  const service = await database
    .selectFrom('appointment_services')
    .select(['facility_id', 'duration_minutes'])
    .where('id', '=', fixture.appointmentServiceId)
    .executeTakeFirst();
  if (!service) return null;

  const facility = await database
    .selectFrom('facilities')
    .select(['tenant_id', 'organization_id', 'timezone', 'is_synthetic'])
    .where('id', '=', service.facility_id)
    .executeTakeFirst();

  if (
    !facility ||
    !Number.isInteger(service.duration_minutes) ||
    service.duration_minutes < 1
  ) {
    throw new Error('Persisted synthetic provider fixture scope is invalid.');
  }
  assertSyntheticSchedulingFacilityScope({
    tenantId,
    organizationId: fixture.organizationId,
    bookableTimezone: fixture.bookableTimezone,
    facility: {
      tenantId: facility.tenant_id,
      organizationId: facility.organization_id,
      timezone: facility.timezone,
      isSynthetic: facility.is_synthetic,
    },
  });

  return {
    facilityId: service.facility_id,
    sourceTimezone: facility.timezone,
    durationMinutes: service.duration_minutes,
  };
}

async function preflightProviderFixtures(
  database: SeedDatabase,
  tenantId: string,
  fixtures: readonly ProviderFixtureSeed[],
  requireComplete = false,
): Promise<void> {
  for (const fixture of fixtures) {
    const practitioner = await database
      .selectFrom('practitioners')
      .select([
        'tenant_id',
        'application_user_id',
        'display_name',
        'professional_title',
        'status',
        'is_synthetic',
      ])
      .where('id', '=', fixture.practitionerId)
      .executeTakeFirst();
    assertDeterministicFixtureRow(
      practitioner,
      practitioner?.tenant_id === tenantId &&
        practitioner.application_user_id === null &&
        practitioner.display_name === 'Synthetic Physician' &&
        practitioner.professional_title === 'General physician' &&
        practitioner.status === 'active' &&
        practitioner.is_synthetic,
      requireComplete,
      'practitioner',
    );

    const specialty = await database
      .selectFrom('specialties')
      .select([
        'tenant_id',
        'organization_id',
        'organization_kind',
        'code',
        'name',
        'status',
        'is_synthetic',
      ])
      .where('id', '=', fixture.specialtyId)
      .executeTakeFirst();
    assertDeterministicFixtureRow(
      specialty,
      specialty?.tenant_id === tenantId &&
        specialty.organization_id === fixture.organizationId &&
        specialty.organization_kind === 'practice' &&
        specialty.code === 'GENERAL-MEDICINE' &&
        specialty.name === 'General medicine' &&
        specialty.status === 'active' &&
        specialty.is_synthetic,
      requireComplete,
      'specialty',
    );

    const facilityAssignment = await database
      .selectFrom('practitioner_facility_assignments')
      .select([
        'tenant_id',
        'organization_id',
        'organization_kind',
        'facility_id',
        'practitioner_id',
        'status',
        'is_synthetic',
      ])
      .where('id', '=', fixture.practitionerFacilityAssignmentId)
      .executeTakeFirst();
    assertDeterministicFixtureRow(
      facilityAssignment,
      facilityAssignment?.tenant_id === tenantId &&
        facilityAssignment.organization_id === fixture.organizationId &&
        facilityAssignment.organization_kind === 'practice' &&
        facilityAssignment.facility_id === fixture.facilityId &&
        facilityAssignment.practitioner_id === fixture.practitionerId &&
        facilityAssignment.status === 'active' &&
        facilityAssignment.is_synthetic,
      requireComplete,
      'practitioner facility assignment',
    );

    const service = await database
      .selectFrom('appointment_services')
      .select([
        'tenant_id',
        'organization_id',
        'organization_kind',
        'facility_id',
        'specialty_id',
        'code',
        'patient_facing_name',
        'duration_minutes',
        'allows_any_practitioner',
        'status',
        'is_synthetic',
      ])
      .where('id', '=', fixture.appointmentServiceId)
      .executeTakeFirst();
    assertDeterministicFixtureRow(
      service,
      service?.tenant_id === tenantId &&
        service.organization_id === fixture.organizationId &&
        service.organization_kind === 'practice' &&
        service.facility_id === fixture.facilityId &&
        service.specialty_id === fixture.specialtyId &&
        service.code === 'GENERAL-CONSULTATION' &&
        service.patient_facing_name === 'General consultation' &&
        service.duration_minutes === fixture.durationMinutes &&
        service.allows_any_practitioner &&
        service.status === 'active' &&
        service.is_synthetic,
      requireComplete,
      'appointment service',
    );

    const serviceAssignment = await database
      .selectFrom('practitioner_service_assignments')
      .select([
        'tenant_id',
        'organization_id',
        'facility_id',
        'practitioner_facility_assignment_id',
        'practitioner_id',
        'appointment_service_id',
        'status',
        'is_synthetic',
      ])
      .where('id', '=', fixture.practitionerServiceAssignmentId)
      .executeTakeFirst();
    assertDeterministicFixtureRow(
      serviceAssignment,
      serviceAssignment?.tenant_id === tenantId &&
        serviceAssignment.organization_id === fixture.organizationId &&
        serviceAssignment.facility_id === fixture.facilityId &&
        serviceAssignment.practitioner_facility_assignment_id ===
          fixture.practitionerFacilityAssignmentId &&
        serviceAssignment.practitioner_id === fixture.practitionerId &&
        serviceAssignment.appointment_service_id ===
          fixture.appointmentServiceId &&
        serviceAssignment.status === 'active' &&
        serviceAssignment.is_synthetic,
      requireComplete,
      'practitioner service assignment',
    );
  }
}

async function preflightAvailabilityFixtures(
  database: SeedDatabase,
  fixtures: SyntheticAppointmentFixtures,
): Promise<void> {
  await preflightAvailabilityTemplates(
    database,
    fixtures.availabilityTemplates,
  );
  await preflightAppointmentSlots(database, fixtures.slots);
}

async function preflightAvailabilityTemplates(
  database: SeedDatabase,
  templates: readonly SyntheticAvailabilityTemplateSeed[],
  requireComplete = false,
): Promise<void> {
  for (const template of templates) {
    const persisted = await database
      .selectFrom('practitioner_availability_templates')
      .select([
        'tenant_id',
        'organization_id',
        'facility_id',
        'practitioner_facility_assignment_id',
        'practitioner_service_assignment_id',
        'practitioner_id',
        'appointment_service_id',
        'iso_weekday',
        'local_start_minute',
        'local_end_minute',
        'effective_from',
        'effective_until',
        'source_timezone',
        'status',
        'is_synthetic',
      ])
      .where('id', '=', template.id)
      .executeTakeFirst();

    if (!persisted) {
      if (requireComplete) {
        throw new Error(
          'Deterministic synthetic availability template is missing after seed insert.',
        );
      }
      continue;
    }
    assertSyntheticAvailabilityTemplateMatch(persisted, template);
  }
}

async function preflightAppointmentSlots(
  database: SeedDatabase,
  slots: readonly SyntheticAppointmentSlotSeed[],
  requireComplete = false,
): Promise<void> {
  for (const slot of slots) {
    const persisted = await database
      .selectFrom('patient_portal_appointment_slots')
      .select([
        'bookable_practice_id',
        'tenant_id',
        'organization_id',
        'starts_at',
        'ends_at',
        'facility_id',
        'practitioner_facility_assignment_id',
        'practitioner_service_assignment_id',
        'practitioner_id',
        'appointment_service_id',
        'availability_template_id',
        'generation_key_hash',
        'source_local_date',
        'source_timezone',
        'status',
        'is_synthetic',
      ])
      .where('availability_template_id', '=', slot.availability_template_id)
      .where('generation_key_hash', '=', slot.generation_key_hash)
      .executeTakeFirst();

    if (!persisted) {
      if (requireComplete) {
        throw new Error(
          'Synthetic appointment generation key is missing after seed insert.',
        );
      }
      continue;
    }
    assertSyntheticAppointmentSlotMatch(persisted, slot);
  }
}

function assertDeterministicFixtureRow(
  row: object | undefined,
  isExact: boolean | undefined,
  requireComplete: boolean,
  kind: string,
): void {
  if (!row) {
    if (requireComplete) {
      throw new Error(
        `Deterministic synthetic ${kind} is missing after seed insert.`,
      );
    }
    return;
  }
  if (!isExact) {
    throw new Error(
      `Deterministic synthetic ${kind} is not an exact fixture match.`,
    );
  }
}

function assertIanaTimezone(timezone: string, owner: string): void {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
  } catch {
    throw new Error(`Synthetic ${owner} timezone is invalid.`);
  }
}

void seed().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Seed failed.');
  process.exitCode = 1;
});
