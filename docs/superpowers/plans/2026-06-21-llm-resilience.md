# LLM Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En mode `platform`, encaisser le plafond de débit Anthropic via un pool de clés et garantir l'équité entre clients via une file d'attente par client — sans jamais rejeter un message (la file ralentit, ne coupe pas).

**Architecture:** Deux unités runtime sous `src/llm/` à responsabilité unique — `KeyPool` (sélection clé moins chargée + cooldown 429) et `ClientFairQueue` (concurrence par client, jamais de rejet) — composées dans `chat()` uniquement pour le mode `platform`. Le mode BYO reste strictement inchangé. Le pool de clés vit dans une table DB dédiée `platform_llm_keys` (chiffrée via le crypto existant). Les compteurs de charge sont en mémoire, derrière des interfaces pluggables pour un futur store partagé multi-instance.

**Tech Stack:** TypeScript strict ESM, Vitest (SDK Anthropic mocké), `p-limit` (déjà dépendance), `better-sqlite3` / `pg`, crypto AES-256-GCM existant.

## Global Constraints

- TypeScript strict : pas de `any`, `const` par défaut. (copié de CLAUDE.md)
- Logs format `[Service] message`, sans emoji. Jamais de clé/secret en clair dans un log. (spec §Erreurs/UX)
- Author git : `Francois Greze <francois@cyran.fr>`. Pas de signature Claude. Pas de push sans validation explicite.
- Mode BYO **totalement inchangé** : aucune file, aucun pool ne s'applique ; chemin actuel `getClientForTenant` + cascade + `withRetry`. (spec §Périmètre)
- Invariant UX : le quota est un **ordonnanceur d'équité**, jamais un interrupteur. Aucun message utilisateur n'est rejeté en contention. Seul échec visible = épuisement total (comportement actuel inchangé). (spec §Objectif)
- Défauts de config : `LLM_CLIENT_CONCURRENCY=3`, `LLM_KEY_COOLDOWN_MS=30000`. Lues via getters `config.*`. (spec §Configuration)
- Upsert DB = **UPDATE-then-INSERT** (PAS `ON CONFLICT` — non validable sans Postgres en CI). Cohérent avec `tenant_credentials`. (project_design_decisions)
- Toutes les méthodes `Database` sont async. SQLite est le seul driver testé en CI ; Postgres mirroir mécanique non testé runtime.
- Mono-instance aujourd'hui, mais les mécanismes exposent une interface pluggable (compteurs mémoire injectables) pour un store partagé futur. (spec §Périmètre)

---

### Task 1: Configuration — getters des nouvelles variables

**Files:**
- Modify: `src/core/config.ts`
- Modify: `.env.example`
- Test: `src/core/__tests__/config-llm.test.ts` (create)

**Interfaces:**
- Consumes: rien (premier task).
- Produces :
  - `config.llm.clientConcurrency: number` — getter, défaut `3`, lit `LLM_CLIENT_CONCURRENCY`.
  - `config.llm.keyCooldownMs: number` — getter, défaut `30000`, lit `LLM_KEY_COOLDOWN_MS`.
  - `config.llm.apiKeys: string[]` — getter, parse `ANTHROPIC_API_KEYS` (séparé par virgules, trim, vide filtrés) ; si absent, retombe sur `[ANTHROPIC_API_KEY]` (filtré si vide).

Note : `config.anthropic.apiKey` reste `required()` eager (inchangé). On ajoute un **nouveau** sous-objet `config.llm` en getters live (cohérent avec `config.meta`/`config.cm`).

- [ ] **Step 1: Write the failing test**

Create `src/core/__tests__/config-llm.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config.js';

describe('config.llm', () => {
  beforeEach(() => {
    // config.anthropic.apiKey est required() eager : il faut une clé au chargement du module.
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-boot');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('clientConcurrency défaut 3, override par env', () => {
    expect(config.llm.clientConcurrency).toBe(3);
    vi.stubEnv('LLM_CLIENT_CONCURRENCY', '5');
    expect(config.llm.clientConcurrency).toBe(5);
  });

  it('keyCooldownMs défaut 30000, override par env', () => {
    expect(config.llm.keyCooldownMs).toBe(30000);
    vi.stubEnv('LLM_KEY_COOLDOWN_MS', '1000');
    expect(config.llm.keyCooldownMs).toBe(1000);
  });

  it('apiKeys parse ANTHROPIC_API_KEYS séparé par virgules', () => {
    vi.stubEnv('ANTHROPIC_API_KEYS', 'sk-a, sk-b ,sk-c');
    expect(config.llm.apiKeys).toEqual(['sk-a', 'sk-b', 'sk-c']);
  });

  it('apiKeys retombe sur ANTHROPIC_API_KEY si ANTHROPIC_API_KEYS absent', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-single');
    expect(config.llm.apiKeys).toEqual(['sk-single']);
  });

  it('apiKeys vide si aucune source', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEYS', '');
    expect(config.llm.apiKeys).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/__tests__/config-llm.test.ts`
Expected: FAIL — `config.llm` undefined.

- [ ] **Step 3: Write minimal implementation**

In `src/core/config.ts`, add a `llm` block to the `config` object (after the `anthropic` block, before `hubspot`):

```ts
  llm: {
    get clientConcurrency(): number {
      return parseInt(process.env['LLM_CLIENT_CONCURRENCY'] || '3', 10);
    },
    get keyCooldownMs(): number {
      return parseInt(process.env['LLM_KEY_COOLDOWN_MS'] || '30000', 10);
    },
    get apiKeys(): string[] {
      const multi = (process.env['ANTHROPIC_API_KEYS'] || '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
      if (multi.length > 0) return multi;
      const single = (process.env['ANTHROPIC_API_KEY'] || '').trim();
      return single ? [single] : [];
    },
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/__tests__/config-llm.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Document in .env.example**

In `.env.example`, replace the `# --- LLM par défaut (overridable par tenant) ---` block (lines 16-17) with:

```
# --- LLM par défaut (overridable par tenant) ---
ANTHROPIC_API_KEY=
# Pool de clés plateforme (mode SaaS) : liste séparée par virgules. Si absent, ANTHROPIC_API_KEY sert de clé unique.
ANTHROPIC_API_KEYS=
# Concurrence max d'appels LLM en vol PAR CLIENT en mode platform (file d'attente au-delà, jamais de rejet).
LLM_CLIENT_CONCURRENCY=3
# Durée de mise en pause d'une clé du pool après un 429/529 (ms).
LLM_KEY_COOLDOWN_MS=30000
```

