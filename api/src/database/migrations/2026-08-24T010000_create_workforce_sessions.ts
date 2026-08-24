import { Kysely, sql } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    create table workforce_sessions (
      id uuid primary key default gen_random_uuid(),
      session_token_hash char(64) not null unique,
      csrf_token_hash char(64) not null,
      cognito_subject varchar(500) not null,
      cognito_client_id varchar(128) not null,
      cognito_username varchar(500),
      idle_expires_at timestamptz not null,
      absolute_expires_at timestamptz not null,
      last_seen_at timestamptz not null default now(),
      revoked_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint workforce_sessions_expiry_check
        check (idle_expires_at <= absolute_expires_at),
      constraint workforce_sessions_revocation_check
        check (revoked_at is null or revoked_at >= created_at)
    )
  `.execute(database);

  await sql`
    create index workforce_sessions_active_token_idx
      on workforce_sessions (session_token_hash, idle_expires_at, absolute_expires_at)
      where revoked_at is null
  `.execute(database);

  await sql`
    create index workforce_sessions_subject_active_idx
      on workforce_sessions (cognito_subject, absolute_expires_at)
      where revoked_at is null
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists workforce_sessions`.execute(database);
}
