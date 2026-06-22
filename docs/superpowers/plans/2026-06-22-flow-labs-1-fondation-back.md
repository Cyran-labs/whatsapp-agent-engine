# Flow Labs — Plan 1 : Fondation back (config en DB) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrer la configuration des bots (aujourd'hui fichiers JSON sur disque) vers la base de données derrière une interface `ConfigStore`, avec import one-shot des JSON existants, sans changer le comportement runtime.

**Architecture:** Nouvelles tables `clients`, `bots`, `bot_numbers` (SQLite + Postgres, même patron que `tenant_credentials`/`platform_llm_keys`). Un `ConfigStore` charge tous les bots en cache mémoire au démarrage (`initConfigStore()`) ; les getters runtime (`loadBotConfig`/`findBotByNumber`/`listBots`) restent **synchrones** (lecture du cache chaud) et sont rafraîchis sur écriture admin (`upsertBot`). `bot-config.ts` délègue désormais au `ConfigStore`. Les champs de contenu sont stockés **localisés** (`{ "fr": ... }`) dès maintenant ; le runtime lit `default_language`.

**Tech Stack:** TypeScript strict ESM, Vitest (sqlite in-memory), better-sqlite3, pg.

## Global Constraints

- TypeScript strict : pas de `any`, `const` par défaut. (CLAUDE.md)
- Logs `[Service] message` sans emoji. (CLAUDE.md)
- Author git : `Francois Greze <francois@cyran.fr>`, pas de signature Claude, pas de push. (CLAUDE.md)
- Toutes les méthodes `Database` sont async. SQLite seul testé en CI ; Postgres = mirror mécanique non testé runtime.
- Upsert DB = **UPDATE-then-INSERT** (PAS `ON CONFLICT`), cohérent avec `tenant_credentials`.
- Le **pipeline runtime ne doit pas changer de comportement** : `loadBotConfig`/`findBotByNumber`/`listBots` gardent leur signature **synchrone** et leur sémantique (cache, conflit de numéro = throw).
- Champs de contenu stockés **localisés** (`Localized = Record<string,string>`) ; le runtime aplatit sur `default_language`.
- `whatsapp_number` est **normalisé** (chiffres uniquement) et sert de **PK** dans `bot_numbers` → garantit *1 numéro = 1 bot* au niveau DB.
- Hors périmètre de CE plan : `connector_mappings` (migré au Plan 4, couplé au CRM bot-scope). Les mappings restent sur fichiers JSON ; CRM inchangé.

---

### Task 1 : Types + couche DB SQLite (clients, bots, bot_numbers)

**Files:**
- Modify: `src/core/database/types.ts`
- Modify: `src/core/database/sqlite.ts`
- Test: `src/core/database/__tests__/config-tables.test.ts` (create)

**Interfaces:**
- Consumes: rien.
- Produces :
  ```ts
  export type Localized = Record<string, string>;
  export interface ClientRecord { client_id: string; name: string; status: string; }
  export interface BotRecord {
    client_id: string; bot_id: string; name: string;
    transport: string; status: string;
    default_language: string; languages: string[];
    system_prompt: Localized; lead_fields: string;
    welcome: { enabled: boolean; message: Localized };
    error_messages: Localized;
    catalog: { meta_catalog_id?: string } | null;
    llm: { model?: string; mode?: string } | null;
    crm: { connector: string } | null;
  }
  export interface BotNumberRecord { whatsapp_number: string; client_id: string; bot_id: string; }
  ```
  Méthodes `Database` :
  ```ts
  listClients(): Promise<ClientRecord[]>;
  upsertClient(rec: ClientRecord): Promise<void>;
  getBotRecord(clientId: string, botId: string): Promise<BotRecord | undefined>;
  listBotRecords(): Promise<BotRecord[]>;
  upsertBotRecord(rec: BotRecord): Promise<void>;
  deleteBotRecord(clientId: string, botId: string): Promise<void>;
  listBotNumbers(): Promise<BotNumberRecord[]>;
  setBotNumbers(clientId: string, botId: string, numbers: string[]): Promise<void>;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/core/database/__tests__/config-tables.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../sqlite.js';
import type { Database, BotRecord } from '../types.js';

function bot(over: Partial<BotRecord> = {}): BotRecord {
  return {
    client_id: 'acme', bot_id: 'immo', name: 'Bot Immo',
    transport: 'meta-cloud', status: 'active',
    default_language: 'fr', languages: ['fr', 'en'],
    system_prompt: { fr: 'Tu es...', en: 'You are...' }, lead_fields: 'email, stage',
    welcome: { enabled: true, message: { fr: 'Bonjour', en: 'Hello' } },
    error_messages: { fr: 'Souci technique' },
    catalog: null, llm: { mode: 'platform' }, crm: { connector: 'hubspot' },
    ...over,
  };
}

describe('config tables (sqlite)', () => {
  let db: Database;
  beforeEach(() => { db = createSqliteDriver(':memory:'); });
  afterEach(async () => { await db.close(); });

  it('upsert + get bot roundtrip (JSON localisé préservé)', async () => {
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.upsertBotRecord(bot());
    const got = await db.getBotRecord('acme', 'immo');
    expect(got).toBeDefined();
    expect(got!.system_prompt).toEqual({ fr: 'Tu es...', en: 'You are...' });
    expect(got!.languages).toEqual(['fr', 'en']);
    expect(got!.welcome.message.fr).toBe('Bonjour');
    expect(got!.crm).toEqual({ connector: 'hubspot' });
  });

  it('upsert est idempotent (update, pas de doublon)', async () => {
    await db.upsertBotRecord(bot());
    await db.upsertBotRecord(bot({ name: 'Renommé' }));
    const all = await db.listBotRecords();
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe('Renommé');
  });

  it('setBotNumbers remplace le set et listBotNumbers les renvoie', async () => {
    await db.upsertBotRecord(bot());
    await db.setBotNumbers('acme', 'immo', ['+33 6 11', '+33 6 22']);
    await db.setBotNumbers('acme', 'immo', ['+33 6 33']); // remplace
    const nums = await db.listBotNumbers();
    expect(nums.map((n) => n.whatsapp_number)).toEqual(['33633']); // normalisé
    expect(nums[0]!.bot_id).toBe('immo');
  });

  it('deleteBotRecord supprime le bot et ses numéros', async () => {
    await db.upsertBotRecord(bot());
    await db.setBotNumbers('acme', 'immo', ['+33 6 33']);
    await db.deleteBotRecord('acme', 'immo');
    expect(await db.getBotRecord('acme', 'immo')).toBeUndefined();
    expect(await db.listBotNumbers()).toHaveLength(0);
  });

  it('clients : upsert + list', async () => {
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.upsertClient({ client_id: 'acme', name: 'Acme Corp', status: 'active' });
    const clients = await db.listClients();
    expect(clients).toHaveLength(1);
    expect(clients[0]!.name).toBe('Acme Corp');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/database/__tests__/config-tables.test.ts`
