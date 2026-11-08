import { randomBytes } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import BetterSqlite3 from 'better-sqlite3';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../../test-support/test-database.js';
import { createSqliteDriver } from '../sqlite.js';
import { createPostgresDriver } from '../postgres.js';
import type { Database } from '../types.js';

// Chauffe le pool Postgres (connexions déjà ouvertes) pour que les requêtes concurrentes se chevauchent réellement.
async function warmUp(db: Database): Promise<void> {
  await Promise.all(Array.from({ length: 10 }, () => db.getSession('warm-up')));
}

describe('écritures atomiques et dédoublonnage en deux temps', () => {
  let db: Database;
  beforeEach(async () => { db = await createTestDatabase(); });
  afterEach(async () => { await db.close(); });

  // audit 5.3
  it('dix réclamations simultanées du même message : une seule réussit', async () => {
    await warmUp(db);
    const results = await Promise.all(Array.from({ length: 10 }, () => db.claimMessage('+33600000000:wamid.1', 300)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  // audit 5.3
  it('un message terminé ne se réclame plus ; un message bloqué en cours se réclame après le délai', async () => {
    expect(await db.claimMessage('k1', 300)).toBe(true);
    await db.completeMessage('k1');
    expect(await db.claimMessage('k1', 0)).toBe(false);
    expect(await db.claimMessage('k2', 300)).toBe(true);
    expect(await db.claimMessage('k2', 300)).toBe(false);
    expect(await db.claimMessage('k2', 0)).toBe(true); // délai écoulé : reprise
  });

  // audit 5.3
  it('dix reprises simultanées d\'un message bloqué : une seule réussit', async () => {
    expect(await db.claimMessage('k3', 1)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1200)); // le délai de 1 s est écoulé
    await warmUp(db);
    const results = await Promise.all(Array.from({ length: 10 }, () => db.claimMessage('k3', 1)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await db.claimMessage('k3', 1)).toBe(false); // la reprise a rafraîchi l'horloge
  });

  // audit 5.4
  it('saveLead concurrents : aucun champ perdu, aucune erreur d\'unicité', async () => {
    await warmUp(db);
    await Promise.all(['a', 'b', 'c', 'd', 'e'].map((k) => db.saveLead('336', 'acme', 'ventes', { [k]: k })));
    expect(await db.getLeadData('336', 'acme', 'ventes')).toMatchObject({ a: 'a', b: 'b', c: 'c', d: 'd', e: 'e' });
  });

  // audit 5.4
  it('saveLead conserve les valeurs null, fusionne et garde le nom existant', async () => {
    await db.saveLead('336', 'acme', 'ventes', { name: 'Alice', budget: 100 });
    await db.saveLead('336', 'acme', 'ventes', { budget: null, ville: 'Lyon' });
    expect(await db.getLeadData('336', 'acme', 'ventes')).toEqual({ name: 'Alice', budget: null, ville: 'Lyon' });
    const leads = await db.listLeadsByBot('acme', 'ventes', { limit: 10, offset: 0 });
    expect(leads.leads[0]?.name).toBe('Alice');
  });

  // audit 6.5
  it('écritures concurrentes de bot_runtime_state sans erreur', async () => {
    await warmUp(db);
    await Promise.all([
      db.setTransportValidation('acme', 'ventes', null, 'x'),
      db.setLastCrmError('acme', 'ventes', 'y'),
      db.incrementUnserved('acme', 'ventes'),
      db.incrementUnserved('acme', 'ventes'),
    ]);
    expect(await db.getBotRuntimeState('acme', 'ventes')).toMatchObject({ transport_error: 'x', last_crm_error: 'y', unserved_count: 2 });
  });

  // audit 5.5
  it('le compteur de messages non servis est par agent IA et horodaté', async () => {
    await db.incrementUnserved('acme', 'ventes');
    await db.incrementUnserved('acme', 'support');
    const ventes = await db.getBotRuntimeState('acme', 'ventes');
    expect(ventes?.unserved_count).toBe(1);
    expect(ventes?.unserved_last_at).toEqual(expect.any(String));
    expect((await db.getBotRuntimeState('acme', 'support'))?.unserved_count).toBe(1);
    expect(await db.getBotRuntimeState('autre', 'ventes')).toBeUndefined();
  });

  // audit 6.5
  it('upsertCredential concurrents : pas d\'erreur d\'unicité', async () => {
    const cred = { client_id: 'acme', bot_id: null, service: 'crm', provider: 'hubspot', mode: 'byo' as const, secret_encrypted: 's', key_version: 1 };
    await warmUp(db);
    await Promise.all(Array.from({ length: 5 }, () => db.upsertCredential(cred)));
    expect(await db.listCredentials('acme')).toHaveLength(1);
  });

  // audit 6.5
  it('upsertBotRecord concurrents : pas d\'erreur d\'unicité, dernière valeur conservée', async () => {
    const bot = {
      client_id: 'acme', bot_id: 'ventes', name: 'Ventes', transport: 'meta', status: 'draft', default_language: 'fr',
      languages: ['fr'], system_prompt: { fr: 'p' }, lead_fields: '', welcome: { enabled: false, message: {} },
      error_messages: {}, catalog: null, llm: null, crm: null, personality: null, entity_id: null,
    };
    await warmUp(db);
    await Promise.all(Array.from({ length: 5 }, () => db.upsertBotRecord(bot)));
    await db.upsertBotRecord({ ...bot, name: 'Ventes 2' });
    const bots = (await db.listBotRecords()).filter((b) => b.client_id === 'acme');
    expect(bots).toHaveLength(1);
    expect(bots[0]?.name).toBe('Ventes 2');
  });
});

// audit 5.3, 5.5
describe('migration des colonnes state et compteur (SQLite)', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('une base à l\'ancien schéma s\'ouvre, migre, et se rouvre sans erreur', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wab-state-'));
    const file = path.join(dir, 'legacy.db');
    const raw = new BetterSqlite3(file);
    raw.exec(`
      CREATE TABLE processed_messages (message_id TEXT PRIMARY KEY, created_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE bot_runtime_state (
        client_id TEXT NOT NULL, bot_id TEXT NOT NULL,
        transport_validated_at TEXT, transport_error TEXT, last_crm_error TEXT, last_crm_error_at TEXT,
        updated_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (client_id, bot_id)
      );
    `);
    raw.prepare('INSERT INTO processed_messages (message_id) VALUES (?)').run('ancien');
    raw.prepare('INSERT INTO bot_runtime_state (client_id, bot_id, transport_error) VALUES (?, ?, ?)').run('acme', 'ventes', 'e');
    raw.close();

    const first = createSqliteDriver(file);
    expect(await first.claimMessage('ancien', 0)).toBe(false); // ligne existante = done
    expect(await first.getBotRuntimeState('acme', 'ventes')).toMatchObject({ transport_error: 'e', unserved_count: 0, unserved_last_at: null });
    await first.incrementUnserved('acme', 'ventes');
    await first.close();

    const second = createSqliteDriver(file);
    expect(await second.getBotRuntimeState('acme', 'ventes')).toMatchObject({ unserved_count: 1 });
    await second.close();
  });
});

const baseUrl = process.env['TEST_DATABASE_URL'];

describe.skipIf(!baseUrl)('migration des colonnes state et compteur (Postgres)', () => {
  it('une base à l\'ancien schéma s\'ouvre, migre, et se rouvre sans erreur', async () => {
    const name = `wab_test_${randomBytes(4).toString('hex')}`;
    const admin = new pg.Client({ connectionString: baseUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(baseUrl!);
    url.pathname = `/${name}`;
    const dbUrl = url.toString();
    try {
      const raw = new pg.Client({ connectionString: dbUrl });
      await raw.connect();
      await raw.query(`
        CREATE TABLE processed_messages (message_id TEXT PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT NOW());
        CREATE TABLE bot_runtime_state (
          client_id TEXT NOT NULL, bot_id TEXT NOT NULL,
          transport_validated_at TIMESTAMPTZ, transport_error TEXT, last_crm_error TEXT, last_crm_error_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (client_id, bot_id)
        );
        INSERT INTO processed_messages (message_id) VALUES ('ancien');
        INSERT INTO bot_runtime_state (client_id, bot_id, transport_error) VALUES ('acme', 'ventes', 'e');
      `);
      await raw.end();

      const first = await createPostgresDriver(dbUrl);
      expect(await first.claimMessage('ancien', 0)).toBe(false);
      expect(await first.getBotRuntimeState('acme', 'ventes')).toMatchObject({ transport_error: 'e', unserved_count: 0, unserved_last_at: null });
      await first.incrementUnserved('acme', 'ventes');
      await first.close();

      const second = await createPostgresDriver(dbUrl);
      expect(await second.getBotRuntimeState('acme', 'ventes')).toMatchObject({ unserved_count: 1 });
      await second.close();
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    }
  });
});