- [ ] **Step 6: Run tsc + commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add src/core/config.ts src/core/__tests__/config-llm.test.ts .env.example
git commit -m "feat(llm): config getters pour pool de clés et concurrence par client"
```

---

### Task 2: Couche DB — table `platform_llm_keys`

**Files:**
- Modify: `src/core/database/types.ts`
- Modify: `src/core/database/sqlite.ts`
- Modify: `src/core/database/postgres.ts`
- Test: `src/core/database/__tests__/platform-keys.test.ts` (create)

**Interfaces:**
- Consumes: rien des autres tasks.
- Produces :
  - Type `PlatformKeyRecord`:
    ```ts
    export interface PlatformKeyRecord {
      id: number;
      label: string;
      secret_encrypted: string;
      key_version: number;
      active: boolean;
    }
    ```
  - Type d'entrée upsert `PlatformKeyInput`:
    ```ts
    export interface PlatformKeyInput {
      label: string;
      secret_encrypted: string;
      key_version: number;
      active: boolean;
    }
    ```
  - Méthodes `Database` :
    - `listActivePlatformKeys(): Promise<PlatformKeyRecord[]>` — ne renvoie que `active = true`, ordonné par `id`.
    - `upsertPlatformKey(rec: PlatformKeyInput): Promise<void>` — idempotent par `label` (UPDATE-then-INSERT).

- [ ] **Step 1: Write the failing test**

Create `src/core/database/__tests__/platform-keys.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../sqlite.js';
import type { Database } from '../types.js';

