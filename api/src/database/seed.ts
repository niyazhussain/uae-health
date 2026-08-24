import { createDatabaseClient } from './create-database-client.js';
import type { DatabaseSchema } from './database.types.js';
import { loadScriptEnvironment } from './load-script-environment.js';

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

  const database = createDatabaseClient<DatabaseSchema>({
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

    const facility = await database
      .insertInto('facilities')
      .values({
        tenant_id: tenant.id,
        organization_id: organization.id,
        code: 'DEMO-DXB',
        name: 'Synthetic Care Centre',
        timezone: 'Asia/Dubai',
        is_synthetic: true,
      })
      .onConflict((conflict) =>
        conflict.column('code').doUpdateSet({
          tenant_id: tenant.id,
          organization_id: organization.id,
          name: 'Synthetic Care Centre',
          timezone: 'Asia/Dubai',
          is_synthetic: true,
          updated_at: new Date(),
        }),
      )
      .returning(['id', 'code'])
      .executeTakeFirstOrThrow();

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
      `Seeded ${tenant.code}/${organization.code}/${facility.code} and a synthetic practice administrator.`,
    );
  } finally {
    await database.destroy();
  }
}

void seed().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Seed failed.');
  process.exitCode = 1;
});
