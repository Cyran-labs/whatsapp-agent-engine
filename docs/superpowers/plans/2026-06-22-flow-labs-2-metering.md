# Flow Labs — Plan 2 : Metering LLM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capturer, à chaque appel LLM, le modèle, la consommation de tokens et le **vrai coût Anthropic à l'instant T**, par client/bot, dans un journal append-only — base de l'analyse et de la facturation futures.

**Architecture:** Deux tables (`llm_pricing` versionnée + `llm_usage` append-only, SQLite + Postgres). Un `UsageRecorder` (interface pluggable) calcule le coût depuis le tarif courant et insère une ligne — **fire-and-forget, ne bloque ni ne ralentit jamais** la réponse. Câblé aux deux points d'appel : `chat()` (byo + platform) juste après le succès, et l'extracteur de leads. Un script seed amorce `llm_pricing` avec les tarifs Anthropic courants des modèles de la cascade.

**Tech Stack:** TypeScript strict ESM, Vitest (sqlite in-memory), better-sqlite3, pg.

## Global Constraints

- TypeScript strict : pas de `any`, `const` par défaut. (CLAUDE.md)
- Logs `[Metering] message` sans emoji. Jamais de secret/clé en clair. (CLAUDE.md)
- Author git : `Francois Greze <francois@cyran.fr>`, pas de signature Claude, pas de push.
- Toutes les méthodes `Database` async. SQLite seul testé en CI ; Postgres = mirror.
- Upsert DB = **UPDATE-then-INSERT** (PAS `ON CONFLICT`).
- La capture est **fire-and-forget** : elle ne doit jamais throw vers l'appelant ni ajouter de latence bloquante au chemin de réponse. Échec → log `[Metering]`, on continue.
- `cost_usd` est **calculé puis figé** dans `llm_usage` (vrai coût à T) ; `pricing_version` = id de la ligne `llm_pricing` utilisée (audit).
- Hors périmètre : `platform_key_id` reste **nullable et non peuplé** dans ce plan (attribution par clé du pool = ultérieure ; nécessiterait d'exposer l'id de clé depuis `KeyPool`). La facturation client (objectif) repose sur `client_id` + `cost_usd`, indépendante de ce champ.
- Hors périmètre : UI/agrégations de lecture (Plan 4/7), facturation/marge/quotas.

## Données de référence — tarifs Anthropic (USD / million de tokens)

Tarifs à seeder (cache read ≈ 0,1× input ; cache write éphémère ≈ 1,25× input) :

| model | input | output | cache_read | cache_write |
|---|---|---|---|---|
| `claude-sonnet-4-20250514` | 3 | 15 | 0.30 | 3.75 |
| `claude-sonnet-4-5-20250929` | 3 | 15 | 0.30 | 3.75 |
| `claude-haiku-4-5-20251001` | 1 | 5 | 0.10 | 1.25 |

---

### Task 1 : Tables `llm_pricing` + `llm_usage` (types + DB)

**Files:**
- Modify: `src/core/database/types.ts`
- Modify: `src/core/database/sqlite.ts`
- Modify: `src/core/database/postgres.ts`
- Test: `src/core/database/__tests__/metering-tables.test.ts` (create)

