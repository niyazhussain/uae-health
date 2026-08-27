import { Kysely, sql } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    alter table patient_portal_identities
      alter column status type varchar(32)
  `.execute(database);

  await sql`
    alter table patient_portal_identities
      drop constraint patient_portal_identities_status_check
  `.execute(database);

  await sql`
    alter table patient_portal_identities
      add constraint patient_portal_identities_status_check
        check (status in ('pending_verification', 'active', 'suspended'))
  `.execute(database);

  await sql`
    alter table patient_portal_identities
      add column provider_sync_status varchar(16) not null default 'synchronized',
      add column provider_sync_attempted_at timestamptz,
      add column provider_sync_completed_at timestamptz,
      add column provider_sync_error_code varchar(128),
      add constraint patient_portal_identities_provider_sync_status_check
        check (provider_sync_status in ('pending', 'synchronized', 'failed'))
  `.execute(database);

  await sql`
    create table patient_portal_registration_requests (
      id uuid primary key default gen_random_uuid(),
      idempotency_key_hash char(64) not null unique,
      request_hash char(64) not null,
      email_hmac char(64) not null,
      client_ip_hmac char(64) not null,
      provider_issuer varchar(500),
      provider_subject varchar(500),
      status varchar(32) not null,
      expires_at timestamptz not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint patient_portal_registration_requests_status_check
        check (status in ('pending_provider', 'pending_binding', 'accepted', 'rate_limited')),
      constraint patient_portal_registration_requests_provider_identity_check
        check (
          (provider_issuer is null and provider_subject is null)
          or
          (length(btrim(provider_issuer)) > 0 and length(btrim(provider_subject)) > 0)
        ),
      constraint patient_portal_registration_requests_expiry_check
        check (expires_at > created_at)
    )
  `.execute(database);

  await sql`
    create index patient_portal_registration_requests_email_window_idx
      on patient_portal_registration_requests (email_hmac, expires_at)
  `.execute(database);

  await sql`
    create index patient_portal_registration_requests_ip_window_idx
      on patient_portal_registration_requests (client_ip_hmac, expires_at)
  `.execute(database);

  await sql`
    create table patient_portal_invitations (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id) on delete restrict,
      organization_id uuid not null,
      issued_by_user_id uuid not null references application_users(id) on delete restrict,
      token_hash char(64) not null unique,
      status varchar(16) not null default 'issued',
      reason text not null,
      expires_at timestamptz not null,
      accepted_patient_portal_identity_id uuid
        references patient_portal_identities(id) on delete restrict,
      accepted_patient_portal_profile_id uuid
        references patient_portal_profiles(id) on delete restrict,
      accepted_at timestamptz,
      revoked_at timestamptz,
      revoked_by_user_id uuid references application_users(id) on delete restrict,
      revocation_reason text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint patient_portal_invitations_organization_same_tenant_fk
        foreign key (tenant_id, organization_id)
        references organizations(tenant_id, id) on delete restrict,
      constraint patient_portal_invitations_status_check
        check (status in ('issued', 'accepted', 'revoked', 'expired')),
      constraint patient_portal_invitations_reason_check
        check (length(btrim(reason)) > 0),
      constraint patient_portal_invitations_reason_code_check
        check (reason in (
          'patient-portal-onboarding',
          'patient-requested-access',
          'staff-assisted-enrolment'
        )),
      constraint patient_portal_invitations_expiry_check
        check (expires_at > created_at),
      constraint patient_portal_invitations_acceptance_check
        check (
          (status = 'accepted'
            and accepted_patient_portal_identity_id is not null
            and accepted_patient_portal_profile_id is not null
            and accepted_at is not null
            and revoked_at is null
            and revoked_by_user_id is null
            and revocation_reason is null)
          or
          (status in ('issued', 'expired')
            and accepted_patient_portal_identity_id is null
            and accepted_patient_portal_profile_id is null
            and accepted_at is null
            and revoked_at is null
            and revoked_by_user_id is null
            and revocation_reason is null)
          or
          (status = 'revoked'
            and accepted_patient_portal_identity_id is null
            and accepted_patient_portal_profile_id is null
            and accepted_at is null
            and revoked_at is not null
            and revoked_by_user_id is not null
            and revocation_reason is not null
            and length(btrim(revocation_reason)) > 0)
        )
    )
  `.execute(database);

  await sql`
    create index patient_portal_invitations_organization_issued_idx
      on patient_portal_invitations (tenant_id, organization_id, expires_at)
      where status = 'issued'
  `.execute(database);

  await sql`
    insert into permissions (code, name, description, is_delegable)
    values (
      'patients.portal.invite',
      'Invite patients to the portal',
      'Issue one-time patient portal invitations for the assigned practice.',
      true
    )
    on conflict (code) do nothing
  `.execute(database);

  await sql`
    insert into role_permissions (role_id, permission_id)
    select role.id, permission.id
    from roles role
    join permissions permission on permission.code = 'patients.portal.invite'
    where role.tenant_id is null
      and role.code = 'PRACTICE_ADMIN'
    on conflict do nothing
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists patient_portal_invitations`.execute(database);
  await sql`drop table if exists patient_portal_registration_requests`.execute(
    database,
  );

  await sql`
    delete from role_permissions
    where permission_id in (
      select id from permissions where code = 'patients.portal.invite'
    )
  `.execute(database);

  await sql`
    delete from permissions where code = 'patients.portal.invite'
  `.execute(database);

  await sql`
    alter table patient_portal_identities
      drop constraint patient_portal_identities_status_check
  `.execute(database);

  await sql`
    alter table patient_portal_identities
      drop constraint patient_portal_identities_provider_sync_status_check
  `.execute(database);

  await sql`
    update patient_portal_identities
    set status = 'suspended', updated_at = now()
    where status = 'pending_verification'
  `.execute(database);

  await sql`
    alter table patient_portal_identities
      add constraint patient_portal_identities_status_check
        check (status in ('active', 'suspended'))
  `.execute(database);

  await sql`
    alter table patient_portal_identities
      drop column provider_sync_error_code,
      drop column provider_sync_completed_at,
      drop column provider_sync_attempted_at,
      drop column provider_sync_status
  `.execute(database);

  await sql`
    alter table patient_portal_identities
      alter column status type varchar(16)
  `.execute(database);
}
