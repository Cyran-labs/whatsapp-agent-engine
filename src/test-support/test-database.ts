import { randomBytes } from 'crypto';
import pg from 'pg';
import { createSqliteDriver } from '../core/database/sqlite.js';
import { createPostgresDriver } from '../core/database/postgres.js';
import type { Database } from '../core/database/types.js';

export type TestEngine = 'sqlite' | 'postgres';

/** Moteur de base utilisé par les tests : Postgres si TEST_DATABASE_URL est défini, SQLite sinon. */
export function testEngine(): TestEngine {
  return process.env['TEST_DATABASE_URL'] ? 'postgres' : 'sqlite';
}

function withDatabaseName(baseUrl: string, name: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

/**
 * Base vide et isolée pour un test.
 * SQLite en mémoire par défaut. Avec TEST_DATABASE_URL, crée une base Postgres neuve
 * `wab_test_<8 hex>` sur ce serveur ; son close() ferme le pool puis supprime la base.
 */
export async function createTestDatabase(): Promise<Database> {
  const baseUrl = process.env['TEST_DATABASE_URL'];
  if (!baseUrl) return createSqliteDriver(':memory:');

  const name = `wab_test_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }

  const driver = await createPostgresDriver(withDatabaseName(baseUrl, name));
  let closed = false;
  return {
    ...driver,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await driver.close();
      const cleaner = new pg.Client({ connectionString: baseUrl });
      await cleaner.connect();
      try {
        await cleaner.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await cleaner.end();
      }
    },
  };
}
