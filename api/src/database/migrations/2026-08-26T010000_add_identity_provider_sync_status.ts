import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../database.types.js';

export async function up(database: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    alter table user_identities
      add column provider_sync_status varchar(16) not null default 'synchronized',
      add column provider_sync_attempted_at timestamptz,
      add column provider_sync_completed_at timestamptz,
      add column provider_sync_error_code varchar(80),
      add constraint user_identities_provider_sync_status_check
        check (provider_sync_status in ('pending', 'synchronized', 'failed'))
  `.execute(database);
}

export async function down(database: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    alter table user_identities
      drop constraint user_identities_provider_sync_status_check,
      drop column provider_sync_error_code,
      drop column provider_sync_completed_at,
      drop column provider_sync_attempted_at,
      drop column provider_sync_status
  `.execute(database);
}