**Interfaces:**
- Consumes: rien.
- Produces :
  ```ts
  export interface LlmPricingRecord {
    id: number; model: string;
    input_per_mtok: number; output_per_mtok: number;
    cache_read_per_mtok: number; cache_write_per_mtok: number;
    currency: string; effective_from: string; effective_to: string | null;
  }
  export interface LlmPricingInput {
    model: string; input_per_mtok: number; output_per_mtok: number;
    cache_read_per_mtok: number; cache_write_per_mtok: number; currency: string;
  }
  export interface LlmUsageInput {
    client_id: string; bot_id: string | null; phone: string | null;
    call_type: string; mode: string; platform_key_id: number | null;
    model: string;
    input_tokens: number; output_tokens: number;
    cache_read_tokens: number; cache_creation_tokens: number;
    cost_usd: number; pricing_version: number | null;
    anthropic_request_id: string | null;
  }
  export interface LlmUsageRow extends LlmUsageInput { id: number; created_at: string; }
  ```
  Méthodes `Database` :
  ```ts
  getLlmPricing(model: string): Promise<LlmPricingRecord | undefined>; // tarif courant (effective_to IS NULL)
  upsertLlmPricing(rec: LlmPricingInput): Promise<void>;               // remplace le tarif courant du modèle
  insertLlmUsage(rec: LlmUsageInput): Promise<void>;
  listLlmUsage(clientId: string): Promise<LlmUsageRow[]>;              // lecture (tests + futur dashboard)
  ```

Note `upsertLlmPricing` (versionné) : clôt le tarif courant du modèle (`effective_to = now`) s'il existe, puis insère une nouvelle ligne courante (`effective_to = NULL`). Ainsi l'historique est conservé et `getLlmPricing` renvoie toujours la ligne courante.

- [ ] **Step 1: Write the failing test**

Create `src/core/database/__tests__/metering-tables.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../sqlite.js';
import type { Database, LlmUsageInput } from '../types.js';

function usage(over: Partial<LlmUsageInput> = {}): LlmUsageInput {
  return {
    client_id: 'acme', bot_id: 'immo', phone: '33611', call_type: 'chat', mode: 'platform',
    platform_key_id: null, model: 'claude-haiku-4-5-20251001',
    input_tokens: 1000, output_tokens: 200, cache_read_tokens: 0, cache_creation_tokens: 0,
    cost_usd: 0.002, pricing_version: 1, anthropic_request_id: 'req_1', ...over,
  };
}

describe('metering tables (sqlite)', () => {
  let db: Database;
  beforeEach(() => { db = createSqliteDriver(':memory:'); });
  afterEach(async () => { await db.close(); });

  it('upsertLlmPricing versionne : getLlmPricing renvoie le tarif courant', async () => {
    await db.upsertLlmPricing({ model: 'm', input_per_mtok: 3, output_per_mtok: 15, cache_read_per_mtok: 0.3, cache_write_per_mtok: 3.75, currency: 'USD' });
    await db.upsertLlmPricing({ model: 'm', input_per_mtok: 4, output_per_mtok: 16, cache_read_per_mtok: 0.4, cache_write_per_mtok: 5, currency: 'USD' });
    const cur = await db.getLlmPricing('m');
    expect(cur!.input_per_mtok).toBe(4);
    expect(cur!.effective_to).toBeNull();
  });

  it('getLlmPricing renvoie undefined pour un modèle inconnu', async () => {
    expect(await db.getLlmPricing('nope')).toBeUndefined();
  });

  it('insertLlmUsage append + listLlmUsage par client', async () => {
    await db.insertLlmUsage(usage());
    await db.insertLlmUsage(usage({ model: 'claude-sonnet-4-20250514', cost_usd: 0.05 }));
    await db.insertLlmUsage(usage({ client_id: 'other' }));
    const rows = await db.listLlmUsage('acme');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).toBeGreaterThan(0);
    expect(rows[0]!.created_at).toBeTruthy();
    expect(rows.map((r) => r.cost_usd).sort()).toEqual([0.002, 0.05]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/database/__tests__/metering-tables.test.ts`
Expected: FAIL — `upsertLlmPricing` not a function.

- [ ] **Step 3: Add types**

In `src/core/database/types.ts`, after the bots/clients block, add the 5 interfaces from the Interfaces section above (LlmPricingRecord, LlmPricingInput, LlmUsageInput, LlmUsageRow). In the `Database` interface, add the 4 method signatures.

- [ ] **Step 4: SQLite — schéma**

In `src/core/database/sqlite.ts` import line, add `LlmPricingRecord, LlmPricingInput, LlmUsageInput, LlmUsageRow`. In `SCHEMA`, before the closing backtick, add:

```sql

    CREATE TABLE IF NOT EXISTS llm_pricing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL,
      input_per_mtok REAL NOT NULL,
      output_per_mtok REAL NOT NULL,
      cache_read_per_mtok REAL NOT NULL,
      cache_write_per_mtok REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      effective_from TEXT DEFAULT (datetime('now')),
      effective_to TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_llm_pricing_model ON llm_pricing(model, effective_to);

    CREATE TABLE IF NOT EXISTS llm_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      bot_id TEXT,
      phone TEXT,
      call_type TEXT NOT NULL,
      mode TEXT NOT NULL,
      platform_key_id INTEGER,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      pricing_version INTEGER,
      anthropic_request_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_llm_usage_client ON llm_usage(client_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_llm_usage_bot ON llm_usage(client_id, bot_id, created_at);
```

- [ ] **Step 5: SQLite — méthodes**

In the `driver`, add:

```ts
    async getLlmPricing(model: string): Promise<LlmPricingRecord | undefined> {
      return db.prepare(
        `SELECT id, model, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok,
                currency, effective_from, effective_to
         FROM llm_pricing WHERE model = ? AND effective_to IS NULL ORDER BY id DESC LIMIT 1`
      ).get(model) as LlmPricingRecord | undefined;
    },

    async upsertLlmPricing(rec: LlmPricingInput): Promise<void> {
      db.prepare(`UPDATE llm_pricing SET effective_to = datetime('now') WHERE model = ? AND effective_to IS NULL`).run(rec.model);
      db.prepare(
        `INSERT INTO llm_pricing (model, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok, currency)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(rec.model, rec.input_per_mtok, rec.output_per_mtok, rec.cache_read_per_mtok, rec.cache_write_per_mtok, rec.currency);
    },

    async insertLlmUsage(rec: LlmUsageInput): Promise<void> {
      db.prepare(
        `INSERT INTO llm_usage (client_id, bot_id, phone, call_type, mode, platform_key_id, model,
           input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, pricing_version, anthropic_request_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(rec.client_id, rec.bot_id, rec.phone, rec.call_type, rec.mode, rec.platform_key_id, rec.model,
            rec.input_tokens, rec.output_tokens, rec.cache_read_tokens, rec.cache_creation_tokens,
            rec.cost_usd, rec.pricing_version, rec.anthropic_request_id);
    },

    async listLlmUsage(clientId: string): Promise<LlmUsageRow[]> {
      return db.prepare(
        `SELECT id, client_id, bot_id, phone, call_type, mode, platform_key_id, model,
                input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, pricing_version, anthropic_request_id, created_at
         FROM llm_usage WHERE client_id = ? ORDER BY id DESC`
      ).all(clientId) as LlmUsageRow[];
    },
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/core/database/__tests__/metering-tables.test.ts`
Expected: PASS (3/3).

- [ ] **Step 7: Postgres mirror**

In `src/core/database/postgres.ts` import line add the 4 types. In `SCHEMA` (before closing backtick):

```sql

    CREATE TABLE IF NOT EXISTS llm_pricing (
      id SERIAL PRIMARY KEY,
      model TEXT NOT NULL,
      input_per_mtok DOUBLE PRECISION NOT NULL,
      output_per_mtok DOUBLE PRECISION NOT NULL,
      cache_read_per_mtok DOUBLE PRECISION NOT NULL,
      cache_write_per_mtok DOUBLE PRECISION NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      effective_from TIMESTAMPTZ DEFAULT NOW(),
      effective_to TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_llm_pricing_model ON llm_pricing(model, effective_to);

    CREATE TABLE IF NOT EXISTS llm_usage (
      id SERIAL PRIMARY KEY,
      client_id TEXT NOT NULL,
      bot_id TEXT,
      phone TEXT,
      call_type TEXT NOT NULL,
      mode TEXT NOT NULL,
      platform_key_id INTEGER,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      pricing_version INTEGER,
      anthropic_request_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_llm_usage_client ON llm_usage(client_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_llm_usage_bot ON llm_usage(client_id, bot_id, created_at);
```

Méthodes (après les méthodes config) :

```ts
    async getLlmPricing(model: string): Promise<LlmPricingRecord | undefined> {
      const r = await pool.query(
        `SELECT id, model, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok,
                currency, effective_from::text, effective_to::text
         FROM llm_pricing WHERE model = $1 AND effective_to IS NULL ORDER BY id DESC LIMIT 1`, [model]
      );
      return r.rows[0] as LlmPricingRecord | undefined;
    },

    async upsertLlmPricing(rec: LlmPricingInput): Promise<void> {
      await pool.query(`UPDATE llm_pricing SET effective_to = NOW() WHERE model = $1 AND effective_to IS NULL`, [rec.model]);
      await pool.query(
        `INSERT INTO llm_pricing (model, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok, currency)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [rec.model, rec.input_per_mtok, rec.output_per_mtok, rec.cache_read_per_mtok, rec.cache_write_per_mtok, rec.currency]
      );
    },

    async insertLlmUsage(rec: LlmUsageInput): Promise<void> {
      await pool.query(
        `INSERT INTO llm_usage (client_id, bot_id, phone, call_type, mode, platform_key_id, model,
           input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, pricing_version, anthropic_request_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [rec.client_id, rec.bot_id, rec.phone, rec.call_type, rec.mode, rec.platform_key_id, rec.model,
         rec.input_tokens, rec.output_tokens, rec.cache_read_tokens, rec.cache_creation_tokens, rec.cost_usd, rec.pricing_version, rec.anthropic_request_id]
      );
    },

    async listLlmUsage(clientId: string): Promise<LlmUsageRow[]> {
      const r = await pool.query(
        `SELECT id, client_id, bot_id, phone, call_type, mode, platform_key_id, model,
                input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, pricing_version, anthropic_request_id, created_at::text
         FROM llm_usage WHERE client_id = $1 ORDER BY id DESC`, [clientId]
      );
      return r.rows as LlmUsageRow[];
    },
```

- [ ] **Step 8: tsc + full suite + commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean + vert.

```bash
git add src/core/database/types.ts src/core/database/sqlite.ts src/core/database/postgres.ts src/core/database/__tests__/metering-tables.test.ts
git commit -m "feat(db): tables llm_pricing + llm_usage (metering)"
```

---

### Task 2 : `UsageRecorder` (calcul du coût + insertion fire-and-forget)

**Files:**
- Create: `src/llm/usage-recorder.ts`
- Test: `src/llm/__tests__/usage-recorder.test.ts` (create)

**Interfaces:**
- Consumes: `Database` (Task 1), `getDatabase`.
- Produces :
  ```ts
  export interface UsageEvent {
    clientId: string; botId: string | null; phone: string | null;
    callType: 'chat' | 'lead_extraction'; mode: 'byo' | 'platform';
    model: string; usage: unknown; // response.usage du SDK
    requestId?: string | null;
  }
  export function computeCost(p: { input: number; output: number; cacheRead: number; cacheCreation: number },
    pricing: { input_per_mtok: number; output_per_mtok: number; cache_read_per_mtok: number; cache_write_per_mtok: number }): number;
  export function extractTokens(usage: unknown): { input: number; output: number; cacheRead: number; cacheCreation: number };
  export async function recordUsage(ev: UsageEvent): Promise<void>; // fire-and-forget : ne throw jamais
  ```

`recordUsage` : extrait les tokens, lit le tarif courant (`getLlmPricing(model)`), calcule le coût (0 si tarif inconnu + warn `[Metering]`), insère la ligne. Tout est dans un `try/catch` qui log `[Metering]` et avale l'erreur (jamais de throw vers l'appelant). `platform_key_id` = `null` (hors périmètre).

- [ ] **Step 1: Write the failing test**

Create `src/llm/__tests__/usage-recorder.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteDriver } from '../../core/database/sqlite.js';
import { __setDatabaseForTests, getDatabase } from '../../core/database/index.js';
import { computeCost, extractTokens, recordUsage } from '../usage-recorder.js';

describe('computeCost', () => {
  it('somme input/output/cache au prorata du million de tokens', () => {
    const c = computeCost({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheCreation: 1_000_000 },
      { input_per_mtok: 3, output_per_mtok: 15, cache_read_per_mtok: 0.3, cache_write_per_mtok: 3.75 });
    expect(c).toBeCloseTo(3 + 15 + 0.3 + 3.75, 6);
  });
});

describe('extractTokens', () => {
  it('mappe les champs usage du SDK', () => {
    expect(extractTokens({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 }))
      .toEqual({ input: 10, output: 5, cacheRead: 2, cacheCreation: 1 });
  });
  it('défaut 0 sur champs absents / usage non-objet', () => {
    expect(extractTokens(null)).toEqual({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
  });
});

describe('recordUsage', () => {
  beforeEach(() => { __setDatabaseForTests(createSqliteDriver(':memory:')); });

  it('insère une ligne avec coût calculé depuis le tarif courant', async () => {
    await getDatabase().upsertLlmPricing({ model: 'm', input_per_mtok: 3, output_per_mtok: 15, cache_read_per_mtok: 0.3, cache_write_per_mtok: 3.75, currency: 'USD' });
    await recordUsage({ clientId: 'acme', botId: 'immo', phone: '33611', callType: 'chat', mode: 'platform',
      model: 'm', usage: { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    const rows = await getDatabase().listLlmUsage('acme');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cost_usd).toBeCloseTo(3, 6);
    expect(rows[0]!.model).toBe('m');
    expect(rows[0]!.call_type).toBe('chat');
  });

  it('tarif inconnu -> coût 0 mais ligne quand même enregistrée', async () => {
    await recordUsage({ clientId: 'acme', botId: null, phone: null, callType: 'chat', mode: 'byo',
      model: 'unknown', usage: { input_tokens: 100, output_tokens: 50 } });
    const rows = await getDatabase().listLlmUsage('acme');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cost_usd).toBe(0);
    expect(rows[0]!.input_tokens).toBe(100);
  });

  it('ne throw jamais (DB en échec avalé)', async () => {
    __setDatabaseForTests({ getLlmPricing: async () => { throw new Error('db down'); } } as never);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(recordUsage({ clientId: 'x', botId: null, phone: null, callType: 'chat', mode: 'byo', model: 'm', usage: {} })).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/llm/__tests__/usage-recorder.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implement**

Create `src/llm/usage-recorder.ts`:

```ts
/**
 * Enregistrement de l'usage LLM (tokens + coût réel à T) — fire-and-forget.
 *
 * Ne throw JAMAIS vers l'appelant et n'ajoute pas de latence bloquante : un échec
 * de metering ne doit jamais dégrader une réponse utilisateur. platform_key_id
 * n'est pas peuplé ici (attribution par clé du pool = ultérieure).
 */

import { getDatabase } from '../core/database/index.js';

export interface UsageEvent {
  clientId: string;
  botId: string | null;
  phone: string | null;
  callType: 'chat' | 'lead_extraction';
  mode: 'byo' | 'platform';
  model: string;
  usage: unknown;
  requestId?: string | null;
}

export function extractTokens(usage: unknown): { input: number; output: number; cacheRead: number; cacheCreation: number } {
  const u = (usage && typeof usage === 'object' ? usage : {}) as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === 'number' ? v : 0);
  return {
    input: n(u['input_tokens']),
    output: n(u['output_tokens']),
    cacheRead: n(u['cache_read_input_tokens']),
    cacheCreation: n(u['cache_creation_input_tokens']),
  };
}

