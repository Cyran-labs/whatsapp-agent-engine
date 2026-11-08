import { randomBytes } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import BetterSqlite3 from 'better-sqlite3';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteDriver } from '../sqlite.js';
import { createPostgresDriver } from '../postgres.js';
import { createTestDatabase, testEngine } from '../../../test-support/test-database.js';
import type { Database } from '../types.js';

const baseUrl = process.env['TEST_DATABASE_URL'];

describe('sessions clées par (numéro destinataire, contact)', () => {
  let db: Database;
  beforeEach(async () => { db = await createTestDatabase(); });
  afterEach(async () => { await db.close(); });

  // audit 1.1
  it('un même contact a une session distincte par numéro destinataire', async () => {
    expect(await db.createSessionIfAbsent('+33100000001', '33600000001', 'acme', 'ventes')).toBe(true);
    expect(await db.createSessionIfAbsent('+33100000002', '33600000001', 'beta', 'accueil')).toBe(true);
    expect((await db.getSession('+33100000001', '33600000001'))?.client_id).toBe('acme');
    expect((await db.getSession('+33100000002', '33600000001'))?.client_id).toBe('beta');
  });

  // audit 1.1
  it('getSession renvoie le numéro destinataire, le contact, l\'organisation et l\'agent IA', async () => {
    await db.createSessionIfAbsent('+33100000001', '33600000001', 'acme', 'ventes');
    expect(await db.getSession('+33100000001', '33600000001')).toMatchObject({
      wa_number: '+33100000001', phone: '33600000001', client_id: 'acme', bot_id: 'ventes',
    });
    expect(await db.getSession('+33100000001', 'autre')).toBeUndefined();
    expect(await db.getSession('+33100000009', '33600000001')).toBeUndefined();
  });

  // audit 1.1
  it('une session existante n\'est jamais réassignée par une seconde création', async () => {
    expect(await db.createSessionIfAbsent('+33100000001', 'c', 'acme', 'ventes')).toBe(true);
    expect(await db.createSessionIfAbsent('+33100000001', 'c', 'beta', 'accueil')).toBe(false);
    expect(await db.getSession('+33100000001', 'c')).toMatchObject({ client_id: 'acme', bot_id: 'ventes' });
  });

  // audit 1.1
  it('création concurrente : une seule renvoie true', async () => {
    const r = await Promise.all(Array.from({ length: 5 }, () => db.createSessionIfAbsent('+331', 'c', 'acme', 'ventes')));
    expect(r.filter(Boolean)).toHaveLength(1);
  });

  it('touchSession sur une session absente ne crée rien et ne lève pas', async () => {
    await expect(db.touchSession('+33100000001', 'inconnu')).resolves.toBeUndefined();
    expect(await db.getSession('+33100000001', 'inconnu')).toBeUndefined();
  });
});

/**
 * Base avec un accès brut pour vieillir une session : fichier SQLite + better-sqlite3,
 * ou base Postgres dédiée + client pg (même principe que les tests de migration).
 */
