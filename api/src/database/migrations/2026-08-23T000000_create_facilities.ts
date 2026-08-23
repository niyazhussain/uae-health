import { Kysely, sql } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`create extension if not exists pgcrypto`.execute(database);

  await database.schema
    .createTable('facilities')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('code', 'varchar(32)', (column) => column.notNull().unique())
    .addColumn('name', 'varchar(200)', (column) => column.notNull())
    .addColumn('timezone', 'varchar(64)', (column) => column.notNull())
    .addColumn('is_synthetic', 'boolean', (column) =>
      column.notNull().defaultTo(false),
    )
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      'facilities_code_format_check',
      sql`code ~ '^[A-Z0-9][A-Z0-9-]{1,31}$'`,
    )
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('facilities').execute();
}
