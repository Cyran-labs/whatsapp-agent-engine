import { randomBytes } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import BetterSqlite3 from 'better-sqlite3';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { createSqliteDriver } from '../sqlite.js';
import { createPostgresDriver } from '../postgres.js';
import type { Database } from '../types.js';

// Point d'attention 5 du plan 2b-2 : démarrage sur une copie de base existante (ancien schéma, numéros en texte
// libre et identifiants de transport par agent IA). Rien n'est déployé : la migration supprime bot_numbers, les
// identifiants `transport`, les colonnes de transport ; elle repasse les agents IA en brouillon et garde
// conversations, leads et identifiants `crm`. Un second démarrage ne change rien et ne journalise aucune suppression.

const CONTACT = '+33600000001';

/** Ancien schéma (avant le lot 2b-2), dialecte SQLite. */
const LEGACY_SQLITE = `
  CREATE TABLE clients (client_id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE conversations (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT NOT NULL, client_id TEXT NOT NULL,
    bot_id TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('user', 'assistant')), content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE leads (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT NOT NULL, client_id TEXT NOT NULL, bot_id TEXT NOT NULL,
    name TEXT, qualified_data TEXT, rdv_requested INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE tenant_credentials (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, bot_id TEXT,
    service TEXT NOT NULL, provider TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'byo', secret_encrypted TEXT NOT NULL,
    key_version INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  CREATE UNIQUE INDEX uniq_tenant_credentials ON tenant_credentials(client_id, COALESCE(bot_id, ''), service, provider);
  CREATE TABLE bots (client_id TEXT NOT NULL, bot_id TEXT NOT NULL, name TEXT NOT NULL, transport TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft', default_language TEXT NOT NULL DEFAULT 'fr', languages TEXT NOT NULL DEFAULT '["fr"]',
    system_prompt TEXT NOT NULL DEFAULT '{}', lead_fields TEXT NOT NULL DEFAULT '',
    welcome TEXT NOT NULL DEFAULT '{"enabled":false,"message":{}}', error_messages TEXT NOT NULL DEFAULT '{}',
    catalog TEXT, llm TEXT, crm TEXT, personality TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (client_id, bot_id));
  CREATE TABLE bot_numbers (whatsapp_number TEXT PRIMARY KEY, client_id TEXT NOT NULL, bot_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')));
  CREATE INDEX idx_bot_numbers_bot ON bot_numbers(client_id, bot_id);
  CREATE TABLE bot_runtime_state (client_id TEXT NOT NULL, bot_id TEXT NOT NULL, transport_validated_at TEXT, transport_error TEXT,
    last_crm_error TEXT, last_crm_error_at TEXT, updated_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (client_id, bot_id));
`;

/** Ancien schéma (avant le lot 2b-2), dialecte Postgres. */
const LEGACY_POSTGRES = `
  CREATE TABLE clients (client_id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE conversations (id SERIAL PRIMARY KEY, phone TEXT NOT NULL, client_id TEXT NOT NULL, bot_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')), content TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE leads (id SERIAL PRIMARY KEY, phone TEXT NOT NULL, client_id TEXT NOT NULL, bot_id TEXT NOT NULL, name TEXT,
    qualified_data JSONB, rdv_requested INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (phone, client_id, bot_id));
  CREATE TABLE tenant_credentials (id SERIAL PRIMARY KEY, client_id TEXT NOT NULL, bot_id TEXT, service TEXT NOT NULL,
    provider TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'byo', secret_encrypted TEXT NOT NULL, key_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE UNIQUE INDEX uniq_tenant_credentials ON tenant_credentials(client_id, COALESCE(bot_id, ''), service, provider);
  CREATE TABLE bots (client_id TEXT NOT NULL, bot_id TEXT NOT NULL, name TEXT NOT NULL, transport TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft', default_language TEXT NOT NULL DEFAULT 'fr', languages JSONB NOT NULL DEFAULT '["fr"]',
    system_prompt JSONB NOT NULL DEFAULT '{}', lead_fields TEXT NOT NULL DEFAULT '',
    welcome JSONB NOT NULL DEFAULT '{"enabled":false,"message":{}}', error_messages JSONB NOT NULL DEFAULT '{}',
    catalog JSONB, llm JSONB, crm JSONB, personality JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (client_id, bot_id));
  CREATE TABLE bot_numbers (whatsapp_number TEXT PRIMARY KEY, client_id TEXT NOT NULL, bot_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW());
  CREATE INDEX idx_bot_numbers_bot ON bot_numbers(client_id, bot_id);
  CREATE TABLE bot_runtime_state (client_id TEXT NOT NULL, bot_id TEXT NOT NULL, transport_validated_at TIMESTAMPTZ,
    transport_error TEXT, last_crm_error TEXT, last_crm_error_at TIMESTAMPTZ, updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (client_id, bot_id));
`;

