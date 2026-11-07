import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

import { CONFIG, type Config } from '../config';

@Injectable()
export class Database implements OnApplicationShutdown {
  private readonly logger = new Logger(Database.name);
  readonly pool: Pool;

  constructor(@Inject(CONFIG) config: Config) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      // Every in-flight message holds at most one connection; +2 for HTTP reads.
      max: config.prefetch + 2,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 10_000,
      lock_timeout: 5_000,
    });
    this.pool.on('error', (error) => this.logger.warn(`Idle connection failed: ${error.message}`));
  }

  async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {
        broken = true; // never return a session in an unknown state to the pool
      });
      throw error;
    } finally {
      client.release(broken);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
