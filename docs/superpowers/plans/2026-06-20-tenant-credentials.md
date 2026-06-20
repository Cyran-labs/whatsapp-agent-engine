# Credentials chiffrés par tenant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stocker les credentials (LLM, transport, CRM) par tenant, chiffrés au repos, et les résoudre au runtime via une couche unique avec discriminant de mode `byo`/`platform`.

**Architecture:** Trois modules à responsabilité unique sous `src/core/credentials/` : `crypto.ts` (AES-256-GCM pur), `store.ts` (accès DB des enregistrements chiffrés via l'abstraction `Database` existante), `resolver.ts` (logique `byo`/`platform` + fallback bot→client→`.env`). Une table générique `tenant_credentials` (blob JSON chiffré) dans les drivers SQLite et Postgres. Un script de migration seed les globals `.env` vers le client `default`.

**Tech Stack:** TypeScript (ESM, strict), Node `crypto` (AES-256-GCM), better-sqlite3 (dev/test), pg (prod), Vitest.

## Global Constraints

- TypeScript strict : pas de `any`, `const` par défaut.
- Logs : format `[Service] message`, sans emoji.
- Chiffrement : AES-256-GCM, IV aléatoire 12 octets, enveloppe `iv ‖ authTag ‖ ciphertext` en base64.
- KEK : `process.env.CREDENTIALS_ENCRYPTION_KEY`, 32 octets (hex 64 car. ou base64). Fail-closed si absente/mauvaise taille.
- Résolution avec fallback : bot-scope → client-scope → `.env`.
- Modèle `mode` : `byo` | `platform` (pertinent pour `llm`).
- Tests Vitest. Auteur git : `Francois Greze <francois@cyran.fr>`. Pas de signature Claude.
- HORS scope (plan de suivi) : branchement dans transport/LLM/CRM ; pool de clés / quotas / concurrence.

---

## File Structure

- `src/core/credentials/crypto.ts` (créer) — chiffre/déchiffre chaînes et JSON. Pur, dépend uniquement de la KEK env.
- `src/core/credentials/store.ts` (créer) — façade typée d'accès DB pour les credentials. Aucune crypto.
- `src/core/credentials/resolver.ts` (créer) — résolution byo/platform + fallback. Seul module appelé par le moteur (au plan de suivi).
- `src/core/database/types.ts` (modifier) — type `CredentialRecord` + 3 méthodes sur l'interface `Database`.
- `src/core/database/sqlite.ts` (modifier) — table `tenant_credentials` + impl des 3 méthodes + paramètre de chemin optionnel pour les tests.
- `src/core/database/postgres.ts` (modifier) — table `tenant_credentials` + impl des 3 méthodes.
- `src/core/config.ts` (modifier) — getter `credentials.encryptionKey`.
- `scripts/seed-credentials.ts` (créer) — migration `.env` → DB pour le client `default`.
- `.env.example` (modifier) — documenter `CREDENTIALS_ENCRYPTION_KEY`.
- Tests : `src/core/credentials/__tests__/{crypto,store,resolver,seed}.test.ts`.

---

## Task 1: Crypto module + config

**Files:**
- Modify: `src/core/config.ts`
- Modify: `.env.example`
- Create: `src/core/credentials/crypto.ts`
- Test: `src/core/credentials/__tests__/crypto.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `encrypt(plaintext: string): { secret: string; keyVersion: number }`
  - `decrypt(secret: string, keyVersion: number): string`
  - `encryptJson(value: unknown): { secret: string; keyVersion: number }`
  - `decryptJson(secret: string, keyVersion: number): unknown`
  - `config.credentials.encryptionKey: string` (getter live sur l'env)

- [ ] **Step 1: Add the config getter**

Dans `src/core/config.ts`, ajouter une entrée `credentials` à l'objet `config` (avant `port`) :

```typescript
  credentials: {
    get encryptionKey(): string {
      return process.env['CREDENTIALS_ENCRYPTION_KEY'] || '';
    },
  },
```

Le getter relit l'env à chaque accès (testabilité + rotation future).

- [ ] **Step 2: Document the env var**

Dans `.env.example`, ajouter sous une section dédiée :

```
# --- Credentials chiffrés par tenant ---
# Clé maître AES-256 (32 octets). Générer : openssl rand -hex 32
# Requise pour chiffrer/déchiffrer les credentials en DB.
CREDENTIALS_ENCRYPTION_KEY=
```

- [ ] **Step 3: Write the failing test**

Créer `src/core/credentials/__tests__/crypto.test.ts` :

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encrypt, decrypt, encryptJson, decryptJson } from '../crypto.js';

const KEY_HEX = '0'.repeat(64); // 32 octets en hex

describe('crypto', () => {
  beforeEach(() => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', KEY_HEX);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('round-trip chaîne', () => {
    const { secret, keyVersion } = encrypt('hello secret');
    expect(keyVersion).toBe(1);
    expect(secret).not.toContain('hello');
    expect(decrypt(secret, keyVersion)).toBe('hello secret');
  });

  it('round-trip JSON', () => {
    const { secret, keyVersion } = encryptJson({ api_key: 'sk-123', n: 4 });
    expect(decryptJson(secret, keyVersion)).toEqual({ api_key: 'sk-123', n: 4 });
  });

  it('détecte la falsification (tag GCM)', () => {
    const { secret, keyVersion } = encrypt('data');
    const buf = Buffer.from(secret, 'base64');
    buf[buf.length - 1] ^= 0xff; // altère le dernier octet du ciphertext
    const tampered = buf.toString('base64');
    expect(() => decrypt(tampered, keyVersion)).toThrow();
  });

  it('mauvaise clé rejetée', () => {
    const { secret, keyVersion } = encrypt('data');
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', 'f'.repeat(64));
    expect(() => decrypt(secret, keyVersion)).toThrow();
  });

  it('KEK absente -> erreur explicite', () => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '');
    expect(() => encrypt('data')).toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
  });

  it('version de clé inconnue -> erreur', () => {
    const { secret } = encrypt('data');
    expect(() => decrypt(secret, 99)).toThrow(/key version/i);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/core/credentials/__tests__/crypto.test.ts`
Expected: FAIL — `Cannot find module '../crypto.js'`.

- [ ] **Step 5: Write the implementation**

Créer `src/core/credentials/crypto.ts` :

```typescript
/**
 * Chiffrement des credentials par tenant — AES-256-GCM authentifié.
 *
 * Pur : ne dépend que de la KEK (CREDENTIALS_ENCRYPTION_KEY). Aucune dépendance DB.
 * Enveloppe stockée = base64( iv(12) ‖ authTag(16) ‖ ciphertext ).
 * key_version permet la rotation future sans changement de schéma.
 */

import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const CURRENT_KEY_VERSION = 1;

function decodeKey(raw: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  return Buffer.from(raw, 'base64');
}

function getKey(version: number): Buffer {
  if (version !== CURRENT_KEY_VERSION) {
    throw new Error(`[Credentials] Unknown key version: ${version}`);
  }
  const raw = process.env['CREDENTIALS_ENCRYPTION_KEY'] || '';
  if (!raw) {
    throw new Error('[Credentials] CREDENTIALS_ENCRYPTION_KEY is required');
  }
  const key = decodeKey(raw);
  if (key.length !== 32) {
    throw new Error('[Credentials] CREDENTIALS_ENCRYPTION_KEY must decode to 32 bytes');
  }
  return key;
}

export function encrypt(plaintext: string): { secret: string; keyVersion: number } {
  const key = getKey(CURRENT_KEY_VERSION);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    secret: Buffer.concat([iv, tag, ct]).toString('base64'),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

export function decrypt(secret: string, keyVersion: number): string {
  const key = getKey(keyVersion);
  const buf = Buffer.from(secret, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export function encryptJson(value: unknown): { secret: string; keyVersion: number } {
  return encrypt(JSON.stringify(value));
}

export function decryptJson(secret: string, keyVersion: number): unknown {
  return JSON.parse(decrypt(secret, keyVersion));
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/core/credentials/__tests__/crypto.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: pas d'erreur.

- [ ] **Step 8: Commit**

```bash
git add src/core/config.ts .env.example src/core/credentials/crypto.ts src/core/credentials/__tests__/crypto.test.ts
git commit -m "P3: crypto credentials AES-256-GCM + config CREDENTIALS_ENCRYPTION_KEY"
```

---

## Task 2: CredentialRecord + Database methods + SQLite + store

**Files:**
- Modify: `src/core/database/types.ts`
- Modify: `src/core/database/sqlite.ts`
- Create: `src/core/credentials/store.ts`
- Test: `src/core/credentials/__tests__/store.test.ts`

**Interfaces:**
- Consumes: rien (la façade `store` réutilise l'interface `Database`).
- Produces:
  - Type `CredentialRecord { client_id: string; bot_id: string | null; service: string; provider: string; mode: string; secret_encrypted: string; key_version: number }`
  - `Database.getCredential(clientId, botId, service, provider): Promise<CredentialRecord | undefined>`
  - `Database.upsertCredential(rec: CredentialRecord): Promise<void>`
  - `Database.listCredentials(clientId): Promise<CredentialRecord[]>`
  - `createSqliteDriver(dbPath?: string): Database` (paramètre optionnel ajouté)
  - `store.getCredentialRecord / upsertCredentialRecord / listCredentialRecords`

- [ ] **Step 1: Add the type and interface methods**

Dans `src/core/database/types.ts`, ajouter le type (après `LeadRow`) :

```typescript
export interface CredentialRecord {
  client_id: string;
  bot_id: string | null;
  service: string;
  provider: string;
  mode: string;
  secret_encrypted: string;
  key_version: number;
}
```

Et dans l'interface `Database`, ajouter (avant `// Lifecycle`) :

```typescript
  // Credentials par tenant (chiffrés)
  getCredential(clientId: string, botId: string | null, service: string, provider: string): Promise<CredentialRecord | undefined>;
  upsertCredential(rec: CredentialRecord): Promise<void>;
  listCredentials(clientId: string): Promise<CredentialRecord[]>;
```

- [ ] **Step 2: Write the failing test**

Créer `src/core/credentials/__tests__/store.test.ts` :

```typescript
import { describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import type { CredentialRecord } from '../../database/types.js';

function rec(overrides: Partial<CredentialRecord> = {}): CredentialRecord {
  return {
    client_id: 'default',
    bot_id: null,
    service: 'llm',
    provider: 'anthropic',
    mode: 'byo',
    secret_encrypted: 'ZW5j',
    key_version: 1,
    ...overrides,
  };
}

describe('Database credentials (sqlite in-memory)', () => {
  it('insert puis get (portée client, bot_id null)', async () => {
    const db = createSqliteDriver(':memory:');
    await db.upsertCredential(rec());
    const got = await db.getCredential('default', null, 'llm', 'anthropic');
    expect(got?.secret_encrypted).toBe('ZW5j');
    expect(got?.mode).toBe('byo');
    await db.close();
  });

  it('upsert met à jour au lieu de dupliquer', async () => {
    const db = createSqliteDriver(':memory:');
    await db.upsertCredential(rec({ secret_encrypted: 'v1' }));
    await db.upsertCredential(rec({ secret_encrypted: 'v2' }));
    const got = await db.getCredential('default', null, 'llm', 'anthropic');
    expect(got?.secret_encrypted).toBe('v2');
    const all = await db.listCredentials('default');
    expect(all).toHaveLength(1);
    await db.close();
  });

  it('distingue portée bot et portée client', async () => {
    const db = createSqliteDriver(':memory:');
    await db.upsertCredential(rec({ bot_id: null, secret_encrypted: 'client' }));
    await db.upsertCredential(rec({ bot_id: 'botA', secret_encrypted: 'bot' }));
    expect((await db.getCredential('default', null, 'llm', 'anthropic'))?.secret_encrypted).toBe('client');
    expect((await db.getCredential('default', 'botA', 'llm', 'anthropic'))?.secret_encrypted).toBe('bot');
    await db.close();
  });

  it('get inexistant -> undefined', async () => {
    const db = createSqliteDriver(':memory:');
    expect(await db.getCredential('x', null, 'llm', 'anthropic')).toBeUndefined();
    await db.close();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/core/credentials/__tests__/store.test.ts`
Expected: FAIL — `createSqliteDriver` n'accepte pas d'argument / `upsertCredential` absent.

- [ ] **Step 4: Make sqlite driver accept an optional path**

Dans `src/core/database/sqlite.ts`, modifier la signature et l'ouverture :

```typescript
export function createSqliteDriver(dbPath: string = DB_PATH): Database {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new BetterSqlite3(dbPath);
```

(Remplace l'ancien `fs.mkdirSync(path.dirname(DB_PATH), …)` et `new BetterSqlite3(DB_PATH)`.)

- [ ] **Step 5: Add the table to the SQLite schema**

Dans la constante `SCHEMA` de `sqlite.ts`, ajouter avant la fin du template :

```sql
    CREATE TABLE IF NOT EXISTS tenant_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      bot_id TEXT,
      service TEXT NOT NULL,
      provider TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'byo',
      secret_encrypted TEXT NOT NULL,
      key_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uniq_tenant_credentials
      ON tenant_credentials(client_id, COALESCE(bot_id, ''), service, provider);
```

- [ ] **Step 6: Implement the three methods in the SQLite driver**

Dans l'objet `driver` de `sqlite.ts`, ajouter (avant `close`) :

```typescript
    async getCredential(clientId, botId, service, provider) {
      return db.prepare(
        `SELECT client_id, bot_id, service, provider, mode, secret_encrypted, key_version
         FROM tenant_credentials
         WHERE client_id = ? AND bot_id IS ? AND service = ? AND provider = ?`
      ).get(clientId, botId, service, provider) as CredentialRecord | undefined;
    },

    async upsertCredential(rec) {
      const upd = db.prepare(
        `UPDATE tenant_credentials
         SET mode = ?, secret_encrypted = ?, key_version = ?, updated_at = datetime('now')
         WHERE client_id = ? AND bot_id IS ? AND service = ? AND provider = ?`
      ).run(rec.mode, rec.secret_encrypted, rec.key_version, rec.client_id, rec.bot_id, rec.service, rec.provider);
      if (upd.changes === 0) {
        db.prepare(
          `INSERT INTO tenant_credentials (client_id, bot_id, service, provider, mode, secret_encrypted, key_version)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(rec.client_id, rec.bot_id, rec.service, rec.provider, rec.mode, rec.secret_encrypted, rec.key_version);
      }
    },

    async listCredentials(clientId) {
      return db.prepare(
        `SELECT client_id, bot_id, service, provider, mode, secret_encrypted, key_version
         FROM tenant_credentials WHERE client_id = ? ORDER BY service, provider`
      ).all(clientId) as CredentialRecord[];
    },