export function computeCost(
  t: { input: number; output: number; cacheRead: number; cacheCreation: number },
  p: { input_per_mtok: number; output_per_mtok: number; cache_read_per_mtok: number; cache_write_per_mtok: number },
): number {
  const M = 1_000_000;
  return (t.input * p.input_per_mtok + t.output * p.output_per_mtok
    + t.cacheRead * p.cache_read_per_mtok + t.cacheCreation * p.cache_write_per_mtok) / M;
}

export async function recordUsage(ev: UsageEvent): Promise<void> {
  try {
    const db = getDatabase();
    const tokens = extractTokens(ev.usage);
    const pricing = await db.getLlmPricing(ev.model);
    let cost = 0;
    if (pricing) {
      cost = computeCost(tokens, pricing);
    } else {
      console.warn(`[Metering] No pricing for model ${ev.model} — cost recorded as 0`);
    }
    await db.insertLlmUsage({
      client_id: ev.clientId, bot_id: ev.botId, phone: ev.phone,
      call_type: ev.callType, mode: ev.mode, platform_key_id: null, model: ev.model,
      input_tokens: tokens.input, output_tokens: tokens.output,
      cache_read_tokens: tokens.cacheRead, cache_creation_tokens: tokens.cacheCreation,
      cost_usd: cost, pricing_version: pricing?.id ?? null,
      anthropic_request_id: ev.requestId ?? null,
    });
  } catch (err) {
    console.warn(`[Metering] record failed: ${(err as { message?: string }).message ?? 'unknown'}`);
  }
}
```

- [ ] **Step 4: Run test + tsc**

Run: `npx vitest run src/llm/__tests__/usage-recorder.test.ts && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add src/llm/usage-recorder.ts src/llm/__tests__/usage-recorder.test.ts
git commit -m "feat(llm): UsageRecorder (coût réel à T, fire-and-forget)"
```

---

### Task 3 : Seed des tarifs Anthropic

**Files:**
- Modify: `scripts/seed-credentials.ts` (réutilise le runner DB existant) OU create `scripts/seed-pricing.ts`
- Test: `src/llm/__tests__/seed-pricing.test.ts` (create)

Décision : **create `scripts/seed-pricing.ts`** (responsabilité unique, ne mélange pas avec les credentials).

**Interfaces:**
- Consumes: `Database.upsertLlmPricing` (Task 1).
- Produces : `export function buildPricingRows(): LlmPricingInput[]` (pur, testable) + `main()` qui upsert chaque ligne. Idempotent (upsertLlmPricing versionne).

- [ ] **Step 1: Write the failing test**

Create `src/llm/__tests__/seed-pricing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildPricingRows } from '../../../scripts/seed-pricing.js';

