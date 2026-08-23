import { promises as fileSystem } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import { createDatabaseClient } from './create-database-client.js';
import type { DatabaseSchema } from './database.types.js';
import { loadScriptEnvironment } from './load-script-environment.js';

async function migrate(): Promise<void> {
  loadScriptEnvironment();

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run migrations.');
  }

  const database = createDatabaseClient<DatabaseSchema>({
    connectionString: databaseUrl,
    maxConnections: 1,
    ssl: process.env.DATABASE_SSL === 'true',
  });

  try {
    const migrator = new Migrator({
      db: database,
      provider: new FileMigrationProvider({
        fs: fileSystem,
        path,
        migrationFolder: path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          'migrations',
        ),
      }),
    });
    const direction = process.argv[2] ?? 'up';
    const result =
      direction === 'down'
        ? await migrator.migrateDown()
        : await migrator.migrateToLatest();

    for (const migration of result.results ?? []) {
      console.info(
        `${migration.status}: ${migration.migrationName} (${migration.direction})`,
      );
    }

    if (result.error) {
      throw result.error instanceof Error
        ? result.error
        : new Error('Migration failed.', { cause: result.error });
    }
  } finally {
    await database.destroy();
  }
}

void migrate().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Migration failed.');
  process.exitCode = 1;
});
