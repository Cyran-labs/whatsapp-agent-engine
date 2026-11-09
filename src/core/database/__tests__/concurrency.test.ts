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
import type { BotRecord, Database } from '../types.js';

const bot: BotRecord = {
  client_id: 'acme', bot_id: 'ventes', name: 'Ventes', status: 'draft', status_reason: null, default_language: 'fr',
  languages: ['fr'], system_prompt: { fr: 'p' }, lead_fields: '', welcome: { enabled: false, message: {} },
  error_messages: {}, catalog: null, llm: null, crm: null, personality: null, entity_id: null,
};

// Chauffe le pool Postgres (connexions déjà ouvertes) pour que les requêtes concurrentes se chevauchent réellement.
async function warmUp(db: Database): Promise<void> {
  await Promise.all(Array.from({ length: 10 }, () => db.getSession('warm-up', 'warm-up')));
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

  // audit 5.3 : le délai est mesuré à la milliseconde (pas à la seconde entière) sur les deux moteurs
  it('un message réclamé il y a 1,2 s n\'est pas repris avec un délai de 2 s', async () => {
    expect(await db.claimMessage('k4', 2)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(await db.claimMessage('k4', 2)).toBe(false);
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
      db.setLastCrmError('acme', 'ventes', 'y'),
      db.incrementUnserved('acme', 'ventes'),
      db.incrementUnserved('acme', 'ventes'),
      db.incrementUnserved('acme', 'ventes'),
    ]);
    expect(await db.getBotRuntimeState('acme', 'ventes')).toMatchObject({ last_crm_error: 'y', unserved_count: 3 });
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
    await warmUp(db);
    await Promise.all(Array.from({ length: 5 }, () => db.upsertBotRecord(bot)));
    await db.upsertBotRecord({ ...bot, name: 'Ventes 2' });
    const bots = (await db.listBotRecords()).filter((b) => b.client_id === 'acme');
    expect(bots).toHaveLength(1);
    expect(bots[0]?.name).toBe('Ventes 2');
  });

  it("deux remplacements simultanés de la liste d'accès limité : la liste finale est l'une des deux, jamais un mélange", async () => {
    const listA = Array.from({ length: 15 }, (_, i) => `+3361000${String(i).padStart(4, '0')}`);
    const listB = Array.from({ length: 15 }, (_, i) => `+3362000${String(i).padStart(4, '0')}`);
    await db.upsertBotRecord(bot);
    await warmUp(db);
    for (let round = 0; round < 5; round += 1) {
      await Promise.all([db.replaceAllowlist('acme', 'ventes', listA), db.replaceAllowlist('acme', 'ventes', listB)]);
      const final = await db.getAllowlist('acme', 'ventes');
      expect([listA, listB]).toContainEqual(final);
    }
  });

  // Décision PO tâche 8 : une liste orpheline ne naît jamais d'un remplacement concurrent d'une suppression.
  it("remplacement de la liste d'accès limité concurrent d'une suppression de l'agent IA : aucune ligne orpheline", async () => {
    const list = Array.from({ length: 15 }, (_, i) => `+3361000${String(i).padStart(4, '0')}`);
    await warmUp(db);
    for (let round = 0; round < 10; round += 1) {
      await db.upsertBotRecord(bot);
      const [replaced] = await Promise.all([db.replaceAllowlist('acme', 'ventes', list), db.deleteBotRecord('acme', 'ventes')]);
      expect(await db.getBotRecord('acme', 'ventes')).toBeUndefined();
      expect(await db.getAllowlist('acme', 'ventes')).toEqual([]);
      expect([{ ok: true }, { ok: false, reason: 'not_found' }]).toContainEqual(replaced);
    }
  });

  it('ajouts simultanés d\'alertes sur un compte : aucune perdue, 20 plus récentes gardées', async () => {
    const acc = await db.insertWhatsAppAccount({
      client_id: 'acme', name: 'Compte', mode: 'meta_manual', provider_account_id: 'waba-1', waba_id: 'waba-1',
      meta_app_id: 'app-1', secret_encrypted: 'enc', key_version: 1, webhook_key_hash: 'h1', token_expiry: null,
      last_verified_at: null,
    });
    const alert = (code: number) => ({ kind: 'policy_block' as const, code, event: null, at: `2026-11-08T10:00:${String(code).padStart(2, '0')}.000Z` });
    await warmUp(db);

    // 15 ajouts simultanés : sous la limite, les 15 sont là.
    await Promise.all(Array.from({ length: 15 }, (_, i) => db.addWhatsAppAccountAlert(acc.id, alert(i + 1))));
    const first = (await db.getWhatsAppAccount('acme', acc.id))!.alerts.map((a) => a.code).sort((x, y) => (x ?? 0) - (y ?? 0));
    expect(first).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));

    // 25 de plus : 20 gardées, distinctes, toutes parmi les 25 dernières.
    await Promise.all(Array.from({ length: 25 }, (_, i) => db.addWhatsAppAccountAlert(acc.id, alert(i + 16))));
    const codes = (await db.getWhatsAppAccount('acme', acc.id))!.alerts.map((a) => a.code);
    expect(codes).toHaveLength(20);
    expect(new Set(codes).size).toBe(20);
    expect(codes.every((c) => c !== null && c >= 16 && c <= 40)).toBe(true);

    // Un ajout ensuite est le plus récent, la limite tient.
    await db.addWhatsAppAccountAlert(acc.id, alert(41));
    const last = (await db.getWhatsAppAccount('acme', acc.id))!.alerts;
    expect(last).toHaveLength(20);
    expect(last[19]?.code).toBe(41);
  });
});

