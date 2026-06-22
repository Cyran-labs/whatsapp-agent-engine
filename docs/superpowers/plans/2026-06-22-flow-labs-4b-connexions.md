# Flow Labs — Plan 4b : Connexions (credentials, validation, mappings, LLM) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compléter l'API admin avec l'onglet « Connexions » d'un agent : configuration + validation des identifiants WhatsApp (transport), CRM et IA (LLM), gestion des mappings CRM (FieldMapping validé), masquage des secrets, et durcissement du gate d'activation (« WhatsApp connecté + validé »).

**Architecture:** On prolonge le socle des Plans 3/4a. Un module `providers` décrit, par service/provider, les champs d'identifiants (publics vs secrets) — il pilote le catalogue, le masquage et la validation d'entrée. Une nouvelle table `bot_runtime_state` persiste le résultat de validation du transport (drive le gate). Les drivers `Transport` et `CRMConnector` gagnent une capacité `validate()` (appel API réel, `fetch` mockable). Un `CredentialsService` écrit/lit les secrets (chiffrés AES-GCM, masqués en lecture). Un `ConnectionsService` orchestre set/validate transport+CRM+LLM + mappings. Le gate `BotService.setStatus('active')` exige désormais une validation transport réussie. Tout passe par l'API ; le pipeline runtime ne bouge pas.

**Tech Stack:** TypeScript strict ESM, Express 5, better-sqlite3 + pg, Vitest, zod. Pas de nouvelle dépendance.

## Global Constraints

Du spec `docs/superpowers/specs/2026-06-22-flow-labs-backoffice-design.md` (§6, §8, §9) + conventions repo. Hérité par chaque task.

- **Nom produit = Flow Labs** (jamais « Cyran » dans code/logs/messages).
- **TypeScript strict** : pas de `any`, `const` par défaut, `noUnusedLocals`/`noUnusedParameters`. Imports relatifs en `.js`.
- **Logs** : `[Service] message` sans emoji.
- **Database** : méthodes `async`. SQLite testé CI ; Postgres miroir mécanique (SERIAL, TIMESTAMPTZ, `::text`, `$n`, `JSONB`, `RETURNING`). Upsert tables neuves = UPDATE-then-INSERT.
- **Sécurité secrets** : credentials chiffrés AES-256-GCM (réutiliser `crypto.ts` existant). **Jamais renvoyés en clair** : GET renvoie les champs publics en clair et les champs secrets masqués `••••1234`. Comparaisons de secrets en temps constant (déjà en place).
- **Validation testable sans comptes** : `validate()` fait un appel API réel via `fetch` global ; les tests stubent `fetch` (`vi.stubGlobal`). Aucun test ne requiert de compte live.
- **Multi-tenant** : routes `bots/*` sous `requireAuth` + `scopeToClient` (clientId effectif = `req.scopedClientId`). Jamais d'accès cross-client.
- **Gate activation** : `setStatus('active')` exige `≥1 numéro` (4a) **ET** une validation transport réussie persistée (`bot_runtime_state.transport_validated_at` non nul). Tout changement des creds transport réinitialise cette validation.
- **CRM bot-scope + fallback client** (décision actée) : les creds CRM sont résolus bot→client. Ce plan **aligne** `resolveCrmCredentials` sur ce contrat.
- **Forme d'erreur API unique** (Plan 3) ; conflits → 409 ; validation Zod → 400.
- **Audit** : toute mutation (set creds, set mapping, set llm, validate) journalise via `recordAudit` (best-effort).
- Author git : `Francois Greze <francois@cyran.fr>`. Pas de signature Claude. Commits via le workflow subagent.

---

## File Structure

**Nouveaux fichiers**
- `src/core/providers.ts` — métadonnées providers (champs publics/secrets), masquage, catalogue.
- `src/core/__tests__/providers.test.ts`
- `src/core/services/credentials-service.ts` — `CredentialsService` (set + getMasked).
- `src/core/services/__tests__/credentials-service.test.ts`
- `src/core/services/connections-service.ts` — `ConnectionsService` (transport/crm/llm/mappings).
- `src/core/services/__tests__/connections-service.test.ts`
- `src/contracts/connections.ts` — schémas Zod (SetCredentialsInput, SetLlmInput, FieldMapping).
- `src/api/admin/routes/connections.ts` — sous-routeur monté sur `bots/:botId/...` (transport/crm/llm/mappings) + `GET /connectors`.
- `src/api/admin/__tests__/connections-routes.test.ts`
- `src/core/database/__tests__/runtime-state-table.test.ts`
- `src/transport/__tests__/validate.test.ts`
- `src/connectors/__tests__/validate.test.ts`

**Fichiers modifiés**
- `src/core/database/types.ts` — `BotRuntimeStateRecord` + méthodes `Database`.
- `src/core/database/sqlite.ts` + `postgres.ts` — table `bot_runtime_state` + méthodes.
- `src/transport/types.ts` — `Transport.validateCredentials?()`.
- `src/transport/meta-cloud.ts` + `cm-com.ts` — impl `validateCredentials`.
- `src/connectors/types.ts` — `CRMConnector.validate?()`.
- `src/connectors/hubspot.ts` — impl `validate`.
- `src/core/credentials/resolver.ts` — `resolveCrmCredentials(clientId, botId, provider)` bot→client.
- `src/core/crm-bridge.ts` — appel `resolveCrmCredentials(client_id, bot_id, connector)`.
- `src/core/credentials/__tests__/resolver.test.ts` — cas bot→client CRM.
- `src/core/services/bot-service.ts` — gate `setStatus` lit `bot_runtime_state`.
- `src/contracts/index.ts` — ré-export connections.
- `src/api/admin/router.ts` — monte le routeur connections + `GET /connectors`.

**Décisions actées (Plan 4b)** : `validate()` injectable (fetch mockable) ; masquage = champs publics clairs + secrets `••••`+4 ; gate = creds transport présents + validation persistée ; CRM creds bot→client (alignement resolver).

---

## Task 1: Module `providers` (métadonnées, masquage, catalogue)

**Files:**
- Create: `src/core/providers.ts`, `src/core/__tests__/providers.test.ts`

**Interfaces:**
- Produces :
  - `CredentialField { name: string; label: string; secret: boolean }`, `ProviderDef { label: string; fields: CredentialField[] }`, `CredentialService = 'transport' | 'crm' | 'llm'`.
  - `PROVIDERS: Record<CredentialService, Record<string, ProviderDef>>`.
  - `getProviderDef(service: string, provider: string): ProviderDef | undefined`.
  - `maskSecret(value: string): string` — `••••` + 4 derniers caractères (si len ≥ 4), sinon `••••`.
  - `maskCredentials(def: ProviderDef, values: Record<string, string>): Record<string, string>` — champs secrets masqués, publics en clair.
  - `connectorsCatalogue(): Array<{ service: CredentialService; provider: string; label: string; fields: CredentialField[] }>`.

- [ ] **Step 1: Test (échec attendu)**

Créer `src/core/__tests__/providers.test.ts` :

```typescript
import { describe, expect, it } from 'vitest';
import { PROVIDERS, getProviderDef, maskSecret, maskCredentials, connectorsCatalogue } from '../providers.js';

describe('providers', () => {
  it('PROVIDERS couvre transport/crm/llm', () => {
    expect(getProviderDef('transport', 'meta-cloud')).toBeDefined();
    expect(getProviderDef('crm', 'hubspot')).toBeDefined();
    expect(getProviderDef('llm', 'anthropic')).toBeDefined();
    expect(getProviderDef('crm', 'inconnu')).toBeUndefined();
  });

  it('maskSecret garde les 4 derniers', () => {
    expect(maskSecret('pat-eu1-secret-1234')).toBe('••••1234');
    expect(maskSecret('abc')).toBe('••••');
    expect(maskSecret('')).toBe('••••');
  });

  it('maskCredentials masque les secrets, garde les publics', () => {
    const def = getProviderDef('transport', 'meta-cloud')!;
    const masked = maskCredentials(def, { phone_number_id: '123456789', access_token: 'EAALongToken9876', app_secret: 'sek_abcd5555' });
    expect(masked.phone_number_id).toBe('123456789'); // public
    expect(masked.access_token).toBe('••••9876'); // secret
    expect(masked.app_secret).toBe('••••5555');
  });

  it('connectorsCatalogue aplatit tous les providers', () => {
    const cat = connectorsCatalogue();
    expect(cat.some((c) => c.service === 'crm' && c.provider === 'hubspot')).toBe(true);
    expect(cat.every((c) => Array.isArray(c.fields))).toBe(true);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/core/__tests__/providers.test.ts`
Expected: FAIL.

- [ ] **Step 3: Écrire `src/core/providers.ts`**

