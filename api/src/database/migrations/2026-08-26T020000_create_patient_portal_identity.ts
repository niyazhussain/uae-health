import { Kysely, sql } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    create table patient_portal_identities (
      id uuid primary key default gen_random_uuid(),
      application_user_id uuid not null
        references application_users(id) on delete restrict,
      issuer varchar(500) not null,
      subject varchar(500) not null,
      client_id varchar(128) not null,
      username varchar(500),
      status varchar(16) not null default 'active',
      last_authenticated_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint patient_portal_identities_status_check
        check (status in ('active', 'suspended')),
      constraint patient_portal_identities_immutable_values_check
        check (
          length(btrim(issuer)) > 0
          and length(btrim(subject)) > 0
          and length(btrim(client_id)) > 0
        ),
      constraint patient_portal_identities_issuer_subject_unique
        unique (issuer, subject)
    )
  `.execute(database);

  await sql`
    create index patient_portal_identities_application_user_idx
      on patient_portal_identities (application_user_id)
      where status = 'active'
  `.execute(database);

  await sql`
    create table patient_portal_profiles (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id) on delete restrict,
      organization_id uuid not null,
      application_user_id uuid not null
        references application_users(id) on delete restrict,
      status varchar(16) not null default 'active',
      is_synthetic boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint patient_portal_profiles_status_check
        check (status in ('active', 'suspended', 'closed')),
      constraint patient_portal_profiles_organization_same_tenant_fk
        foreign key (tenant_id, organization_id)
        references organizations(tenant_id, id) on delete restrict,
      constraint patient_portal_profiles_user_organization_unique
        unique (application_user_id, organization_id)
    )
  `.execute(database);

  await sql`
    create index patient_portal_profiles_tenant_organization_idx
      on patient_portal_profiles (tenant_id, organization_id)
      where status = 'active'
  `.execute(database);

  await sql`
    create table patient_portal_profile_links (
      id uuid primary key default gen_random_uuid(),
      patient_portal_profile_id uuid not null
        references patient_portal_profiles(id) on delete restrict,
      patient_portal_identity_id uuid not null
        references patient_portal_identities(id) on delete restrict,
      status varchar(16) not null default 'active',
      linked_by_user_id uuid references application_users(id) on delete restrict,
      link_reason text not null,
      revoked_at timestamptz,
      revoked_by_user_id uuid references application_users(id) on delete restrict,
      revocation_reason text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint patient_portal_profile_links_status_check
        check (status in ('active', 'revoked')),
      constraint patient_portal_profile_links_reason_check
        check (length(btrim(link_reason)) > 0),
      constraint patient_portal_profile_links_revocation_check
        check (
          (status = 'active' and revoked_at is null and revoked_by_user_id is null and revocation_reason is null)
          or
          (status = 'revoked' and revoked_at is not null and revoked_by_user_id is not null
           and revocation_reason is not null and length(btrim(revocation_reason)) > 0)
        ),
      constraint patient_portal_profile_links_profile_unique
        unique (patient_portal_profile_id)
    )
  `.execute(database);

  await sql`
    create index patient_portal_profile_links_active_identity_idx
      on patient_portal_profile_links (patient_portal_identity_id, patient_portal_profile_id)
      where status = 'active'
  `.execute(database);

  await sql`
    create table patient_portal_sessions (
      id uuid primary key default gen_random_uuid(),
      session_token_hash char(64) not null unique,
      csrf_token_hash char(64) not null,
      patient_portal_identity_id uuid not null
        references patient_portal_identities(id) on delete restrict,
      patient_portal_profile_id uuid
        references patient_portal_profiles(id) on delete restrict,
      identity_issuer varchar(500) not null,
      identity_subject varchar(500) not null,
      identity_client_id varchar(128) not null,
      identity_username varchar(500),
      idle_expires_at timestamptz not null,
      absolute_expires_at timestamptz not null,
      last_seen_at timestamptz not null default now(),
      revoked_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint patient_portal_sessions_expiry_check
        check (idle_expires_at <= absolute_expires_at),
      constraint patient_portal_sessions_revocation_check
        check (revoked_at is null or revoked_at >= created_at)
    )
  `.execute(database);

  await sql`
    create index patient_portal_sessions_active_token_idx
      on patient_portal_sessions (session_token_hash, idle_expires_at, absolute_expires_at)
      where revoked_at is null
  `.execute(database);

  await sql`
    create index patient_portal_sessions_profile_active_idx
      on patient_portal_sessions (patient_portal_profile_id, absolute_expires_at)
      where revoked_at is null
  `.execute(database);

  await sql`
    create index patient_portal_sessions_identity_active_idx
      on patient_portal_sessions (patient_portal_identity_id, absolute_expires_at)
      where revoked_at is null
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists patient_portal_sessions`.execute(database);
  await sql`drop table if exists patient_portal_profile_links`.execute(
    database,
  );
  await sql`drop table if exists patient_portal_profiles`.execute(database);
  await sql`drop table if exists patient_portal_identities`.execute(database);
}
