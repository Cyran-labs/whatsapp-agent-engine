# Flow Labs — Plan 4a : Fondation config-write + mappings DB + audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Doter l'API admin (`/api/admin/v1`) de l'épine dorsale d'écriture de configuration : CRUD des bots (draft→active, numéros, statut) scopé par client, migration des mappings CRM (`connector_mappings`) en DB (fin du loader fichier), et journal d'audit (`audit_log`) des mutations.

**Architecture:** On prolonge le socle du Plan 3. Deux nouvelles tables (`connector_mappings`, `audit_log`) + méthodes `Database`. `ConfigStore` gagne `getMapping`/`upsertMapping` (async, DB ; pas de cache sync car la résolution de mapping se fait au bind du `CrmBridge`, hors hot path). Les connecteurs cessent de lire les fichiers `connectors-config/*.json` : le `CrmBridge` résout le mapping en DB (fallback bot→client) et l'injecte. Un `BotService` (même patron que `AuthService`/`AdminService`) porte la logique métier ; un sous-router `bots/*` est monté, protégé par `requireAuth` + `scopeToClient` (premier câblage de `scopeToClient`). Un helper `recordAudit` journalise chaque mutation. Le pipeline webhook runtime reste inchangé.

**Tech Stack:** TypeScript strict ESM, Express 5, better-sqlite3 + pg, Vitest, zod. Pas de nouvelle dépendance.

## Global Constraints

Du spec `docs/superpowers/specs/2026-06-22-flow-labs-backoffice-design.md` (§5, §6, §9) + conventions repo. Hérité par chaque task.

- **Nom produit = Flow Labs** (jamais « Cyran » dans code/logs/messages).
- **TypeScript strict** : pas de `any`, `const` par défaut, `noUnusedLocals`/`noUnusedParameters`. Imports relatifs en `.js` (ESM).
- **Logs** : `[Service] message` sans emoji.
- **Database** : méthodes toutes `async`. SQLite = backend testé CI ; Postgres = miroir mécanique (SERIAL, TIMESTAMPTZ, `::text` casts, `$n`, `JSONB` pour colonnes JSON, `RETURNING`). Upsert sur tables neuves = **UPDATE-then-INSERT** (PAS `ON CONFLICT`). Égalité NULL : SQLite `col IS ?`, Postgres `col IS NOT DISTINCT FROM $n`.
- **Source de vérité = DB** : aucun accès filesystem côté config runtime après migration (le loader fichier `loadMappingConfig` est supprimé). L'engine reste seule source de vérité ; tout écrit passe par l'API.
- **Multi-tenant** : `scopeToClient` force le `client_id` d'un `client_admin` ; un `super_admin` cible via `?client_id`. Une route `bots/*` ne doit jamais laisser un `client_admin` toucher un autre client.
- **Forme d'erreur API unique** (Plan 3) : `{ error: { code, message, details?, request_id } }`, codes stables ; conflits → 409.
- **Routage 1 numéro = 1 bot** (invariant historique) : `bot_numbers.whatsapp_number` est PK global ; un numéro déjà routé vers un autre bot → 409.
- **Audit** : toute mutation admin (create/update/delete/status/numbers/mapping) écrit une ligne `audit_log` (`actor_user_id`, `action`, `target`, `client_id`, `metadata`). L'échec d'audit ne doit pas casser l'opération (best-effort, loggé).
- Author git : `Francois Greze <francois@cyran.fr>`. Pas de signature Claude. Commits via le workflow subagent uniquement.

---

## File Structure

**Nouveaux fichiers**
- `src/core/audit.ts` — `recordAudit(deps, entry)` helper best-effort.
- `src/core/auth/__tests__/audit.test.ts`
- `src/core/services/bot-service.ts` — `BotService` (CRUD bots + numéros + statut, avec audit).
- `src/core/services/__tests__/bot-service.test.ts`
- `src/contracts/bots.ts` — schémas Zod bot (create/update/numbers/status) + localisé.
- `src/api/admin/routes/bots.ts` — sous-router `bots/*`.
- `src/api/admin/__tests__/bots-routes.test.ts`
- `src/core/database/__tests__/config-write-tables.test.ts` — tables connector_mappings + audit_log.
- `src/core/__tests__/config-store-mappings.test.ts` — getMapping/upsertMapping.

**Fichiers modifiés**
- `src/core/database/types.ts` — `ConnectorMappingRecord`/`Input`, `AuditLogInput`/`Row` + méthodes `Database`.
- `src/core/database/sqlite.ts` + `postgres.ts` — tables + méthodes.
- `src/core/config-store.ts` — `getMapping`/`upsertMapping` (async, DB, fallback bot→client).
- `src/connectors/types.ts` — `ConnectorConfig.mapping?: FieldMapping`.
- `src/connectors/registry.ts` — passe `mapping` aux connecteurs plats.
- `src/connectors/{hubspot,pipedrive,salesforce,zoho}.ts` — `options.mapping` requis, suppression du fallback `loadMappingConfig`.
- `src/connectors/field-mapper.ts` — suppression de `loadMappingConfig` + imports `fs`/`path`.
- `src/core/crm-bridge.ts` — résout le mapping en DB et l'injecte (fin de l'auto-load fichier).
- `src/core/__tests__/crm-bridge.test.ts` — seed du mapping en DB au lieu des fichiers.
- `scripts/import-config-to-db.ts` — migre `connectors-config/*.json` → table.
- `src/api/admin/router.ts` — monte le sous-router `bots`.

**Décisions actées**
- Mappings : **DB seule source** (loader fichier supprimé), import one-shot étendu.
- `getMapping`/`upsertMapping` **async** (DB), pas de cache sync (résolution au bind du bridge, hors hot path).
- Gate d'activation `draft→active` en 4a = **≥1 numéro WhatsApp** ; le gate complet « WhatsApp validé » arrive au Plan 4b (transport-validate).

---

## Task 1: Tables `connector_mappings` + `audit_log` + méthodes Database

**Files:**
- Modify: `src/core/database/types.ts`, `src/core/database/sqlite.ts`, `src/core/database/postgres.ts`
- Test: `src/core/database/__tests__/config-write-tables.test.ts`

**Interfaces:**
- Produces :
  - Types : `ConnectorMappingInput { client_id; bot_id: string|null; connector; mapping: Record<string, unknown> }`, `ConnectorMappingRecord extends ConnectorMappingInput { id; created_at; updated_at }`, `AuditLogInput { actor_user_id: number|null; action; target; client_id: string|null; metadata: Record<string, unknown>|null }`, `AuditLogRow extends AuditLogInput { id; created_at }`.
  - Méthodes `Database` :
    - `getConnectorMapping(clientId: string, botId: string | null, connector: string): Promise<ConnectorMappingRecord | undefined>` (match exact, égalité NULL sur bot_id)
    - `upsertConnectorMapping(rec: ConnectorMappingInput): Promise<void>` (UPDATE-then-INSERT sur (client_id, COALESCE(bot_id), connector))
    - `listConnectorMappings(clientId: string): Promise<ConnectorMappingRecord[]>`
    - `insertAuditLog(rec: AuditLogInput): Promise<void>`
    - `listAuditLog(clientId: string, limit?: number): Promise<AuditLogRow[]>`