```typescript
/**
 * Métadonnées des providers d'identifiants (transport / CRM / LLM).
 * Source unique pour : le catalogue UI, le masquage des secrets en lecture,
 * et la validation des champs acceptés en écriture.
 */

export interface CredentialField {
  name: string;
  label: string;
  secret: boolean;
}

export interface ProviderDef {
  label: string;
  fields: CredentialField[];
}

export type CredentialService = 'transport' | 'crm' | 'llm';

export const PROVIDERS: Record<CredentialService, Record<string, ProviderDef>> = {
  transport: {
    'meta-cloud': {
      label: 'WhatsApp — Meta Cloud API',
      fields: [
        { name: 'phone_number_id', label: 'Phone Number ID', secret: false },
        { name: 'access_token', label: 'Access Token', secret: true },
        { name: 'app_secret', label: 'App Secret', secret: true },
      ],
    },
    'cm-com': {
      label: 'WhatsApp — CM.com',
      fields: [
        { name: 'product_token', label: 'Product Token', secret: true },
        { name: 'from_number', label: 'Numéro émetteur', secret: false },
        { name: 'service_url', label: 'Service URL', secret: false },
      ],
    },
  },
  crm: {
    hubspot: { label: 'HubSpot', fields: [{ name: 'access_token', label: 'Private App Token', secret: true }] },
    attio: { label: 'Attio', fields: [{ name: 'api_key', label: 'API Key', secret: true }] },
    pipedrive: { label: 'Pipedrive', fields: [{ name: 'api_token', label: 'API Token', secret: true }, { name: 'company_domain', label: 'Domaine', secret: false }] },
    salesforce: { label: 'Salesforce', fields: [{ name: 'instance_url', label: 'Instance URL', secret: false }, { name: 'access_token', label: 'Access Token', secret: true }] },
    zoho: { label: 'Zoho', fields: [{ name: 'access_token', label: 'Access Token', secret: true }, { name: 'api_domain', label: 'API Domain', secret: false }] },
    'webhook-generic': { label: 'Webhook générique', fields: [{ name: 'url', label: 'URL', secret: false }, { name: 'secret', label: 'Secret HMAC', secret: true }] },
  },
  llm: {
    anthropic: { label: 'Anthropic', fields: [{ name: 'api_key', label: 'API Key', secret: true }] },
  },
};

export function getProviderDef(service: string, provider: string): ProviderDef | undefined {
  const svc = PROVIDERS[service as CredentialService];
  return svc ? svc[provider] : undefined;
}

export function maskSecret(value: string): string {
  return value.length >= 4 ? `••••${value.slice(-4)}` : '••••';
}

export function maskCredentials(def: ProviderDef, values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of def.fields) {
    const v = values[field.name];
    if (v === undefined) continue;
    out[field.name] = field.secret ? maskSecret(v) : v;
  }
  return out;
}

export function connectorsCatalogue(): Array<{ service: CredentialService; provider: string; label: string; fields: CredentialField[] }> {
  const out: Array<{ service: CredentialService; provider: string; label: string; fields: CredentialField[] }> = [];
  for (const service of Object.keys(PROVIDERS) as CredentialService[]) {
    for (const [provider, def] of Object.entries(PROVIDERS[service])) {
      out.push({ service, provider, label: def.label, fields: def.fields });
    }
  }
  return out;
}
```

- [ ] **Step 4: Vérifier le succès + tsc**

Run: `npm run typecheck && npx vitest run src/core/__tests__/providers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/providers.ts src/core/__tests__/providers.test.ts
git commit -m "feat(core): module providers (champs creds, masquage, catalogue)"
```

---

## Task 2: Table `bot_runtime_state` + méthodes Database

**Files:**
- Modify: `src/core/database/types.ts`, `src/core/database/sqlite.ts`, `src/core/database/postgres.ts`
- Test: `src/core/database/__tests__/runtime-state-table.test.ts`

**Interfaces:**
- Produces :
  - `BotRuntimeStateRecord { client_id: string; bot_id: string; transport_validated_at: string | null; transport_error: string | null; updated_at: string }`.
  - `Database.getBotRuntimeState(clientId: string, botId: string): Promise<BotRuntimeStateRecord | undefined>`.
  - `Database.setTransportValidation(clientId: string, botId: string, validatedAt: string | null, error: string | null): Promise<void>` (upsert UPDATE-then-INSERT sur PK (client_id, bot_id)).

> NOTE implémenteur : table PK composite `(client_id, bot_id)`. `setTransportValidation` écrit les deux colonnes (validatedAt + error) à chaque appel (succès → validatedAt=ISO, error=null ; échec → validatedAt=null, error=message). Ajouter types + interface + 2 drivers dans le même commit.

- [ ] **Step 1: Test (échec attendu)**

Créer `src/core/database/__tests__/runtime-state-table.test.ts` :

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../sqlite.js';
import type { Database } from '../types.js';

describe('bot_runtime_state (sqlite)', () => {
  let db: Database;
  beforeEach(() => { db = createSqliteDriver(':memory:'); });
  afterEach(async () => { await db.close(); });

  it('absent → undefined', async () => {
    expect(await db.getBotRuntimeState('acme', 'immo')).toBeUndefined();
  });

  it('setTransportValidation succès puis échec (upsert)', async () => {
    await db.setTransportValidation('acme', 'immo', '2026-06-22T10:00:00.000Z', null);
    let st = await db.getBotRuntimeState('acme', 'immo');
    expect(st!.transport_validated_at).toBe('2026-06-22T10:00:00.000Z');
    expect(st!.transport_error).toBeNull();
    await db.setTransportValidation('acme', 'immo', null, 'token expiré');
    st = await db.getBotRuntimeState('acme', 'immo');
    expect(st!.transport_validated_at).toBeNull();
    expect(st!.transport_error).toBe('token expiré');
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/core/database/__tests__/runtime-state-table.test.ts`
Expected: FAIL.

- [ ] **Step 3: Types**

Dans `src/core/database/types.ts`, ajouter :

```typescript
export interface BotRuntimeStateRecord {
  client_id: string;
  bot_id: string;
  transport_validated_at: string | null;
  transport_error: string | null;
  updated_at: string;
}
```

Dans l'interface `Database` :

```typescript
  // État runtime par bot (validation transport, etc.)
  getBotRuntimeState(clientId: string, botId: string): Promise<BotRuntimeStateRecord | undefined>;
  setTransportValidation(clientId: string, botId: string, validatedAt: string | null, error: string | null): Promise<void>;
```

- [ ] **Step 4: SQLite**

Mettre à jour l'import de types. Ajouter au SCHEMA :

```sql
    CREATE TABLE IF NOT EXISTS bot_runtime_state (
      client_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      transport_validated_at TEXT,
      transport_error TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (client_id, bot_id)
    );
```

Méthodes :

```typescript
    async getBotRuntimeState(clientId: string, botId: string): Promise<BotRuntimeStateRecord | undefined> {
      return db.prepare(
        `SELECT client_id, bot_id, transport_validated_at, transport_error, updated_at
         FROM bot_runtime_state WHERE client_id = ? AND bot_id = ?`
      ).get(clientId, botId) as BotRuntimeStateRecord | undefined;
    },

    async setTransportValidation(clientId: string, botId: string, validatedAt: string | null, error: string | null): Promise<void> {
      const upd = db.prepare(
        `UPDATE bot_runtime_state SET transport_validated_at = ?, transport_error = ?, updated_at = datetime('now')
         WHERE client_id = ? AND bot_id = ?`
      ).run(validatedAt, error, clientId, botId);
      if (upd.changes === 0) {
        db.prepare(
          `INSERT INTO bot_runtime_state (client_id, bot_id, transport_validated_at, transport_error)
           VALUES (?, ?, ?, ?)`
        ).run(clientId, botId, validatedAt, error);
      }
    },
```

- [ ] **Step 5: Vérifier le succès SQLite**

Run: `npx vitest run src/core/database/__tests__/runtime-state-table.test.ts`
Expected: PASS.

- [ ] **Step 6: Postgres**

Mettre à jour l'import. Ajouter au SCHEMA :

```sql
    CREATE TABLE IF NOT EXISTS bot_runtime_state (
      client_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      transport_validated_at TIMESTAMPTZ,
      transport_error TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (client_id, bot_id)
    );
```

Méthodes :

```typescript
    async getBotRuntimeState(clientId: string, botId: string): Promise<BotRuntimeStateRecord | undefined> {
      const r = await pool.query(
        `SELECT client_id, bot_id, transport_validated_at::text, transport_error, updated_at::text
         FROM bot_runtime_state WHERE client_id = $1 AND bot_id = $2`,
        [clientId, botId]
      );
      return r.rows[0] as BotRuntimeStateRecord | undefined;
    },

    async setTransportValidation(clientId: string, botId: string, validatedAt: string | null, error: string | null): Promise<void> {
      const upd = await pool.query(
        `UPDATE bot_runtime_state SET transport_validated_at = $1, transport_error = $2, updated_at = NOW()
         WHERE client_id = $3 AND bot_id = $4`,
        [validatedAt, error, clientId, botId]
      );
      if (upd.rowCount === 0) {
        await pool.query(
          `INSERT INTO bot_runtime_state (client_id, bot_id, transport_validated_at, transport_error)
           VALUES ($1, $2, $3, $4)`,
          [clientId, botId, validatedAt, error]
        );
      }
    },
```

- [ ] **Step 7: tsc + suite DB**

Run: `npm run typecheck && npx vitest run src/core/database/`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/core/database/types.ts src/core/database/sqlite.ts src/core/database/postgres.ts src/core/database/__tests__/runtime-state-table.test.ts
git commit -m "feat(db): table bot_runtime_state (validation transport)"
```

---

## Task 3: Capacité `validate()` (Transport + CRMConnector)

**Files:**
- Modify: `src/transport/types.ts`, `src/transport/meta-cloud.ts`, `src/transport/cm-com.ts`, `src/connectors/types.ts`, `src/connectors/hubspot.ts`
- Test: `src/transport/__tests__/validate.test.ts`, `src/connectors/__tests__/validate.test.ts`

**Interfaces:**
- Produces :
  - `Transport.validateCredentials?(): Promise<{ ok: boolean; error?: string }>`.
  - `CRMConnector.validate?(): Promise<{ ok: boolean; error?: string }>`.
  - Impl : meta-cloud (GET Graph), cm-com (présence), hubspot (GET contacts?limit=1).

> NOTE implémenteur : `validateCredentials`/`validate` utilisent `fetch` global (tests : `vi.stubGlobal('fetch', ...)`), try/catch → jamais throw, renvoient `{ ok, error? }`. meta-cloud : `GET {BASE}/{VERSION}/{phoneNumberId}?fields=id` avec header `Authorization: Bearer {accessToken}` ; 2xx → ok, sinon error avec status. cm-com : pas d'endpoint de test → `{ ok: true }` si productToken+fromNumber présents (sinon `{ ok:false, error }`). hubspot : `GET {HUBSPOT_API_BASE}/crm/v3/objects/contacts?limit=1` header `Authorization: Bearer {accessToken}`.

- [ ] **Step 1: Tests (échec attendu)**

Créer `src/transport/__tests__/validate.test.ts` :

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMetaCloudTransport } from '../meta-cloud.js';

afterEach(() => { vi.unstubAllGlobals(); });

const opts = { phoneNumberId: '123', accessToken: 'tok', appSecret: 'sek' };

describe('meta-cloud validateCredentials', () => {
  it('2xx → ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{"id":"123"}' }));
    const t = createMetaCloudTransport(opts);
    expect(await t.validateCredentials!()).toEqual({ ok: true });
  });

  it('401 → ok:false + error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'invalid token' }));
    const t = createMetaCloudTransport(opts);
    const r = await t.validateCredentials!();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('401');
  });

  it('fetch throw → ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const t = createMetaCloudTransport(opts);
    const r = await t.validateCredentials!();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('network down');
  });
});
```

Créer `src/connectors/__tests__/validate.test.ts` :

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HubSpotConnector } from '../hubspot.js';

afterEach(() => { vi.unstubAllGlobals(); });

const mapping = { version: 1, connector: 'hubspot', target_object: 'contacts', client_id: 'acme', field_mapping: [{ source: 'email', target: 'email' }] };

describe('hubspot validate', () => {
  it('2xx → ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' }));
    const c = new HubSpotConnector({ accessToken: 'pat-x', mapping });
    expect(await c.validate!()).toEqual({ ok: true });
  });

  it('403 → ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => 'forbidden' }));
    const c = new HubSpotConnector({ accessToken: 'pat-x', mapping });
    const r = await c.validate!();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('403');
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/transport/__tests__/validate.test.ts src/connectors/__tests__/validate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Interfaces**

Dans `src/transport/types.ts`, ajouter à l'interface `Transport` (après `verifyWebhookSignature?`) :

```typescript
  /**
   * (Optionnel) Teste les identifiants auprès de l'API du provider.
   * Appel réseau réel. Ne throw jamais : retourne { ok, error? }.
   */
  validateCredentials?(): Promise<{ ok: boolean; error?: string }>;