describe('platform_llm_keys (sqlite)', () => {
  let db: Database;
  beforeEach(() => { db = createSqliteDriver(':memory:'); });
  afterEach(async () => { await db.close(); });

  it('upsert puis list ne renvoie que les clés actives', async () => {
    await db.upsertPlatformKey({ label: 'pool-1', secret_encrypted: 'enc1', key_version: 1, active: true });
    await db.upsertPlatformKey({ label: 'pool-2', secret_encrypted: 'enc2', key_version: 1, active: false });
    const active = await db.listActivePlatformKeys();
    expect(active.map((k) => k.label)).toEqual(['pool-1']);
    expect(active[0]!.active).toBe(true);
    expect(active[0]!.secret_encrypted).toBe('enc1');
  });

  it('upsert est idempotent par label (update, pas de doublon)', async () => {
    await db.upsertPlatformKey({ label: 'pool-1', secret_encrypted: 'old', key_version: 1, active: true });
    await db.upsertPlatformKey({ label: 'pool-1', secret_encrypted: 'new', key_version: 2, active: true });
    const active = await db.listActivePlatformKeys();
    expect(active).toHaveLength(1);
    expect(active[0]!.secret_encrypted).toBe('new');
    expect(active[0]!.key_version).toBe(2);
  });

  it('réactiver une clé désactivée via upsert', async () => {
    await db.upsertPlatformKey({ label: 'pool-1', secret_encrypted: 'e', key_version: 1, active: false });
    expect(await db.listActivePlatformKeys()).toHaveLength(0);
    await db.upsertPlatformKey({ label: 'pool-1', secret_encrypted: 'e', key_version: 1, active: true });
    expect(await db.listActivePlatformKeys()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/database/__tests__/platform-keys.test.ts`
Expected: FAIL — `upsertPlatformKey` not a function.

- [ ] **Step 3: Add types**

In `src/core/database/types.ts`, after the `CredentialRecord` interface (line 53), add:

```ts
export interface PlatformKeyRecord {
  id: number;
  label: string;
  secret_encrypted: string;
  key_version: number;
  active: boolean;
}

export interface PlatformKeyInput {
  label: string;
  secret_encrypted: string;
  key_version: number;
  active: boolean;
}
```

In the `Database` interface, after the credentials block (`listCredentials`, line 91), add:

```ts
  // Pool de clés LLM plateforme (infra, chiffrées)
  listActivePlatformKeys(): Promise<PlatformKeyRecord[]>;
  upsertPlatformKey(rec: PlatformKeyInput): Promise<void>;
```

- [ ] **Step 4: Implement sqlite**

In `src/core/database/sqlite.ts`:

Update the import line (line 5) to add the new types:

```ts
import type { Database, Session, SessionRow, HistoryRow, LeadRow, CrossConversationRow, CredentialRecord, PlatformKeyRecord, PlatformKeyInput } from './types.js';
```

In the `SCHEMA` template string, after the `uniq_tenant_credentials` index (before the closing backtick, line 72), add:

```sql

    CREATE TABLE IF NOT EXISTS platform_llm_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      secret_encrypted TEXT NOT NULL,
      key_version INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uniq_platform_llm_keys_label
      ON platform_llm_keys(label);
```

In the `driver` object, after `listCredentials` (line 238), add:

```ts
    async listActivePlatformKeys(): Promise<PlatformKeyRecord[]> {
      const rows = db.prepare(
        `SELECT id, label, secret_encrypted, key_version, active
         FROM platform_llm_keys WHERE active = 1 ORDER BY id`
      ).all() as Array<{ id: number; label: string; secret_encrypted: string; key_version: number; active: number }>;
      return rows.map((r) => ({ ...r, active: r.active === 1 }));
    },

    async upsertPlatformKey(rec: PlatformKeyInput): Promise<void> {
      const upd = db.prepare(
        `UPDATE platform_llm_keys
         SET secret_encrypted = ?, key_version = ?, active = ?, updated_at = datetime('now')
         WHERE label = ?`
      ).run(rec.secret_encrypted, rec.key_version, rec.active ? 1 : 0, rec.label);
      if (upd.changes === 0) {
        db.prepare(
          `INSERT INTO platform_llm_keys (label, secret_encrypted, key_version, active)
           VALUES (?, ?, ?, ?)`
        ).run(rec.label, rec.secret_encrypted, rec.key_version, rec.active ? 1 : 0);
      }
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/core/database/__tests__/platform-keys.test.ts`
Expected: PASS (3/3).

- [ ] **Step 6: Implement postgres (mirror, non testé en CI)**

In `src/core/database/postgres.ts`:

Update the import line (line 2):

```ts
import type { Database, Session, SessionRow, HistoryRow, LeadRow, CrossConversationRow, CredentialRecord, PlatformKeyRecord, PlatformKeyInput } from './types.js';
```

In the `SCHEMA` template string, after the `uniq_tenant_credentials` index (before the closing backtick, line 63), add:

```sql

    CREATE TABLE IF NOT EXISTS platform_llm_keys (
      id SERIAL PRIMARY KEY,
      label TEXT NOT NULL,
      secret_encrypted TEXT NOT NULL,
      key_version INTEGER NOT NULL DEFAULT 1,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uniq_platform_llm_keys_label
      ON platform_llm_keys(label);
```

In the `driver` object, after `listCredentials` (line 259), add:

```ts
    async listActivePlatformKeys(): Promise<PlatformKeyRecord[]> {
      const result = await pool.query(
        `SELECT id, label, secret_encrypted, key_version, active
         FROM platform_llm_keys WHERE active = TRUE ORDER BY id`
      );
      return result.rows as PlatformKeyRecord[];
    },

    async upsertPlatformKey(rec: PlatformKeyInput): Promise<void> {
      const upd = await pool.query(
        `UPDATE platform_llm_keys
         SET secret_encrypted = $2, key_version = $3, active = $4, updated_at = NOW()
         WHERE label = $1`,
        [rec.label, rec.secret_encrypted, rec.key_version, rec.active]
      );
      if (upd.rowCount === 0) {
        await pool.query(
          `INSERT INTO platform_llm_keys (label, secret_encrypted, key_version, active)
           VALUES ($1, $2, $3, $4)`,
          [rec.label, rec.secret_encrypted, rec.key_version, rec.active]
        );
      }
    },
```

- [ ] **Step 7: Run tsc + full DB tests + commit**

Run: `npx tsc --noEmit && npx vitest run src/core/database`
Expected: clean + green.

```bash
git add src/core/database/types.ts src/core/database/sqlite.ts src/core/database/postgres.ts src/core/database/__tests__/platform-keys.test.ts
git commit -m "feat(db): table platform_llm_keys + listActivePlatformKeys/upsertPlatformKey"
```

---

### Task 3: Resolver — exposer le `mode`

**Files:**
- Modify: `src/core/credentials/resolver.ts`
- Test: `src/core/credentials/__tests__/resolver.test.ts` (extend)

**Interfaces:**
- Consumes: rien.
- Produces : `resolveLlmCredentials(clientId, botId): Promise<{ apiKey: string; mode: 'byo' | 'platform' }>`.
  - byo avec `api_key` présent → `{ apiKey: obj.api_key, mode: 'byo' }`.
  - byo mal formé (api_key absent) → warning existant + `{ apiKey: env, mode: 'platform' }`.
  - mode platform OU aucun enregistrement → `{ apiKey: process.env.ANTHROPIC_API_KEY || '', mode: 'platform' }`.

Note : `getClientForTenant` (anthropic.ts) déstructure uniquement `{ apiKey }` — il reste valide. Le champ `quotaContext?` réservé est **retiré** (remplacé par `mode`).

- [ ] **Step 1: Write the failing test (extend resolver.test.ts)**

In `src/core/credentials/__tests__/resolver.test.ts`, add these cases inside the `describe('resolver', ...)` block (after the existing `'llm fallback .env...'` test):

```ts
  it('byo expose mode=byo', async () => {
    const store = fakeStore([record({ mode: 'byo', value: { api_key: 'sk-client' } })]);
    const r = makeResolver({ store });
    expect(await r.resolveLlmCredentials('default', null)).toEqual({ apiKey: 'sk-client', mode: 'byo' });
  });

  it('platform expose mode=platform', async () => {
    const store = fakeStore([record({ mode: 'platform', value: {} })]);
    const r = makeResolver({ store });
    expect(await r.resolveLlmCredentials('default', null)).toEqual({ apiKey: 'sk-platform', mode: 'platform' });
  });

  it('byo mal formé -> mode=platform', async () => {
    const store = fakeStore([record({ mode: 'byo', value: { foo: 'bar' } })]);
    const r = makeResolver({ store });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await r.resolveLlmCredentials('default', null)).mode).toBe('platform');
    warn.mockRestore();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/credentials/__tests__/resolver.test.ts`
Expected: FAIL — résultat manque le champ `mode`.

- [ ] **Step 3: Implement**

In `src/core/credentials/resolver.ts`, replace the `resolveLlmCredentials` function (lines 49-64) with:

```ts
  async function resolveLlmCredentials(
    clientId: string,
    botId: string | null,
  ): Promise<{ apiKey: string; mode: 'byo' | 'platform' }> {
    const rec = await findRecord(store, clientId, botId, 'llm', 'anthropic');
    if (rec && rec.mode === 'byo') {
      const obj = decode(rec);
      if (obj.api_key) return { apiKey: obj.api_key, mode: 'byo' };
      // Record byo mal formé (api_key absent) : on ne bascule pas en silence sur la
      // clé plateforme — un client byo croirait utiliser sa clé/son quota propre.
      console.warn(`[CredentialResolver] byo record without api_key for client ${clientId} (bot=${botId ?? '-'}), falling back to platform key`);
    }
    // mode platform OU pas d'enregistrement -> clé plateforme.
    return { apiKey: process.env['ANTHROPIC_API_KEY'] || '', mode: 'platform' };
  }
```

- [ ] **Step 4: Run resolver + anthropic tests to verify pass**

Run: `npx vitest run src/core/credentials/__tests__/resolver.test.ts src/llm/__tests__/anthropic.test.ts`
Expected: PASS (resolver étendu + anthropic existant inchangé — `getClientForTenant` ne lit que `apiKey`).

- [ ] **Step 5: Run tsc + commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add src/core/credentials/resolver.ts src/core/credentials/__tests__/resolver.test.ts
git commit -m "feat(credentials): resolveLlmCredentials expose le mode byo/platform"
```

---

### Task 4: `ClientFairQueue` — équité par client, jamais de rejet

**Files:**
- Create: `src/llm/client-fairness.ts`
- Test: `src/llm/__tests__/client-fairness.test.ts`

**Interfaces:**
- Consumes: `config.llm.clientConcurrency` (Task 1).
- Produces :
  - `interface FairQueue { run<T>(clientId: string, fn: () => Promise<T>): Promise<T>; }`
  - `makeClientFairQueue(concurrency?: number): FairQueue` — factory. `concurrency` défaut `config.llm.clientConcurrency`.
  - `export const clientFairQueue: FairQueue` — singleton par défaut (lit la config au premier appel).

Comportement : un `pLimit(concurrency)` par `clientId` (créé à la volée, mis en cache dans une `Map<string, LimitFunction>`). Au-delà de `concurrency` requêtes en vol pour un client, `fn` attend son tour (sémantique p-limit) — jamais rejeté. Clients distincts = limiters indépendants.

- [ ] **Step 1: Write the failing test**

Create `src/llm/__tests__/client-fairness.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeClientFairQueue } from '../client-fairness.js';

/** Promesse contrôlable manuellement. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('ClientFairQueue', () => {
  it('au-delà de N, la requête suivante attend (pas de rejet)', async () => {
    const q = makeClientFairQueue(2);
    const order: string[] = [];
    const d1 = deferred<void>();
    const d2 = deferred<void>();
    const d3 = deferred<void>();

    const p1 = q.run('c1', async () => { order.push('start1'); await d1.promise; order.push('end1'); });
    const p2 = q.run('c1', async () => { order.push('start2'); await d2.promise; order.push('end2'); });
    const p3 = q.run('c1', async () => { order.push('start3'); await d3.promise; order.push('end3'); });

    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    // 2 en vol max : start1 + start2, PAS start3
    expect(order).toEqual(['start1', 'start2']);

    d1.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toContain('start3'); // une place libérée -> start3 démarre

    d2.resolve(); d3.resolve();
    await Promise.all([p1, p2, p3]);
    expect(order).toContain('end3');
  });

  it('clients distincts sont indépendants', async () => {
    const q = makeClientFairQueue(1);
    const order: string[] = [];
    const dA = deferred<void>();
    const dB = deferred<void>();

    const pA = q.run('A', async () => { order.push('A-start'); await dA.promise; });
    const pB = q.run('B', async () => { order.push('B-start'); await dB.promise; });

    await new Promise((r) => setTimeout(r, 0));
    // concurrence 1 PAR client : A et B démarrent tous les deux (limiters séparés)
    expect(order.sort()).toEqual(['A-start', 'B-start']);

    dA.resolve(); dB.resolve();
    await Promise.all([pA, pB]);
  });

  it('libère la place après complétion et propage le résultat', async () => {
    const q = makeClientFairQueue(1);
    expect(await q.run('c1', async () => 42)).toBe(42);
    expect(await q.run('c1', async () => 43)).toBe(43);
  });

  it('une erreur libère la place (pas de blocage)', async () => {
    const q = makeClientFairQueue(1);
    await expect(q.run('c1', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    // la place doit être libérée malgré l'erreur
    expect(await q.run('c1', async () => 'ok')).toBe('ok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/llm/__tests__/client-fairness.test.ts`
Expected: FAIL — module `../client-fairness.js` introuvable.

- [ ] **Step 3: Write minimal implementation**

Create `src/llm/client-fairness.ts`:

```ts
/**
 * Équité LLM par client en mode platform.
 *
 * Un limiter de concurrence (p-limit) par clientId : au-delà de N appels en vol
 * pour un client, les suivants attendent leur tour — JAMAIS rejetés. C'est un
 * ordonnanceur d'équité, pas un interrupteur (exigence UX : on ne coupe pas une
 * conversation, on la fait patienter).
 *
 * Compteurs en mémoire. L'interface FairQueue est extraite pour permettre un
 * backend partagé (multi-instance) plus tard sans toucher aux appelants.
 */

import pLimit, { type LimitFunction } from 'p-limit';
import { config } from '../core/config.js';

export interface FairQueue {
  run<T>(clientId: string, fn: () => Promise<T>): Promise<T>;
}

export function makeClientFairQueue(concurrency?: number): FairQueue {
  const limiters = new Map<string, LimitFunction>();

  function limiterFor(clientId: string): LimitFunction {
    let lim = limiters.get(clientId);
    if (!lim) {
      const n = concurrency ?? config.llm.clientConcurrency;
      lim = pLimit(n);
      limiters.set(clientId, lim);
    }
    return lim;
  }

  return {
    run<T>(clientId: string, fn: () => Promise<T>): Promise<T> {
      return limiterFor(clientId)(fn);
    },
  };
}

export const clientFairQueue: FairQueue = makeClientFairQueue();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/llm/__tests__/client-fairness.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Run tsc + commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add src/llm/client-fairness.ts src/llm/__tests__/client-fairness.test.ts
git commit -m "feat(llm): ClientFairQueue (équité par client, jamais de rejet)"
```

---

### Task 5: `KeyPool` — sélection clé moins chargée + cooldown 429

**Files:**
- Create: `src/llm/key-pool.ts`
- Test: `src/llm/__tests__/key-pool.test.ts`

**Interfaces:**
- Consumes:
  - Task 2 : `Database.listActivePlatformKeys()`, type `PlatformKeyRecord`.
  - Task 1 : `config.llm.keyCooldownMs`.
  - Crypto existant : `decryptJson(secret, keyVersion)` (renvoie `unknown` ; on attend `{ api_key: string }`).
- Produces :
  - `interface KeyPool { withPlatformKey<T>(fn: (apiKey: string) => Promise<T>): Promise<T>; size(): number; reload(): Promise<void>; }`
  - `interface KeyPoolDeps { loadKeys: () => Promise<PlatformKeyRecord[]>; decrypt: (secret: string, keyVersion: number) => { api_key: string }; cooldownMs: () => number; now: () => number; waitMs: number; }`
  - `makeKeyPool(deps?: Partial<KeyPoolDeps>): KeyPool` — factory ; deps par défaut branchés sur `getDatabase().listActivePlatformKeys`, `decryptJson`, `config.llm.keyCooldownMs`, `Date.now`, `waitMs = 50`.
  - `export const keyPool: KeyPool` — singleton.

Comportement de `withPlatformKey` :
1. S'assure que les clés sont chargées (lazy `reload()` au premier appel si vide).
2. Choisit la clé **active, hors cooldown, la moins chargée** (min in-flight ; égalité → plus petit `id`).
3. Si toutes les clés sont en cooldown → attend `waitMs` puis re-tente (boucle), plutôt que d'échouer.
4. Si le pool est **vide** (aucune clé chargée) → throw `[LLMPool] no platform keys available` (erreur de configuration, pas de contention).
5. Incrémente l'in-flight de la clé choisie, exécute `fn(apiKey)`, décrémente dans un `finally`.
6. Si `fn` lève une erreur **429/529** → met la clé en cooldown (`now() + cooldownMs()`) puis **re-throw** (le caller — `chat()` — décidera de re-tenter sur une autre clé). Les autres erreurs sont re-throw sans cooldown.

État en mémoire indexé par `id` : `{ apiKey, inFlight, cooldownUntil }`. `decrypt` est appelé une fois au chargement (les apiKey déchiffrées vivent en mémoire).

- [ ] **Step 1: Write the failing test**

Create `src/llm/__tests__/key-pool.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { makeKeyPool } from '../key-pool.js';
import type { PlatformKeyRecord } from '../../core/database/types.js';

function keys(...labels: string[]): PlatformKeyRecord[] {
  return labels.map((label, i) => ({
    id: i + 1, label, secret_encrypted: `enc-${label}`, key_version: 1, active: true,
  }));
}

// decrypt factice : enc-pool-1 -> { api_key: 'sk-pool-1' }
const decrypt = (secret: string) => ({ api_key: secret.replace('enc-', 'sk-') });

function err(status: number): Error {
  const e = new Error(`status ${status}`) as Error & { status: number };
  e.status = status;
  return e;
}

describe('KeyPool', () => {
  it('pool vide -> erreur de configuration explicite', async () => {
    const pool = makeKeyPool({ loadKeys: async () => [], decrypt });
    await expect(pool.withPlatformKey(async () => 'x')).rejects.toThrow(/\[LLMPool\]/);
  });

  it('choisit la clé la moins chargée', async () => {
    const pool = makeKeyPool({ loadKeys: async () => keys('pool-1', 'pool-2'), decrypt });
    const used: string[] = [];
    // occupe pool-1 (1 en vol) ; le prochain appel doit prendre pool-2.
    let release!: () => void;
    const busy = pool.withPlatformKey(async (k) => {
      used.push(k);
      await new Promise<void>((r) => { release = r; });
    });
    await new Promise((r) => setTimeout(r, 0));
    await pool.withPlatformKey(async (k) => { used.push(k); });
    release();
    await busy;
    expect(used).toEqual(['sk-pool-1', 'sk-pool-2']);
  });

  it('429 met la clé en cooldown et re-throw ; le caller bascule sur une autre clé', async () => {
    let t = 0;
    const pool = makeKeyPool({
      loadKeys: async () => keys('pool-1', 'pool-2'),
      decrypt, now: () => t, cooldownMs: () => 1000,
    });
    // 1er appel sur pool-1 -> 429 -> cooldown pool-1, re-throw
    await expect(pool.withPlatformKey(async () => { throw err(429); })).rejects.toThrow();
    // 2e appel : pool-1 en cooldown -> doit choisir pool-2
    const used = await pool.withPlatformKey(async (k) => k);
    expect(used).toBe('sk-pool-2');
  });

  it('si toutes en cooldown -> attend puis réessaie (ne rejette pas)', async () => {
    let t = 0;
    const pool = makeKeyPool({
      loadKeys: async () => keys('pool-1'),
      decrypt, now: () => t, cooldownMs: () => 1000, waitMs: 5,
    });
    await expect(pool.withPlatformKey(async () => { throw err(429); })).rejects.toThrow();
    // pool-1 en cooldown jusqu'à t=1000. On avance l'horloge pendant l'attente.
    const p = pool.withPlatformKey(async (k) => k);
    t = 2000; // cooldown expiré
    await expect(p).resolves.toBe('sk-pool-1');
  });

  it('décrémente l\'in-flight même sur erreur non-429', async () => {
    const pool = makeKeyPool({ loadKeys: async () => keys('pool-1'), decrypt });
    await expect(pool.withPlatformKey(async () => { throw err(500); })).rejects.toThrow();
    // si l'in-flight n'avait pas été décrémenté, la clé resterait "chargée" mais
    // doit rester utilisable immédiatement (pas de cooldown sur 500).
    expect(await pool.withPlatformKey(async (k) => k)).toBe('sk-pool-1');
  });

  it('size() reflète le nombre de clés chargées', async () => {
    const pool = makeKeyPool({ loadKeys: async () => keys('pool-1', 'pool-2', 'pool-3'), decrypt });
    await pool.reload();
    expect(pool.size()).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/llm/__tests__/key-pool.test.ts`
Expected: FAIL — module `../key-pool.js` introuvable.

- [ ] **Step 3: Write minimal implementation**

Create `src/llm/key-pool.ts`:

```ts
/**
 * Pool de clés Anthropic plateforme (mode SaaS).
 *
 * Sélectionne la clé active la moins chargée hors cooldown, encaisse les 429/529
 * en mettant la clé en pause (cooldown) puis en relevant l'erreur — le caller
 * (chat) bascule alors sur une autre clé. Si toutes les clés sont en cooldown, on
 * ATTEND plutôt que d'échouer (invariant UX : pas de coupure en contention).
 *
 * État de charge en mémoire (mono-instance). Les deps (chargement, crypto,
 * horloge) sont injectables : interface prête pour un store partagé multi-instance.
 */

import { getDatabase } from '../core/database/index.js';
import { decryptJson } from '../core/credentials/crypto.js';
import { config } from '../core/config.js';
import type { PlatformKeyRecord } from '../core/database/types.js';

export interface KeyPool {
  withPlatformKey<T>(fn: (apiKey: string) => Promise<T>): Promise<T>;
  size(): number;
  reload(): Promise<void>;
}

export interface KeyPoolDeps {
  loadKeys: () => Promise<PlatformKeyRecord[]>;
  decrypt: (secret: string, keyVersion: number) => { api_key: string };
  cooldownMs: () => number;
  now: () => number;
  waitMs: number;
}

interface KeyState {
  id: number;
  apiKey: string;
  inFlight: number;
  cooldownUntil: number;
}

const DEFAULT_DEPS: KeyPoolDeps = {
  loadKeys: () => getDatabase().listActivePlatformKeys(),
  decrypt: (secret, keyVersion) => decryptJson(secret, keyVersion) as { api_key: string },
  cooldownMs: () => config.llm.keyCooldownMs,
  now: () => Date.now(),
  waitMs: 50,
};

export function makeKeyPool(overrides: Partial<KeyPoolDeps> = {}): KeyPool {
  const deps: KeyPoolDeps = { ...DEFAULT_DEPS, ...overrides };
  let states: KeyState[] = [];
  let loaded = false;

  async function reload(): Promise<void> {
    const recs = await deps.loadKeys();
    states = recs
      .map((r) => {
        const obj = deps.decrypt(r.secret_encrypted, r.key_version);
        return obj.api_key
          ? { id: r.id, apiKey: obj.api_key, inFlight: 0, cooldownUntil: 0 }
          : null;
      })
      .filter((s): s is KeyState => s !== null);
    loaded = true;
  }

  function pickAvailable(): KeyState | null {
    const t = deps.now();
    const ready = states.filter((s) => s.cooldownUntil <= t);
    if (ready.length === 0) return null;
    return ready.reduce((best, s) =>
      s.inFlight < best.inFlight || (s.inFlight === best.inFlight && s.id < best.id) ? s : best
    );
  }

  async function withPlatformKey<T>(fn: (apiKey: string) => Promise<T>): Promise<T> {
    if (!loaded) await reload();
    if (states.length === 0) {
      throw new Error('[LLMPool] no platform keys available (configure ANTHROPIC_API_KEYS)');
    }

    // Boucle d'attente : si toutes les clés sont en cooldown, on patiente.
    let chosen = pickAvailable();
    while (!chosen) {
      await new Promise((r) => setTimeout(r, deps.waitMs));
      chosen = pickAvailable();
    }

    chosen.inFlight++;
    try {
      return await fn(chosen.apiKey);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 429 || status === 529) {
        chosen.cooldownUntil = deps.now() + deps.cooldownMs();
        console.warn(`[LLMPool] key id=${chosen.id} en cooldown (${status})`);
      }
      throw err;
    } finally {
      chosen.inFlight--;
    }
  }

  return {
    withPlatformKey,
    size: () => states.length,
    reload,
  };
}

export const keyPool: KeyPool = makeKeyPool();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/llm/__tests__/key-pool.test.ts`
Expected: PASS (6/6).

> Note implémenteur : le test `'si toutes en cooldown -> attend'` repose sur la boucle `while (!chosen)` qui relit `deps.now()` à chaque tour. Le test avance `t` après avoir lancé l'appel ; `waitMs: 5` borne l'attente. Ne pas mettre en cache `t` hors de `pickAvailable`.

- [ ] **Step 5: Run tsc + commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add src/llm/key-pool.ts src/llm/__tests__/key-pool.test.ts
git commit -m "feat(llm): KeyPool (clé moins chargée + cooldown 429)"
```

---

### Task 6: Intégration dans `chat()` — composition platform

**Files:**
- Modify: `src/llm/anthropic.ts`
- Test: `src/llm/__tests__/anthropic.test.ts` (extend)

**Interfaces:**
- Consumes:
  - Task 3 : `resolveLlmCredentials` renvoie `{ apiKey, mode }`.
  - Task 4 : `clientFairQueue.run(clientId, fn)`.
  - Task 5 : `keyPool.withPlatformKey(fn)`, `keyPool.size()`.
- Produces :
  - `getClientForApiKey(apiKey: string): Anthropic` (export) — extraction du cache `clientCache` par apiKey.
  - `chat(...)` inchangé en signature ; nouveau comportement interne :
    - **byo** → chemin actuel inchangé (`getClientForApiKey` sur la clé byo + cascade + `withRetry`).
    - **platform** → `clientFairQueue.run(clientId, () => cascade(model => keyPool.withPlatformKey(apiKey => getClientForApiKey(apiKey).messages.create({ model, ... }))))`.

Composition résilience platform (par modèle de la cascade) :
- Pour chaque modèle du plan : on tente `withPlatformKey`. Sur **429/529**, on **re-tente une autre clé** pour le **même** modèle, jusqu'à `keyPool.size()` tentatives. Si toutes les clés du modèle échouent (ou erreur non-429), on **descend** au modèle suivant. À épuisement total de la cascade → re-throw (message d'erreur actuel).
- Le `withRetry` (backoff intra-clé sur 429) reste utilisé sur le chemin **byo**. Sur le chemin platform, c'est le **KeyPool** qui gère la bascule de clé ; on n'empile pas `withRetry` par-dessus (sinon double backoff). Le `pLimit(10)` global du handler reste en garde-fou externe (hors de ce fichier).

- [ ] **Step 1: Write the failing test (extend anthropic.test.ts)**

Replace the resolver mock and add platform cases. In `src/llm/__tests__/anthropic.test.ts`, update the resolver mock (lines 16-21) to return `mode`, and make `messages.create` configurable to simulate 429. New full file:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock du SDK Anthropic : enregistre les apiKey construites ; create() configurable.
const constructedKeys: string[] = [];
let createImpl: (args: { model: string }) => Promise<unknown>;
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    apiKey: string;
    messages = { create: vi.fn((args: { model: string }) => createImpl(args)) };
    constructor(opts: { apiKey: string }) {
      this.apiKey = opts.apiKey;
      constructedKeys.push(opts.apiKey);
    }
  },
}));

// Mock resolver : renvoie apiKey + mode. clientId 'plat' -> platform ; sinon byo.
vi.mock('../../core/credentials/resolver.js', () => ({
  resolveLlmCredentials: vi.fn(async (clientId: string) => ({
    apiKey: clientId === 'empty' ? '' : `sk-${clientId}`,
    mode: clientId === 'plat' ? 'platform' : 'byo',
  })),
}));

// Mock KeyPool : deux clés plateforme, bascule sur 429.
const poolKeys = ['sk-pool-1', 'sk-pool-2'];
vi.mock('../key-pool.js', () => {
  return {
    keyPool: {
      size: () => poolKeys.length,
      async withPlatformKey<T>(fn: (k: string) => Promise<T>): Promise<T> {
        // essaie chaque clé jusqu'à succès (simulé) ; sinon relève la dernière erreur
        let lastErr: unknown;
        for (const k of poolKeys) {
          try { return await fn(k); } catch (e) { lastErr = e; }
        }
        throw lastErr;
      },
    },
  };
});

// Mock FairQueue : passe-plat (exécute immédiatement).
vi.mock('../client-fairness.js', () => ({
  clientFairQueue: { run: <T>(_c: string, fn: () => Promise<T>) => fn() },
}));

import { getClientForTenant, getClientForApiKey, chat } from '../anthropic.js';

function ok(text = 'ok') { return { content: [{ type: 'text', text }], usage: {} }; }
function err(status: number) { const e = new Error('x') as Error & { status: number }; e.status = status; return e; }

describe('anthropic per-tenant', () => {
  beforeEach(() => {
    constructedKeys.length = 0;
    createImpl = async () => ok();
  });
  afterEach(() => vi.clearAllMocks());

  it('byo : résout et met en cache par apiKey', async () => {
    const a = await getClientForTenant('c1', null);
    const b = await getClientForTenant('c1', null);
    expect(a).toBe(b);
    expect(constructedKeys.filter((k) => k === 'sk-c1')).toHaveLength(1);
  });

  it('getClientForApiKey met en cache par clé', async () => {
    const a = getClientForApiKey('sk-x');
    const b = getClientForApiKey('sk-x');
    expect(a).toBe(b);
  });

  it('byo apiKey vide -> erreur explicite', async () => {
    await expect(getClientForTenant('empty', null)).rejects.toThrow(/\[LLM\]/);
  });

  it('byo : chat utilise le client résolu (pas le pool)', async () => {
    const out = await chat('sys', [{ role: 'user', content: 'hi' }], { clientId: 'c3', botId: null });
    expect(out).toBe('ok');
    expect(constructedKeys).toContain('sk-c3');
  });

  it('platform : chat passe par le pool (clé pool, pas la clé client)', async () => {
    const out = await chat('sys', [{ role: 'user', content: 'hi' }], { clientId: 'plat', botId: null });
    expect(out).toBe('ok');
    expect(constructedKeys).toContain('sk-pool-1');
    expect(constructedKeys).not.toContain('sk-plat');
  });

  it('platform : 429 sur 1re clé -> bascule sur 2e clé (même modèle)', async () => {
    let calls = 0;
    createImpl = async () => { calls++; if (calls === 1) throw err(429); return ok(); };
    const out = await chat('sys', [{ role: 'user', content: 'hi' }], { clientId: 'plat', botId: null });
    expect(out).toBe('ok');
    expect(constructedKeys).toContain('sk-pool-2');
  });

  it('platform : échec total -> throw', async () => {
    createImpl = async () => { throw err(429); };
    await expect(
      chat('sys', [{ role: 'user', content: 'hi' }], { clientId: 'plat', botId: null })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/llm/__tests__/anthropic.test.ts`
Expected: FAIL — `getClientForApiKey` non exporté ; chat ne branche pas le pool.

- [ ] **Step 3: Implement — extraire le cache et brancher le pool**

In `src/llm/anthropic.ts`:

Update imports (lines 1-2):

```ts
import Anthropic from '@anthropic-ai/sdk';
import { resolveLlmCredentials } from '../core/credentials/resolver.js';
import { keyPool } from './key-pool.js';
import { clientFairQueue } from './client-fairness.js';
```

Replace `getClientForTenant` (lines 29-39) with the extracted cache + a thin resolver wrapper:

```ts
/** Cache d'un client Anthropic par apiKey (deux tenants même clé = client partagé). */
export function getClientForApiKey(apiKey: string): Anthropic {
  const cached = clientCache.get(apiKey);
  if (cached) return cached;
  const created = new Anthropic({ apiKey, timeout: 60000 });
  clientCache.set(apiKey, created);
  return created;
}

export async function getClientForTenant(clientId: string, botId: string | null): Promise<Anthropic> {
  const { apiKey } = await resolveLlmCredentials(clientId, botId);
  if (!apiKey) {
    throw new Error(`[LLM] No API key resolved for client ${clientId} (bot=${botId ?? '-'})`);
  }
  return getClientForApiKey(apiKey);
}
```

Replace the `chat` function (lines 75-139) with mode-aware composition:

```ts
export async function chat(
  systemPromptParts: SystemPromptPart[] | string,
  messages: ChatMessage[],
  opts: { clientId: string; botId: string | null; model?: string }
): Promise<string> {
  const { apiKey, mode } = await resolveLlmCredentials(opts.clientId, opts.botId);

  const system = typeof systemPromptParts === 'string'
    ? systemPromptParts
    : systemPromptParts.map(part => ({
        type: 'text' as const,
        text: part.text,
        ...(part.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
      }));

  const plan = buildModelPlan(opts.model);

  const logUsage = (response: { usage?: unknown }) => {
    if (response.usage && typeof response.usage === 'object' && 'cache_read_input_tokens' in response.usage) {
      const usage = response.usage as unknown as Record<string, number>;
      console.log(`[LLM] Cache: read=${usage.cache_read_input_tokens || 0}, creation=${usage.cache_creation_input_tokens || 0}, input=${usage.input_tokens}`);
    }
  };

  const extractText = (response: { content: Array<{ type: string; text?: string }> }): string => {
    const block = response.content[0];
    if (block?.type === 'text') return block.text ?? '[Reponse non-texte]';
    return '[Reponse non-texte]';
  };

  // --- BYO : chemin historique inchangé (client unique + cascade + withRetry) ---
  if (mode === 'byo') {
    if (!apiKey) {
      throw new Error(`[LLM] No API key resolved for client ${opts.clientId} (bot=${opts.botId ?? '-'})`);
    }
    const client = getClientForApiKey(apiKey);
    let lastError: unknown;
    for (let i = 0; i < plan.length; i++) {
      const { model, plan: planId, label } = plan[i]!;
      console.log(`[LLM] Model=${model} (plan ${planId} / ${label})`);
      try {
        const response = await withRetry(() =>
          client.messages.create({ model, max_tokens: 2048, system, messages })
        );
        logUsage(response);
        if (i > 0) console.log(`[LLM] Fallback reussi sur plan ${planId} (${label})`);
        return extractText(response);
      } catch (err) {
        lastError = err;
        const status = (err as { status?: number }).status;
        const hasNext = i < plan.length - 1;
        if (hasNext) {
          const next = plan[i + 1]!;
          const errMsg = (err as { message?: string }).message || 'unknown';
          console.warn(`[LLM] Plan ${planId} (${label}) echoue (${status || 'no-status'}: ${errMsg.slice(0, 120)}), bascule vers plan ${next.plan} (${next.label})`);
          continue;
        }
        throw err;
      }
    }
    throw lastError || new Error('[LLM] Cascade epuise sans succes');
  }

  // --- PLATFORM : file par client -> cascade modèle -> pool de clés ---
  return clientFairQueue.run(opts.clientId, async () => {
    let lastError: unknown;
    const keyAttempts = Math.max(1, keyPool.size());
    for (let i = 0; i < plan.length; i++) {
      const { model, plan: planId, label } = plan[i]!;
      console.log(`[LLMPool] Model=${model} (plan ${planId} / ${label})`);
      // Épuiser les clés disponibles pour CE modèle avant de descendre d'un cran.
      for (let attempt = 0; attempt < keyAttempts; attempt++) {
        try {
          const response = await keyPool.withPlatformKey((key) =>
            getClientForApiKey(key).messages.create({ model, max_tokens: 2048, system, messages })
          );
          logUsage(response);
          if (i > 0 || attempt > 0) console.log(`[LLMPool] Succès plan ${planId} (${label}) après ${attempt + 1} tentative(s) clé`);
          return extractText(response);
        } catch (err) {
          lastError = err;
          const status = (err as { status?: number }).status;
          // 429/529 : retenter une autre clé pour le même modèle (si tentatives restantes).
          if ((status === 429 || status === 529) && attempt < keyAttempts - 1) {
            console.warn(`[LLMPool] Plan ${planId} (${label}) ${status} sur clé, bascule de clé (tentative ${attempt + 2}/${keyAttempts})`);
            continue;
          }
          // erreur non-429 OU clés épuisées : on sort de la boucle clé -> modèle suivant.
          break;
        }
      }
      const hasNext = i < plan.length - 1;
      if (hasNext) {
        const next = plan[i + 1]!;
        console.warn(`[LLMPool] Plan ${planId} (${label}) épuisé, bascule vers plan ${next.plan} (${next.label})`);
        continue;
      }
      throw lastError || new Error('[LLMPool] Cascade épuisée sans succès');
    }
    throw lastError || new Error('[LLMPool] Cascade épuisée sans succès');
  });
}
```

> Note implémenteur : ne pas réintroduire de `getClientForTenant` à l'intérieur de `chat()` (il re-résoudrait les credentials une 2e fois). `chat` résout une seule fois en tête et branche sur `mode`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/llm/__tests__/anthropic.test.ts`
Expected: PASS (7/7).

- [ ] **Step 5: Run full suite + tsc + commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean + tous les tests verts (vérifier que handler.ts compile toujours : il importe `getClientForTenant`, conservé).

```bash
git add src/llm/anthropic.ts src/llm/__tests__/anthropic.test.ts
git commit -m "feat(llm): chat() compose file par client + pool de clés en mode platform"
```

---

### Task 7: Amorçage du pool — seed `platform_llm_keys`

**Files:**
- Modify: `scripts/seed-credentials.ts`
- Test: `src/core/credentials/__tests__/seed.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1 (`config.llm.apiKeys` n'est PAS utilisé ici — le seed lit l'env brut directement, comme `buildSeedRecords` ; voir note), Task 2 (`db.upsertPlatformKey`, type `PlatformKeyInput`), crypto `encryptJson`.
- Produces :
  - `buildPlatformKeyRecords(env: Env): PlatformKeyInput[]` — lit `ANTHROPIC_API_KEYS` (csv) ou à défaut `ANTHROPIC_API_KEY` ; produit un `PlatformKeyInput` actif par clé, label `pool-1`, `pool-2`, … ; secret = `encryptJson({ api_key })`. Liste vide si aucune source.
  - `main()` étendu : après les credentials, upsert chaque platform key via `db.upsertPlatformKey`.

Note cohérence : `buildSeedRecords` lit l'env passé en argument (testable). On garde ce patron pour `buildPlatformKeyRecords` (parse local du csv, identique à `config.llm.apiKeys` mais sans dépendre de `process.env` global — l'env est injecté).

- [ ] **Step 1: Write the failing test (extend seed.test.ts)**

In `src/core/credentials/__tests__/seed.test.ts`, add a new describe block at the end (and update the import on line 2):

```ts
import { buildSeedRecords, buildPlatformKeyRecords } from '../../../../scripts/seed-credentials.js';
```

```ts
describe('buildPlatformKeyRecords', () => {
  beforeEach(() => vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', KEY_HEX));
  afterEach(() => vi.unstubAllEnvs());

  it('ANTHROPIC_API_KEYS (csv) -> une clé pool par entrée, labels pool-N', () => {
    const recs = buildPlatformKeyRecords({ ANTHROPIC_API_KEYS: 'sk-a, sk-b' });
    expect(recs.map((r) => r.label)).toEqual(['pool-1', 'pool-2']);
    expect(recs.every((r) => r.active)).toBe(true);
    expect(decryptJson(recs[0]!.secret_encrypted, recs[0]!.key_version)).toEqual({ api_key: 'sk-a' });
  });

  it('retombe sur ANTHROPIC_API_KEY si ANTHROPIC_API_KEYS absent', () => {
    const recs = buildPlatformKeyRecords({ ANTHROPIC_API_KEY: 'sk-solo' });
    expect(recs).toHaveLength(1);
    expect(recs[0]!.label).toBe('pool-1');
    expect(decryptJson(recs[0]!.secret_encrypted, recs[0]!.key_version)).toEqual({ api_key: 'sk-solo' });
  });

  it('liste vide si aucune source', () => {
    expect(buildPlatformKeyRecords({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/credentials/__tests__/seed.test.ts`
Expected: FAIL — `buildPlatformKeyRecords` non exporté.

- [ ] **Step 3: Implement**

In `scripts/seed-credentials.ts`:

Update the type import (line 10) to add `PlatformKeyInput`:

```ts
import type { CredentialRecord, PlatformKeyInput } from '../src/core/database/types.js';
```

After `buildSeedRecords` (line 53), add:

```ts
export function buildPlatformKeyRecords(env: Env): PlatformKeyInput[] {
  const multi = (env['ANTHROPIC_API_KEYS'] || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  const keys = multi.length > 0
    ? multi
    : (env['ANTHROPIC_API_KEY'] || '').trim()
      ? [(env['ANTHROPIC_API_KEY'] || '').trim()]
      : [];

  return keys.map((api_key, i) => {
    const { secret, keyVersion } = encryptJson({ api_key });
    return { label: `pool-${i + 1}`, secret_encrypted: secret, key_version: keyVersion, active: true };
  });
}
```

In `main()`, after the credentials upsert loop (after line 62, before the final count log), add:

```ts
  const poolKeys = buildPlatformKeyRecords(process.env);
  for (const rec of poolKeys) {
    await db.upsertPlatformKey(rec);
    console.log(`[Seed] platform key ${rec.label} -> pool`);
  }
  console.log(`[Seed] ${poolKeys.length} clé(s) plateforme dans le pool.`);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/credentials/__tests__/seed.test.ts`
Expected: PASS (existant + 3 nouveaux).

- [ ] **Step 5: Run full suite + tsc + commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean + tout vert.

```bash
git add scripts/seed-credentials.ts src/core/credentials/__tests__/seed.test.ts
git commit -m "feat(seed): amorçage du pool platform_llm_keys depuis l'env"
```

---

## Self-Review

**Spec coverage :**
- Table `platform_llm_keys` (id, label, secret_encrypted, key_version, active, created_at) → Task 2. ✓ (ajout `updated_at` pour l'upsert, cohérent avec `tenant_credentials`).
- `listActivePlatformKeys` → Task 2. ✓
- `KeyPool.withPlatformKey` + least-loaded + cooldown + attente si tout en cooldown + décrément finally + 429 re-throw → Task 5. ✓
- `KeyLoadTracker` extrait : la spec demande une interface pluggable ; réalisé via `KeyPoolDeps` injectables (loadKeys/decrypt/now/cooldown). ✓ (compteurs `inFlight`/`cooldownUntil` en mémoire dans `KeyState`, isolables derrière deps).
- `ClientFairQueue.run` concurrence par client, jamais de rejet, clients indépendants → Task 4. ✓
- Resolver expose `mode` (et retire `quotaContext`) → Task 3. ✓
- Composition chat platform : file → cascade → pool ; byo inchangé → Task 6. ✓
- Config getters `LLM_CLIENT_CONCURRENCY`/`LLM_KEY_COOLDOWN_MS`/`ANTHROPIC_API_KEYS` + `.env.example` → Task 1. ✓
- Amorçage seed → Task 7. ✓
- Logs `[LLMPool]`/`[LLMFairness]` sans secret : `[LLMPool]` présent (Task 5/6). Pas de log `[LLMFairness]` ajouté (la FairQueue n'a rien d'utile à logger en fonctionnement nominal ; YAGNI). Aucun secret loggé. ✓

**Décalages assumés vs spec (à valider) :**
1. Spec §Intégration mentionne `withRetry` interne au KeyPool côté caller. Le plan **ne double pas** `withRetry` sur le chemin platform (le KeyPool gère la bascule de clé ; empiler withRetry = double backoff). C'est un choix d'implémentation cohérent avec l'invariant « bascule de clé d'abord ».
2. Spec liste les colonnes sans `updated_at` ; le plan l'ajoute (nécessaire à l'upsert idempotent UPDATE-then-INSERT, patron `tenant_credentials`).
3. Le lead extractor (`handler.ts`) reste sur `getClientForTenant` (hors `chat()`) — en mode platform il utilise la clé `.env` via resolver fallback, **sans** passer par le pool. Hors scope spec (la spec cible `chat()`), documenté comme limitation.

**Placeholder scan :** aucun TODO/TBD ; chaque step de code contient le code complet. ✓
**Type consistency :** `PlatformKeyRecord`/`PlatformKeyInput` cohérents entre types.ts, drivers, KeyPool, seed. `resolveLlmCredentials` retour `{ apiKey, mode }` cohérent resolver/anthropic. `getClientForApiKey` défini Task 6 et consommé seulement Task 6. ✓
```