> NOTE implémenteur : `mapping`/`metadata` = JSON (`TEXT` SQLite avec JSON.parse/stringify, `JSONB` Postgres). Suis le patron `bots.system_prompt` (sqlite `botRecordToCols`/`rowToBotRecord`) et `tenant_credentials` (égalité NULL via `COALESCE(bot_id,'')` pour l'index unique SQLite ; Postgres `bot_id IS NOT DISTINCT FROM $n` pour le UPDATE et index unique sur `COALESCE(bot_id,'')`). Ajoute types + interface + LES DEUX drivers dans le même commit (tsc casse sinon).

- [ ] **Step 1: Écrire le test (échec attendu)**

Créer `src/core/database/__tests__/config-write-tables.test.ts` :

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../sqlite.js';
import type { Database } from '../types.js';

const MAPPING = { version: 1, connector: 'hubspot', target_object: 'contacts', client_id: 'acme', field_mapping: [{ source: 'email', target: 'email' }] };

describe('connector_mappings + audit_log (sqlite)', () => {
  let db: Database;
  beforeEach(() => { db = createSqliteDriver(':memory:'); });
  afterEach(async () => { await db.close(); });

  it('upsertConnectorMapping (client-level) + getConnectorMapping exact', async () => {
    await db.upsertConnectorMapping({ client_id: 'acme', bot_id: null, connector: 'hubspot', mapping: MAPPING });
    const got = await db.getConnectorMapping('acme', null, 'hubspot');
    expect(got!.mapping).toEqual(MAPPING);
    expect(got!.bot_id).toBeNull();
    expect(await db.getConnectorMapping('acme', 'immo', 'hubspot')).toBeUndefined(); // pas de bot-scope
  });

  it('upsert met à jour sans dupliquer', async () => {
    await db.upsertConnectorMapping({ client_id: 'acme', bot_id: null, connector: 'hubspot', mapping: MAPPING });
    await db.upsertConnectorMapping({ client_id: 'acme', bot_id: null, connector: 'hubspot', mapping: { ...MAPPING, target_object: 'leads' } });
    expect((await db.getConnectorMapping('acme', null, 'hubspot'))!.mapping).toMatchObject({ target_object: 'leads' });
    expect(await db.listConnectorMappings('acme')).toHaveLength(1);
  });

  it('bot-scope et client-level coexistent (clés distinctes)', async () => {
    await db.upsertConnectorMapping({ client_id: 'acme', bot_id: null, connector: 'hubspot', mapping: MAPPING });
    await db.upsertConnectorMapping({ client_id: 'acme', bot_id: 'immo', connector: 'hubspot', mapping: { ...MAPPING, target_object: 'bot' } });
    expect((await db.getConnectorMapping('acme', 'immo', 'hubspot'))!.mapping).toMatchObject({ target_object: 'bot' });
    expect((await db.getConnectorMapping('acme', null, 'hubspot'))!.mapping).toMatchObject({ target_object: 'contacts' });
    expect(await db.listConnectorMappings('acme')).toHaveLength(2);
  });

  it('insertAuditLog append + listAuditLog par client (récents d\'abord)', async () => {
    await db.insertAuditLog({ actor_user_id: 1, action: 'bot.create', target: 'bot:acme/immo', client_id: 'acme', metadata: { name: 'Immo' } });
    await db.insertAuditLog({ actor_user_id: 1, action: 'bot.status', target: 'bot:acme/immo', client_id: 'acme', metadata: null });
    await db.insertAuditLog({ actor_user_id: 2, action: 'bot.create', target: 'bot:other/x', client_id: 'other', metadata: null });
    const rows = await db.listAuditLog('acme');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.action).toBe('bot.status'); // plus récent d'abord
    expect(rows[0]!.id).toBeGreaterThan(0);
    expect(rows[1]!.metadata).toEqual({ name: 'Immo' });
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/core/database/__tests__/config-write-tables.test.ts`
Expected: FAIL.

- [ ] **Step 3: Types dans `src/core/database/types.ts`**

Ajouter après les types d'auth (avant `export interface Database`) :

```typescript
export interface ConnectorMappingInput {
  client_id: string;
  bot_id: string | null;
  connector: string;
  mapping: Record<string, unknown>;
}

export interface ConnectorMappingRecord extends ConnectorMappingInput {
  id: number;
  created_at: string;
  updated_at: string;
}

export interface AuditLogInput {
  actor_user_id: number | null;
  action: string;
  target: string;
  client_id: string | null;
  metadata: Record<string, unknown> | null;
}

export interface AuditLogRow extends AuditLogInput {
  id: number;
  created_at: string;
}
```

Dans l'interface `Database`, après le bloc auth :

```typescript
  // Mappings CRM (migrés depuis connectors-config/*.json)
  getConnectorMapping(clientId: string, botId: string | null, connector: string): Promise<ConnectorMappingRecord | undefined>;
  upsertConnectorMapping(rec: ConnectorMappingInput): Promise<void>;
  listConnectorMappings(clientId: string): Promise<ConnectorMappingRecord[]>;

  // Journal d'audit des mutations admin
  insertAuditLog(rec: AuditLogInput): Promise<void>;
  listAuditLog(clientId: string, limit?: number): Promise<AuditLogRow[]>;
```

- [ ] **Step 4: Tables + méthodes SQLite**

Mettre à jour l'import de types (`ConnectorMappingInput, ConnectorMappingRecord, AuditLogInput, AuditLogRow`). Ajouter au `SCHEMA` :

```sql
    CREATE TABLE IF NOT EXISTS connector_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      bot_id TEXT,
      connector TEXT NOT NULL,
      mapping TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_connector_mappings
      ON connector_mappings(client_id, COALESCE(bot_id, ''), connector);

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      client_id TEXT,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_client ON audit_log(client_id, id);
```

Méthodes (avant `close()`) :

```typescript
    async getConnectorMapping(clientId: string, botId: string | null, connector: string): Promise<ConnectorMappingRecord | undefined> {
      const row = db.prepare(
        `SELECT id, client_id, bot_id, connector, mapping, created_at, updated_at
         FROM connector_mappings WHERE client_id = ? AND bot_id IS ? AND connector = ?`
      ).get(clientId, botId, connector) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return { ...row, mapping: JSON.parse(String(row.mapping)) } as ConnectorMappingRecord;
    },

    async upsertConnectorMapping(rec: ConnectorMappingInput): Promise<void> {
      const json = JSON.stringify(rec.mapping);
      const upd = db.prepare(
        `UPDATE connector_mappings SET mapping = ?, updated_at = datetime('now')
         WHERE client_id = ? AND bot_id IS ? AND connector = ?`
      ).run(json, rec.client_id, rec.bot_id, rec.connector);
      if (upd.changes === 0) {
        db.prepare(
          `INSERT INTO connector_mappings (client_id, bot_id, connector, mapping) VALUES (?, ?, ?, ?)`
        ).run(rec.client_id, rec.bot_id, rec.connector, json);
      }
    },

    async listConnectorMappings(clientId: string): Promise<ConnectorMappingRecord[]> {
      const rows = db.prepare(
        `SELECT id, client_id, bot_id, connector, mapping, created_at, updated_at
         FROM connector_mappings WHERE client_id = ? ORDER BY connector, bot_id`
      ).all(clientId) as Array<Record<string, unknown>>;
      return rows.map((r) => ({ ...r, mapping: JSON.parse(String(r.mapping)) }) as ConnectorMappingRecord);
    },

    async insertAuditLog(rec: AuditLogInput): Promise<void> {
      db.prepare(
        `INSERT INTO audit_log (actor_user_id, action, target, client_id, metadata)
         VALUES (?, ?, ?, ?, ?)`
      ).run(rec.actor_user_id, rec.action, rec.target, rec.client_id, rec.metadata ? JSON.stringify(rec.metadata) : null);
    },

    async listAuditLog(clientId: string, limit = 100): Promise<AuditLogRow[]> {
      const rows = db.prepare(
        `SELECT id, actor_user_id, action, target, client_id, metadata, created_at
         FROM audit_log WHERE client_id = ? ORDER BY id DESC LIMIT ?`
      ).all(clientId, limit) as Array<Record<string, unknown>>;
      return rows.map((r) => ({ ...r, metadata: r.metadata ? JSON.parse(String(r.metadata)) : null }) as AuditLogRow);
    },
```

- [ ] **Step 5: Vérifier le succès SQLite**

Run: `npx vitest run src/core/database/__tests__/config-write-tables.test.ts`
Expected: PASS (4/4).

- [ ] **Step 6: Miroir Postgres**

Mettre à jour l'import de types. Ajouter au `SCHEMA` :

```sql
    CREATE TABLE IF NOT EXISTS connector_mappings (
      id SERIAL PRIMARY KEY,
      client_id TEXT NOT NULL,
      bot_id TEXT,
      connector TEXT NOT NULL,
      mapping JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_connector_mappings
      ON connector_mappings(client_id, COALESCE(bot_id, ''), connector);

    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      actor_user_id INTEGER,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      client_id TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_client ON audit_log(client_id, id);
```

Méthodes (avant `close()`) — `mapping`/`metadata` sont du JSONB, `pg` les renvoie déjà désérialisés ; à l'insert, passer un objet JS (pg sérialise via le paramètre) ou `JSON.stringify` — utiliser `JSON.stringify` pour rester explicite :

```typescript
    async getConnectorMapping(clientId: string, botId: string | null, connector: string): Promise<ConnectorMappingRecord | undefined> {
      const r = await pool.query(
        `SELECT id, client_id, bot_id, connector, mapping, created_at::text, updated_at::text
         FROM connector_mappings WHERE client_id = $1 AND bot_id IS NOT DISTINCT FROM $2 AND connector = $3`,
        [clientId, botId, connector]
      );
      return r.rows[0] as ConnectorMappingRecord | undefined;
    },

    async upsertConnectorMapping(rec: ConnectorMappingInput): Promise<void> {
      const json = JSON.stringify(rec.mapping);
      const upd = await pool.query(
        `UPDATE connector_mappings SET mapping = $1::jsonb, updated_at = NOW()
         WHERE client_id = $2 AND bot_id IS NOT DISTINCT FROM $3 AND connector = $4`,
        [json, rec.client_id, rec.bot_id, rec.connector]
      );
      if (upd.rowCount === 0) {
        await pool.query(
          `INSERT INTO connector_mappings (client_id, bot_id, connector, mapping)
           VALUES ($1, $2, $3, $4::jsonb)`,
          [rec.client_id, rec.bot_id, rec.connector, json]
        );
      }
    },

    async listConnectorMappings(clientId: string): Promise<ConnectorMappingRecord[]> {
      const r = await pool.query(
        `SELECT id, client_id, bot_id, connector, mapping, created_at::text, updated_at::text
         FROM connector_mappings WHERE client_id = $1 ORDER BY connector, bot_id`,
        [clientId]
      );
      return r.rows as ConnectorMappingRecord[];
    },

    async insertAuditLog(rec: AuditLogInput): Promise<void> {
      await pool.query(
        `INSERT INTO audit_log (actor_user_id, action, target, client_id, metadata)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [rec.actor_user_id, rec.action, rec.target, rec.client_id, rec.metadata ? JSON.stringify(rec.metadata) : null]
      );
    },

    async listAuditLog(clientId: string, limit = 100): Promise<AuditLogRow[]> {
      const r = await pool.query(
        `SELECT id, actor_user_id, action, target, client_id, metadata, created_at::text
         FROM audit_log WHERE client_id = $1 ORDER BY id DESC LIMIT $2`,
        [clientId, limit]
      );
      return r.rows as AuditLogRow[];
    },
```

- [ ] **Step 7: tsc + suite DB**

Run: `npm run typecheck && npx vitest run src/core/database/`
Expected: tsc propre, tests verts.

- [ ] **Step 8: Commit**

```bash
git add src/core/database/types.ts src/core/database/sqlite.ts src/core/database/postgres.ts src/core/database/__tests__/config-write-tables.test.ts
git commit -m "feat(db): tables connector_mappings + audit_log + accès"
```

---

## Task 2: ConfigStore — getMapping / upsertMapping (async, fallback bot→client)

**Files:**
- Modify: `src/core/config-store.ts`
- Test: `src/core/__tests__/config-store-mappings.test.ts`

**Interfaces:**
- Consumes: `getDatabase()`, `db.getConnectorMapping`/`upsertConnectorMapping`, type `FieldMapping` (depuis `../connectors/field-mapper.js`, **import type** uniquement pour éviter un cycle runtime).
- Produces (consommés par Tasks 3, 5) :
  - `getMapping(clientId: string, botId: string, connector: string): Promise<FieldMapping | null>` — essaie (clientId, botId, connector) puis fallback (clientId, null, connector). `null` si aucun.
  - `upsertMapping(clientId: string, botId: string | null, connector: string, mapping: FieldMapping): Promise<void>`.

> NOTE implémenteur : `import type { FieldMapping } from '../connectors/field-mapper.js';` (type-only, pas d'import runtime → pas de cycle). La résolution est async (DB) — ce n'est PAS le hot path runtime (utilisé au bind du CrmBridge et par les endpoints admin). Le record DB stocke `mapping` en `Record<string, unknown>` ; caster en `FieldMapping` au retour.

- [ ] **Step 1: Test (échec attendu)**

Créer `src/core/__tests__/config-store-mappings.test.ts` :

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../database/sqlite.js';
import { __setDatabaseForTests } from '../database/index.js';
import { getMapping, upsertMapping } from '../config-store.js';
import type { Database } from '../database/types.js';
import type { FieldMapping } from '../../connectors/field-mapper.js';

const M = (target: string): FieldMapping => ({
  version: 1, connector: 'hubspot', target_object: target, client_id: 'acme',
  field_mapping: [{ source: 'email', target: 'email' }],
});

describe('ConfigStore mappings', () => {
  let db: Database;
  beforeEach(() => { db = createSqliteDriver(':memory:'); __setDatabaseForTests(db); });
  afterEach(async () => { await db.close(); });

  it('getMapping retourne null si aucun mapping', async () => {
    expect(await getMapping('acme', 'immo', 'hubspot')).toBeNull();
  });

  it('upsertMapping (client-level) puis getMapping en fallback', async () => {
    await upsertMapping('acme', null, 'hubspot', M('contacts'));
    const got = await getMapping('acme', 'immo', 'hubspot'); // pas de bot-scope -> fallback client
    expect(got!.target_object).toBe('contacts');
  });

  it('le bot-scope prime sur le client-level', async () => {
    await upsertMapping('acme', null, 'hubspot', M('client'));
    await upsertMapping('acme', 'immo', 'hubspot', M('bot'));
    expect((await getMapping('acme', 'immo', 'hubspot'))!.target_object).toBe('bot');
    expect((await getMapping('acme', 'autre', 'hubspot'))!.target_object).toBe('client');
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/core/__tests__/config-store-mappings.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implémenter dans `src/core/config-store.ts`**

Ajouter l'import type en tête :

```typescript
import type { FieldMapping } from '../connectors/field-mapper.js';
```

Ajouter les deux fonctions exportées (après `upsertBot`) :

```typescript
/**
 * Résout le mapping CRM d'un bot : bot-scope d'abord, fallback client-level.
 * Async (DB) — utilisé au bind du CrmBridge et par les endpoints admin, pas sur le hot path runtime.
 */
export async function getMapping(clientId: string, botId: string, connector: string): Promise<FieldMapping | null> {
  const db = getDatabase();
  const bot = await db.getConnectorMapping(clientId, botId, connector);
  if (bot) return bot.mapping as unknown as FieldMapping;
  const client = await db.getConnectorMapping(clientId, null, connector);
  return client ? (client.mapping as unknown as FieldMapping) : null;
}

export async function upsertMapping(clientId: string, botId: string | null, connector: string, mapping: FieldMapping): Promise<void> {
  const db = getDatabase();
  await db.upsertConnectorMapping({ client_id: clientId, bot_id: botId, connector, mapping: mapping as unknown as Record<string, unknown> });
}
```

- [ ] **Step 4: Vérifier le succès + tsc**

Run: `npm run typecheck && npx vitest run src/core/__tests__/config-store-mappings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/config-store.ts src/core/__tests__/config-store-mappings.test.ts
git commit -m "feat(core): ConfigStore getMapping/upsertMapping (DB, fallback bot->client)"
```

---

## Task 3: Migration des connecteurs vers le mapping en DB (fin du loader fichier)

**Files:**
- Modify: `src/connectors/types.ts`, `src/connectors/registry.ts`, `src/connectors/hubspot.ts`, `src/connectors/pipedrive.ts`, `src/connectors/salesforce.ts`, `src/connectors/zoho.ts`, `src/connectors/field-mapper.ts`, `src/core/crm-bridge.ts`, `src/core/__tests__/crm-bridge.test.ts`, `scripts/import-config-to-db.ts`

**Interfaces:**
- Consumes: `getMapping` (Task 2), `ConfigStore`.
- Produces: les connecteurs plats (`hubspot`/`pipedrive`/`salesforce`/`zoho`) reçoivent leur `FieldMapping` via `options.mapping` (plus de lecture fichier). `loadMappingConfig` est supprimé.

> NOTE implémenteur (ordre des effets) :
> 1. `ConnectorConfig` gagne `mapping?: FieldMapping`. `createConnector` passe `mapping: config.mapping` dans les options de hubspot/pipedrive/salesforce/zoho.
> 2. Dans chaque connecteur plat : remplacer `const mapping = options.mapping ?? loadMappingConfig(type, options.clientId!)` par une exigence stricte : `if (!options.mapping) throw new Error('[Xxx] mapping is required')`, puis `this.mapper = new FieldMapper(options.mapping)`. Retirer l'import `loadMappingConfig`. **Garder** `options.clientId` (toujours passé via credentials.client_id pour la dédup) — ne supprimer QUE le fallback de chargement fichier. Adapter le guard existant `if (!options.mapping && !options.clientId)` → `if (!options.mapping)`.
> 3. `field-mapper.ts` : supprimer la fonction `loadMappingConfig` et les imports `fs`, `path`, `fileURLToPath`, la constante `MAPPINGS_DIR`. Garder tout le reste (FieldMapper, types).
> 4. `crm-bridge.ts` `instantiateConnector` : pour les connecteurs utilisant FieldMapper (hubspot/pipedrive/salesforce/zoho), résoudre `const mapping = await getMapping(bot.client_id, bot.bot_id, connectorType);` et si `null` → `throw new Error('[CrmBridge] no mapping for ...')` (fail-closed, comme le faisait le loader fichier). Passer `mapping` dans `createConnector({ type, credentials, mapping })`. attio/webhook-generic/mad-crm n'utilisent PAS FieldMapper → pas de mapping.
> 5. `crm-bridge.test.ts` : remplacer la dépendance aux fichiers `connectors-config/default/*.json` par un seed DB : `await upsertMapping('default', null, 'hubspot', <mapping>)` (et pipedrive selon les cas testés) avant `initCrmBridge`. Utiliser `__setDatabaseForTests` + un mapping minimal valide.
> 6. `import-config-to-db.ts` : ajouter une fonction `importMappings(db)` qui lit `connectors-config/{client}/{connector}.json` et fait `db.upsertConnectorMapping({ client_id, bot_id: null, connector, mapping: parsed })` (client-level), idempotent. L'appeler dans `main()`.

- [ ] **Step 1: Étendre `ConnectorConfig` + registry**

Dans `src/connectors/types.ts`, importer le type et ajouter le champ :

```typescript
import type { FieldMapping } from './field-mapper.js';
```
(ajouter en tête du fichier)

```typescript
export interface ConnectorConfig {
  type: string;
  credentials: Record<string, string>;
  options?: Record<string, unknown>;
  /** Mapping FieldMapping résolu (DB) pour les connecteurs plats. Injecté par le CrmBridge. */
  mapping?: FieldMapping;
}
```

Dans `src/connectors/registry.ts`, passer `mapping: config.mapping` dans les options de hubspot/pipedrive/salesforce/zoho. Exemple pour hubspot :

```typescript
    case 'hubspot':
      return new HubSpotConnector({
        accessToken: config.credentials['access_token'] ?? '',
        clientId: config.credentials['client_id'] ?? 'default',
        mapping: config.mapping,
      });
```
Faire de même pour `pipedrive`, `salesforce`, `zoho` (ajouter `mapping: config.mapping,`). Ne pas toucher attio/webhook-generic/mad-crm.

- [ ] **Step 2: Connecteurs plats — exiger `options.mapping`**

Dans `src/connectors/hubspot.ts` : retirer `loadMappingConfig` de l'import (`import { FieldMapper, type FieldMapping } from './field-mapper.js';`). Remplacer le bloc constructeur :

```typescript
    if (!options.accessToken) {
      throw new Error('[HubSpot] accessToken is required');
    }
    if (!options.mapping) {
      throw new Error('[HubSpot] mapping is required');
    }
    this.accessToken = options.accessToken;
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.mapper = new FieldMapper(options.mapping);
```

Appliquer le même patron à `pipedrive.ts`, `salesforce.ts`, `zoho.ts` (retirer l'import `loadMappingConfig`, exiger `options.mapping`, `new FieldMapper(options.mapping)`). Adapter le préfixe de message (`[Pipedrive]`, etc.).

- [ ] **Step 3: Supprimer `loadMappingConfig` de `field-mapper.ts`**

Retirer la fonction `loadMappingConfig` (lignes ~202-222) et les imports devenus inutiles (`fs`, `path`, `fileURLToPath`, `MAPPINGS_DIR`). Garder `FieldMapper`, tous les types, et les helpers.

- [ ] **Step 4: `crm-bridge.ts` résout et injecte le mapping**

Importer `getMapping` :

```typescript
import { getMapping } from './config-store.js';
```

Dans `instantiateConnector`, après la résolution des credentials et avant le `switch`, résoudre le mapping pour les connecteurs FieldMapper :

```typescript
  const FIELDMAPPER_CONNECTORS = new Set(['hubspot', 'pipedrive', 'salesforce', 'zoho']);
  let mapping;
  if (FIELDMAPPER_CONNECTORS.has(connectorType)) {
    const resolved = await getMapping(bot.client_id, bot.bot_id, connectorType);
    if (!resolved) {
      throw new Error(`[CrmBridge] no mapping configured for ${bot.client_id}/${bot.bot_id} -> ${connectorType}`);
    }
    mapping = resolved;
  }
```

Et passer `mapping` dans l'appel `createConnector` :

```typescript
    case 'hubspot':
    case 'attio':
    case 'pipedrive':
    case 'salesforce':
    case 'zoho':
    case 'webhook-generic':
      return createConnector({ type: connectorType, credentials, mapping });
```

(typer `let mapping: import('../connectors/field-mapper.js').FieldMapping | undefined;` ou via `FieldMapping` importé en type.)

- [ ] **Step 5: Adapter `crm-bridge.test.ts`**

Lire le test existant et remplacer la dépendance aux fichiers `connectors-config` par un seed DB AVANT `initCrmBridge`. Pour chaque bot de test ayant un connecteur FieldMapper (hubspot/pipedrive), seeder un mapping minimal :

```typescript
import { upsertMapping } from '../config-store.js';
// dans le setup, après __setDatabaseForTests(db) et l'init des bots :
const minimalMapping = { version: 1, connector: 'hubspot', target_object: 'contacts', client_id: 'default', field_mapping: [{ source: 'email', target: 'email' }] };
await upsertMapping('default', null, 'hubspot', minimalMapping);
// idem pour 'pipedrive' si le test le couvre
```

Adapter aux bots/connecteurs réellement exercés par le test (lire le fichier pour voir lesquels). Le test doit rester vert.

- [ ] **Step 6: Étendre `import-config-to-db.ts`**

Ajouter, après l'import des bots dans `main()` :

```typescript
  await importMappings(db);
```

Et la fonction (avant `main`), avec la constante du dossier :

```typescript
const MAPPINGS_DIR = path.join(__dirname, '..', 'connectors-config');

export async function importMappings(db: import('../src/core/database/types.js').Database): Promise<void> {
  if (!fs.existsSync(MAPPINGS_DIR)) { console.log('[Import] no connectors-config/ directory'); return; }
  const clients = fs.readdirSync(MAPPINGS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  let count = 0;
  for (const clientId of clients) {
    const files = fs.readdirSync(path.join(MAPPINGS_DIR, clientId)).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const connector = file.replace(/\.json$/, '');
      const parsed = JSON.parse(fs.readFileSync(path.join(MAPPINGS_DIR, clientId, file), 'utf-8')) as Record<string, unknown>;
      await db.upsertConnectorMapping({ client_id: clientId, bot_id: null, connector, mapping: parsed });
      count++;
      console.log(`[Import] mapping ${clientId}/${connector}`);
    }
  }
  console.log(`[Import] ${count} mapping(s) importé(s).`);
}
```

- [ ] **Step 7: Vérifier tsc + suite connecteurs + bridge**

Run: `npm run typecheck && npx vitest run src/connectors/ src/core/__tests__/crm-bridge.test.ts`
Expected: tsc propre, tests verts. (Les tests unitaires connecteurs passent déjà `options.mapping` directement — ils ne doivent pas régresser.)

- [ ] **Step 8: Vérifier l'import (sqlite local)**

Run: `CREDENTIALS_ENCRYPTION_KEY=$(openssl rand -hex 32) ANTHROPIC_API_KEY=x npx tsx scripts/import-config-to-db.ts`
Expected: logs `[Import] mapping default/hubspot` etc. + bots importés. Nettoyer : `rm -f store/demo.db store/demo.db-wal store/demo.db-shm`

- [ ] **Step 9: Commit**

```bash
git add src/connectors/ src/core/crm-bridge.ts src/core/__tests__/crm-bridge.test.ts scripts/import-config-to-db.ts
git commit -m "refactor(crm): mappings résolus en DB par le bridge (fin du loader fichier)"
```

---

## Task 4: Helper d'audit + contrats Zod bots

**Files:**
- Create: `src/core/audit.ts`, `src/core/auth/__tests__/audit.test.ts`, `src/contracts/bots.ts`
- Modify: `src/contracts/index.ts`
- Test: `src/contracts/__tests__/contracts.test.ts` (ajout)

**Interfaces:**
- Produces :
  - `recordAudit(db: Database, entry: AuditLogInput): Promise<void>` — best-effort (try/catch, log, ne throw jamais).
  - Schémas Zod : `LocalizedInput` (Record langue→texte non vide), `CreateBotInput`, `UpdateBotInput`, `SetNumbersInput`, `SetBotStatusInput` + types inférés.

> NOTE implémenteur : `CreateBotInput` reflète `BotRecord` sans `client_id` (vient du scope) ni timestamps. Contenu localisé = `z.record(z.string().min(1))` (clé = code langue). `transport` enum `['meta-cloud','cm-com']`. `status` non dans CreateBotInput (toujours créé `draft`). `bot_id` slug `/^[a-z0-9][a-z0-9-]*$/`. `SetBotStatusInput.status` enum `['draft','active','paused']`. `SetNumbersInput.numbers` = `z.array(z.string()).` `recordAudit` ne valide rien, avale les erreurs.

- [ ] **Step 1: Tests (échec attendu)**

Créer `src/core/auth/__tests__/audit.test.ts` :

```typescript
import { describe, expect, it, vi } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import { recordAudit } from '../../audit.js';

describe('recordAudit', () => {
  it('écrit une ligne d\'audit', async () => {
    const db = createSqliteDriver(':memory:');
    await recordAudit(db, { actor_user_id: 1, action: 'bot.create', target: 'bot:acme/immo', client_id: 'acme', metadata: null });
    expect(await db.listAuditLog('acme')).toHaveLength(1);
    await db.close();
  });

  it('ne throw jamais si l\'insert échoue', async () => {
    const broken = { insertAuditLog: vi.fn().mockRejectedValue(new Error('db down')) } as unknown as Parameters<typeof recordAudit>[0];
    await expect(recordAudit(broken, { actor_user_id: null, action: 'x', target: 'y', client_id: null, metadata: null })).resolves.toBeUndefined();
  });
});
```

Ajouter à `src/contracts/__tests__/contracts.test.ts` (nouveau bloc) :

```typescript
import { CreateBotInput, SetNumbersInput, SetBotStatusInput } from '../index.js';

describe('contracts: bots', () => {
  it('CreateBotInput valide un bot minimal', () => {
    const r = CreateBotInput.parse({
      bot_id: 'immo', name: 'Immo', transport: 'meta-cloud',
      system_prompt: { fr: 'Tu es un agent.' }, lead_fields: 'nom,email',
      welcome: { enabled: true, message: { fr: 'Bonjour' } },
    });
    expect(r.bot_id).toBe('immo');
  });
  it('CreateBotInput rejette un bot_id invalide', () => {
    expect(() => CreateBotInput.parse({ bot_id: 'Immo Bot', name: 'x', transport: 'meta-cloud', system_prompt: { fr: 'a' }, lead_fields: '', welcome: { enabled: false, message: {} } })).toThrow();
  });
  it('CreateBotInput rejette un transport inconnu', () => {
    expect(() => CreateBotInput.parse({ bot_id: 'immo', name: 'x', transport: 'sms', system_prompt: { fr: 'a' }, lead_fields: '', welcome: { enabled: false, message: {} } })).toThrow();
  });
  it('SetNumbersInput + SetBotStatusInput', () => {
    expect(SetNumbersInput.parse({ numbers: ['+33611', '33622'] }).numbers).toHaveLength(2);
    expect(() => SetBotStatusInput.parse({ status: 'live' })).toThrow();
    expect(SetBotStatusInput.parse({ status: 'active' }).status).toBe('active');
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/core/auth/__tests__/audit.test.ts src/contracts/`
Expected: FAIL.

- [ ] **Step 3: `src/core/audit.ts`**

```typescript
import type { Database, AuditLogInput } from './database/types.js';

/**
 * Journalise une mutation admin (best-effort). N'échoue jamais : une erreur
 * d'audit ne doit pas casser l'opération métier qui l'a déclenchée.
 */
export async function recordAudit(db: Database, entry: AuditLogInput): Promise<void> {
  try {
    await db.insertAuditLog(entry);
  } catch (err) {
    console.error('[Audit] Échec écriture audit_log:', err);
  }
}
```

- [ ] **Step 4: `src/contracts/bots.ts`**

```typescript
import { z } from 'zod';

/** Contenu localisé : { "fr": "...", "en": "..." }. Au moins une langue, valeurs non vides. */
export const LocalizedInput = z.record(z.string().min(1));
export type LocalizedInput = z.infer<typeof LocalizedInput>;

const botId = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, 'bot_id: minuscules, chiffres, tirets.');
const transport = z.enum(['meta-cloud', 'cm-com']);

export const CreateBotInput = z.object({
  bot_id: botId,
  name: z.string().min(1),
  transport,
  default_language: z.string().min(2).max(8).default('fr'),
  languages: z.array(z.string().min(2).max(8)).default(['fr']),
  system_prompt: LocalizedInput,
  lead_fields: z.string().default(''),
  welcome: z.object({ enabled: z.boolean(), message: z.record(z.string()) }),
  error_messages: z.record(z.string()).default({}),
  catalog: z.object({ meta_catalog_id: z.string().optional() }).nullable().default(null),
  llm: z.object({ model: z.string().optional(), mode: z.string().optional() }).nullable().default(null),
  crm: z.object({ connector: z.string() }).nullable().default(null),
});
export type CreateBotInput = z.infer<typeof CreateBotInput>;

export const UpdateBotInput = CreateBotInput.partial().omit({ bot_id: true });
export type UpdateBotInput = z.infer<typeof UpdateBotInput>;

export const SetNumbersInput = z.object({ numbers: z.array(z.string()) });
export type SetNumbersInput = z.infer<typeof SetNumbersInput>;

export const SetBotStatusInput = z.object({ status: z.enum(['draft', 'active', 'paused']) });
export type SetBotStatusInput = z.infer<typeof SetBotStatusInput>;
```

- [ ] **Step 5: Ré-exporter dans `src/contracts/index.ts`**

Ajouter :

```typescript
export * from './bots.js';
```

- [ ] **Step 6: Vérifier le succès + tsc**

Run: `npm run typecheck && npx vitest run src/core/auth/__tests__/audit.test.ts src/contracts/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/audit.ts src/core/auth/__tests__/audit.test.ts src/contracts/bots.ts src/contracts/index.ts src/contracts/__tests__/contracts.test.ts
git commit -m "feat(core): helper recordAudit + contrats Zod bots"
```

---

## Task 5: BotService (CRUD bots + numéros + statut, avec audit)

**Files:**
- Create: `src/core/services/bot-service.ts`, `src/core/services/__tests__/bot-service.test.ts`

**Interfaces:**
- Consumes: `Database`, `ConfigStore` (`upsertBot`, `botRecordToConfig`), `recordAudit`, types `contracts/bots`, `BotRecord`, `AppError` fabriques.
- Produces (consommés par Task 6) : `BotService` construit avec `{ db: Database }`, méthodes :
  - `listBots(clientId: string): Promise<BotSummary[]>`
  - `getBot(clientId: string, botId: string): Promise<BotDetail>`
  - `createBot(clientId: string, actorUserId: number | null, input: CreateBotInput): Promise<BotDetail>`
  - `updateBot(clientId: string, botId: string, actorUserId: number | null, patch: UpdateBotInput): Promise<BotDetail>`
  - `setStatus(clientId: string, botId: string, actorUserId: number | null, status: string): Promise<BotDetail>`
  - `setNumbers(clientId: string, botId: string, actorUserId: number | null, numbers: string[]): Promise<BotDetail>`
  - Types `BotSummary` (record + numbers) et `BotDetail` (= BotRecord + `numbers: string[]`).

> NOTE implémenteur :
> - `createBot` : `getBotRecord(clientId, bot_id)` existant → `conflict('bot_id déjà pris.')`. Sinon construire un `BotRecord` (client_id du scope, status `'draft'`) depuis l'input, `ConfigStore.upsertBot(rec, [])` (pas de numéro à la création), `recordAudit(action:'bot.create')`. Retourner le détail.
> - `setStatus` : bot doit exister (`notFound` sinon). Transition vers `'active'` exige **≥1 numéro** (`db.listBotNumbers` filtré sur ce bot) → sinon `conflict('Au moins un numéro WhatsApp est requis pour activer.')`. (Le gate complet « WhatsApp validé » viendra au Plan 4b.) Mettre à jour le record (même contenu, status changé) via `ConfigStore.upsertBot(rec, currentNumbers)`. Audit `bot.status`.
> - `setNumbers` : bot doit exister. **Conflit d'unicité globale** : pour chaque numéro normalisé (digits), vérifier `db.listBotNumbers()` qu'aucun n'appartient à un AUTRE (client_id, bot_id) → sinon `conflict('Numéro déjà routé vers un autre bot.')`. Puis `ConfigStore.upsertBot(rec, numbers)` (réutilise le refresh cache + purge). Audit `bot.numbers`.
> - `updateBot` : bot doit exister. Merge le patch sur le `BotRecord` existant (champs fournis uniquement), `ConfigStore.upsertBot(rec, currentNumbers)`. Audit `bot.update`.
> - `BotDetail` = `{ ...BotRecord, numbers }`. `getBot` lit `getBotRecord` + filtre `listBotNumbers`.
> - Normalisation numéros : `n.replace(/\D/g, '')`, filtrer les vides.

- [ ] **Step 1: Test (échec attendu)**

Créer `src/core/services/__tests__/bot-service.test.ts` :

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import { __setDatabaseForTests } from '../../database/index.js';
import { resetConfigStore } from '../../config-store.js';
import { BotService } from '../bot-service.js';
import type { Database } from '../../database/types.js';
import type { CreateBotInput } from '../../../contracts/index.js';

const input = (over: Partial<CreateBotInput> = {}): CreateBotInput => ({
  bot_id: 'immo', name: 'Immo', transport: 'meta-cloud',
  default_language: 'fr', languages: ['fr'],
  system_prompt: { fr: 'Tu es un agent.' }, lead_fields: 'nom,email',
  welcome: { enabled: true, message: { fr: 'Bonjour' } },
  error_messages: {}, catalog: null, llm: null, crm: null, ...over,
});

describe('BotService', () => {
  let db: Database;
  let svc: BotService;
  beforeEach(async () => {
    db = createSqliteDriver(':memory:'); __setDatabaseForTests(db); resetConfigStore();
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.upsertClient({ client_id: 'other', name: 'Other', status: 'active' });
    svc = new BotService({ db });
  });
  afterEach(async () => { resetConfigStore(); await db.close(); });

  it('createBot crée un bot draft + audit', async () => {
    const bot = await svc.createBot('acme', 7, input());
    expect(bot.status).toBe('draft');
    expect(bot.client_id).toBe('acme');
    expect(bot.numbers).toEqual([]);
    expect(await db.listAuditLog('acme')).toHaveLength(1);
  });

  it('createBot en doublon → CONFLICT', async () => {
    await svc.createBot('acme', 7, input());
    await expect(svc.createBot('acme', 7, input())).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('setStatus active exige au moins un numéro', async () => {
    await svc.createBot('acme', 7, input());
    await expect(svc.setStatus('acme', 'immo', 7, 'active')).rejects.toMatchObject({ code: 'CONFLICT' });
    await svc.setNumbers('acme', 'immo', 7, ['+33611111111']);
    const bot = await svc.setStatus('acme', 'immo', 7, 'active');
    expect(bot.status).toBe('active');
  });

  it('setNumbers refuse un numéro déjà routé vers un autre bot', async () => {
    await svc.createBot('acme', 7, input());
    await svc.createBot('acme', 7, input({ bot_id: 'auto' }));
    await svc.setNumbers('acme', 'immo', 7, ['+33611111111']);
    await expect(svc.setNumbers('acme', 'auto', 7, ['33611111111'])).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('getBot inconnu → NOT_FOUND ; listBots scopé', async () => {
    await svc.createBot('acme', 7, input());
    await expect(svc.getBot('acme', 'ghost')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await svc.listBots('acme')).toHaveLength(1);
    expect(await svc.listBots('other')).toHaveLength(0);
  });

  it('updateBot merge le patch (nom) + audit', async () => {
    await svc.createBot('acme', 7, input());
    const bot = await svc.updateBot('acme', 'immo', 7, { name: 'Immobilier' });
    expect(bot.name).toBe('Immobilier');
    expect(bot.system_prompt).toEqual({ fr: 'Tu es un agent.' }); // inchangé
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/core/services/__tests__/bot-service.test.ts`
Expected: FAIL.

- [ ] **Step 3: `src/core/services/bot-service.ts`**

```typescript
import type { Database, BotRecord } from '../database/types.js';
import type { CreateBotInput, UpdateBotInput } from '../../contracts/index.js';
import { upsertBot } from '../config-store.js';
import { recordAudit } from '../audit.js';
import { conflict, notFound } from '../../api/errors.js';

export interface BotDetail extends BotRecord { numbers: string[]; }
export type BotSummary = BotDetail;

export interface BotServiceDeps { db: Database; }

function normalizeNumbers(numbers: string[]): string[] {
  return numbers.map((n) => n.replace(/\D/g, '')).filter(Boolean);
}

function inputToRecord(clientId: string, input: CreateBotInput): BotRecord {
  return {
    client_id: clientId,
    bot_id: input.bot_id,
    name: input.name,
    transport: input.transport,
    status: 'draft',
    default_language: input.default_language,
    languages: input.languages,
    system_prompt: input.system_prompt,
    lead_fields: input.lead_fields,
    welcome: input.welcome,
    error_messages: input.error_messages,
    catalog: input.catalog,
    llm: input.llm,
    crm: input.crm,
  };
}

export class BotService {
  private readonly db: Database;
  constructor(deps: BotServiceDeps) { this.db = deps.db; }

  private async numbersOf(clientId: string, botId: string): Promise<string[]> {
    return (await this.db.listBotNumbers())
      .filter((n) => n.client_id === clientId && n.bot_id === botId)
      .map((n) => n.whatsapp_number);
  }

  private async detail(rec: BotRecord): Promise<BotDetail> {
    return { ...rec, numbers: await this.numbersOf(rec.client_id, rec.bot_id) };
  }

  async listBots(clientId: string): Promise<BotSummary[]> {
    const recs = (await this.db.listBotRecords()).filter((r) => r.client_id === clientId);
    return Promise.all(recs.map((r) => this.detail(r)));
  }

  async getBot(clientId: string, botId: string): Promise<BotDetail> {
    const rec = await this.db.getBotRecord(clientId, botId);
    if (!rec) throw notFound('Bot introuvable.');
    return this.detail(rec);
  }

  async createBot(clientId: string, actorUserId: number | null, input: CreateBotInput): Promise<BotDetail> {
    if (await this.db.getBotRecord(clientId, input.bot_id)) throw conflict('bot_id déjà pris.');
    const rec = inputToRecord(clientId, input);
    await upsertBot(rec, []);
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'bot.create', target: `bot:${clientId}/${rec.bot_id}`, client_id: clientId, metadata: { name: rec.name } });
    return this.detail(rec);
  }

  async updateBot(clientId: string, botId: string, actorUserId: number | null, patch: UpdateBotInput): Promise<BotDetail> {
    const existing = await this.db.getBotRecord(clientId, botId);
    if (!existing) throw notFound('Bot introuvable.');
    const merged: BotRecord = {
      ...existing,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.transport !== undefined ? { transport: patch.transport } : {}),
      ...(patch.default_language !== undefined ? { default_language: patch.default_language } : {}),
      ...(patch.languages !== undefined ? { languages: patch.languages } : {}),
      ...(patch.system_prompt !== undefined ? { system_prompt: patch.system_prompt } : {}),
      ...(patch.lead_fields !== undefined ? { lead_fields: patch.lead_fields } : {}),
      ...(patch.welcome !== undefined ? { welcome: patch.welcome } : {}),
      ...(patch.error_messages !== undefined ? { error_messages: patch.error_messages } : {}),
      ...(patch.catalog !== undefined ? { catalog: patch.catalog } : {}),
      ...(patch.llm !== undefined ? { llm: patch.llm } : {}),
      ...(patch.crm !== undefined ? { crm: patch.crm } : {}),
    };
    const numbers = await this.numbersOf(clientId, botId);
    await upsertBot(merged, numbers);
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'bot.update', target: `bot:${clientId}/${botId}`, client_id: clientId, metadata: null });
    return this.detail(merged);
  }

  async setStatus(clientId: string, botId: string, actorUserId: number | null, status: string): Promise<BotDetail> {
    const existing = await this.db.getBotRecord(clientId, botId);
    if (!existing) throw notFound('Bot introuvable.');
    const numbers = await this.numbersOf(clientId, botId);
    if (status === 'active' && numbers.length === 0) {
      throw conflict('Au moins un numéro WhatsApp est requis pour activer.');
    }
    const updated: BotRecord = { ...existing, status };
    await upsertBot(updated, numbers);
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'bot.status', target: `bot:${clientId}/${botId}`, client_id: clientId, metadata: { status } });
    return this.detail(updated);
  }

  async setNumbers(clientId: string, botId: string, actorUserId: number | null, numbers: string[]): Promise<BotDetail> {
    const existing = await this.db.getBotRecord(clientId, botId);
    if (!existing) throw notFound('Bot introuvable.');
    const normalized = normalizeNumbers(numbers);
    const all = await this.db.listBotNumbers();
    for (const num of normalized) {
      const owner = all.find((n) => n.whatsapp_number === num);
      if (owner && !(owner.client_id === clientId && owner.bot_id === botId)) {
        throw conflict('Numéro déjà routé vers un autre bot.');
      }
    }
    await upsertBot(existing, normalized);
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'bot.numbers', target: `bot:${clientId}/${botId}`, client_id: clientId, metadata: { count: normalized.length } });
    return this.detail(existing);
  }
}
```

- [ ] **Step 4: Vérifier le succès + tsc**

Run: `npm run typecheck && npx vitest run src/core/services/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/services/bot-service.ts src/core/services/__tests__/bot-service.test.ts
git commit -m "feat(core): BotService (CRUD bots + numéros + statut, audité)"
```

---

## Task 6: Router `bots/*` + câblage scopeToClient + montage

**Files:**
- Create: `src/api/admin/routes/bots.ts`, `src/api/admin/__tests__/bots-routes.test.ts`
- Modify: `src/api/admin/router.ts`

**Interfaces:**
- Consumes: `BotService`, middlewares (`requireAuth`, `scopeToClient`), schémas `contracts/bots`, `wrap`.
- Produces : `botsRoutes(botService, wrap)` monté sous `/bots` dans `createAdminRouter`. `createAdminRouter` reçoit `botService` dans ses deps.

> NOTE implémenteur :
> - Toutes les routes `bots/*` : `requireAuth` + `scopeToClient`. Le `clientId` effectif = `req.scopedClientId`. Si absent (super_admin sans `?client_id`) → `validationError`/`forbidden('client_id requis')`. Le `actorUserId` = `req.auth!.userId`.
> - Endpoints :
>   - `GET /bots` → `listBots(scopedClientId)`.
>   - `POST /bots` → `CreateBotInput.parse` → `createBot` → 201.
>   - `GET /bots/:botId` → `getBot` → 200.
>   - `PATCH /bots/:botId` → `UpdateBotInput.parse` → `updateBot` → 200.
>   - `PUT /bots/:botId/numbers` → `SetNumbersInput.parse` → `setNumbers` → 200.
>   - `PUT /bots/:botId/status` → `SetBotStatusInput.parse` → `setStatus` → 200.
> - `req.params` typé strict express5 : utiliser `String(req.params['botId'])` (cf. Plan 3).
> - Helper local `requireScopedClient(req)` qui retourne `req.scopedClientId` ou throw `forbidden('client_id requis.')`.

- [ ] **Step 1: Test d'intégration (échec attendu)**

Créer `src/api/admin/__tests__/bots-routes.test.ts` :

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSqliteDriver } from '../../../core/database/sqlite.js';
import { __setDatabaseForTests } from '../../../core/database/index.js';
import { resetConfigStore } from '../../../core/config-store.js';
import type { Database } from '../../../core/database/types.js';
import { AuthService } from '../../../core/auth/auth-service.js';
import { AdminService } from '../../../core/auth/admin-service.js';
import { BotService } from '../../../core/services/bot-service.js';
import type { Mailer } from '../../../core/auth/mailer.js';
import { hashPassword } from '../../../core/auth/passwords.js';
import { createAdminRouter } from '../router.js';

class FakeMailer implements Mailer {
  async sendInvitation() {} async sendPasswordReset() {}
}

const bot = { bot_id: 'immo', name: 'Immo', transport: 'meta-cloud', system_prompt: { fr: 'Agent.' }, lead_fields: 'nom', welcome: { enabled: false, message: {} } };

async function bearer(app: express.Express, email: string, password: string): Promise<string> {
  return (await request(app).post('/api/admin/v1/auth/login').send({ email, password })).body.access_token as string;
}

describe('bots routes', () => {
  let db: Database;
  let app: express.Express;
  beforeEach(async () => {
    process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!';
    process.env['ADMIN_BCRYPT_ROUNDS'] = '4';
    db = createSqliteDriver(':memory:'); __setDatabaseForTests(db); resetConfigStore();
    const mailer = new FakeMailer();
    app = express();
    app.use('/api/admin/v1', createAdminRouter({
      db, authService: new AuthService({ db, mailer }),
      adminService: new AdminService({ db, mailer }), botService: new BotService({ db }),
    }));
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.createUser({ email: 'ca@acme.test', password_hash: await hashPassword('motdepasse123'), role: 'client_admin', client_id: 'acme', status: 'active' });
    await db.createUser({ email: 'ca2@other.test', password_hash: await hashPassword('motdepasse123'), role: 'client_admin', client_id: 'other', status: 'active' });
    await db.upsertClient({ client_id: 'other', name: 'Other', status: 'active' });
  });
  afterEach(() => { resetConfigStore(); });

  it('client_admin crée un bot puis le liste (scopé)', async () => {
    const tok = await bearer(app, 'ca@acme.test', 'motdepasse123');
    const created = await request(app).post('/api/admin/v1/bots').set('Authorization', `Bearer ${tok}`).send(bot);
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('draft');
    const list = await request(app).get('/api/admin/v1/bots').set('Authorization', `Bearer ${tok}`);
    expect(list.body).toHaveLength(1);
  });

  it('isolation : un autre client_admin ne voit pas le bot', async () => {
    const tokA = await bearer(app, 'ca@acme.test', 'motdepasse123');
    await request(app).post('/api/admin/v1/bots').set('Authorization', `Bearer ${tokA}`).send(bot);
    const tokB = await bearer(app, 'ca2@other.test', 'motdepasse123');
    const list = await request(app).get('/api/admin/v1/bots').set('Authorization', `Bearer ${tokB}`);
    expect(list.body).toHaveLength(0);
    // accès direct au bot de acme depuis other -> 404 (scopé sur other)
    const direct = await request(app).get('/api/admin/v1/bots/immo').set('Authorization', `Bearer ${tokB}`);
    expect(direct.status).toBe(404);
  });

  it('numbers + activation', async () => {
    const tok = await bearer(app, 'ca@acme.test', 'motdepasse123');
    await request(app).post('/api/admin/v1/bots').set('Authorization', `Bearer ${tok}`).send(bot);
    const noNum = await request(app).put('/api/admin/v1/bots/immo/status').set('Authorization', `Bearer ${tok}`).send({ status: 'active' });
    expect(noNum.status).toBe(409);
    await request(app).put('/api/admin/v1/bots/immo/numbers').set('Authorization', `Bearer ${tok}`).send({ numbers: ['+33611111111'] });
    const active = await request(app).put('/api/admin/v1/bots/immo/status').set('Authorization', `Bearer ${tok}`).send({ status: 'active' });
    expect(active.status).toBe(200);
    expect(active.body.status).toBe('active');
  });

  it('sans token → 401 ; payload invalide → 400', async () => {
    expect((await request(app).get('/api/admin/v1/bots')).status).toBe(401);
    const tok = await bearer(app, 'ca@acme.test', 'motdepasse123');
    const bad = await request(app).post('/api/admin/v1/bots').set('Authorization', `Bearer ${tok}`).send({ bot_id: 'Bad Id' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/api/admin/__tests__/bots-routes.test.ts`
Expected: FAIL.

- [ ] **Step 3: `src/api/admin/routes/bots.ts`**

```typescript
import { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import type { BotService } from '../../../core/services/bot-service.js';
import { CreateBotInput, UpdateBotInput, SetNumbersInput, SetBotStatusInput } from '../../../contracts/index.js';
import { requireAuth, scopeToClient } from '../../middleware/auth.js';
import { forbidden } from '../../errors.js';

function requireScopedClient(req: Request): string {
  if (!req.scopedClientId) throw forbidden('client_id requis (super_admin : préciser ?client_id).');
  return req.scopedClientId;
}

export function botsRoutes(botService: BotService, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router();
  r.use(requireAuth, scopeToClient);

  r.get('/', wrap(async (req, res) => {
    res.json(await botService.listBots(requireScopedClient(req)));
  }));

  r.post('/', wrap(async (req, res) => {
    const clientId = requireScopedClient(req);
    const body = CreateBotInput.parse(req.body);
    res.status(201).json(await botService.createBot(clientId, req.auth!.userId, body));
  }));

  r.get('/:botId', wrap(async (req, res) => {
    res.json(await botService.getBot(requireScopedClient(req), String(req.params['botId'])));
  }));

  r.patch('/:botId', wrap(async (req, res) => {
    const clientId = requireScopedClient(req);
    const body = UpdateBotInput.parse(req.body);
    res.json(await botService.updateBot(clientId, String(req.params['botId']), req.auth!.userId, body));
  }));

  r.put('/:botId/numbers', wrap(async (req, res) => {
    const clientId = requireScopedClient(req);
    const body = SetNumbersInput.parse(req.body);
    res.json(await botService.setNumbers(clientId, String(req.params['botId']), req.auth!.userId, body.numbers));
  }));

  r.put('/:botId/status', wrap(async (req, res) => {
    const clientId = requireScopedClient(req);
    const body = SetBotStatusInput.parse(req.body);
    res.json(await botService.setStatus(clientId, String(req.params['botId']), req.auth!.userId, body.status));
  }));

  return r;
}
```

- [ ] **Step 4: Monter dans `src/api/admin/router.ts`**

Étendre `AdminRouterDeps` et monter `bots` :

```typescript
import { botsRoutes } from './routes/bots.js';
import type { BotService } from '../../core/services/bot-service.js';
```

Ajouter `botService: BotService;` à `AdminRouterDeps`, et après le montage de `/clients` :

```typescript
  r.use('/bots', botsRoutes(deps.botService, wrap));
```

- [ ] **Step 5: Vérifier le succès + suite complète + tsc**

Run: `npm run typecheck && npm test`
Expected: tsc propre, toute la suite verte (les tests Plan 3 `auth-routes`/`clients-routes` qui appellent `createAdminRouter` doivent recevoir le nouveau `botService` — METTRE À JOUR ces deux fichiers de test pour passer `botService: new BotService({ db })` dans `createAdminRouter`, sinon tsc casse). Importer `BotService` dans ces deux fichiers.

> NOTE : Cette mise à jour des appels `createAdminRouter` dans `auth-routes.test.ts` et `clients-routes.test.ts` fait partie de cette étape (sinon `AdminRouterDeps` exige `botService`). Ajouter l'import et le champ `botService: new BotService({ db })`.

- [ ] **Step 6: Commit**

```bash
git add src/api/admin/routes/bots.ts src/api/admin/router.ts src/api/admin/__tests__/
git commit -m "feat(api): router bots/* (CRUD + numéros + statut) scopé par client"
```

---

## Self-Review (auteur du plan)

**1. Couverture du périmètre 4a :**
- `bots/*` CRUD (draft→active), `:botId/numbers` (unicité globale), `:botId/status` → Tasks 5-6. ✅
- migration `connector_mappings` en DB (fin loader fichier) → Tasks 1-3. ✅
- `audit_log` + audit des mutations → Tasks 1, 4, 5. ✅
- `scopeToClient` câblé (premier usage) → Task 6. ✅
- **Hors 4a (→ 4b/4c)** : credentials, transport/crm-validate, llm, mappings endpoints, simulate, leads/health/metrics/usage. `getMapping`/`upsertMapping` posés ici, mais les **endpoints** mapping sont en 4b.

**2. Placeholders :** aucun ; code complet.

**3. Cohérence des types :** `BotDetail`/`BotSummary` = `BotRecord + numbers`, cohérent service↔routes. `CreateBotInput` (contracts) ↔ `inputToRecord` (service) alignés champ à champ avec `BotRecord`. `ConnectorMappingRecord.mapping: Record<string,unknown>` (DB découplée) ↔ `FieldMapping` (cast en ConfigStore/bridge). `recordAudit(db, AuditLogInput)` ↔ appels BotService.

**Anticipation Plan 4b/4c :** `getMapping`/`upsertMapping` prêts pour les endpoints mapping (4b) ; `recordAudit` réutilisable pour credentials/transport (4b) ; `BotService` extensible (transport-validate écrira la config transport sur le bot) ; `listAuditLog` prêt pour un futur endpoint audit (4c/dashboard). Le gate d'activation passera de « ≥1 numéro » à « WhatsApp validé » au Plan 4b (point d'extension : `setStatus`).

**Risque identifié :** Task 3 (migration connecteurs) touche 9 fichiers + un test existant (`crm-bridge.test.ts`) — c'est le point le plus délicat. Le brief impose de lire le test avant de le ré-seeder en DB.

---

## Execution Handoff

Plan 4a complet. Deux options :
1. **Subagent-Driven (recommandé)** — un subagent par task, revue spec+qualité, revue finale.
2. **Inline** — exécution avec checkpoints.