describe('buildPricingRows', () => {
  it('contient les 3 modèles de la cascade avec leurs tarifs', () => {
    const rows = buildPricingRows();
    const haiku = rows.find((r) => r.model === 'claude-haiku-4-5-20251001');
    expect(haiku).toEqual({ model: 'claude-haiku-4-5-20251001', input_per_mtok: 1, output_per_mtok: 5, cache_read_per_mtok: 0.1, cache_write_per_mtok: 1.25, currency: 'USD' });
    const sonnet = rows.find((r) => r.model === 'claude-sonnet-4-20250514');
    expect(sonnet!.input_per_mtok).toBe(3);
    expect(sonnet!.output_per_mtok).toBe(15);
    expect(rows).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/llm/__tests__/seed-pricing.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implement**

Create `scripts/seed-pricing.ts`:

```ts
/**
 * Seed des tarifs Anthropic courants (USD / million de tokens) dans llm_pricing.
 * Idempotent (upsertLlmPricing versionne). Exécuter : npx tsx scripts/seed-pricing.ts
 */

import 'dotenv/config';
import { initDatabase, getDatabase } from '../src/core/database/index.js';
import type { LlmPricingInput } from '../src/core/database/types.js';

export function buildPricingRows(): LlmPricingInput[] {
  const sonnet = (model: string): LlmPricingInput => ({
    model, input_per_mtok: 3, output_per_mtok: 15, cache_read_per_mtok: 0.3, cache_write_per_mtok: 3.75, currency: 'USD',
  });
  return [
    sonnet('claude-sonnet-4-20250514'),
    sonnet('claude-sonnet-4-5-20250929'),
    { model: 'claude-haiku-4-5-20251001', input_per_mtok: 1, output_per_mtok: 5, cache_read_per_mtok: 0.1, cache_write_per_mtok: 1.25, currency: 'USD' },
  ];
}

async function main(): Promise<void> {
  await initDatabase();
  const db = getDatabase();
  for (const row of buildPricingRows()) {
    await db.upsertLlmPricing(row);
    console.log(`[SeedPricing] ${row.model} (in=${row.input_per_mtok} out=${row.output_per_mtok})`);
  }
  console.log(`[SeedPricing] ${buildPricingRows().length} tarif(s) à jour.`);
  await db.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error('[SeedPricing] échec:', err); process.exit(1); });
}
```

- [ ] **Step 4: Run test + tsc + exécuter le seed**

Run: `npx vitest run src/llm/__tests__/seed-pricing.test.ts && npx tsc --noEmit && npx tsx scripts/seed-pricing.ts`
Expected: PASS + clean + logs `[SeedPricing] ...` sans erreur.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-pricing.ts src/llm/__tests__/seed-pricing.test.ts
git commit -m "feat(scripts): seed des tarifs Anthropic (llm_pricing)"
```

---

### Task 4 : Câblage de la capture (chat + extracteur de leads)

**Files:**
- Modify: `src/llm/anthropic.ts`
- Modify: `src/core/handler.ts`
- Test: `src/llm/__tests__/anthropic-metering.test.ts` (create)

**Interfaces:**
- Consumes: `recordUsage` (Task 2).
- Produces : `chat()` enregistre l'usage juste après chaque succès (byo + platform) ; l'extracteur enregistre avec `call_type='lead_extraction'`. Aucune modification de signature publique.

Note : `recordUsage` est **fire-and-forget** — on l'appelle SANS `await` bloquant (mais on attache `.catch` de sécurité ; en pratique `recordUsage` n'rejette jamais). Le `mode` côté chat vient de `resolveLlmCredentials` (déjà résolu en tête de `chat`). Pour l'extracteur, on résout le mode via `resolveLlmCredentials`.

- [ ] **Step 1: Write the failing test**

Create `src/llm/__tests__/anthropic-metering.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recorded: Array<{ model: string; callType: string; mode: string; clientId: string }> = [];
vi.mock('../usage-recorder.js', () => ({
  recordUsage: vi.fn(async (ev: { model: string; callType: string; mode: string; clientId: string }) => { recorded.push(ev); }),
}));
vi.mock('../../core/credentials/resolver.js', () => ({
  resolveLlmCredentials: vi.fn(async (clientId: string) => ({ apiKey: `sk-${clientId}`, mode: 'byo' })),
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 10, output_tokens: 4 } })) };
    constructor(_opts: { apiKey: string }) {}
  },
}));