```

Dans `src/connectors/types.ts`, ajouter à l'interface `CRMConnector` :

```typescript
  /**
   * (Optionnel) Teste les identifiants auprès de l'API du CRM.
   * Appel réseau réel. Ne throw jamais : retourne { ok, error? }.
   */
  validate?(): Promise<{ ok: boolean; error?: string }>;
```

- [ ] **Step 4: Impl meta-cloud**

Dans `src/transport/meta-cloud.ts`, ajouter dans l'objet `Transport` retourné par `createMetaCloudTransport` (à côté des autres méthodes) :

```typescript
    async validateCredentials(): Promise<{ ok: boolean; error?: string }> {
      try {
        const url = `${META_API_BASE}/${META_API_VERSION}/${phoneNumberId}?fields=id`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (res.ok) return { ok: true };
        const body = await res.text();
        return { ok: false, error: `Meta a répondu ${res.status}: ${body.slice(0, 200)}` };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
```

- [ ] **Step 5: Impl cm-com**

Dans `src/transport/cm-com.ts`, ajouter à l'objet Transport retourné (adapter au nom des variables internes — `productToken`/`fromNumber`) :

```typescript
    async validateCredentials(): Promise<{ ok: boolean; error?: string }> {
      // CM.com n'expose pas d'endpoint de test simple : on valide la présence des identifiants requis.
      if (!productToken || !fromNumber) {
        return { ok: false, error: 'product_token et from_number sont requis.' };
      }
      return { ok: true };
    },
```

(Si le driver cm-com ne capture pas `productToken`/`fromNumber` en closure, lire le fichier et adapter — la garde porte sur les champs requis du provider.)

- [ ] **Step 6: Impl hubspot**

Dans `src/connectors/hubspot.ts`, ajouter à la classe `HubSpotConnector` :

```typescript
  async validate(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/contacts?limit=1`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      if (res.ok) return { ok: true };
      const body = await res.text();
      return { ok: false, error: `HubSpot a répondu ${res.status}: ${body.slice(0, 200)}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
```

- [ ] **Step 7: Vérifier le succès + tsc + connecteurs/transport**

Run: `npm run typecheck && npx vitest run src/transport/ src/connectors/`
Expected: PASS (aucune régression).

- [ ] **Step 8: Commit**

```bash
git add src/transport/types.ts src/transport/meta-cloud.ts src/transport/cm-com.ts src/connectors/types.ts src/connectors/hubspot.ts src/transport/__tests__/validate.test.ts src/connectors/__tests__/validate.test.ts
git commit -m "feat(transport,crm): capacité validate() (Meta + HubSpot, fetch mockable)"
```

---

## Task 4: CredentialsService + contrat FieldMapping (Zod)

**Files:**
- Create: `src/core/services/credentials-service.ts`, `src/core/services/__tests__/credentials-service.test.ts`, `src/contracts/connections.ts`
- Modify: `src/contracts/index.ts`

**Interfaces:**
- Consumes: `getProviderDef` (providers), `encryptJson`/`decryptJson` (crypto), store (`getCredentialRecord`/`upsertCredentialRecord`), `validationError`.
- Produces :
  - `CredentialsService` construit avec `{ db: Database }` (mais utilise le store via getDatabase indirectement — voir note), méthodes :
    - `setCredentials(clientId: string, botId: string | null, service: string, provider: string, values: Record<string, string>, mode?: string): Promise<void>`
    - `getMasked(clientId: string, botId: string | null, service: string, provider: string): Promise<{ configured: boolean; fields?: Record<string, string> }>`
  - Schémas Zod (`contracts/connections.ts`) : `SetCredentialsInput = z.object({ values: z.record(z.string()) })`, `SetLlmInput`, et `FieldMappingSchema` (mirror du type `FieldMapping`).

> NOTE implémenteur :
> - `setCredentials` : `getProviderDef(service, provider)` → si absent `validationError([{path:'provider', message:'Provider inconnu.'}])`. Rejeter toute clé de `values` hors des `fields` du provider (`validationError`). Champs secrets vides ignorés ? Non — accepter ce qui est fourni. Chiffrer le blob via `encryptJson(values)` → `upsertCredentialRecord({ client_id, bot_id, service, provider, mode: mode ?? 'byo', secret_encrypted, key_version })`.
> - `getMasked` : `getCredentialRecord` → si absent `{ configured: false }`. Sinon `decryptJson` → `maskCredentials(def, values)` → `{ configured: true, fields }`.
> - Le service prend `db` mais peut aussi appeler le store (`getDatabase()`). Pour la testabilité, injecter le store : constructeur `{ db }` suffit (le store lit `getDatabase()` ; les tests font `__setDatabaseForTests`). Utiliser directement `getCredentialRecord`/`upsertCredentialRecord` du store.
> - `FieldMappingSchema` Zod doit refléter `FieldMapping` (field-mapper.ts) : version(number), connector(string), target_object(string), client_id(string), field_mapping(array of {source,target,transform?}), fixed_values?({on_create?,on_update?} record string), default_values? idem, fallback?({target, concat_template?, include_unmapped?}), deduplication?({primary_key, fallback_keys?}).

- [ ] **Step 1: Tests (échec attendu)**

Créer `src/core/services/__tests__/credentials-service.test.ts` :

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import { __setDatabaseForTests } from '../../database/index.js';
import { CredentialsService } from '../credentials-service.js';
import type { Database } from '../../database/types.js';

const KEY = '0'.repeat(64); // 32 octets hex

describe('CredentialsService', () => {
  let db: Database;
  let svc: CredentialsService;
  beforeEach(() => {
    process.env['CREDENTIALS_ENCRYPTION_KEY'] = KEY;
    db = createSqliteDriver(':memory:'); __setDatabaseForTests(db);
    svc = new CredentialsService({ db });
  });
  afterEach(async () => { await db.close(); });

  it('set + getMasked : secrets masqués, publics clairs', async () => {
    await svc.setCredentials('acme', 'immo', 'transport', 'meta-cloud', { phone_number_id: '123456789', access_token: 'EAAToken9876', app_secret: 'sek_5555' });
    const masked = await svc.getMasked('acme', 'immo', 'transport', 'meta-cloud');
    expect(masked.configured).toBe(true);
    expect(masked.fields!.phone_number_id).toBe('123456789');
    expect(masked.fields!.access_token).toBe('••••9876');
  });

  it('getMasked non configuré → configured:false', async () => {
    expect(await svc.getMasked('acme', 'immo', 'crm', 'hubspot')).toEqual({ configured: false });
  });

  it('provider inconnu → VALIDATION_ERROR', async () => {
    await expect(svc.setCredentials('acme', null, 'crm', 'nope', { x: '1' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('clé hors schéma → VALIDATION_ERROR', async () => {
    await expect(svc.setCredentials('acme', 'immo', 'crm', 'hubspot', { access_token: 'x', bogus: 'y' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/core/services/__tests__/credentials-service.test.ts`
Expected: FAIL.

- [ ] **Step 3: `src/contracts/connections.ts`**

```typescript
import { z } from 'zod';

export const SetCredentialsInput = z.object({ values: z.record(z.string()) });
export type SetCredentialsInput = z.infer<typeof SetCredentialsInput>;

export const SetLlmInput = z.object({
  mode: z.enum(['byo', 'platform']),
  model: z.string().optional(),
  api_key: z.string().optional(),
});
export type SetLlmInput = z.infer<typeof SetLlmInput>;

const RuleSchema = z.object({ source: z.string(), target: z.string(), transform: z.string().optional() });
const ValuesSchema = z.object({ on_create: z.record(z.string()).optional(), on_update: z.record(z.string()).optional() });

export const FieldMappingSchema = z.object({
  version: z.number(),
  connector: z.string(),
  target_object: z.string(),
  client_id: z.string(),
  field_mapping: z.array(RuleSchema),
  fixed_values: ValuesSchema.optional(),
  default_values: ValuesSchema.optional(),
  fallback: z.object({ target: z.string(), concat_template: z.string().optional(), include_unmapped: z.boolean().optional() }).optional(),
  deduplication: z.object({ primary_key: z.string(), fallback_keys: z.array(z.string()).optional() }).optional(),
});
export type FieldMappingSchema = z.infer<typeof FieldMappingSchema>;
```

Ajouter à `src/contracts/index.ts` : `export * from './connections.js';`

- [ ] **Step 4: `src/core/services/credentials-service.ts`**

```typescript
import type { Database } from '../database/types.js';
import { getProviderDef, maskCredentials } from '../providers.js';
import { encryptJson, decryptJson } from '../credentials/crypto.js';
import { getCredentialRecord, upsertCredentialRecord } from '../credentials/store.js';
import { validationError } from '../../api/errors.js';

export interface CredentialsServiceDeps { db: Database; }

export class CredentialsService {
  // db conservé pour cohérence d'injection ; le store lit getDatabase() (positionné par les tests).
  constructor(_deps: CredentialsServiceDeps) { void _deps; }

  async setCredentials(clientId: string, botId: string | null, service: string, provider: string, values: Record<string, string>, mode?: string): Promise<void> {
    const def = getProviderDef(service, provider);
    if (!def) throw validationError([{ path: 'provider', message: 'Provider inconnu.' }]);
    const allowed = new Set(def.fields.map((f) => f.name));
    const unknown = Object.keys(values).filter((k) => !allowed.has(k));
    if (unknown.length > 0) throw validationError(unknown.map((k) => ({ path: `values.${k}`, message: 'Champ non reconnu pour ce provider.' })));
    const { secret, keyVersion } = encryptJson(values);
    await upsertCredentialRecord({ client_id: clientId, bot_id: botId, service, provider, mode: mode ?? 'byo', secret_encrypted: secret, key_version: keyVersion });
  }

  async getMasked(clientId: string, botId: string | null, service: string, provider: string): Promise<{ configured: boolean; fields?: Record<string, string> }> {
    const def = getProviderDef(service, provider);
    if (!def) throw validationError([{ path: 'provider', message: 'Provider inconnu.' }]);
    const rec = await getCredentialRecord(clientId, botId, service, provider);
    if (!rec) return { configured: false };
    const values = decryptJson(rec.secret_encrypted, rec.key_version) as Record<string, string>;
    return { configured: true, fields: maskCredentials(def, values) };
  }
}
```

- [ ] **Step 5: Vérifier le succès + tsc**

Run: `npm run typecheck && npx vitest run src/core/services/__tests__/credentials-service.test.ts src/contracts/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/services/credentials-service.ts src/core/services/__tests__/credentials-service.test.ts src/contracts/connections.ts src/contracts/index.ts
git commit -m "feat(core): CredentialsService (set chiffré + lecture masquée) + contrat FieldMapping Zod"
```

---

## Task 5: ConnectionsService — transport (set/validate) + gate d'activation

**Files:**
- Create: `src/core/services/connections-service.ts`, `src/core/services/__tests__/connections-service.test.ts`
- Modify: `src/core/services/bot-service.ts`

**Interfaces:**
- Consumes: `Database`, `CredentialsService`, `recordAudit`, `getBotRuntimeState`/`setTransportValidation`, factories transport (`createMetaCloudTransport`/`createCmComTransport`), `getCredentialRecord`+`decryptJson` (creds stockées), `AppError` fabriques.
- Produces (consommés par Tasks 6-7) :
  - `ConnectionsService` construit avec `{ db: Database; credentials: CredentialsService }`, méthodes (transport pour cette task) :
    - `setTransport(clientId, botId, actorUserId, values): Promise<void>` — écrit creds (service 'transport', provider = bot.transport) + **reset** `setTransportValidation(null, null)` + audit.
    - `getTransportMasked(clientId, botId): Promise<{ configured; fields?; validated_at: string|null; error: string|null }>`.
    - `validateTransport(clientId, botId, actorUserId): Promise<{ ok: boolean; error?: string }>` — résout les creds stockées, instancie le driver, `validateCredentials()`, persiste (`setTransportValidation`), audit, retourne le résultat.
  - Extension `BotService.setStatus` : gate `'active'` exige `getBotRuntimeState(...).transport_validated_at` non nul (sinon `conflict`).

> NOTE implémenteur :
> - `setTransport` : bot doit exister (`notFound`). `provider = bot.transport` (lu via `getBotRecord`). `credentials.setCredentials(clientId, botId, 'transport', provider, values)`. Puis `db.setTransportValidation(clientId, botId, null, null)` (changement de creds → re-valider). Audit `transport.set`.
> - `validateTransport` : bot doit exister. Lire les creds stockées : `getCredentialRecord(clientId, botId, 'transport', provider)` (sinon `conflict('Aucun identifiant transport configuré.')`), `decryptJson`. Instancier le driver dans un try/catch (le constructeur meta-cloud throw si champ requis manquant → traiter comme échec de validation avec le message). Appeler `transport.validateCredentials?.()` (si absent → `{ ok: true }`). Persister : succès → `setTransportValidation(now ISO, null)` ; échec → `setTransportValidation(null, error)`. Audit `transport.validate` (metadata {ok}). Retourner `{ ok, error? }`.
> - Construction du driver : `provider === 'meta-cloud'` → `createMetaCloudTransport({ phoneNumberId: creds.phone_number_id, accessToken: creds.access_token, appSecret: creds.app_secret })` ; `'cm-com'` → `createCmComTransport({ productToken: creds.product_token, fromNumber: creds.from_number, serviceUrl: creds.service_url })`.
> - `BotService.setStatus` : ajouter, quand `status === 'active'`, après le check ≥1 numéro : `const rt = await this.db.getBotRuntimeState(clientId, botId); if (!rt?.transport_validated_at) throw conflict('Le transport WhatsApp doit être validé avant activation.');`
> - `ConnectionsService` reçoit `credentials: CredentialsService` (injecté).

- [ ] **Step 1: Tests (échec attendu)**

Créer `src/core/services/__tests__/connections-service.test.ts` :

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import { __setDatabaseForTests } from '../../database/index.js';
import { resetConfigStore, upsertBot } from '../../config-store.js';
import { ConnectionsService } from '../connections-service.js';
import { CredentialsService } from '../credentials-service.js';
import { BotService } from '../bot-service.js';
import type { Database, BotRecord } from '../../database/types.js';

const KEY = '0'.repeat(64);
const botRec = (over: Partial<BotRecord> = {}): BotRecord => ({
  client_id: 'acme', bot_id: 'immo', name: 'Immo', transport: 'meta-cloud', status: 'draft',
  default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'a' }, lead_fields: '',
  welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null, ...over,
});

describe('ConnectionsService — transport', () => {
  let db: Database;
  let conn: ConnectionsService;
  let bots: BotService;
  beforeEach(async () => {
    process.env['CREDENTIALS_ENCRYPTION_KEY'] = KEY;
    db = createSqliteDriver(':memory:'); __setDatabaseForTests(db); resetConfigStore();
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await upsertBot(botRec(), ['+33611111111']);
    conn = new ConnectionsService({ db, credentials: new CredentialsService({ db }) });
    bots = new BotService({ db });
  });
  afterEach(async () => { resetConfigStore(); vi.unstubAllGlobals(); await db.close(); });

  it('setTransport stocke + getTransportMasked masque + non validé', async () => {
    await conn.setTransport('acme', 'immo', 7, { phone_number_id: '123', access_token: 'EAAtok9876', app_secret: 'sek5555' });
    const m = await conn.getTransportMasked('acme', 'immo');
    expect(m.configured).toBe(true);
    expect(m.fields!.access_token).toBe('••••9876');
    expect(m.validated_at).toBeNull();
  });

  it('validateTransport OK persiste la validation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' }));
    await conn.setTransport('acme', 'immo', 7, { phone_number_id: '123', access_token: 'EAAtok', app_secret: 'sek' });
    const r = await conn.validateTransport('acme', 'immo', 7);
    expect(r.ok).toBe(true);
    expect((await db.getBotRuntimeState('acme', 'immo'))!.transport_validated_at).toBeTruthy();
  });

  it('validateTransport KO enregistre l\'erreur', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'bad token' }));
    await conn.setTransport('acme', 'immo', 7, { phone_number_id: '123', access_token: 'EAAtok', app_secret: 'sek' });
    const r = await conn.validateTransport('acme', 'immo', 7);
    expect(r.ok).toBe(false);
    const st = await db.getBotRuntimeState('acme', 'immo');
    expect(st!.transport_validated_at).toBeNull();
    expect(st!.transport_error).toContain('401');
  });

  it('setTransport réinitialise une validation existante', async () => {
    await db.setTransportValidation('acme', 'immo', '2026-01-01T00:00:00.000Z', null);
    await conn.setTransport('acme', 'immo', 7, { phone_number_id: '123', access_token: 'x', app_secret: 'y' });
    expect((await db.getBotRuntimeState('acme', 'immo'))!.transport_validated_at).toBeNull();
  });

  it('gate : activation refusée tant que le transport n\'est pas validé', async () => {
    await expect(bots.setStatus('acme', 'immo', 7, 'active')).rejects.toMatchObject({ code: 'CONFLICT' });
    await db.setTransportValidation('acme', 'immo', '2026-06-22T00:00:00.000Z', null);
    const bot = await bots.setStatus('acme', 'immo', 7, 'active');
    expect(bot.status).toBe('active');
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/core/services/__tests__/connections-service.test.ts`
Expected: FAIL.

- [ ] **Step 3: `src/core/services/connections-service.ts` (transport)**

```typescript
import type { Database } from '../database/types.js';
import type { CredentialsService } from './credentials-service.js';
import { recordAudit } from '../audit.js';
import { conflict, notFound } from '../../api/errors.js';
import { getCredentialRecord } from '../credentials/store.js';
import { decryptJson } from '../credentials/crypto.js';
import { createMetaCloudTransport } from '../../transport/meta-cloud.js';
import { createCmComTransport } from '../../transport/cm-com.js';
import type { Transport } from '../../transport/types.js';

export interface ConnectionsServiceDeps { db: Database; credentials: CredentialsService; }

export class ConnectionsService {
  private readonly db: Database;
  private readonly credentials: CredentialsService;
  constructor(deps: ConnectionsServiceDeps) { this.db = deps.db; this.credentials = deps.credentials; }

  private async requireBotTransport(clientId: string, botId: string): Promise<string> {
    const rec = await this.db.getBotRecord(clientId, botId);
    if (!rec) throw notFound('Bot introuvable.');
    return rec.transport;
  }

  async setTransport(clientId: string, botId: string, actorUserId: number | null, values: Record<string, string>): Promise<void> {
    const provider = await this.requireBotTransport(clientId, botId);
    await this.credentials.setCredentials(clientId, botId, 'transport', provider, values);
    await this.db.setTransportValidation(clientId, botId, null, null); // creds changées -> re-valider
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'transport.set', target: `bot:${clientId}/${botId}`, client_id: clientId, metadata: { provider } });
  }

  async getTransportMasked(clientId: string, botId: string): Promise<{ configured: boolean; fields?: Record<string, string>; validated_at: string | null; error: string | null }> {
    const provider = await this.requireBotTransport(clientId, botId);
    const masked = await this.credentials.getMasked(clientId, botId, 'transport', provider);
    const rt = await this.db.getBotRuntimeState(clientId, botId);
    return { ...masked, validated_at: rt?.transport_validated_at ?? null, error: rt?.transport_error ?? null };
  }

  async validateTransport(clientId: string, botId: string, actorUserId: number | null): Promise<{ ok: boolean; error?: string }> {
    const provider = await this.requireBotTransport(clientId, botId);
    const rec = await getCredentialRecord(clientId, botId, 'transport', provider);
    if (!rec) throw conflict('Aucun identifiant transport configuré.');
    const creds = decryptJson(rec.secret_encrypted, rec.key_version) as Record<string, string>;

    let result: { ok: boolean; error?: string };
    try {
      const transport = this.buildTransport(provider, creds);
      result = transport.validateCredentials ? await transport.validateCredentials() : { ok: true };
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    await this.db.setTransportValidation(clientId, botId, result.ok ? new Date().toISOString() : null, result.ok ? null : (result.error ?? 'Validation échouée.'));
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'transport.validate', target: `bot:${clientId}/${botId}`, client_id: clientId, metadata: { ok: result.ok } });
    return result;
  }

  private buildTransport(provider: string, creds: Record<string, string>): Transport {
    if (provider === 'meta-cloud') {
      return createMetaCloudTransport({ phoneNumberId: creds['phone_number_id'] ?? '', accessToken: creds['access_token'] ?? '', appSecret: creds['app_secret'] ?? '' });
    }
    if (provider === 'cm-com') {
      return createCmComTransport({ productToken: creds['product_token'], fromNumber: creds['from_number'], serviceUrl: creds['service_url'] });
    }
    throw new Error(`Transport inconnu: ${provider}`);
  }
}
```

> NOTE : `new Date().toISOString()` est utilisé en code applicatif (autorisé ; seules les restrictions des scripts workflow interdisent Date). Si `createCmComTransport` n'accepte pas exactement ces options, lire `cm-com.ts` et adapter les clés.

- [ ] **Step 4: Étendre le gate `BotService.setStatus`**

Dans `src/core/services/bot-service.ts`, méthode `setStatus`, après le check ≥1 numéro, ajouter le check de validation transport :

```typescript
    if (status === 'active') {
      if (numbers.length === 0) {
        throw conflict('Au moins un numéro WhatsApp est requis pour activer.');
      }
      const rt = await this.db.getBotRuntimeState(clientId, botId);
      if (!rt?.transport_validated_at) {
        throw conflict('Le transport WhatsApp doit être validé avant activation.');
      }
    }
