import { randomBytes } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import BetterSqlite3 from 'better-sqlite3';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../sqlite.js';
import { createPostgresDriver } from '../postgres.js';
import { testEngine } from '../../../test-support/test-database.js';
import { PROCESSED_MESSAGES_RETENTION_HOURS } from '../types.js';
import type { Database } from '../types.js';

const baseUrl = process.env['TEST_DATABASE_URL'];

interface AgeableDb {
  db: Database;
  /** Fixe l'ancienneté d'une clé de dédoublonnage, en heures. */
  age(key: string, hours: number): Promise<void>;
  close(): Promise<void>;
}

async function openAgeable(): Promise<AgeableDb> {
  if (testEngine() === 'postgres') {
    const name = `wab_test_${randomBytes(4).toString('hex')}`;
    const admin = new pg.Client({ connectionString: baseUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(baseUrl!);
    url.pathname = `/${name}`;
    const dbUrl = url.toString();
    const db = await createPostgresDriver(dbUrl);
    const raw = new pg.Client({ connectionString: dbUrl });
    await raw.connect();
    return {
      db,
      async age(key, hours) {
        await raw.query(`UPDATE processed_messages SET created_at = NOW() - INTERVAL '1 hour' * $2 WHERE message_id = $1`, [key, hours]);
      },
      async close() {
        await raw.end();
        await db.close();
        await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
        await admin.end();
      },
    };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wab-retention-'));
  const file = path.join(dir, 'retention.db');
  const db = createSqliteDriver(file);
  const raw = new BetterSqlite3(file);
  return {
    db,
    async age(key, hours) {
      // Même format que claimMessage (milliseconde), comparable lexicalement à la limite du nettoyage.
      raw.prepare(`UPDATE processed_messages SET created_at = strftime('%Y-%m-%d %H:%M:%f', 'now', '-' || ? || ' hours') WHERE message_id = ?`).run(hours, key);
    },
    async close() {
      raw.close();
      await db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe('rétention des clés de dédoublonnage', () => {
  let ctx: AgeableDb;
  beforeEach(async () => { ctx = await openAgeable(); });
  afterEach(async () => { await ctx.close(); });

  it('cleanupProcessedMessages supprime au-delà de PROCESSED_MESSAGES_RETENTION_HOURS et garde en deçà', async () => {
    const { db } = ctx;
    for (const key of ['juste-avant', 'juste-apres', 'recent']) {
      expect(await db.claimMessage(key, 300)).toBe(true);
      await db.completeMessage(key);
    }
    await ctx.age('juste-avant', PROCESSED_MESSAGES_RETENTION_HOURS - 1);
    await ctx.age('juste-apres', PROCESSED_MESSAGES_RETENTION_HOURS + 1);
    await ctx.age('recent', 1);

    await db.cleanupProcessedMessages();

    expect(await db.claimMessage('juste-avant', 0)).toBe(false); // conservée
    expect(await db.claimMessage('recent', 0)).toBe(false); // conservée
    expect(await db.claimMessage('juste-apres', 0)).toBe(true); // purgée, donc à nouveau réservable
  });
});