interface AgeableDb {
  db: Database;
  age(waNumber: string, phone: string, days: number): Promise<void>;
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
      async age(waNumber, phone, days) {
        await raw.query(
          `UPDATE sessions SET updated_at = NOW() - INTERVAL '1 day' * $3 WHERE wa_number = $1 AND phone = $2`,
          [waNumber, phone, days]
        );
      },
      async close() {
        await raw.end();
        await db.close();
        await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
        await admin.end();
      },
    };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wab-sessions-'));
  const file = path.join(dir, 'sessions.db');
  const db = createSqliteDriver(file);
  const raw = new BetterSqlite3(file);
  return {
    db,
    async age(waNumber, phone, days) {
      raw.prepare(`UPDATE sessions SET updated_at = datetime('now', '-' || ? || ' days') WHERE wa_number = ? AND phone = ?`).run(days, waNumber, phone);
    },
    async close() {
      raw.close();
      await db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe('purge des sessions inactives', () => {
  let ctx: AgeableDb;
  beforeEach(async () => { ctx = await openAgeable(); });
  afterEach(async () => { await ctx.close(); });

  // audit 6.6
  it('purgeInactiveSessions supprime les sessions sans activité depuis N jours et elles seules', async () => {
    const { db } = ctx;
    await db.createSessionIfAbsent('+33100000001', 'ancien', 'acme', 'ventes');
    await db.createSessionIfAbsent('+33100000001', 'recent', 'acme', 'ventes');
    await db.createSessionIfAbsent('+33100000002', 'ancien', 'beta', 'accueil');
    await ctx.age('+33100000001', 'ancien', 31);
    await ctx.age('+33100000002', 'ancien', 45);
    await ctx.age('+33100000001', 'recent', 29);

    expect(await db.purgeInactiveSessions(30)).toBe(2);
    expect(await db.getSession('+33100000001', 'ancien')).toBeUndefined();
    expect(await db.getSession('+33100000002', 'ancien')).toBeUndefined();
    expect(await db.getSession('+33100000001', 'recent')).toBeDefined();
    expect(await db.purgeInactiveSessions(30)).toBe(0);
  });

  // audit 6.6
  it('touchSession renouvelle l\'activité : la session touchée échappe à la purge', async () => {
    const { db } = ctx;
    await db.createSessionIfAbsent('+33100000001', 'actif', 'acme', 'ventes');
    await db.createSessionIfAbsent('+33100000001', 'inactif', 'acme', 'ventes');
    await ctx.age('+33100000001', 'actif', 40);
    await ctx.age('+33100000001', 'inactif', 40);
    await db.touchSession('+33100000001', 'actif');

    expect(await db.purgeInactiveSessions(30)).toBe(1);
    expect(await db.getSession('+33100000001', 'actif')).toBeDefined();
    expect(await db.getSession('+33100000001', 'inactif')).toBeUndefined();
  });

  it('un nombre de jours invalide est refusé sans rien supprimer', async () => {
    const { db } = ctx;
    await db.createSessionIfAbsent('+33100000001', 'c', 'acme', 'ventes');
    await expect(db.purgeInactiveSessions(Number.NaN)).rejects.toThrow();
    await expect(db.purgeInactiveSessions(-1)).rejects.toThrow();
    expect(await db.getSession('+33100000001', 'c')).toBeDefined();
  });
});

// audit 1.1 : l'ancien schéma sessions(phone PRIMARY KEY) est remplacé, conversations et leads sont conservés.
const LEGACY_SQLITE = `
  DROP TABLE sessions;
  CREATE TABLE sessions (
    phone TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  INSERT INTO sessions (phone, client_id, bot_id) VALUES ('33600000001', 'acme', 'ventes');
`;

describe('migration des sessions vers (wa_number, phone) (SQLite)', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('supprime les sessions héritées, conserve conversations et leads, et une seconde ouverture ne change rien', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wab-sessions-mig-'));
    const file = path.join(dir, 'legacy.db');
    await createSqliteDriver(file).close();
    const raw = new BetterSqlite3(file);
    raw.exec(LEGACY_SQLITE);
    raw.prepare("INSERT INTO conversations (phone, client_id, bot_id, role, content) VALUES ('33600000001', 'acme', 'ventes', 'user', 'bonjour')").run();
    raw.prepare("INSERT INTO leads (phone, client_id, bot_id, name, qualified_data) VALUES ('33600000001', 'acme', 'ventes', 'Alice', '{\"budget\":\"10k\"}')").run();
    raw.close();

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const first = createSqliteDriver(file);
    expect(log.mock.calls.map((c) => String(c[0]))).toContain('[DB] Sessions migrated to (wa_number, phone), 1 legacy row(s) dropped');
    log.mockClear();
    expect(await first.getSession('+33100000001', '33600000001')).toBeUndefined();
    expect(await first.createSessionIfAbsent('+33100000001', '33600000001', 'acme', 'ventes')).toBe(true);
    expect(await first.getConversation('33600000001', 'acme', 'ventes')).toHaveLength(1);
    expect((await first.getLeadData('33600000001', 'acme', 'ventes'))?.['budget']).toBe('10k');
    await first.close();

    const second = createSqliteDriver(file);
    expect(log.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('Sessions migrated'))).toEqual([]);
    expect(await second.getSession('+33100000001', '33600000001')).toMatchObject({ client_id: 'acme' });
    await second.close();
    log.mockRestore();
  });
});

describe.skipIf(!baseUrl)('migration des sessions vers (wa_number, phone) (Postgres)', () => {
  it('supprime les sessions héritées, conserve conversations et leads, et une seconde ouverture ne change rien', async () => {
    const name = `wab_test_${randomBytes(4).toString('hex')}`;
    const admin = new pg.Client({ connectionString: baseUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(baseUrl!);
    url.pathname = `/${name}`;
    const dbUrl = url.toString();
    try {
      await (await createPostgresDriver(dbUrl)).close();
      const raw = new pg.Client({ connectionString: dbUrl });
      await raw.connect();
      await raw.query(`
        DROP TABLE sessions;
        CREATE TABLE sessions (
          phone TEXT PRIMARY KEY, client_id TEXT NOT NULL, bot_id TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        INSERT INTO sessions (phone, client_id, bot_id) VALUES ('33600000001', 'acme', 'ventes');
        INSERT INTO conversations (phone, client_id, bot_id, role, content) VALUES ('33600000001', 'acme', 'ventes', 'user', 'bonjour');
        INSERT INTO leads (phone, client_id, bot_id, name, qualified_data) VALUES ('33600000001', 'acme', 'ventes', 'Alice', '{"budget":"10k"}');
      `);
      await raw.end();

      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const first = await createPostgresDriver(dbUrl);
      expect(log.mock.calls.map((c) => String(c[0]))).toContain('[DB] Sessions migrated to (wa_number, phone), 1 legacy row(s) dropped');
      log.mockClear();
      expect(await first.getSession('+33100000001', '33600000001')).toBeUndefined();
      expect(await first.createSessionIfAbsent('+33100000001', '33600000001', 'acme', 'ventes')).toBe(true);
      expect(await first.getConversation('33600000001', 'acme', 'ventes')).toHaveLength(1);
      expect((await first.getLeadData('33600000001', 'acme', 'ventes'))?.['budget']).toBe('10k');
      await first.close();

      const second = await createPostgresDriver(dbUrl);
      expect(log.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('Sessions migrated'))).toEqual([]);
      expect(await second.getSession('+33100000001', '33600000001')).toMatchObject({ client_id: 'acme' });
      await second.close();
      log.mockRestore();
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    }
  });
});