```

(remplacer le bloc existant `if (status === 'active' && numbers.length === 0) {...}` par ce bloc.)

- [ ] **Step 5: Vérifier le succès + tsc + services**

Run: `npm run typecheck && npx vitest run src/core/services/`
Expected: PASS. NOTE : le test `bot-service.test.ts` existant « setStatus active exige au moins un numéro » devient incomplet (il ajoute un numéro puis active → échouera désormais faute de validation transport). **Mettre à jour ce test** : après `setNumbers`, ajouter `await db.setTransportValidation('acme', 'immo', '2026-06-22T00:00:00.000Z', null);` avant le `setStatus('active')` attendu en succès. Lire le test et l'ajuster.

- [ ] **Step 6: Commit**

```bash
git add src/core/services/connections-service.ts src/core/services/__tests__/connections-service.test.ts src/core/services/bot-service.ts src/core/services/__tests__/bot-service.test.ts
git commit -m "feat(core): ConnectionsService transport (set/validate) + gate activation validé"
```

---

## Task 6: ConnectionsService — CRM (set/validate, resolver bot→client) + LLM + mappings

**Files:**
- Modify: `src/core/services/connections-service.ts`, `src/core/credentials/resolver.ts`, `src/core/crm-bridge.ts`, `src/core/credentials/__tests__/resolver.test.ts`
- Test: `src/core/services/__tests__/connections-service.test.ts` (ajout)

**Interfaces:**
- Produces (méthodes ConnectionsService) :
  - `setCrm(clientId, botId, actorUserId, connector, values): Promise<void>` — écrit creds CRM (service 'crm', provider=connector, bot-scope) + audit.
  - `getCrmMasked(clientId, botId, connector): Promise<{ configured; fields? }>`.
  - `validateCrm(clientId, botId, connector): Promise<{ ok: boolean; error?: string }>` — instancie le connecteur via mapping+creds, appelle `validate?()`.
  - `setLlm(clientId, botId, actorUserId, input: SetLlmInput): Promise<void>` — set `bot.llm = {model, mode}` (via ConfigStore.upsertBot) + si byo, stocke la clé (credential service 'llm' provider 'anthropic' mode 'byo').
  - `getLlm(clientId, botId): Promise<{ mode; model?; key_configured: boolean }>`.
  - `getMapping(clientId, botId, connector)` / `putMapping(clientId, botId, connector, mapping)` — délèguent à ConfigStore (`getMapping`/`upsertMapping`) + audit sur put.
- `resolveCrmCredentials(clientId, botId, provider)` — **signature changée** : bot→client fallback (`findRecord`).

> NOTE implémenteur :
> - **resolver** : changer `resolveCrmCredentials(clientId, provider)` → `resolveCrmCredentials(clientId, botId, provider)` et utiliser `findRecord(store, clientId, botId, 'crm', provider)` (bot→client). Mettre à jour l'export + le type. **crm-bridge.ts** : l'appel `resolveCrmCredentials(bot.client_id, connectorType)` → `resolveCrmCredentials(bot.client_id, bot.bot_id, connectorType)`. Mettre à jour `resolver.test.ts` (cas bot-scope prime sur client-scope pour CRM).
> - `setCrm` : creds bot-scope (`botId` non null). Le `bot.crm.connector` peut être positionné séparément via `updateBot` (4a) ; ici on ne touche QUE les creds. Audit `crm.set`.
> - `validateCrm` : récupérer le mapping (`ConfigStore.getMapping`) — si le connecteur est un FieldMapper-connector et pas de mapping → `conflict('Mapping requis.')`. Récupérer creds (`getCredentialRecord` bot→client : essayer bot puis client). Instancier via `createConnector({ type: connector, credentials, mapping })`. Si `connector.validate` absent → `{ ok: false, error: 'Validation non supportée pour ce connecteur.' }`. Sinon retourner `await connector.validate()`. (Pas de persistance runtime_state pour le CRM en 4b — le CRM ne gate pas l'activation.)
> - `setLlm` : charger `BotRecord`, fusionner `llm: { model: input.model, mode: input.mode }`, `ConfigStore.upsertBot(rec, numbers)`. Si `mode === 'byo'` : exiger `input.api_key` (sinon `validationError`), `credentials.setCredentials(clientId, botId, 'llm', 'anthropic', { api_key }, 'byo')`. Si `mode === 'platform'` : ne pas exiger de clé. Audit `llm.set`.
> - `getLlm` : lire `bot.llm` + `getMasked('llm','anthropic')` pour `key_configured`.
> - `putMapping` : valider via `FieldMappingSchema` est fait au niveau route (Zod) ; ici recevoir le mapping typé et `upsertMapping(clientId, botId, connector, mapping)`. Audit `mapping.set`.

- [ ] **Step 1: Tests (échec attendu)** — ajouter à `connections-service.test.ts` un bloc CRM/LLM/mapping :

```typescript
import { ZohoConnector } from '../../../connectors/zoho.js'; // (si besoin) — sinon tester hubspot
import { upsertMapping, getMapping } from '../../config-store.js';