Expected: FAIL — `upsertBotRecord` not a function.

- [ ] **Step 3: Add types**

In `src/core/database/types.ts`, after `PlatformKeyInput` (the platform keys block), add:

```ts
export type Localized = Record<string, string>;

export interface ClientRecord {
  client_id: string;
  name: string;
  status: string;
}

export interface BotRecord {
  client_id: string;
  bot_id: string;
  name: string;
  transport: string;
  status: string;
  default_language: string;
  languages: string[];
  system_prompt: Localized;
  lead_fields: string;
  welcome: { enabled: boolean; message: Localized };
  error_messages: Localized;
  catalog: { meta_catalog_id?: string } | null;
  llm: { model?: string; mode?: string } | null;
  crm: { connector: string } | null;
}

export interface BotNumberRecord {
  whatsapp_number: string;
  client_id: string;
  bot_id: string;
}
```

In the `Database` interface, after the platform keys block, add:

```ts
  // Configuration des bots (migrée depuis les fichiers JSON)
  listClients(): Promise<ClientRecord[]>;
  upsertClient(rec: ClientRecord): Promise<void>;
  getBotRecord(clientId: string, botId: string): Promise<BotRecord | undefined>;
  listBotRecords(): Promise<BotRecord[]>;
  upsertBotRecord(rec: BotRecord): Promise<void>;
  deleteBotRecord(clientId: string, botId: string): Promise<void>;
  listBotNumbers(): Promise<BotNumberRecord[]>;
  setBotNumbers(clientId: string, botId: string, numbers: string[]): Promise<void>;
```

- [ ] **Step 4: SQLite — schéma + helpers**

In `src/core/database/sqlite.ts`, extend the type import (line 5) to add `ClientRecord, BotRecord, BotNumberRecord`:

```ts
import type { Database, Session, SessionRow, HistoryRow, LeadRow, CrossConversationRow, CredentialRecord, PlatformKeyRecord, PlatformKeyInput, ClientRecord, BotRecord, BotNumberRecord } from './types.js';
```

In the `SCHEMA` string, before the closing backtick, add:

```sql

    CREATE TABLE IF NOT EXISTS clients (
      client_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bots (
      client_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      name TEXT NOT NULL,
      transport TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      default_language TEXT NOT NULL DEFAULT 'fr',
      languages TEXT NOT NULL DEFAULT '["fr"]',
      system_prompt TEXT NOT NULL DEFAULT '{}',
      lead_fields TEXT NOT NULL DEFAULT '',
      welcome TEXT NOT NULL DEFAULT '{"enabled":false,"message":{}}',
      error_messages TEXT NOT NULL DEFAULT '{}',
      catalog TEXT,
      llm TEXT,
      crm TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (client_id, bot_id)
    );

    CREATE TABLE IF NOT EXISTS bot_numbers (
      whatsapp_number TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bot_numbers_bot ON bot_numbers(client_id, bot_id);
```

Add a normalization helper near the top of the file (after the imports):

```ts
function normalizePhone(num: string): string {
  return num.replace(/\D/g, '');
}
```

- [ ] **Step 5: SQLite — méthodes**

In the `driver` object (after `upsertPlatformKey`), add:

```ts
    async listClients(): Promise<ClientRecord[]> {
      return db.prepare('SELECT client_id, name, status FROM clients ORDER BY client_id').all() as ClientRecord[];
    },

    async upsertClient(rec: ClientRecord): Promise<void> {
      const upd = db.prepare(
        `UPDATE clients SET name = ?, status = ?, updated_at = datetime('now') WHERE client_id = ?`
      ).run(rec.name, rec.status, rec.client_id);
      if (upd.changes === 0) {
        db.prepare('INSERT INTO clients (client_id, name, status) VALUES (?, ?, ?)').run(rec.client_id, rec.name, rec.status);
      }
    },

    async getBotRecord(clientId: string, botId: string): Promise<BotRecord | undefined> {
      const row = db.prepare(
        `SELECT client_id, bot_id, name, transport, status, default_language, languages,
                system_prompt, lead_fields, welcome, error_messages, catalog, llm, crm
         FROM bots WHERE client_id = ? AND bot_id = ?`
      ).get(clientId, botId) as Record<string, string> | undefined;
      return row ? rowToBotRecord(row) : undefined;
    },

    async listBotRecords(): Promise<BotRecord[]> {
      const rows = db.prepare(
        `SELECT client_id, bot_id, name, transport, status, default_language, languages,
                system_prompt, lead_fields, welcome, error_messages, catalog, llm, crm
         FROM bots ORDER BY client_id, bot_id`
      ).all() as Array<Record<string, string>>;
      return rows.map(rowToBotRecord);
    },

    async upsertBotRecord(rec: BotRecord): Promise<void> {
      const vals = botRecordToCols(rec);
      const upd = db.prepare(
        `UPDATE bots SET name=?, transport=?, status=?, default_language=?, languages=?,
           system_prompt=?, lead_fields=?, welcome=?, error_messages=?, catalog=?, llm=?, crm=?,
           updated_at=datetime('now')
         WHERE client_id=? AND bot_id=?`
      ).run(vals.name, vals.transport, vals.status, vals.default_language, vals.languages,
            vals.system_prompt, vals.lead_fields, vals.welcome, vals.error_messages, vals.catalog, vals.llm, vals.crm,
            rec.client_id, rec.bot_id);
      if (upd.changes === 0) {
        db.prepare(
          `INSERT INTO bots (client_id, bot_id, name, transport, status, default_language, languages,
             system_prompt, lead_fields, welcome, error_messages, catalog, llm, crm)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(rec.client_id, rec.bot_id, vals.name, vals.transport, vals.status, vals.default_language, vals.languages,
              vals.system_prompt, vals.lead_fields, vals.welcome, vals.error_messages, vals.catalog, vals.llm, vals.crm);
      }
    },

    async deleteBotRecord(clientId: string, botId: string): Promise<void> {
      db.prepare('DELETE FROM bot_numbers WHERE client_id = ? AND bot_id = ?').run(clientId, botId);
      db.prepare('DELETE FROM bots WHERE client_id = ? AND bot_id = ?').run(clientId, botId);
    },

    async listBotNumbers(): Promise<BotNumberRecord[]> {
      return db.prepare('SELECT whatsapp_number, client_id, bot_id FROM bot_numbers ORDER BY whatsapp_number').all() as BotNumberRecord[];
    },

    async setBotNumbers(clientId: string, botId: string, numbers: string[]): Promise<void> {
      const tx = db.transaction((nums: string[]) => {
        db.prepare('DELETE FROM bot_numbers WHERE client_id = ? AND bot_id = ?').run(clientId, botId);
        const ins = db.prepare('INSERT INTO bot_numbers (whatsapp_number, client_id, bot_id) VALUES (?, ?, ?)');
        for (const n of nums) {
          const norm = normalizePhone(n);
          if (norm) ins.run(norm, clientId, botId);
        }
      });
      tx(numbers);
    },
```

Add the JSON (de)serialization helpers near `normalizePhone` (module scope):

```ts
function botRecordToCols(rec: BotRecord) {
  return {
    name: rec.name, transport: rec.transport, status: rec.status,
    default_language: rec.default_language,
    languages: JSON.stringify(rec.languages),
    system_prompt: JSON.stringify(rec.system_prompt),
    lead_fields: rec.lead_fields,
    welcome: JSON.stringify(rec.welcome),
    error_messages: JSON.stringify(rec.error_messages),
    catalog: rec.catalog ? JSON.stringify(rec.catalog) : null,
    llm: rec.llm ? JSON.stringify(rec.llm) : null,
    crm: rec.crm ? JSON.stringify(rec.crm) : null,
  };
}

