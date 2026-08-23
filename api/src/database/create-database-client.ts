import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

export interface DatabaseClientOptions {
  connectionString: string;
  maxConnections: number;
  ssl: boolean;
}

export function createDatabaseClient<TDatabase>({
  connectionString,
  maxConnections,
  ssl,
}: DatabaseClientOptions): Kysely<TDatabase> {
  return new Kysely<TDatabase>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString,
        max: maxConnections,
        application_name: 'uae-health-api',
        ssl: ssl ? { rejectUnauthorized: true } : undefined,
      }),
    }),
  });
}