describe('ConnectionsService — CRM/LLM/mappings', () => {
  let db: Database; let conn: ConnectionsService;
  beforeEach(async () => {
    process.env['CREDENTIALS_ENCRYPTION_KEY'] = KEY;
    db = createSqliteDriver(':memory:'); __setDatabaseForTests(db); resetConfigStore();
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await upsertBot(botRec(), []);
    conn = new ConnectionsService({ db, credentials: new CredentialsService({ db }) });
  });
  afterEach(async () => { resetConfigStore(); vi.unstubAllGlobals(); await db.close(); });

  it('setCrm + getCrmMasked', async () => {
    await conn.setCrm('acme', 'immo', 7, 'hubspot', { access_token: 'pat-eu1-secret9999' });
    const m = await conn.getCrmMasked('acme', 'immo', 'hubspot');
    expect(m.configured).toBe(true);
    expect(m.fields!.access_token).toBe('••••9999');
  });

  it('validateCrm hubspot OK via fetch mocké', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' }));
    await upsertMapping('acme', null, 'hubspot', { version: 1, connector: 'hubspot', target_object: 'contacts', client_id: 'acme', field_mapping: [{ source: 'email', target: 'email' }] } as never);
    await conn.setCrm('acme', 'immo', 7, 'hubspot', { access_token: 'pat-x' });
    expect(await conn.validateCrm('acme', 'immo', 'hubspot')).toEqual({ ok: true });
  });

  it('setLlm byo exige une clé + getLlm', async () => {
    await expect(conn.setLlm('acme', 'immo', 7, { mode: 'byo' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await conn.setLlm('acme', 'immo', 7, { mode: 'byo', model: 'claude-haiku-4-5', api_key: 'sk-ant-9999' });
    const llm = await conn.getLlm('acme', 'immo');
    expect(llm.mode).toBe('byo');
    expect(llm.key_configured).toBe(true);
    expect(llm.model).toBe('claude-haiku-4-5');
  });

  it('setLlm platform sans clé', async () => {
    await conn.setLlm('acme', 'immo', 7, { mode: 'platform', model: 'claude-haiku-4-5' });
    const llm = await conn.getLlm('acme', 'immo');
    expect(llm.mode).toBe('platform');
    expect(llm.key_configured).toBe(false);
  });

  it('putMapping persiste + getMapping relit', async () => {
    const mapping = { version: 1, connector: 'hubspot', target_object: 'contacts', client_id: 'acme', field_mapping: [{ source: 'email', target: 'email' }] };
    await conn.putMapping('acme', 'immo', 'hubspot', 7, mapping as never);
    expect((await getMapping('acme', 'immo', 'hubspot'))!.target_object).toBe('contacts');
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/core/services/__tests__/connections-service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Resolver bot→client pour CRM**

Dans `src/core/credentials/resolver.ts` :

```typescript
  async function resolveCrmCredentials(
    clientId: string,
    botId: string | null,
    provider: string,
  ): Promise<Record<string, string>> {
    const rec = await findRecord(store, clientId, botId, 'crm', provider);
    if (rec) return decode(rec);
    return {};
  }
```

(et l'export `export const resolveCrmCredentials = defaultResolver.resolveCrmCredentials;` reste identique.)

Dans `src/core/crm-bridge.ts`, l'appel devient :

```typescript
  const resolved = await resolveCrmCredentials(bot.client_id, bot.bot_id, connectorType);
```

Mettre à jour `src/core/credentials/__tests__/resolver.test.ts` : ajouter un cas « CRM bot-scope prime sur client-scope » et adapter les appels existants à `resolveCrmCredentials` (3 args).

- [ ] **Step 4: Étendre `connections-service.ts` (CRM/LLM/mappings)**

Ajouter les imports et méthodes :

```typescript
import { createConnector } from '../../connectors/registry.js';
import { getMapping, upsertMapping } from '../config-store.js';
import { upsertBot } from '../config-store.js';
import { validationError } from '../../api/errors.js';
import type { FieldMapping } from '../../connectors/field-mapper.js';
import type { SetLlmInput } from '../../contracts/index.js';
```

Méthodes (dans la classe) :

```typescript
  async setCrm(clientId: string, botId: string, actorUserId: number | null, connector: string, values: Record<string, string>): Promise<void> {
    if (!(await this.db.getBotRecord(clientId, botId))) throw notFound('Bot introuvable.');
    await this.credentials.setCredentials(clientId, botId, 'crm', connector, values);
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'crm.set', target: `bot:${clientId}/${botId}`, client_id: clientId, metadata: { connector } });
  }

  async getCrmMasked(clientId: string, botId: string, connector: string): Promise<{ configured: boolean; fields?: Record<string, string> }> {
    return this.credentials.getMasked(clientId, botId, 'crm', connector);
  }

  async validateCrm(clientId: string, botId: string, connector: string): Promise<{ ok: boolean; error?: string }> {
    const rec = await getCredentialRecord(clientId, botId, 'crm', connector) ?? await getCredentialRecord(clientId, null, 'crm', connector);
    if (!rec) throw conflict('Aucun identifiant CRM configuré.');
    const credentials = decryptJson(rec.secret_encrypted, rec.key_version) as Record<string, string>;
    const FIELDMAPPER = new Set(['hubspot', 'pipedrive', 'salesforce', 'zoho']);
    let mapping: FieldMapping | undefined;
    if (FIELDMAPPER.has(connector)) {
      const m = await getMapping(clientId, botId, connector);
      if (!m) throw conflict('Mapping requis pour ce connecteur.');
      mapping = m;
    }
    try {
      const conn = createConnector({ type: connector, credentials: { ...credentials, client_id: clientId }, mapping });
      if (!conn.validate) return { ok: false, error: 'Validation non supportée pour ce connecteur.' };
      return await conn.validate();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async setLlm(clientId: string, botId: string, actorUserId: number | null, input: SetLlmInput): Promise<void> {
    const rec = await this.db.getBotRecord(clientId, botId);
    if (!rec) throw notFound('Bot introuvable.');
    if (input.mode === 'byo' && !input.api_key) throw validationError([{ path: 'api_key', message: 'Clé API requise en mode byo.' }]);
    const numbers = (await this.db.listBotNumbers()).filter((n) => n.client_id === clientId && n.bot_id === botId).map((n) => n.whatsapp_number);
    const updated = { ...rec, llm: { mode: input.mode, ...(input.model ? { model: input.model } : {}) } };
    await upsertBot(updated, numbers);
    if (input.mode === 'byo' && input.api_key) {
      await this.credentials.setCredentials(clientId, botId, 'llm', 'anthropic', { api_key: input.api_key }, 'byo');
    }
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'llm.set', target: `bot:${clientId}/${botId}`, client_id: clientId, metadata: { mode: input.mode } });
  }

  async getLlm(clientId: string, botId: string): Promise<{ mode: string; model?: string; key_configured: boolean }> {
    const rec = await this.db.getBotRecord(clientId, botId);
    if (!rec) throw notFound('Bot introuvable.');
    const key = await this.credentials.getMasked(clientId, botId, 'llm', 'anthropic');
    const mode = rec.llm?.mode ?? 'platform';
    return { mode, ...(rec.llm?.model ? { model: rec.llm.model } : {}), key_configured: key.configured };
  }

  async getMapping(clientId: string, botId: string, connector: string): Promise<FieldMapping | null> {
    return getMapping(clientId, botId, connector);
  }

  async putMapping(clientId: string, botId: string, connector: string, actorUserId: number | null, mapping: FieldMapping): Promise<void> {
    if (!(await this.db.getBotRecord(clientId, botId))) throw notFound('Bot introuvable.');
    await upsertMapping(clientId, botId, connector, mapping);
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'mapping.set', target: `bot:${clientId}/${botId}`, client_id: clientId, metadata: { connector } });
  }
```

- [ ] **Step 5: Vérifier le succès + tsc + suite credentials/services**

Run: `npm run typecheck && npx vitest run src/core/services/ src/core/credentials/ src/core/__tests__/crm-bridge.test.ts`
Expected: PASS (resolver test mis à jour, crm-bridge toujours vert avec la nouvelle signature).

- [ ] **Step 6: Commit**

```bash
git add src/core/services/connections-service.ts src/core/services/__tests__/connections-service.test.ts src/core/credentials/resolver.ts src/core/crm-bridge.ts src/core/credentials/__tests__/resolver.test.ts
git commit -m "feat(core): ConnectionsService CRM/LLM/mappings + resolver CRM bot->client"
```

---

## Task 7: Routes connexions + catalogue + montage

**Files:**
- Create: `src/api/admin/routes/connections.ts`, `src/api/admin/__tests__/connections-routes.test.ts`
- Modify: `src/api/admin/router.ts`

**Interfaces:**
- Consumes: `ConnectionsService`, middlewares, schémas `contracts` (`SetCredentialsInput`/`SetLlmInput`/`FieldMappingSchema`), `connectorsCatalogue`, `wrap`.
- Produces : `connectionsRoutes(connectionsService, wrap)` monté sur `/bots/:botId/...` ; `GET /connectors` (catalogue, auth simple) ; ajout `connectionsService` à `AdminRouterDeps`.

> NOTE implémenteur :
> - Le sous-routeur connexions est monté SOUS le routeur `bots` existant OU comme routeur séparé `r.use('/bots/:botId', ...)`. **Choix** : créer `connectionsRoutes` comme `Router({ mergeParams: true })` monté `r.use('/bots/:botId', requireAuth, scopeToClient, connectionsRoutes(...))` dans `router.ts`. `mergeParams: true` pour accéder à `:botId`. `clientId = requireScopedClient(req)` (réutiliser le helper — l'extraire dans un module partagé `src/api/admin/scope.ts` ou redéfinir localement).
> - Endpoints (tous sous `/bots/:botId`) :
>   - `PUT /transport` → `SetCredentialsInput.parse` → `setTransport` → 204. `GET /transport` → `getTransportMasked` → 200. `POST /transport/validate` → `validateTransport` → 200 `{ok,error?}`.
>   - `PUT /crm/:connector` → `SetCredentialsInput.parse` → `setCrm` → 204. `GET /crm/:connector` → `getCrmMasked`. `POST /crm/:connector/validate` → `validateCrm` → 200.
>   - `PUT /llm` → `SetLlmInput.parse` → `setLlm` → 204. `GET /llm` → `getLlm` → 200.
>   - `GET /mappings/:connector` → `getMapping` → 200 (404 si null). `PUT /mappings/:connector` → `FieldMappingSchema.parse` → `putMapping` → 204.
> - `GET /connectors` (catalogue) : monté au niveau racine du router admin sous `requireAuth` (pas besoin de scope) → `res.json(connectorsCatalogue())`.
> - `req.params` strict : `String(req.params['botId'])`, `String(req.params['connector'])`.
> - Mettre à jour les appels `createAdminRouter` dans TOUS les tests qui l'utilisent (auth-routes, clients-routes, bots-routes) pour injecter `connectionsService: new ConnectionsService({ db, credentials: new CredentialsService({ db }) })`. Sinon tsc casse.

- [ ] **Step 1: Test d'intégration (échec attendu)**

Créer `src/api/admin/__tests__/connections-routes.test.ts` :

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSqliteDriver } from '../../../core/database/sqlite.js';
import { __setDatabaseForTests } from '../../../core/database/index.js';
import { resetConfigStore, upsertBot } from '../../../core/config-store.js';
import type { Database, BotRecord } from '../../../core/database/types.js';
import { AuthService } from '../../../core/auth/auth-service.js';
import { AdminService } from '../../../core/auth/admin-service.js';
import { BotService } from '../../../core/services/bot-service.js';
import { CredentialsService } from '../../../core/services/credentials-service.js';
import { ConnectionsService } from '../../../core/services/connections-service.js';
import type { Mailer } from '../../../core/auth/mailer.js';
import { hashPassword } from '../../../core/auth/passwords.js';
import { createAdminRouter } from '../router.js';

class FakeMailer implements Mailer { async sendInvitation() {} async sendPasswordReset() {} }
const KEY = '0'.repeat(64);
const botRec: BotRecord = { client_id: 'acme', bot_id: 'immo', name: 'Immo', transport: 'meta-cloud', status: 'draft', default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'a' }, lead_fields: '', welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null };

async function bearer(app: express.Express): Promise<string> {
  return (await request(app).post('/api/admin/v1/auth/login').send({ email: 'ca@acme.test', password: 'motdepasse123' })).body.access_token as string;
}

describe('connections routes', () => {
  let db: Database; let app: express.Express;
  beforeEach(async () => {
    process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!';
    process.env['ADMIN_BCRYPT_ROUNDS'] = '4';
    process.env['CREDENTIALS_ENCRYPTION_KEY'] = KEY;
    db = createSqliteDriver(':memory:'); __setDatabaseForTests(db); resetConfigStore();
    const mailer = new FakeMailer();
    const credentials = new CredentialsService({ db });
    app = express();
    app.use('/api/admin/v1', createAdminRouter({
      db, authService: new AuthService({ db, mailer }), adminService: new AdminService({ db, mailer }),
      botService: new BotService({ db }), connectionsService: new ConnectionsService({ db, credentials }),
    }));
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.createUser({ email: 'ca@acme.test', password_hash: await hashPassword('motdepasse123'), role: 'client_admin', client_id: 'acme', status: 'active' });
    await upsertBot(botRec, ['+33611111111']);
  });
  afterEach(() => { resetConfigStore(); vi.unstubAllGlobals(); });

  it('PUT transport (masqué au GET) puis validate OK', async () => {
    const tok = await bearer(app);
    const put = await request(app).put('/api/admin/v1/bots/immo/transport').set('Authorization', `Bearer ${tok}`).send({ values: { phone_number_id: '123', access_token: 'EAAtok9876', app_secret: 'sek5555' } });
    expect(put.status).toBe(204);
    const get = await request(app).get('/api/admin/v1/bots/immo/transport').set('Authorization', `Bearer ${tok}`);
    expect(get.body.fields.access_token).toBe('••••9876');
    expect(get.body.validated_at).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' }));
    const val = await request(app).post('/api/admin/v1/bots/immo/transport/validate').set('Authorization', `Bearer ${tok}`);
    expect(val.body.ok).toBe(true);
  });

  it('GET /connectors renvoie le catalogue', async () => {
    const tok = await bearer(app);
    const res = await request(app).get('/api/admin/v1/connectors').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('PUT mapping invalide → 400', async () => {
    const tok = await bearer(app);
    const bad = await request(app).put('/api/admin/v1/bots/immo/mappings/hubspot').set('Authorization', `Bearer ${tok}`).send({ version: 'x' });
    expect(bad.status).toBe(400);
  });

  it('isolation : autre client ne peut pas écrire le transport du bot', async () => {
    await db.upsertClient({ client_id: 'other', name: 'O', status: 'active' });
    await db.createUser({ email: 'o@o.test', password_hash: await hashPassword('motdepasse123'), role: 'client_admin', client_id: 'other', status: 'active' });
    const tokO = (await request(app).post('/api/admin/v1/auth/login').send({ email: 'o@o.test', password: 'motdepasse123' })).body.access_token;
    const put = await request(app).put('/api/admin/v1/bots/immo/transport').set('Authorization', `Bearer ${tokO}`).send({ values: { phone_number_id: '1', access_token: '2', app_secret: '3' } });
    expect(put.status).toBe(404); // scopé sur 'other' -> bot 'immo' introuvable
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/api/admin/__tests__/connections-routes.test.ts`
Expected: FAIL.

- [ ] **Step 3: `src/api/admin/routes/connections.ts`**

```typescript
import { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import type { ConnectionsService } from '../../../core/services/connections-service.js';
import { SetCredentialsInput, SetLlmInput, FieldMappingSchema } from '../../../contracts/index.js';
import { forbidden, notFound } from '../../errors.js';

function requireScopedClient(req: Request): string {
  if (!req.scopedClientId) throw forbidden('client_id requis (super_admin : préciser ?client_id).');
  return req.scopedClientId;
}

export function connectionsRoutes(svc: ConnectionsService, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router({ mergeParams: true });

  r.put('/transport', wrap(async (req, res) => {
    const clientId = requireScopedClient(req);
    const body = SetCredentialsInput.parse(req.body);
    await svc.setTransport(clientId, String(req.params['botId']), req.auth!.userId, body.values);
    res.sendStatus(204);
  }));
  r.get('/transport', wrap(async (req, res) => {
    res.json(await svc.getTransportMasked(requireScopedClient(req), String(req.params['botId'])));
  }));
  r.post('/transport/validate', wrap(async (req, res) => {
    res.json(await svc.validateTransport(requireScopedClient(req), String(req.params['botId']), req.auth!.userId));
  }));

  r.put('/crm/:connector', wrap(async (req, res) => {
    const clientId = requireScopedClient(req);
    const body = SetCredentialsInput.parse(req.body);
    await svc.setCrm(clientId, String(req.params['botId']), req.auth!.userId, String(req.params['connector']), body.values);
    res.sendStatus(204);
  }));
  r.get('/crm/:connector', wrap(async (req, res) => {
    res.json(await svc.getCrmMasked(requireScopedClient(req), String(req.params['botId']), String(req.params['connector'])));
  }));
  r.post('/crm/:connector/validate', wrap(async (req, res) => {
    res.json(await svc.validateCrm(requireScopedClient(req), String(req.params['botId']), String(req.params['connector'])));
  }));

  r.put('/llm', wrap(async (req, res) => {
    const clientId = requireScopedClient(req);
    const body = SetLlmInput.parse(req.body);
    await svc.setLlm(clientId, String(req.params['botId']), req.auth!.userId, body);
    res.sendStatus(204);
  }));
  r.get('/llm', wrap(async (req, res) => {
    res.json(await svc.getLlm(requireScopedClient(req), String(req.params['botId'])));
  }));

  r.get('/mappings/:connector', wrap(async (req, res) => {
    const m = await svc.getMapping(requireScopedClient(req), String(req.params['botId']), String(req.params['connector']));
    if (!m) throw notFound('Mapping introuvable.');
    res.json(m);
  }));
  r.put('/mappings/:connector', wrap(async (req, res) => {
    const clientId = requireScopedClient(req);
    const mapping = FieldMappingSchema.parse(req.body);
    await svc.putMapping(clientId, String(req.params['botId']), String(req.params['connector']), req.auth!.userId, mapping);
    res.sendStatus(204);
  }));

  return r;
}
```

- [ ] **Step 4: Montage dans `src/api/admin/router.ts`**

Imports :

```typescript
import { connectionsRoutes } from './routes/connections.js';
import type { ConnectionsService } from '../../core/services/connections-service.js';
import { connectorsCatalogue } from '../../core/providers.js';
import { requireAuth, scopeToClient } from '../middleware/auth.js';
```

Ajouter `connectionsService: ConnectionsService;` à `AdminRouterDeps`. Après le montage `/bots` :

```typescript
  r.get('/connectors', requireAuth, wrap(async (_req, res) => { res.json(connectorsCatalogue()); }));
  r.use('/bots/:botId', requireAuth, scopeToClient, connectionsRoutes(deps.connectionsService, wrap));
```

> NOTE : `requireAuth` peut déjà être importé dans router.ts ; éviter le doublon d'import. `wrap` est défini dans router.ts.

- [ ] **Step 5: Mettre à jour les appels `createAdminRouter` des autres tests**

Dans `auth-routes.test.ts`, `clients-routes.test.ts`, `bots-routes.test.ts` : importer `CredentialsService` + `ConnectionsService` et ajouter `connectionsService: new ConnectionsService({ db, credentials: new CredentialsService({ db }) })` à l'appel `createAdminRouter`. Définir `process.env['CREDENTIALS_ENCRYPTION_KEY']` dans le `beforeEach` de ces fichiers si absent (nécessaire à l'instanciation de CredentialsService ? non — l'instanciation ne chiffre rien ; mais par sûreté, l'ajouter).

- [ ] **Step 6: Vérifier tsc + suite complète**

Run: `npm run typecheck && npm test`
Expected: tsc propre, TOUTE la suite verte (zéro régression).

- [ ] **Step 7: Commit**

```bash
git add src/api/admin/routes/connections.ts src/api/admin/router.ts src/api/admin/__tests__/
git commit -m "feat(api): routes connexions (transport/crm/llm/mappings) + catalogue /connectors"
```

---

## Self-Review (auteur du plan)

**1. Couverture du périmètre 4b :**
- credentials GET masqué / PUT chiffré → Tasks 4, 5, 6, 7. ✅
- transport-validate + PUT → Tasks 3, 5, 7. ✅
- crm-validate + creds → Tasks 3, 6, 7. ✅
- endpoints mapping (bot-scope) + validation Zod FieldMapping → Tasks 4, 6, 7. ✅
- llm (byo/platform, modèle, clé) → Tasks 6, 7. ✅
- gate activation « WhatsApp validé » → Tasks 2, 5. ✅
- catalogue `/connectors` → Tasks 1, 7. ✅
- masquage secrets → Tasks 1, 4. ✅
- CRM bot→client (alignement resolver) → Task 6. ✅
- **Hors 4b (→ 4c)** : simulate, leads/health/metrics/usage, mapping client-level endpoint (super-admin) — déféré 4c (mentionné spec §6 mais non bloquant ; l'import one-shot pose déjà le client-level). audit_log endpoint de lecture → 4c.

**2. Placeholders :** aucun ; code complet (les `as never` dans les tests = raccourci de fixture, acceptable en test).

**3. Cohérence des types :** `SetCredentialsInput.values` (record string) ↔ `setCredentials(values)`. `FieldMappingSchema` (Zod) ↔ `FieldMapping` (field-mapper) — mirror ; `putMapping` reçoit le type validé. `SetLlmInput` ↔ `setLlm`. `getTransportMasked` retourne `{configured, fields?, validated_at, error}` cohérent route↔service. `resolveCrmCredentials` 3 args propagé en crm-bridge + resolver.test.

**Anticipation 4c :** `bot_runtime_state.transport_error` + (futur) erreurs CRM serviront le dashboard santé ; `validateTransport` persiste déjà l'erreur affichable. `getLlm`/`getTransportMasked` réutilisables par les écrans. La capacité `validate()` servira aussi au simulateur (4c) pour signaler une clé invalide.

**Risque identifié :** Task 7 modifie l'instanciation `createAdminRouter` dans 4 fichiers de tests (couplage) — explicité au Step 5. Task 6 change la signature de `resolveCrmCredentials` (chemin runtime via crm-bridge) — couvert par resolver.test + crm-bridge.test.

---

## Execution Handoff

Plan 4b complet. Deux options :
1. **Subagent-Driven (recommandé)** — un subagent par task, revue spec+qualité, revue finale.
2. **Inline** — exécution avec checkpoints.
