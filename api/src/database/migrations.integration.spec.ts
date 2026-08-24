import { Kysely, sql } from 'kysely';
import { createDatabaseClient } from './create-database-client.js';
import type { DatabaseSchema } from './database.types.js';
import * as createFacilities from './migrations/2026-08-23T000000_create_facilities.js';
import * as createIdentityAuthorizationAudit from './migrations/2026-08-24T000000_create_identity_authorization_audit.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('identity, authorization, and audit migrations', () => {
  const schemaName = `identity_schema_test_${process.pid}_${Date.now()}`;
  let adminDatabase: Kysely<unknown>;
  let database: Kysely<DatabaseSchema>;

  beforeAll(async () => {
    adminDatabase = createDatabaseClient<unknown>({
      connectionString: databaseUrl!,
      maxConnections: 1,
      ssl: false,
    });
    await sql`create schema ${sql.id(schemaName)}`.execute(adminDatabase);

    database = createDatabaseClient<DatabaseSchema>({
      connectionString: databaseUrl!,
      maxConnections: 1,
      ssl: false,
    });
    await sql`set search_path to ${sql.id(schemaName)}, public`.execute(
      database,
    );
    await createFacilities.up(database);
    await createIdentityAuthorizationAudit.up(database);
  });

  afterAll(async () => {
    if (database) {
      await createIdentityAuthorizationAudit.down(database);
      await createFacilities.down(database);
      await database.destroy();
    }

    if (adminDatabase) {
      await sql`drop schema ${sql.id(schemaName)} cascade`.execute(
        adminDatabase,
      );
      await adminDatabase.destroy();
    }
  });

  it('creates global role templates and supports one user across tenants', async () => {
    const globalRoles = await database
      .selectFrom('roles')
      .select(['code', 'is_system_template'])
      .where('tenant_id', 'is', null)
      .execute();

    expect(globalRoles).toHaveLength(10);
    expect(globalRoles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PRACTICE_ADMIN',
          is_system_template: true,
        }),
        expect.objectContaining({
          code: 'BILLING_APPROVER',
          is_system_template: true,
        }),
      ]),
    );

    const user = await database
      .insertInto('application_users')
      .values({
        display_name: 'Synthetic Multi Practice User',
        primary_email: 'multi-practice@example.invalid',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    for (const [tenantCode, organizationCode] of [
      ['TENANT-A', 'PRACTICE-A'],
      ['TENANT-B', 'PRACTICE-B'],
    ] as const) {
      const tenant = await database
        .insertInto('tenants')
        .values({
          code: tenantCode,
          name: `Synthetic ${tenantCode}`,
          is_synthetic: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const organization = await database
        .insertInto('organizations')
        .values({
          tenant_id: tenant.id,
          parent_organization_id: null,
          kind: 'practice',
          code: organizationCode,
          name: `Synthetic ${organizationCode}`,
          is_synthetic: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await database
        .insertInto('organization_memberships')
        .values({
          tenant_id: tenant.id,
          organization_id: organization.id,
          application_user_id: user.id,
          status: 'active',
          provisioning_method: 'jit',
          external_id: null,
          valid_until: null,
        })
        .execute();
    }

    const memberships = await database
      .selectFrom('organization_memberships')
      .select('tenant_id')
      .where('application_user_id', '=', user.id)
      .execute();

    expect(memberships).toHaveLength(2);
    expect(new Set(memberships.map(({ tenant_id }) => tenant_id)).size).toBe(2);
  });

  it('prevents organization cycles', async () => {
    const tenant = await database
      .insertInto('tenants')
      .values({
        code: 'CYCLE-TEST',
        name: 'Synthetic Cycle Test',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const parent = await database
      .insertInto('organizations')
      .values({
        tenant_id: tenant.id,
        parent_organization_id: null,
        kind: 'group',
        code: 'CYCLE-PARENT',
        name: 'Synthetic Parent',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const child = await database
      .insertInto('organizations')
      .values({
        tenant_id: tenant.id,
        parent_organization_id: parent.id,
        kind: 'practice',
        code: 'CYCLE-CHILD',
        name: 'Synthetic Child',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await expect(
      database
        .updateTable('organizations')
        .set({ parent_organization_id: child.id })
        .where('id', '=', parent.id)
        .execute(),
    ).rejects.toThrow('Organization hierarchy cannot contain a cycle.');
  });

  it('binds identities by connection and subject instead of email', async () => {
    const tenant = await database
      .insertInto('tenants')
      .values({
        code: 'IDENTITY-TEST',
        name: 'Synthetic Identity Test',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const connection = await database
      .insertInto('identity_connections')
      .values({
        tenant_id: tenant.id,
        code: 'test-entra',
        name: 'Synthetic Entra',
        protocol: 'oidc',
        issuer: 'https://login.example.invalid/identity-test/v2.0',
        jit_provisioning_enabled: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const firstUser = await database
      .insertInto('application_users')
      .values({
        display_name: 'Synthetic First User',
        primary_email: 'same-email@example.invalid',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const secondUser = await database
      .insertInto('application_users')
      .values({
        display_name: 'Synthetic Second User',
        primary_email: 'same-email@example.invalid',
        is_synthetic: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await database
      .insertInto('user_identities')
      .values({
        application_user_id: firstUser.id,
        identity_connection_id: connection.id,
        subject: 'immutable-subject',
        last_authenticated_at: null,
      })
      .execute();

    await expect(
      database
        .insertInto('user_identities')
        .values({
          application_user_id: secondUser.id,
          identity_connection_id: connection.id,
          subject: 'immutable-subject',
          last_authenticated_at: null,
        })
        .execute(),
    ).rejects.toThrow();
  });

  it('rejects a tenant-local role outside its tenant', async () => {
    const tenants = await database
      .selectFrom('tenants')
      .select('id')
      .where('code', 'in', ['TENANT-A', 'TENANT-B'])
      .orderBy('code')
      .execute();
    const membership = await database
      .selectFrom('organization_memberships')
      .select(['id', 'tenant_id', 'organization_id', 'application_user_id'])
      .where('tenant_id', '=', tenants[1].id)
      .executeTakeFirstOrThrow();
    const localRole = await database
      .insertInto('roles')
      .values({
        tenant_id: tenants[0].id,
        code: 'LOCAL_ROLE',
        name: 'Synthetic Local Role',
        description: 'Synthetic local-role boundary test.',
        is_system_template: false,
        request_policy: 'approval_required',
        cloned_from_role_id: null,
        created_by_user_id: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await expect(
      database
        .insertInto('role_assignments')
        .values({
          tenant_id: membership.tenant_id,
          membership_id: membership.id,
          role_id: localRole.id,
          scope_organization_id: membership.organization_id,
          facility_id: null,
          include_descendants: false,
          assignment_source: 'admin',
          assigned_by_user_id: membership.application_user_id,
          source_role_request_id: null,
          valid_until: null,
          revoked_at: null,
          revoked_by_user_id: null,
          revocation_reason: null,
        })
        .execute(),
    ).rejects.toThrow('Tenant-local role cannot be used outside its tenant.');
  });

  it('enforces requestable roles and prevents self-approval', async () => {
    const membership = await database
      .selectFrom('organization_memberships')
      .innerJoin('tenants', 'tenants.id', 'organization_memberships.tenant_id')
      .select([
        'organization_memberships.id',
        'organization_memberships.tenant_id',
        'organization_memberships.organization_id',
        'organization_memberships.application_user_id',
      ])
      .where('tenants.code', '=', 'TENANT-A')
      .executeTakeFirstOrThrow();
    const roles = await database
      .selectFrom('roles')
      .select(['id', 'code'])
      .where('code', 'in', ['PRACTICE_ADMIN', 'RECEPTION'])
      .execute();
    const practiceAdmin = roles.find(({ code }) => code === 'PRACTICE_ADMIN')!;
    const reception = roles.find(({ code }) => code === 'RECEPTION')!;

    await expect(
      database
        .insertInto('role_requests')
        .values({
          tenant_id: membership.tenant_id,
          membership_id: membership.id,
          role_id: practiceAdmin.id,
          scope_organization_id: membership.organization_id,
          facility_id: null,
          include_descendants: false,
          requested_by_user_id: membership.application_user_id,
          request_reason: 'Synthetic restricted-role request.',
          decided_by_user_id: null,
          decision_reason: null,
          decided_at: null,
        })
        .execute(),
    ).rejects.toThrow('This role is restricted to administrator assignment.');

    const request = await database
      .insertInto('role_requests')
      .values({
        tenant_id: membership.tenant_id,
        membership_id: membership.id,
        role_id: reception.id,
        scope_organization_id: membership.organization_id,
        facility_id: null,
        include_descendants: false,
        requested_by_user_id: membership.application_user_id,
        request_reason: 'Synthetic requestable-role request.',
        decided_by_user_id: null,
        decision_reason: null,
        decided_at: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await expect(
      database
        .updateTable('role_requests')
        .set({
          status: 'approved',
          decided_by_user_id: membership.application_user_id,
          decision_reason: 'Synthetic self-approval must fail.',
          decided_at: new Date(),
        })
        .where('id', '=', request.id)
        .execute(),
    ).rejects.toThrow();
  });

  it('keeps committed audit events append-only', async () => {
    const auditEvent = await database
      .insertInto('audit_events')
      .values({
        actor_type: 'system',
        actor_identifier: 'migration-integration-test',
        actor_user_id: null,
        effective_user_id: null,
        tenant_id: null,
        organization_id: null,
        facility_id: null,
        action: 'schema.append_only_verified',
        target_entity_type: 'migration',
        target_entity_id: '2026-08-24T000000',
        outcome: 'success',
        correlation_id: 'aaaaaaaa-0000-4000-8000-000000000001',
        reason: 'Verify append-only database enforcement.',
        before_data: null,
        after_data: { verified: true },
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await expect(
      database
        .updateTable('audit_events')
        .set({ reason: 'Mutation must fail.' })
        .where('id', '=', auditEvent.id)
        .execute(),
    ).rejects.toThrow('Committed audit events are append-only.');

    await expect(
      database
        .deleteFrom('audit_events')
        .where('id', '=', auditEvent.id)
        .execute(),
    ).rejects.toThrow('Committed audit events are append-only.');

    await expect(
      sql`truncate table audit_events`.execute(database),
    ).rejects.toThrow('Committed audit events are append-only.');
  });
});
