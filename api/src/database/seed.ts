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

  try {
    const facility = await database
      .insertInto('facilities')
      .values({
        code: 'DEMO-DXB',
        name: 'Synthetic Care Centre',
        timezone: 'Asia/Dubai',
        is_synthetic: true,
      })
      .onConflict((conflict) =>
        conflict.column('code').doUpdateSet({
          name: 'Synthetic Care Centre',
          timezone: 'Asia/Dubai',
          is_synthetic: true,
          updated_at: new Date(),
        }),
      )
      .returning(['id', 'code'])
      .executeTakeFirstOrThrow();

    console.info(`Seeded ${facility.code} (${facility.id}).`);
  } finally {
    await database.destroy();
  }
}

void seed().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Seed failed.');
  process.exitCode = 1;
});