import { chat } from '../anthropic.js';

describe('chat enregistre l\'usage', () => {
  beforeEach(() => { recorded.length = 0; });
  afterEach(() => vi.clearAllMocks());

  it('byo : une ligne usage call_type=chat après succès', async () => {
    const out = await chat('sys', [{ role: 'user', content: 'hi' }], { clientId: 'c1', botId: 'b1' });
    expect(out).toBe('ok');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ callType: 'chat', mode: 'byo', clientId: 'c1' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/llm/__tests__/anthropic-metering.test.ts`
Expected: FAIL — `recordUsage` jamais appelé (capture absente).

- [ ] **Step 3: Câbler dans chat()**

In `src/llm/anthropic.ts`, add the import:

```ts
import { recordUsage } from './usage-recorder.js';
```

In `chat()`, define a capture helper alongside `logUsage` (after the `logUsage` const):

```ts
  const capture = (model: string, response: { usage?: unknown }): void => {
    void recordUsage({
      clientId: opts.clientId, botId: opts.botId, phone: null,
      callType: 'chat', mode, model, usage: response.usage,
    });
  };
```

In the **byo** branch, right after `logUsage(response);` (before the `if (i > 0)` log / return), add `capture(model, response);`.
In the **platform** branch, right after `logUsage(response);`, add `capture(model, response);`.

(`mode` is in scope from the destructured `resolveLlmCredentials` result; `model` is the loop variable.)

- [ ] **Step 4: Run the chat test to verify it passes**

Run: `npx vitest run src/llm/__tests__/anthropic-metering.test.ts`
Expected: PASS.

- [ ] **Step 5: Câbler dans l'extracteur de leads**

In `src/core/handler.ts`, add imports:

```ts
import { recordUsage } from '../llm/usage-recorder.js';
import { resolveLlmCredentials } from './credentials/resolver.js';
```

In `extractAndSaveLead`, after the `response = await llmLimit(...)` call (the `client.messages.create` for the haiku extraction), add:

```ts
  resolveLlmCredentials(botCfg.client_id, botCfg.bot_id)
    .then((res) => recordUsage({
      clientId: botCfg.client_id, botId: botCfg.bot_id, phone,
      callType: 'lead_extraction', mode: res.mode,
      model: 'claude-haiku-4-5-20251001', usage: (response as { usage?: unknown }).usage,
    }))
    .catch(() => {});
```

(`phone` is the first parameter of `extractAndSaveLead`. Place this right after `response` is obtained, before the early `return` on non-text — so the call is always metered on success.)

- [ ] **Step 6: Run full suite + tsc**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean + vert (les tests existants de `anthropic.test.ts` doivent rester verts — `recordUsage` y est soit mocké soit no-op si la DB n'est pas initialisée ; vérifier qu'ils n'échouent pas. Si un test existant de `chat` n'a pas de DB et que `recordUsage` est réel, c'est OK car `recordUsage` avale ses erreurs).

- [ ] **Step 7: Commit**

```bash
git add src/llm/anthropic.ts src/core/handler.ts src/llm/__tests__/anthropic-metering.test.ts
git commit -m "feat(llm): capture de l'usage dans chat() + extracteur de leads"
```

---

## Self-Review

**Spec coverage (Metering)** :
- `llm_usage` + `llm_pricing` (sqlite+pg) → Task 1. ✓
- `UsageRecorder` (coût réel figé, fire-and-forget, pluggable) → Task 2. ✓
- Capture dans `chat()` (byo + platform) + extracteur → Task 4. ✓
- Coût calculé via tarif courant + `pricing_version` (audit) + figé → Task 2. ✓
- Seed tarifs → Task 3. ✓
- `platform_key_id` nullable non peuplé (déféré, documenté). ✓
- Ne bloque/ralentit jamais la réponse (fire-and-forget, erreurs avalées) → Task 2/4. ✓

**Placeholder scan** : aucun TODO/TBD ; code complet. ✓

**Type consistency** : `LlmUsageInput`/`LlmPricingInput`/`LlmPricingRecord` cohérents types.ts ↔ drivers ↔ recorder ↔ seed. `recordUsage(UsageEvent)` consommé par chat + extracteur avec les bons champs. `__setDatabaseForTests` (Plan 1) réutilisé. ✓

**Risque connu** : les tests existants de `anthropic.test.ts` appellent `chat` sans DB initialisée → `recordUsage` réel tentera `getDatabase()` et avalera l'erreur (`[Metering] record failed`) sans casser le test. Si du bruit de log gêne, mocker `usage-recorder` dans ces tests (à traiter au fil de l'exécution).
```