// audit 5.3, 5.5
describe('migration des colonnes state et compteur (SQLite)', () => {
  it('le nettoyage à 7 jours reste cohérent avec l\'horodatage de réclamation à la milliseconde', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wab-cleanup-'));
    try {
      const file = path.join(d, 'cleanup.db');
      await createSqliteDriver(file).close();
      const raw = new BetterSqlite3(file);
      // Lignes héritées au format 'YYYY-MM-DD HH:MM:SS' : une ancienne (8 jours), une récente.
      raw.prepare(`INSERT INTO processed_messages (message_id, created_at, state) VALUES ('vieux', datetime('now', '-8 days'), 'done')`).run();
      raw.prepare(`INSERT INTO processed_messages (message_id, created_at, state) VALUES ('recent', datetime('now', '-1 days'), 'done')`).run();
      raw.close();
      const sqlite = createSqliteDriver(file);
      expect(await sqlite.claimMessage('neuf', 300)).toBe(true);
      await sqlite.cleanupProcessedMessages();
      expect(await sqlite.claimMessage('vieux', 300)).toBe(true); // supprimé par le nettoyage
      expect(await sqlite.claimMessage('recent', 300)).toBe(false);
      expect(await sqlite.claimMessage('neuf', 300)).toBe(false);
      await sqlite.close();
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

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
    raw.prepare('INSERT INTO bot_runtime_state (client_id, bot_id, transport_error, last_crm_error) VALUES (?, ?, ?, ?)').run('acme', 'ventes', 'e', 'c');
    raw.close();

    const first = createSqliteDriver(file);
    expect(await first.claimMessage('ancien', 0)).toBe(false); // ligne existante = done
    const migrated = await first.getBotRuntimeState('acme', 'ventes');
    expect(migrated).toMatchObject({ last_crm_error: 'c', unserved_count: 0, unserved_last_at: null });
    expect(migrated).not.toHaveProperty('transport_error');
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
    const url = new URL(baseUrl!);
    url.pathname = `/${name}`;
    const dbUrl = url.toString();
    try {
      await admin.query(`CREATE DATABASE ${name}`);
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
        INSERT INTO bot_runtime_state (client_id, bot_id, transport_error, last_crm_error) VALUES ('acme', 'ventes', 'e', 'c');
      `);
      await raw.end();

      const first = await createPostgresDriver(dbUrl);
      expect(await first.claimMessage('ancien', 0)).toBe(false);
      const migrated = await first.getBotRuntimeState('acme', 'ventes');
      expect(migrated).toMatchObject({ last_crm_error: 'c', unserved_count: 0, unserved_last_at: null });
      expect(migrated).not.toHaveProperty('transport_error');
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