function rowToBotRecord(row: Record<string, unknown>): BotRecord {
  const j = (v: unknown) => (v == null ? null : JSON.parse(String(v)));
  return {
    client_id: String(row.client_id), bot_id: String(row.bot_id), name: String(row.name),
    transport: String(row.transport), status: String(row.status),
    default_language: String(row.default_language),
    languages: j(row.languages) ?? [],
    system_prompt: j(row.system_prompt) ?? {},
    lead_fields: String(row.lead_fields ?? ''),
    welcome: j(row.welcome) ?? { enabled: false, message: {} },
    error_messages: j(row.error_messages) ?? {},
    catalog: j(row.catalog),
    llm: j(row.llm),
    crm: j(row.crm),
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/core/database/__tests__/config-tables.test.ts`
Expected: PASS (5/5).

- [ ] **Step 7: tsc + commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add src/core/database/types.ts src/core/database/sqlite.ts src/core/database/__tests__/config-tables.test.ts
git commit -m "feat(db): tables clients/bots/bot_numbers + accès SQLite (config en DB)"
```

---

### Task 2 : Couche DB Postgres (mirror)

**Files:**
- Modify: `src/core/database/postgres.ts`

**Interfaces:**
- Consumes: types Task 1.
- Produces : mêmes 8 méthodes côté Postgres (non testées en CI).

- [ ] **Step 1: Étendre l'import de types**

`src/core/database/postgres.ts` ligne 2 :

```ts
import type { Database, Session, SessionRow, HistoryRow, LeadRow, CrossConversationRow, CredentialRecord, PlatformKeyRecord, PlatformKeyInput, ClientRecord, BotRecord, BotNumberRecord } from './types.js';
```

- [ ] **Step 2: Schéma Postgres**

Dans le `SCHEMA`, avant le backtick fermant, ajouter :

```sql

    CREATE TABLE IF NOT EXISTS clients (
      client_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bots (
      client_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      name TEXT NOT NULL,
      transport TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      default_language TEXT NOT NULL DEFAULT 'fr',
      languages JSONB NOT NULL DEFAULT '["fr"]',
      system_prompt JSONB NOT NULL DEFAULT '{}',
      lead_fields TEXT NOT NULL DEFAULT '',
      welcome JSONB NOT NULL DEFAULT '{"enabled":false,"message":{}}',
      error_messages JSONB NOT NULL DEFAULT '{}',
      catalog JSONB,
      llm JSONB,
      crm JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (client_id, bot_id)
    );

    CREATE TABLE IF NOT EXISTS bot_numbers (
      whatsapp_number TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_bot_numbers_bot ON bot_numbers(client_id, bot_id);
```

- [ ] **Step 3: Helpers + méthodes Postgres**

Au scope module (après `const { Pool } = pg;`), ajouter :

```ts
function normalizePhone(num: string): string {
  return num.replace(/\D/g, '');
}
```

Dans le `driver`, après `upsertPlatformKey`, ajouter. Note : `pg` parse nativement `JSONB` en objet JS — pas de `JSON.parse` à la lecture ; à l'écriture on passe `JSON.stringify` pour les champs JSONB.

```ts
    async listClients(): Promise<ClientRecord[]> {
      const r = await pool.query('SELECT client_id, name, status FROM clients ORDER BY client_id');
      return r.rows as ClientRecord[];
    },

    async upsertClient(rec: ClientRecord): Promise<void> {
      const upd = await pool.query(
        'UPDATE clients SET name = $2, status = $3, updated_at = NOW() WHERE client_id = $1',
        [rec.client_id, rec.name, rec.status]
      );
      if (upd.rowCount === 0) {
        await pool.query('INSERT INTO clients (client_id, name, status) VALUES ($1, $2, $3)', [rec.client_id, rec.name, rec.status]);
      }
    },

    async getBotRecord(clientId: string, botId: string): Promise<BotRecord | undefined> {
      const r = await pool.query(
        `SELECT client_id, bot_id, name, transport, status, default_language, languages,
                system_prompt, lead_fields, welcome, error_messages, catalog, llm, crm
         FROM bots WHERE client_id = $1 AND bot_id = $2`, [clientId, botId]
      );
      return r.rows[0] as BotRecord | undefined;
    },

    async listBotRecords(): Promise<BotRecord[]> {
      const r = await pool.query(
        `SELECT client_id, bot_id, name, transport, status, default_language, languages,
                system_prompt, lead_fields, welcome, error_messages, catalog, llm, crm
         FROM bots ORDER BY client_id, bot_id`
      );
      return r.rows as BotRecord[];
    },

    async upsertBotRecord(rec: BotRecord): Promise<void> {
      const params = [
        rec.client_id, rec.bot_id, rec.name, rec.transport, rec.status, rec.default_language,
        JSON.stringify(rec.languages), JSON.stringify(rec.system_prompt), rec.lead_fields,
        JSON.stringify(rec.welcome), JSON.stringify(rec.error_messages),
        rec.catalog ? JSON.stringify(rec.catalog) : null,
        rec.llm ? JSON.stringify(rec.llm) : null,
        rec.crm ? JSON.stringify(rec.crm) : null,
      ];
      const upd = await pool.query(
        `UPDATE bots SET name=$3, transport=$4, status=$5, default_language=$6, languages=$7,
           system_prompt=$8, lead_fields=$9, welcome=$10, error_messages=$11, catalog=$12, llm=$13, crm=$14,
           updated_at=NOW()
         WHERE client_id=$1 AND bot_id=$2`, params
      );
      if (upd.rowCount === 0) {
        await pool.query(
          `INSERT INTO bots (client_id, bot_id, name, transport, status, default_language, languages,
             system_prompt, lead_fields, welcome, error_messages, catalog, llm, crm)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, params
        );
      }
    },

    async deleteBotRecord(clientId: string, botId: string): Promise<void> {
      await pool.query('DELETE FROM bot_numbers WHERE client_id = $1 AND bot_id = $2', [clientId, botId]);
      await pool.query('DELETE FROM bots WHERE client_id = $1 AND bot_id = $2', [clientId, botId]);
    },

    async listBotNumbers(): Promise<BotNumberRecord[]> {
      const r = await pool.query('SELECT whatsapp_number, client_id, bot_id FROM bot_numbers ORDER BY whatsapp_number');
      return r.rows as BotNumberRecord[];
    },

    async setBotNumbers(clientId: string, botId: string, numbers: string[]): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM bot_numbers WHERE client_id = $1 AND bot_id = $2', [clientId, botId]);
        for (const n of numbers) {
          const norm = normalizePhone(n);
          if (norm) await client.query('INSERT INTO bot_numbers (whatsapp_number, client_id, bot_id) VALUES ($1, $2, $3)', [norm, clientId, botId]);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
```

- [ ] **Step 4: tsc + commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add src/core/database/postgres.ts
git commit -m "feat(db): mirror Postgres clients/bots/bot_numbers"
```

---

### Task 3 : ConfigStore (cache chaud + mapping runtime)

**Files:**
- Create: `src/core/config-store.ts`
- Test: `src/core/__tests__/config-store.test.ts` (create)

**Interfaces:**
- Consumes: `Database` (Task 1), `getDatabase`/`initDatabase` (`src/core/database/index.js`), type `BotConfig` (de `bot-config.js`, import type only).
- Produces :
  ```ts
  export async function initConfigStore(): Promise<void>;     // charge le cache depuis la DB
  export function getBotConfig(clientId: string, botId: string): BotConfig; // sync, throw si absent
  export function findBotConfigByNumber(toNumber: string): BotConfig | null; // sync
  export function listBotConfigs(): BotConfig[];              // sync
  export async function upsertBot(rec: BotRecord, numbers: string[]): Promise<void>; // écrit DB + rafraîchit cache
  export function resetConfigStore(): void;                   // tests
  export function botRecordToConfig(rec: BotRecord, numbers: string[]): BotConfig; // pur, testable
  ```

Note : `botRecordToConfig` aplatit le localisé sur `default_language` (fallback : 1re langue dispo, sinon ''), assemble `whatsapp_numbers` depuis les `BotNumberRecord` du bot, et caste `transport`/`crm.connector` vers les types runtime. Le cache chaud reprend la sémantique actuelle (Map config + index numéro, conflit de numéro → throw — ici garanti par la PK DB, mais on garde la détection défensive au build d'index).

- [ ] **Step 1: Write the failing test**

Create `src/core/__tests__/config-store.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../database/sqlite.js';
import { __setDatabaseForTests } from '../database/index.js';
import {
  initConfigStore, getBotConfig, findBotConfigByNumber, listBotConfigs,
  upsertBot, resetConfigStore, botRecordToConfig,
} from '../config-store.js';
import type { BotRecord } from '../database/types.js';

function rec(over: Partial<BotRecord> = {}): BotRecord {
  return {
    client_id: 'acme', bot_id: 'immo', name: 'Bot Immo',
    transport: 'meta-cloud', status: 'active',
    default_language: 'fr', languages: ['fr', 'en'],
    system_prompt: { fr: 'Prompt FR', en: 'Prompt EN' }, lead_fields: 'email',
    welcome: { enabled: true, message: { fr: 'Bonjour', en: 'Hello' } },
    error_messages: { fr: 'Erreur' }, catalog: null, llm: { model: 'x' }, crm: { connector: 'hubspot' },
    ...over,
  };
}

describe('botRecordToConfig (pur)', () => {
  it('aplatit le localisé sur default_language', () => {
    const cfg = botRecordToConfig(rec(), ['33611']);
    expect(cfg.system_prompt).toBe('Prompt FR');
    expect(cfg.welcome.message).toBe('Bonjour');
    expect(cfg.whatsapp_numbers).toEqual(['33611']);
    expect(cfg.crm).toEqual({ connector: 'hubspot' });
    expect(cfg.transport).toBe('meta-cloud');
  });

  it('fallback sur la 1re langue si default_language absent du map', () => {
    const cfg = botRecordToConfig(rec({ default_language: 'de', system_prompt: { fr: 'FR' }, welcome: { enabled: false, message: { fr: 'B' } } }), []);
    expect(cfg.system_prompt).toBe('FR');
  });
});

describe('ConfigStore (cache chaud)', () => {
  beforeEach(async () => {
    const db = createSqliteDriver(':memory:');
    __setDatabaseForTests(db);
    resetConfigStore();
  });
  afterEach(() => { resetConfigStore(); });

  it('init charge les bots et findBotConfigByNumber résout', async () => {
    const { getDatabase } = await import('../database/index.js');
    await getDatabase().upsertBotRecord(rec());
    await getDatabase().setBotNumbers('acme', 'immo', ['+33 6 11']);
    await initConfigStore();
    expect(listBotConfigs()).toHaveLength(1);
    expect(getBotConfig('acme', 'immo').name).toBe('Bot Immo');
    expect(findBotConfigByNumber('33611')!.bot_id).toBe('immo');
    expect(findBotConfigByNumber('00000')).toBeNull();
  });

  it('upsertBot écrit en DB et rafraîchit le cache à chaud', async () => {
    await initConfigStore();
    await upsertBot(rec(), ['+33 6 22']);
    expect(getBotConfig('acme', 'immo')).toBeDefined();
    expect(findBotConfigByNumber('33622')!.bot_id).toBe('immo');
  });

  it('getBotConfig throw si absent', () => {
    expect(() => getBotConfig('x', 'y')).toThrow(/\[ConfigStore\]/);
  });
});
```

- [ ] **Step 2: Add the test DB hook**

In `src/core/database/index.ts`, add an exported test hook (after `getDatabase`):

```ts
/** Test-only: injecte un driver (sqlite in-memory) sans passer par initDatabase. */
export function __setDatabaseForTests(db: Database): void {
  _db = db;
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/core/__tests__/config-store.test.ts`
Expected: FAIL — module `../config-store.js` introuvable.

- [ ] **Step 4: Implement ConfigStore**

Create `src/core/config-store.ts`:

```ts
/**
 * Source de vérité runtime des configs bot, adossée à la DB avec un cache mémoire chaud.
 *
 * initConfigStore() charge tous les bots au démarrage ; les getters restent synchrones
 * (hot path runtime inchangé). upsertBot() écrit la DB puis rafraîchit le cache à chaud.
 * Les champs de contenu sont stockés localisés ; le runtime lit default_language.
 */

import { getDatabase } from './database/index.js';
import type { BotRecord, BotNumberRecord } from './database/types.js';
import type { BotConfig, TransportId, CrmConnectorId } from './bot-config.js';

const cache = new Map<string, BotConfig>();
const numberIndex = new Map<string, BotConfig>();

function key(clientId: string, botId: string): string { return `${clientId}/${botId}`; }
function normalizePhone(num: string): string { return num.replace(/\D/g, ''); }

function pickLocalized(map: Record<string, string>, defaultLang: string): string {
  if (map[defaultLang]) return map[defaultLang];
  const first = Object.values(map)[0];
  return first ?? '';
}

export function botRecordToConfig(rec: BotRecord, numbers: string[]): BotConfig {
  return {
    client_id: rec.client_id,
    bot_id: rec.bot_id,
    name: rec.name,
    transport: rec.transport as TransportId,
    system_prompt: pickLocalized(rec.system_prompt, rec.default_language),
    lead_fields: rec.lead_fields,
    whatsapp_numbers: numbers.map(normalizePhone).filter(Boolean),
    welcome: {
      enabled: rec.welcome.enabled,
      message: pickLocalized(rec.welcome.message, rec.default_language),
    },
    ...(rec.catalog ? { catalog: rec.catalog } : {}),
    ...(rec.llm ? { llm: { ...(rec.llm.model ? { model: rec.llm.model } : {}) } } : {}),
    ...(rec.crm ? { crm: { connector: rec.crm.connector as CrmConnectorId } } : {}),
  };
}

function indexConfig(cfg: BotConfig): void {
  cache.set(key(cfg.client_id, cfg.bot_id), cfg);
  for (const num of cfg.whatsapp_numbers) {
    const existing = numberIndex.get(num);
    if (existing && key(existing.client_id, existing.bot_id) !== key(cfg.client_id, cfg.bot_id)) {
      throw new Error(`[ConfigStore] WhatsApp number conflict: ${num} -> ${existing.client_id}/${existing.bot_id} et ${cfg.client_id}/${cfg.bot_id}`);
    }
    numberIndex.set(num, cfg);
  }
}

export async function initConfigStore(): Promise<void> {
  resetConfigStore();
  const db = getDatabase();
  const [bots, numbers] = await Promise.all([db.listBotRecords(), db.listBotNumbers()]);
  const numsByBot = new Map<string, string[]>();
  for (const n of numbers as BotNumberRecord[]) {
    const k = key(n.client_id, n.bot_id);
    (numsByBot.get(k) ?? numsByBot.set(k, []).get(k)!).push(n.whatsapp_number);
  }
  for (const rec of bots) {
    indexConfig(botRecordToConfig(rec, numsByBot.get(key(rec.client_id, rec.bot_id)) ?? []));
  }
  console.log(`[ConfigStore] Loaded ${cache.size} bot(s)`);
}

export function getBotConfig(clientId: string, botId: string): BotConfig {
  const cfg = cache.get(key(clientId, botId));
  if (!cfg) throw new Error(`[ConfigStore] Bot not found: ${clientId}/${botId}`);
  return cfg;
}

export function findBotConfigByNumber(toNumber: string): BotConfig | null {
  return numberIndex.get(normalizePhone(toNumber)) ?? null;
}

export function listBotConfigs(): BotConfig[] {
  return Array.from(cache.values());
}

export async function upsertBot(rec: BotRecord, numbers: string[]): Promise<void> {
  const db = getDatabase();
  await db.upsertBotRecord(rec);
  await db.setBotNumbers(rec.client_id, rec.bot_id, numbers);
  // Rafraîchit le cache à chaud : purge les anciens numéros de ce bot puis ré-indexe.
  const k = key(rec.client_id, rec.bot_id);
  for (const [num, cfg] of numberIndex) {
    if (key(cfg.client_id, cfg.bot_id) === k) numberIndex.delete(num);
  }
  cache.delete(k);
  indexConfig(botRecordToConfig(rec, numbers));
}

export function resetConfigStore(): void {
  cache.clear();
  numberIndex.clear();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/core/__tests__/config-store.test.ts`
Expected: PASS.

- [ ] **Step 6: tsc + commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add src/core/config-store.ts src/core/database/index.ts src/core/__tests__/config-store.test.ts
git commit -m "feat(core): ConfigStore (cache chaud DB + mapping runtime localisé)"
```

---

### Task 4 : Bascule du loader + démarrage

**Files:**
- Modify: `src/core/bot-config.ts`
- Modify: `src/index.ts`
- Test: `src/core/__tests__/bot-config-delegation.test.ts` (create)

**Interfaces:**
- Consumes: `ConfigStore` (Task 3).
- Produces : `bot-config.ts` garde **les mêmes exports sync** (`loadBotConfig`, `findBotByNumber`, `listBots`, `resetBotConfigCache`) mais délègue au ConfigStore ; conserve les types (`BotConfig`, `TransportId`, `CrmConnectorId`). `initConfigStore` appelé au démarrage dans `main()` (après `initDatabase`, avant `initCrmBridge`).

- [ ] **Step 1: Write the failing test**

Create `src/core/__tests__/bot-config-delegation.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../database/sqlite.js';
import { __setDatabaseForTests, getDatabase } from '../database/index.js';
import { initConfigStore, resetConfigStore } from '../config-store.js';
import { loadBotConfig, findBotByNumber, listBots } from '../bot-config.js';
import type { BotRecord } from '../database/types.js';

const rec: BotRecord = {
  client_id: 'acme', bot_id: 'immo', name: 'Bot Immo', transport: 'meta-cloud', status: 'active',
  default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'P' }, lead_fields: 'email',
  welcome: { enabled: false, message: { fr: 'B' } }, error_messages: {}, catalog: null, llm: null, crm: null,
};

describe('bot-config délègue au ConfigStore', () => {
  beforeEach(async () => {
    __setDatabaseForTests(createSqliteDriver(':memory:'));
    resetConfigStore();
    await getDatabase().upsertBotRecord(rec);
    await getDatabase().setBotNumbers('acme', 'immo', ['+33 6 11']);
    await initConfigStore();
  });
  afterEach(() => resetConfigStore());

  it('loadBotConfig / findBotByNumber / listBots fonctionnent via la DB', () => {
    expect(loadBotConfig('acme', 'immo').name).toBe('Bot Immo');
    expect(findBotByNumber('+33 6 11')!.bot_id).toBe('immo');
    expect(listBots()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/__tests__/bot-config-delegation.test.ts`
Expected: FAIL — `loadBotConfig` lit encore le filesystem (pas de fichier) → throw `[BotConfig] Not found`.

- [ ] **Step 3: Réécrire bot-config.ts pour déléguer**

Replace the body of `src/core/bot-config.ts` (keep the type exports `BotConfig`, `TransportId`, `CrmConnectorId` exactly as they are; replace everything from `const cache = ...` to the end) with delegations:

```ts
import {
  getBotConfig, findBotConfigByNumber, listBotConfigs, resetConfigStore,
} from './config-store.js';

export function loadBotConfig(clientId: string, botId: string): BotConfig {
  return getBotConfig(clientId, botId);
}

export function findBotByNumber(toNumber: string): BotConfig | null {
  return findBotConfigByNumber(toNumber);
}

export function listBots(): BotConfig[] {
  return listBotConfigs();
}

export function resetBotConfigCache(): void {
  resetConfigStore();
}
```

Remove the now-unused `fs`/`path`/`fileURLToPath` imports and the `BOTS_DIR` constant from the top of the file.

- [ ] **Step 4: Wire initConfigStore at startup**

In `src/index.ts`, import it and call it in `main()` after `initDatabase()` and before `initCrmBridge()`:

```ts
import { initConfigStore } from './core/config-store.js';
```

In `main()`:

```ts
  await initDatabase();
  await initConfigStore();
  await cleanupProcessedMessages();
```

- [ ] **Step 5: Run tests + full suite + tsc**

Run: `npx vitest run src/core/__tests__/bot-config-delegation.test.ts && npx tsc --noEmit && npx vitest run`
Expected: green. Note : si des tests existants chargeaient des bots via fichiers JSON, ils doivent désormais initialiser le ConfigStore (DB in-memory) — corriger ces tests en conséquence (même patron que le test de délégation).

- [ ] **Step 6: Commit**

```bash
git add src/core/bot-config.ts src/index.ts src/core/__tests__/bot-config-delegation.test.ts
git commit -m "feat(core): bot-config délègue au ConfigStore (runtime lit la DB)"
```

---

### Task 5 : Script d'import des JSON existants

**Files:**
- Create: `scripts/import-config-to-db.ts`
- Test: `src/core/__tests__/import-config.test.ts` (create)

**Interfaces:**
- Consumes: `BotRecord` (Task 1), `getDatabase`/`initDatabase`.
- Produces :
  ```ts
  export function jsonBotToRecord(json: Record<string, unknown>): { record: BotRecord; numbers: string[] };
  ```
  Pur et testable (comme `buildSeedRecords`). Wrappe `system_prompt` et `welcome.message` (strings dans les JSON actuels) en `{ <default_language>: value }` avec `default_language = 'fr'`, `languages = ['fr']`, `status = 'active'`, `error_messages = {}`. `main()` scanne `bots/*/*.json`, upsert client + bot + numéros (idempotent), non destructif.

- [ ] **Step 1: Write the failing test**

Create `src/core/__tests__/import-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { jsonBotToRecord } from '../../../scripts/import-config-to-db.js';

describe('jsonBotToRecord', () => {
  it('wrappe les strings de contenu en localisé FR et extrait les numéros', () => {
    const { record, numbers } = jsonBotToRecord({
      client_id: 'default', bot_id: 'example', name: 'Test Bot', transport: 'meta-cloud',
      system_prompt: 'Tu es...', lead_fields: 'email, stage',
      whatsapp_numbers: ['+15551412647'],
      welcome: { enabled: true, message: 'Bonjour {profileName}!' },
      crm: { connector: 'hubspot' },
    });
    expect(record.default_language).toBe('fr');
    expect(record.languages).toEqual(['fr']);
    expect(record.system_prompt).toEqual({ fr: 'Tu es...' });
    expect(record.welcome).toEqual({ enabled: true, message: { fr: 'Bonjour {profileName}!' } });
    expect(record.status).toBe('active');
    expect(record.crm).toEqual({ connector: 'hubspot' });
    expect(numbers).toEqual(['+15551412647']);
  });

  it('gère les champs optionnels absents', () => {
    const { record, numbers } = jsonBotToRecord({
      client_id: 'c', bot_id: 'b', name: 'B', transport: 'cm-com',
      system_prompt: 'P', lead_fields: '', whatsapp_numbers: [], welcome: { enabled: false, message: '' },
    });
    expect(record.catalog).toBeNull();
    expect(record.llm).toBeNull();
    expect(record.crm).toBeNull();
    expect(numbers).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/__tests__/import-config.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implement the import script**

Create `scripts/import-config-to-db.ts`:

```ts
/**
 * Import one-shot des configs bot JSON (bots/{client}/{bot}.json) vers la DB.
 * Idempotent (upsert), non destructif. Exécuter : npx tsx scripts/import-config-to-db.ts
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, getDatabase } from '../src/core/database/index.js';
import type { BotRecord } from '../src/core/database/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOTS_DIR = path.join(__dirname, '..', 'bots');

export function jsonBotToRecord(json: Record<string, unknown>): { record: BotRecord; numbers: string[] } {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const welcome = (json.welcome ?? {}) as { enabled?: boolean; message?: unknown };
  const record: BotRecord = {
    client_id: str(json.client_id),
    bot_id: str(json.bot_id),
    name: str(json.name),
    transport: str(json.transport),
    status: 'active',
    default_language: 'fr',
    languages: ['fr'],
    system_prompt: { fr: str(json.system_prompt) },
    lead_fields: str(json.lead_fields),
    welcome: { enabled: Boolean(welcome.enabled), message: { fr: str(welcome.message) } },
    error_messages: {},
    catalog: (json.catalog as BotRecord['catalog']) ?? null,
    llm: (json.llm as BotRecord['llm']) ?? null,
    crm: (json.crm as BotRecord['crm']) ?? null,
  };
  const numbers = Array.isArray(json.whatsapp_numbers) ? (json.whatsapp_numbers as string[]) : [];
  return { record, numbers };
}

async function main(): Promise<void> {
  await initDatabase();
  const db = getDatabase();
  if (!fs.existsSync(BOTS_DIR)) { console.log('[Import] no bots/ directory'); await db.close(); return; }

  const clients = fs.readdirSync(BOTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  let count = 0;
  for (const clientId of clients) {
    await db.upsertClient({ client_id: clientId, name: clientId, status: 'active' });
    const files = fs.readdirSync(path.join(BOTS_DIR, clientId)).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const raw = fs.readFileSync(path.join(BOTS_DIR, clientId, file), 'utf-8');
      const { record, numbers } = jsonBotToRecord(JSON.parse(raw) as Record<string, unknown>);
      await db.upsertBotRecord(record);
      await db.setBotNumbers(record.client_id, record.bot_id, numbers);
      count++;
      console.log(`[Import] ${record.client_id}/${record.bot_id} (${numbers.length} numéro(s))`);
    }
  }
  console.log(`[Import] ${count} bot(s) importé(s).`);
  await db.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error('[Import] échec:', err); process.exit(1); });
}
```

- [ ] **Step 4: Run test + tsc**

Run: `npx vitest run src/core/__tests__/import-config.test.ts && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 5: Run the import against the local SQLite + verify**

Run: `npx tsx scripts/import-config-to-db.ts`
Expected: logs `[Import] default/example ...` puis `[Import] N bot(s) importé(s).` sans erreur.

- [ ] **Step 6: Commit**

```bash
git add scripts/import-config-to-db.ts src/core/__tests__/import-config.test.ts
git commit -m "feat(scripts): import one-shot des bots JSON vers la DB"
```

---

## Self-Review

**Spec coverage (Tranche 1)** :
- Tables `clients`, `bots`, `bot_numbers` (sqlite+pg) → Task 1/2. ✓ (`connector_mappings` explicitement reporté au Plan 4.)
- `ConfigStore` (getBot/findBotByNumber/listBots/upsertBot) + cache chaud + mapping localisé → Task 3. ✓
- Bascule du loader, runtime inchangé → Task 4. ✓ (signatures sync préservées, `initConfigStore` au boot.)
- Import one-shot idempotent + wrap localisé → Task 5. ✓
- Invariant *1 numéro = 1 bot* → PK `bot_numbers` (normalisé) + détection défensive au build d'index. ✓
- Modèle multilingue-ready (`Localized`, `default_language`, `languages`) ; runtime lit `default_language`. ✓

**Placeholder scan** : aucun TODO/TBD ; code complet à chaque step. ✓

**Type consistency** : `BotRecord`/`Localized` identiques entre types.ts, drivers, ConfigStore, import. `botRecordToConfig` produit le `BotConfig` runtime existant (champs `system_prompt:string`, `welcome.message:string`, `whatsapp_numbers:string[]`). `__setDatabaseForTests` ajouté et utilisé dans les tests. ✓

**Risque connu** : des tests existants qui dépendaient de bots JSON sur disque devront initialiser le ConfigStore via DB in-memory (signalé en Task 4 Step 5). À traiter au fil de l'exécution.
