import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Pool } from 'pg';

import { MIGRATION_FILE_EXTENSION, MIGRATIONS_DIRECTORY } from './database.constants';

/** Applies new files from migrations/ in name order, each in its own transaction. */
export async function migrate(pool: Pool, directory = join(process.cwd(), MIGRATIONS_DIRECTORY)) {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const files = (await readdir(directory))
    .filter((name) => name.endsWith(MIGRATION_FILE_EXTENSION))
    .sort();

  for (const name of files) {
    const sql = await readFile(join(directory, name), 'utf8');
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      // Serializes concurrent runners; the second one sees the row and skips.
      await client.query('LOCK TABLE schema_migrations IN EXCLUSIVE MODE');
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);

      if (applied.rowCount === 0) {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
