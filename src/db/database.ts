import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

import { CONFIG, type Config } from '../config/config';
import { DB_POOL_OPTIONS } from './database.constants';
import { migrationFiles } from './migrate';

@Injectable()
export class Database implements OnApplicationShutdown {
  private readonly logger = new Logger(Database.name);
  readonly pool: Pool;

  constructor(@Inject(CONFIG) config: Config) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      // Config guarantees room for every in-flight message plus HTTP reads.
      max: config.dbPoolSize,
      ...DB_POOL_OPTIONS,
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

  /**
   * True if the database answers and has the latest migration this build ships,
   * so an instance never serves traffic on an older schema.
   */
  async isReady(): Promise<boolean> {
    try {
      const latest = (await migrationFiles()).at(-1);
      const { rowCount } = await this.pool.query(
        'SELECT 1 FROM schema_migrations WHERE name = $1',
        [latest],
      );

      return rowCount === 1;
    } catch {
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
