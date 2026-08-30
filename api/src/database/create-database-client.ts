import { Kysely, PostgresDialect } from 'kysely';
import { Pool, TypeOverrides } from 'pg';

const DATE_OID = 1082;
const TIMESTAMP_WITHOUT_TIME_ZONE_OID = 1114;

function createTypeOverrides(): TypeOverrides {
  const overrides = new TypeOverrides();

  // Scheduling calendar dates and local timestamps have no offset by design.
  // Returning their wire values avoids silently interpreting either through
  // the API host timezone.
  overrides.setTypeParser(DATE_OID, (value: string): string => value);
  overrides.setTypeParser(
    TIMESTAMP_WITHOUT_TIME_ZONE_OID,
    (value: string): string => value,
  );

  return overrides;
}

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
        types: createTypeOverrides(),
      }),
    }),
  });
}
