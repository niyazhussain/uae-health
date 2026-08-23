import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kysely, sql } from 'kysely';
import { createDatabaseClient } from './create-database-client.js';
import type { DatabaseSchema } from './database.types.js';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  readonly client: Kysely<DatabaseSchema>;

  constructor(config: ConfigService) {
    this.client = createDatabaseClient<DatabaseSchema>({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
      maxConnections: config.getOrThrow<number>('DATABASE_MAX_CONNECTIONS'),
      ssl: config.getOrThrow<string>('DATABASE_SSL') === 'true',
    });
  }

  async isReady(): Promise<void> {
    await sql`select 1`.execute(this.client);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.destroy();
  }
}