```

Ajouter `CredentialRecord` à l'import de types en tête de fichier.

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/core/credentials/__tests__/store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Create the store facade**

Créer `src/core/credentials/store.ts` :

```typescript
/**
 * Façade typée d'accès DB pour les credentials.
 * Ne fait aucune crypto : renvoie/écrit des enregistrements chiffrés.
 */

import { getDatabase } from '../database/index.js';
import type { CredentialRecord } from '../database/types.js';

export type { CredentialRecord };

export function getCredentialRecord(
  clientId: string,
  botId: string | null,
  service: string,
  provider: string,
): Promise<CredentialRecord | undefined> {
  return getDatabase().getCredential(clientId, botId, service, provider);
}

export function upsertCredentialRecord(rec: CredentialRecord): Promise<void> {
  return getDatabase().upsertCredential(rec);
}

export function listCredentialRecords(clientId: string): Promise<CredentialRecord[]> {
  return getDatabase().listCredentials(clientId);
}
```

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: pas d'erreur.

- [ ] **Step 10: Commit**

```bash
git add src/core/database/types.ts src/core/database/sqlite.ts src/core/credentials/store.ts src/core/credentials/__tests__/store.test.ts
git commit -m "P3: table tenant_credentials + store (sqlite) pour credentials chiffrés"
```

---

## Task 3: PostgreSQL driver implementation

**Files:**
- Modify: `src/core/database/postgres.ts`

**Interfaces:**
- Consumes: type `CredentialRecord` (Task 2).
- Produces: implémentation Postgres des 3 méthodes (même contrat que SQLite).

> Pas de test unitaire : pas d'instance Postgres en CI. Vérification = typecheck + parité structurelle avec SQLite. La vérification runtime est différée au déploiement sur le VPS.

- [ ] **Step 1: Add the table to the Postgres schema**

Dans la constante `SCHEMA` de `postgres.ts`, ajouter avant les index :

```sql
    CREATE TABLE IF NOT EXISTS tenant_credentials (
      id SERIAL PRIMARY KEY,
      client_id TEXT NOT NULL,
      bot_id TEXT,
      service TEXT NOT NULL,
      provider TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'byo',
      secret_encrypted TEXT NOT NULL,
      key_version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uniq_tenant_credentials
      ON tenant_credentials(client_id, COALESCE(bot_id, ''), service, provider);
```

- [ ] **Step 2: Implement the three methods in the Postgres driver**

Dans l'objet `driver` de `postgres.ts`, ajouter (avant `close`). `IS NOT DISTINCT FROM` gère l'égalité NULL :

```typescript
    async getCredential(clientId, botId, service, provider) {
      const result = await pool.query(
        `SELECT client_id, bot_id, service, provider, mode, secret_encrypted, key_version
         FROM tenant_credentials
         WHERE client_id = $1 AND bot_id IS NOT DISTINCT FROM $2 AND service = $3 AND provider = $4`,
        [clientId, botId, service, provider]
      );
      return result.rows[0] as CredentialRecord | undefined;
    },

    async upsertCredential(rec) {
      const upd = await pool.query(
        `UPDATE tenant_credentials
         SET mode = $5, secret_encrypted = $6, key_version = $7, updated_at = NOW()
         WHERE client_id = $1 AND bot_id IS NOT DISTINCT FROM $2 AND service = $3 AND provider = $4`,
        [rec.client_id, rec.bot_id, rec.service, rec.provider, rec.mode, rec.secret_encrypted, rec.key_version]
      );
      if (upd.rowCount === 0) {
        await pool.query(
          `INSERT INTO tenant_credentials (client_id, bot_id, service, provider, mode, secret_encrypted, key_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [rec.client_id, rec.bot_id, rec.service, rec.provider, rec.mode, rec.secret_encrypted, rec.key_version]
        );
      }
    },

    async listCredentials(clientId) {
      const result = await pool.query(
        `SELECT client_id, bot_id, service, provider, mode, secret_encrypted, key_version
         FROM tenant_credentials WHERE client_id = $1 ORDER BY service, provider`,
        [clientId]
      );
      return result.rows as CredentialRecord[];
    },
```

Ajouter `CredentialRecord` à l'import de types en tête de fichier.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: pas d'erreur (les deux drivers satisfont l'interface `Database`).

- [ ] **Step 4: Run full suite (non-régression)**

Run: `npx vitest run`
Expected: tous les tests passent.

- [ ] **Step 5: Commit**

```bash
git add src/core/database/postgres.ts
git commit -m "P3: impl Postgres de tenant_credentials (parité SQLite)"
```

---

## Task 4: Resolver

**Files:**
- Create: `src/core/credentials/resolver.ts`
- Test: `src/core/credentials/__tests__/resolver.test.ts`

**Interfaces:**
- Consumes: `decryptJson` (Task 1), `CredentialRecord` (Task 2), façade `store` (Task 2).
- Produces:
  - `makeResolver(deps?): Resolver` (factory pour injection en test)
  - `resolveLlmCredentials(clientId: string, botId: string | null): Promise<{ apiKey: string; quotaContext?: unknown }>`
  - `resolveTransportCredentials(clientId: string, botId: string | null, provider: string): Promise<Record<string, string>>`
  - `resolveCrmCredentials(clientId: string, provider: string): Promise<Record<string, string>>`

- [ ] **Step 1: Write the failing test**

Créer `src/core/credentials/__tests__/resolver.test.ts` :

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeResolver } from '../resolver.js';
import { encryptJson } from '../crypto.js';
import type { CredentialRecord } from '../../database/types.js';

const KEY_HEX = '0'.repeat(64);

function record(partial: Partial<CredentialRecord> & { value: unknown }): CredentialRecord {
  const { value, ...rest } = partial;
  const { secret, keyVersion } = encryptJson(value);
  return {
    client_id: 'default',
    bot_id: null,
    service: 'llm',
    provider: 'anthropic',
    mode: 'byo',
    ...rest,
    secret_encrypted: secret,
    key_version: keyVersion,
  };
}

/** Store factice : map clé -> record. */
function fakeStore(records: CredentialRecord[]) {
  const key = (c: string, b: string | null, s: string, p: string) => `${c}|${b ?? ''}|${s}|${p}`;
  const map = new Map(records.map((r) => [key(r.client_id, r.bot_id, r.service, r.provider), r]));
  return {
    getCredentialRecord: async (c: string, b: string | null, s: string, p: string) => map.get(key(c, b, s, p)),
  };
}

describe('resolver', () => {
  beforeEach(() => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', KEY_HEX);
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-platform');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('llm byo renvoie la clé client', async () => {
    const store = fakeStore([record({ mode: 'byo', value: { api_key: 'sk-client' } })]);
    const r = makeResolver({ store });
    expect((await r.resolveLlmCredentials('default', null)).apiKey).toBe('sk-client');
  });

  it('llm platform renvoie la clé plateforme (env)', async () => {
    const store = fakeStore([record({ mode: 'platform', value: {} })]);
    const r = makeResolver({ store });
    expect((await r.resolveLlmCredentials('default', null)).apiKey).toBe('sk-platform');
  });

  it('llm fallback .env quand aucun enregistrement', async () => {
    const store = fakeStore([]);
    const r = makeResolver({ store });
    expect((await r.resolveLlmCredentials('default', null)).apiKey).toBe('sk-platform');
  });

  it('bot-scope prioritaire sur client-scope', async () => {
    const store = fakeStore([
      record({ bot_id: null, mode: 'byo', value: { api_key: 'client-key' } }),
      record({ bot_id: 'botA', mode: 'byo', value: { api_key: 'bot-key' } }),
    ]);
    const r = makeResolver({ store });
    expect((await r.resolveLlmCredentials('default', 'botA')).apiKey).toBe('bot-key');
  });

  it('transport renvoie la config déchiffrée', async () => {
    const store = fakeStore([
      record({ service: 'transport', provider: 'meta-cloud', mode: 'byo', value: { phone_number_id: '123', access_token: 'tok', app_secret: 'sec' } }),
    ]);
    const r = makeResolver({ store });
    expect(await r.resolveTransportCredentials('default', null, 'meta-cloud')).toEqual({ phone_number_id: '123', access_token: 'tok', app_secret: 'sec' });
  });

  it('crm renvoie la config déchiffrée', async () => {
    const store = fakeStore([
      record({ service: 'crm', provider: 'hubspot', mode: 'byo', value: { access_token: 'pat-x' } }),
    ]);
    const r = makeResolver({ store });
    expect(await r.resolveCrmCredentials('default', 'hubspot')).toEqual({ access_token: 'pat-x' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/credentials/__tests__/resolver.test.ts`
Expected: FAIL — `Cannot find module '../resolver.js'`.

- [ ] **Step 3: Write the implementation**

Créer `src/core/credentials/resolver.ts` :

```typescript
/**
 * Résolution des credentials par tenant.
 *
 * Compose store + crypto, porte la logique byo/platform et le fallback.
 * Seul module appelé par le moteur (transport/LLM/CRM) — branchement au plan de suivi.
 *
 * Ordre de résolution : enregistrement bot-scope -> client-scope -> valeurs .env.
 */

import { decryptJson } from './crypto.js';
import * as defaultStore from './store.js';
import type { CredentialRecord } from '../database/types.js';

interface StoreDeps {
  getCredentialRecord(
    clientId: string,
    botId: string | null,
    service: string,
    provider: string,
  ): Promise<CredentialRecord | undefined>;
}

export interface ResolverDeps {
  store?: StoreDeps;
}

/** Cherche bot-scope puis client-scope. */
async function findRecord(
  store: StoreDeps,
  clientId: string,
  botId: string | null,
  service: string,
  provider: string,
): Promise<CredentialRecord | undefined> {
  if (botId) {
    const botScoped = await store.getCredentialRecord(clientId, botId, service, provider);
    if (botScoped) return botScoped;
  }
  return store.getCredentialRecord(clientId, null, service, provider);
}

function decode(rec: CredentialRecord): Record<string, string> {
  return decryptJson(rec.secret_encrypted, rec.key_version) as Record<string, string>;
}

export function makeResolver(deps: ResolverDeps = {}) {
  const store: StoreDeps = deps.store ?? defaultStore;

  async function resolveLlmCredentials(
    clientId: string,
    botId: string | null,
  ): Promise<{ apiKey: string; quotaContext?: unknown }> {
    const rec = await findRecord(store, clientId, botId, 'llm', 'anthropic');
    if (rec && rec.mode === 'byo') {
      const obj = decode(rec);
      if (obj.api_key) return { apiKey: obj.api_key };
    }
    // mode platform OU pas d'enregistrement -> clé plateforme (aujourd'hui une seule, depuis l'env).
    // quotaContext réservé à l'item résilience (pool/quotas) — no-op pour l'instant.
    return { apiKey: process.env['ANTHROPIC_API_KEY'] || '' };
  }

  async function resolveTransportCredentials(
    clientId: string,
    botId: string | null,
    provider: string,
  ): Promise<Record<string, string>> {
    const rec = await findRecord(store, clientId, botId, 'transport', provider);
    if (rec) return decode(rec);
    return {}; // fallback .env géré par l'appelant (config global) au plan de suivi
  }

  async function resolveCrmCredentials(
    clientId: string,
    provider: string,
  ): Promise<Record<string, string>> {
    const rec = await findRecord(store, clientId, null, 'crm', provider);
    if (rec) return decode(rec);
    return {};
  }

  return { resolveLlmCredentials, resolveTransportCredentials, resolveCrmCredentials };
}

const defaultResolver = makeResolver();
export const resolveLlmCredentials = defaultResolver.resolveLlmCredentials;
export const resolveTransportCredentials = defaultResolver.resolveTransportCredentials;
export const resolveCrmCredentials = defaultResolver.resolveCrmCredentials;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/credentials/__tests__/resolver.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: pas d'erreur.

- [ ] **Step 6: Commit**

```bash
git add src/core/credentials/resolver.ts src/core/credentials/__tests__/resolver.test.ts
git commit -m "P3: resolver credentials (byo/platform + fallback bot>client>env)"
```

---

## Task 5: Seed migration script

**Files:**
- Create: `scripts/seed-credentials.ts`
- Test: `src/core/credentials/__tests__/seed.test.ts`

**Interfaces:**
- Consumes: `encryptJson` (Task 1), `CredentialRecord` (Task 2).
- Produces:
  - `buildSeedRecords(env): CredentialRecord[]` (logique pure, testable)
  - script exécutable qui upsert ces records via `getDatabase()`

- [ ] **Step 1: Write the failing test**

Créer `src/core/credentials/__tests__/seed.test.ts` :

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSeedRecords } from '../../../../scripts/seed-credentials.js';
import { decryptJson } from '../crypto.js';

const KEY_HEX = '0'.repeat(64);

describe('buildSeedRecords', () => {
  beforeEach(() => vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', KEY_HEX));
  afterEach(() => vi.unstubAllEnvs());

  it('seed meta + anthropic + hubspot pour le client default', () => {
    const recs = buildSeedRecords({
      META_PHONE_NUMBER_ID: 'pid', META_ACCESS_TOKEN: 'mtok', META_APP_SECRET: 'msec', META_VERIFY_TOKEN: 'vtok',
      ANTHROPIC_API_KEY: 'sk-anthropic',
      HUBSPOT_TOKEN: 'pat-hub',
    });

    const llm = recs.find((r) => r.service === 'llm');
    expect(llm?.client_id).toBe('default');
    expect(llm?.mode).toBe('byo');
    expect(decryptJson(llm!.secret_encrypted, llm!.key_version)).toEqual({ api_key: 'sk-anthropic' });

    const meta = recs.find((r) => r.provider === 'meta-cloud');
    expect(decryptJson(meta!.secret_encrypted, meta!.key_version)).toEqual({
      phone_number_id: 'pid', access_token: 'mtok', app_secret: 'msec', verify_token: 'vtok',
    });

    const hub = recs.find((r) => r.provider === 'hubspot');
    expect(decryptJson(hub!.secret_encrypted, hub!.key_version)).toEqual({ access_token: 'pat-hub' });
  });

  it('ignore les services dont les secrets sont absents', () => {
    const recs = buildSeedRecords({ ANTHROPIC_API_KEY: 'sk-only' });
    expect(recs.map((r) => r.service)).toEqual(['llm']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/credentials/__tests__/seed.test.ts`
Expected: FAIL — module `scripts/seed-credentials.js` introuvable.

- [ ] **Step 3: Write the script**

Créer `scripts/seed-credentials.ts` :

```typescript
/**
 * Migration one-shot : lit les globals .env et écrit des credentials chiffrés
 * pour le client `default`. Non destructif : tant qu'aucun enregistrement n'existe,
 * le resolver retombe sur .env. Exécuter : npx tsx scripts/seed-credentials.ts
 */

import 'dotenv/config';
import { encryptJson } from '../src/core/credentials/crypto.js';
import { initDatabase, getDatabase } from '../src/core/database/index.js';
import type { CredentialRecord } from '../src/core/database/types.js';

type Env = Record<string, string | undefined>;

function makeRecord(
  service: string,
  provider: string,
  mode: string,
  value: Record<string, string>,
): CredentialRecord {
  const { secret, keyVersion } = encryptJson(value);
  return {
    client_id: 'default',
    bot_id: null,
    service,
    provider,
    mode,
    secret_encrypted: secret,
    key_version: keyVersion,
  };
}

export function buildSeedRecords(env: Env): CredentialRecord[] {
  const recs: CredentialRecord[] = [];

  if (env['ANTHROPIC_API_KEY']) {
    recs.push(makeRecord('llm', 'anthropic', 'byo', { api_key: env['ANTHROPIC_API_KEY'] }));
  }

  if (env['META_PHONE_NUMBER_ID'] && env['META_ACCESS_TOKEN']) {
    recs.push(makeRecord('transport', 'meta-cloud', 'byo', {
      phone_number_id: env['META_PHONE_NUMBER_ID'],
      access_token: env['META_ACCESS_TOKEN'],
      app_secret: env['META_APP_SECRET'] ?? '',
      verify_token: env['META_VERIFY_TOKEN'] ?? '',
    }));
  }

  if (env['HUBSPOT_TOKEN']) {
    recs.push(makeRecord('crm', 'hubspot', 'byo', { access_token: env['HUBSPOT_TOKEN'] }));
  }

  return recs;
}

async function main(): Promise<void> {
  await initDatabase();
  const db = getDatabase();
  const recs = buildSeedRecords(process.env);
  for (const rec of recs) {
    await db.upsertCredential(rec);
    console.log(`[Seed] ${rec.service}/${rec.provider} (mode=${rec.mode}) -> client default`);
  }
  console.log(`[Seed] ${recs.length} credential(s) écrit(s).`);
  await db.close();
}

// Exécution directe uniquement (pas à l'import en test)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[Seed] échec:', err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/credentials/__tests__/seed.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: typecheck OK ; tous les tests passent.

- [ ] **Step 6: Commit**

```bash
git add scripts/seed-credentials.ts src/core/credentials/__tests__/seed.test.ts
git commit -m "P3: script de migration .env -> credentials chiffrés (client default)"
```

---

## Suite (plan séparé) — Branchement dans le moteur

Hors scope de ce plan, à planifier en détail après lecture complète des modules concernés :

- **Transport** (`src/transport/index.ts`) : `getTransport` lit `config.meta.*` et met en cache par id global. Rekey le cache par `(client_id, bot_id, provider)` et alimenter via `resolveTransportCredentials` (fallback `config.*` si vide).
- **LLM** (`src/llm/anthropic.ts`) : `export const client = new Anthropic({ apiKey: config.anthropic.apiKey })` est un **singleton créé à l'import**. Refactor en factory `getAnthropicClient(clientId, botId)` qui résout via `resolveLlmCredentials` et met en cache par clé résolue. C'est le point le plus invasif.
- **CRM** (`src/core/crm-bridge.ts`) : alimenter `createConnector` via `resolveCrmCredentials` au lieu de `config.*`.

Chaque branchement = une tâche avec fallback `.env` pour ne rien casser, vérifiée par les tests existants + un test e2e du chemin résolu.
