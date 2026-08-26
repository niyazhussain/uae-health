import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../database.types.js';

export async function up(database: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    create unique index roles_tenant_active_name_unique
      on roles (tenant_id, lower(btrim(name)))
      where tenant_id is not null and status = 'active'
  `.execute(database);
}

export async function down(database: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    drop index if exists roles_tenant_active_name_unique
  `.execute(database);
}