/** Données à l'ancien format, écrites en SQL portable (paramètres `?`). */
const SEED: Array<[string, unknown[]]> = [
  ["INSERT INTO clients (client_id, name) VALUES (?, ?)", ['acme', 'Acme']],
  ["INSERT INTO bots (client_id, bot_id, name, transport, status) VALUES (?, ?, ?, ?, ?)", ['acme', 'ventes', 'Ventes', 'meta-cloud', 'active']],
  ["INSERT INTO bots (client_id, bot_id, name, transport, status) VALUES (?, ?, ?, ?, ?)", ['acme', 'support', 'Support', 'cm-com', 'paused']],
  ["INSERT INTO bots (client_id, bot_id, name, transport, status) VALUES (?, ?, ?, ?, ?)", ['acme', 'brouillon', 'Brouillon', 'meta-cloud', 'draft']],
  ['INSERT INTO bot_numbers (whatsapp_number, client_id, bot_id) VALUES (?, ?, ?)', ['+33611111111', 'acme', 'ventes']],
  ['INSERT INTO bot_numbers (whatsapp_number, client_id, bot_id) VALUES (?, ?, ?)', ['33622222222', 'acme', 'ventes']],
  ['INSERT INTO tenant_credentials (client_id, bot_id, service, provider, secret_encrypted) VALUES (?, ?, ?, ?, ?)', ['acme', 'ventes', 'transport', 'meta-cloud', 'enc-transport']],
  ['INSERT INTO tenant_credentials (client_id, bot_id, service, provider, secret_encrypted) VALUES (?, ?, ?, ?, ?)', ['acme', 'ventes', 'crm', 'hubspot', 'enc-crm']],
  ['INSERT INTO tenant_credentials (client_id, bot_id, service, provider, secret_encrypted) VALUES (?, ?, ?, ?, ?)', ['acme', null, 'llm', 'anthropic', 'enc-llm']],
  ['INSERT INTO conversations (phone, client_id, bot_id, role, content) VALUES (?, ?, ?, ?, ?)', [CONTACT, 'acme', 'ventes', 'user', 'Bonjour']],
  ['INSERT INTO conversations (phone, client_id, bot_id, role, content) VALUES (?, ?, ?, ?, ?)', [CONTACT, 'acme', 'ventes', 'assistant', 'Bienvenue']],
  ['INSERT INTO leads (phone, client_id, bot_id, name, qualified_data) VALUES (?, ?, ?, ?, ?)', [CONTACT, 'acme', 'ventes', 'Alice', '{"prenom":"Alice"}']],
  ['INSERT INTO bot_runtime_state (client_id, bot_id, transport_validated_at, transport_error, last_crm_error) VALUES (?, ?, ?, ?, ?)', ['acme', 'ventes', '2026-11-01T10:00:00.000Z', null, 'crm-ko']],
];

const MIGRATION_LOGS = [
  '[DB] Migration des comptes WhatsApp : table bot_numbers supprimée (2 numéro(s) en texte libre)',
  '[DB] Migration des comptes WhatsApp : 1 identifiant(s) de transport par agent IA supprimé(s)',
  '[DB] Migration des comptes WhatsApp : 2 agent(s) IA repassé(s) en brouillon',
  '[DB] Migration des comptes WhatsApp : colonne bots.transport supprimée (3 agent(s) IA)',
  "[DB] Migration des comptes WhatsApp : colonnes transport_validated_at et transport_error supprimées (1 état(s) d'exécution)",
];

interface Engine {
  /** Ouvre le pilote sur la base. */
  open(): Promise<Database>;
  /** Noms de colonnes d'une table, ou [] si la table n'existe pas. */
  columns(table: string): Promise<string[]>;
  run(sql: string, params: unknown[]): Promise<void>;
  cleanup(): Promise<void>;
}

