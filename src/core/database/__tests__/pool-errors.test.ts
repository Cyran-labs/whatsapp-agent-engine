import { randomBytes } from 'crypto';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPostgresDriver } from '../postgres.js';
import { testEngine } from '../../../test-support/test-database.js';
import type { Database } from '../types.js';

const baseUrl = process.env['TEST_DATABASE_URL'];

// Propre à Postgres : SQLite n'a pas de pool de connexions.
describe.skipIf(testEngine() !== 'postgres')('connexion Postgres inactive coupée par le serveur', () => {
  let name: string;
  let admin: pg.Client;
  let killer: pg.Client;
  let db: Database;

  beforeEach(async () => {
    name = `wab_test_${randomBytes(4).toString('hex')}`;
    admin = new pg.Client({ connectionString: baseUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(baseUrl!);
    url.pathname = `/${name}`;
    db = await createPostgresDriver(url.toString());
    killer = new pg.Client({ connectionString: url.toString() });
    await killer.connect();
  });

  afterEach(async () => {
    await killer.end();
    await db.close();
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  });

  it("l'erreur est journalisée sans arrêter le moteur et le pool se rétablit", async () => {
    // Connexion inactive dans le pool.
    await db.getSession('wa', 'phone');

    const uncaught: unknown[] = [];
    const onUncaught = (err: unknown): void => { uncaught.push(err); };
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Retire temporairement les écouteurs de vitest : une exception non gérée est ici le constat à détecter.
    const previous = process.listeners('uncaughtException');
    process.removeAllListeners('uncaughtException');
    process.on('uncaughtException', onUncaught);
    let logged: unknown[][] = [];
    try {
      await killer.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()'
      );
      // Laisse l'événement `error` du pool arriver.
      for (let i = 0; i < 50 && errorLog.mock.calls.length === 0 && uncaught.length === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      logged = [...errorLog.mock.calls];
    } finally {
      process.removeListener('uncaughtException', onUncaught);
      for (const listener of previous) process.on('uncaughtException', listener);
      errorLog.mockRestore();
    }

    expect(uncaught).toEqual([]);
    expect(logged.length).toBeGreaterThan(0);
    const line = String(logged[0]?.[0]);
    expect(line).toMatch(/^\[DB\] /);
    expect(line).not.toContain('postgres://');
    expect(line).not.toContain(name);

    // Le pool recrée une connexion.
    expect(await db.getSession('wa', 'phone')).toBeUndefined();
  });
});
