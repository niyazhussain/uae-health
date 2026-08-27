import { Kysely, sql } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    create table patient_portal_appointment_relationships (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id) on delete restrict,
      organization_id uuid not null,
      patient_portal_identity_id uuid not null
        references patient_portal_identities(id) on delete restrict,
      status varchar(16) not null default 'pending',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint pp_appointment_relationship_status_check
        check (status = 'pending'),
      constraint pp_appointment_relationship_organization_fk
        foreign key (tenant_id, organization_id)
        references organizations(tenant_id, id) on delete restrict,
      constraint pp_appointment_relationship_identity_org_unique
        unique (patient_portal_identity_id, organization_id),
      constraint pp_appointment_relationship_id_identity_unique
        unique (id, patient_portal_identity_id),
      constraint pp_appointment_relationship_scope_identity_unique
        unique (id, tenant_id, organization_id, patient_portal_identity_id)
    )
  `.execute(database);

  await sql`
    create index pp_appointment_relationship_practice_idx
      on patient_portal_appointment_relationships (tenant_id, organization_id)
      where status = 'pending'
  `.execute(database);

  await sql`
    create table patient_portal_bookable_practices (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id) on delete restrict,
      organization_id uuid not null,
      timezone varchar(64) not null,
      status varchar(16) not null default 'active',
      is_synthetic boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint pp_bookable_practices_status_check
        check (status in ('active', 'unavailable')),
      constraint pp_bookable_practices_timezone_check
        check (length(btrim(timezone)) > 0),
      constraint pp_bookable_practices_organization_fk
        foreign key (tenant_id, organization_id)
        references organizations(tenant_id, id) on delete restrict,
      constraint pp_bookable_practices_org_unique
        unique (tenant_id, organization_id),
      constraint pp_bookable_practices_id_scope_unique
        unique (id, tenant_id, organization_id)
    )
  `.execute(database);

  await sql`
    create index pp_bookable_practices_active_idx
      on patient_portal_bookable_practices (tenant_id, organization_id)
      where status = 'active'
  `.execute(database);

  await sql`
    create table patient_portal_appointment_slots (
      id uuid primary key default gen_random_uuid(),
      bookable_practice_id uuid not null
        references patient_portal_bookable_practices(id) on delete restrict,
      tenant_id uuid not null,
      organization_id uuid not null,
      starts_at timestamptz not null,
      ends_at timestamptz not null,
      status varchar(16) not null default 'available',
      is_synthetic boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint pp_appointment_slots_time_check check (ends_at > starts_at),
      constraint pp_appointment_slots_status_check
        check (status in ('available', 'withdrawn')),
      constraint pp_appointment_slots_bookable_scope_fk
        foreign key (bookable_practice_id, tenant_id, organization_id)
        references patient_portal_bookable_practices(id, tenant_id, organization_id)
        on delete restrict,
      constraint pp_appointment_slots_practice_start_unique
        unique (bookable_practice_id, starts_at),
      constraint pp_appointment_slots_id_scope_unique
        unique (id, tenant_id, organization_id)
    )
  `.execute(database);

  await sql`
    create index pp_appointment_slots_available_idx
      on patient_portal_appointment_slots (bookable_practice_id, starts_at)
      where status = 'available'
  `.execute(database);

  await sql`
    alter table patient_portal_profiles
      add constraint pp_profiles_id_scope_unique
        unique (id, tenant_id, organization_id)
  `.execute(database);

  await sql`
    alter table patient_portal_profile_links
      add constraint pp_profile_links_profile_identity_unique
        unique (patient_portal_profile_id, patient_portal_identity_id)
  `.execute(database);

  await sql`
    create table patient_portal_appointments (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id) on delete restrict,
      organization_id uuid not null,
      patient_portal_identity_id uuid not null
        references patient_portal_identities(id) on delete restrict,
      patient_portal_profile_id uuid
        references patient_portal_profiles(id) on delete restrict,
      patient_portal_appointment_relationship_id uuid
        references patient_portal_appointment_relationships(id) on delete restrict,
      appointment_slot_id uuid not null
        references patient_portal_appointment_slots(id) on delete restrict,
      status varchar(16) not null default 'requested',
      version integer not null default 1,
      cancelled_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint pp_appointments_scope_fk
        foreign key (tenant_id, organization_id)
        references organizations(tenant_id, id) on delete restrict,
      constraint pp_appointments_profile_scope_fk
        foreign key (patient_portal_profile_id, tenant_id, organization_id)
        references patient_portal_profiles(id, tenant_id, organization_id)
        on delete restrict,
      constraint pp_appointments_profile_identity_fk
        foreign key (patient_portal_profile_id, patient_portal_identity_id)
        references patient_portal_profile_links(
          patient_portal_profile_id,
          patient_portal_identity_id
        ) on delete restrict,
      constraint pp_appointments_relationship_scope_identity_fk
        foreign key (
          patient_portal_appointment_relationship_id,
          tenant_id,
          organization_id,
          patient_portal_identity_id
        ) references patient_portal_appointment_relationships(
          id,
          tenant_id,
          organization_id,
          patient_portal_identity_id
        ) on delete restrict,
      constraint pp_appointments_slot_scope_fk
        foreign key (appointment_slot_id, tenant_id, organization_id)
        references patient_portal_appointment_slots(id, tenant_id, organization_id)
        on delete restrict,
      constraint pp_appointments_one_patient_scope_check check (
        (patient_portal_profile_id is not null
          and patient_portal_appointment_relationship_id is null)
        or
        (patient_portal_profile_id is null
          and patient_portal_appointment_relationship_id is not null)
      ),
      constraint pp_appointments_status_check
        check (status in ('requested', 'cancelled')),
      constraint pp_appointments_version_check check (version > 0),
      constraint pp_appointments_cancellation_check check (
        (status = 'requested' and cancelled_at is null)
        or
        (status = 'cancelled' and cancelled_at is not null)
      ),
      constraint pp_appointments_id_identity_unique
        unique (id, patient_portal_identity_id)
    )
  `.execute(database);

  await sql`
    create unique index pp_appointments_live_slot_unique
      on patient_portal_appointments (appointment_slot_id)
      where status = 'requested'
  `.execute(database);

  await sql`
    create index pp_appointments_profile_scope_idx
      on patient_portal_appointments (patient_portal_profile_id, created_at desc)
      where patient_portal_profile_id is not null
  `.execute(database);

  await sql`
    create index pp_appointments_relationship_scope_idx
      on patient_portal_appointments (
        patient_portal_appointment_relationship_id,
        created_at desc
      )
      where patient_portal_appointment_relationship_id is not null
  `.execute(database);

  await sql`
    create table patient_portal_appointment_commands (
      id uuid primary key default gen_random_uuid(),
      patient_portal_identity_id uuid not null
        references patient_portal_identities(id) on delete restrict,
      operation varchar(32) not null,
      idempotency_key_hash char(64) not null,
      request_hash char(64) not null,
      response_data jsonb not null,
      patient_portal_appointment_relationship_id uuid
        references patient_portal_appointment_relationships(id) on delete restrict,
      patient_portal_appointment_id uuid
        references patient_portal_appointments(id) on delete restrict,
      created_at timestamptz not null default now(),
      constraint pp_appointment_commands_operation_check
        check (operation in (
          'relationship_create',
          'appointment_create',
          'appointment_cancellation',
          'appointment_reschedule'
        )),
      constraint pp_appointment_commands_result_check check (
        (operation = 'relationship_create'
          and patient_portal_appointment_relationship_id is not null
          and patient_portal_appointment_id is null)
        or
        (operation <> 'relationship_create'
          and patient_portal_appointment_relationship_id is null
          and patient_portal_appointment_id is not null)
      ),
      constraint pp_appointment_commands_relationship_identity_fk
        foreign key (
          patient_portal_appointment_relationship_id,
          patient_portal_identity_id
        ) references patient_portal_appointment_relationships(
          id,
          patient_portal_identity_id
        ) on delete restrict,
      constraint pp_appointment_commands_appointment_identity_fk
        foreign key (
          patient_portal_appointment_id,
          patient_portal_identity_id
        ) references patient_portal_appointments(
          id,
          patient_portal_identity_id
        ) on delete restrict,
      constraint pp_appointment_commands_identity_operation_key_unique
        unique (patient_portal_identity_id, operation, idempotency_key_hash)
    )
  `.execute(database);

  await sql`
    alter table patient_portal_sessions
      add column patient_portal_appointment_relationship_id uuid
        references patient_portal_appointment_relationships(id) on delete restrict,
      add constraint pp_sessions_context_check
        check (
          num_nonnulls(
            patient_portal_profile_id,
            patient_portal_appointment_relationship_id
          ) <= 1
        )
  `.execute(database);

  await sql`
    create index pp_sessions_appointment_relationship_idx
      on patient_portal_sessions (
        patient_portal_appointment_relationship_id,
        absolute_expires_at
      )
      where revoked_at is null
        and patient_portal_appointment_relationship_id is not null
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`
    drop index if exists pp_sessions_appointment_relationship_idx
  `.execute(database);
  await sql`
    alter table patient_portal_sessions
      drop constraint if exists pp_sessions_context_check,
      drop column if exists patient_portal_appointment_relationship_id
  `.execute(database);
  await sql`drop table if exists patient_portal_appointment_commands`.execute(
    database,
  );
  await sql`drop table if exists patient_portal_appointments`.execute(database);
  await sql`
    alter table patient_portal_profile_links
      drop constraint if exists pp_profile_links_profile_identity_unique
  `.execute(database);
  await sql`
    alter table patient_portal_profiles
      drop constraint if exists pp_profiles_id_scope_unique
  `.execute(database);
  await sql`drop table if exists patient_portal_appointment_slots`.execute(
    database,
  );
  await sql`drop table if exists patient_portal_bookable_practices`.execute(
    database,
  );
  await sql`drop table if exists patient_portal_appointment_relationships`.execute(
    database,
  );
}