function sqliteEngine(): Engine {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wab-legacy-transport-'));
  const file = path.join(dir, 'legacy.db');
  const raw = new BetterSqlite3(file);
  raw.exec(LEGACY_SQLITE);
  for (const [sql, params] of SEED) raw.prepare(sql).run(...params);
  raw.close();
  const withRaw = <T>(fn: (r: BetterSqlite3.Database) => T): T => {
    const r = new BetterSqlite3(file);
    try { return fn(r); } finally { r.close(); }
  };
  return {
    async open() { return createSqliteDriver(file); },
    async columns(table) {
      return withRaw((r) => (r.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
    },
    async run(sql, params) { withRaw((r) => r.prepare(sql).run(...params)); },
    async cleanup() { fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function postgresEngine(baseUrl: string): Promise<Engine> {
  const name = `wab_test_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  const dbUrl = url.toString();
  const withRaw = async <T>(fn: (c: pg.Client) => Promise<T>): Promise<T> => {
    const c = new pg.Client({ connectionString: dbUrl });
    await c.connect();
    try { return await fn(c); } finally { await c.end(); }
  };
  await withRaw(async (c) => {
    await c.query(LEGACY_POSTGRES);
    for (const [sql, params] of SEED) await c.query(toPg(sql), params);
  });
  return {
    async open() { return createPostgresDriver(dbUrl); },
    async columns(table) {
      return withRaw(async (c) => (await c.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`, [table],
      )).rows.map((r: { column_name: string }) => r.column_name));
    },
    async run(sql, params) { await withRaw(async (c) => { await c.query(toPg(sql), params); }); },
    async cleanup() {
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

const baseUrl = process.env['TEST_DATABASE_URL'];
const engines: Array<[string, () => Promise<Engine>, boolean]> = [
  ['SQLite, fichier temporaire', async () => sqliteEngine(), false],
  ['Postgres, base créée par SQL brut', () => postgresEngine(baseUrl!), !baseUrl],
];

for (const [label, make, skip] of engines) {
  describe.skipIf(skip)(`migration du transport par agent IA (${label})`, () => {
    let engine: Engine;
    let log: MockInstance<typeof console.log>;

    beforeEach(async () => {
      engine = await make();
      log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });
    afterEach(async () => {
      log.mockRestore();
      await engine.cleanup();
    });

    const migrationLogs = (): string[] => log.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.startsWith('[DB]') && /supprim|brouillon/.test(m));

    it('supprime bot_numbers, la colonne transport et les identifiants transport ; garde conversations, lead et crm ; second démarrage sans effet', async () => {
      const first = await engine.open();
      try {
        expect(migrationLogs()).toEqual(MIGRATION_LOGS);
        expect(await engine.columns('bot_numbers')).toEqual([]);
        expect(await engine.columns('bots')).not.toContain('transport');
        const runtimeCols = await engine.columns('bot_runtime_state');
        expect(runtimeCols).not.toContain('transport_validated_at');
        expect(runtimeCols).not.toContain('transport_error');
        expect(runtimeCols).toContain('last_crm_error');

        for (const botId of ['ventes', 'support', 'brouillon']) {
          expect(await first.getBotRecord('acme', botId)).toMatchObject({ status: 'draft', status_reason: null });
        }
        expect((await first.listCredentials('acme')).map((c) => [c.bot_id, c.service, c.provider, c.secret_encrypted]).sort()).toEqual([
          [null, 'llm', 'anthropic', 'enc-llm'],
          ['ventes', 'crm', 'hubspot', 'enc-crm'],
        ]);
        // Même horodatage pour les deux messages : l'ordre n'est pas comparé.
        expect((await first.getConversation(CONTACT, 'acme', 'ventes')).map((m) => `${m.role}:${m.content}`).sort()).toEqual([
          'assistant:Bienvenue', 'user:Bonjour',
        ]);
        expect(await first.getLeadData(CONTACT, 'acme', 'ventes')).toMatchObject({ prenom: 'Alice' });
        expect(await first.getBotRuntimeState('acme', 'ventes')).toMatchObject({ last_crm_error: 'crm-ko' });
      } finally {
        await first.close();
      }

      // Agent IA activé après la migration : un second démarrage ne le repasse pas en brouillon.
      await engine.run("UPDATE bots SET status = 'active' WHERE client_id = ? AND bot_id = ?", ['acme', 'ventes']);
      log.mockClear();

      const second = await engine.open();
      try {
        expect(migrationLogs()).toEqual([]);
        expect((await second.getBotRecord('acme', 'ventes'))?.status).toBe('active');
        expect((await second.getBotRecord('acme', 'support'))?.status).toBe('draft');
        expect(await second.listCredentials('acme')).toHaveLength(2);
        expect(await second.getConversation(CONTACT, 'acme', 'ventes')).toHaveLength(2);
        expect(await second.getLeadData(CONTACT, 'acme', 'ventes')).toMatchObject({ prenom: 'Alice' });
      } finally {
        await second.close();
      }
    });
  });
}
