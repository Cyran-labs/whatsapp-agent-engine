# Flow Labs 4c — Reads dashboard + simulate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compléter l'étape 4 du spec (API config) avec les endpoints de lecture dashboard (`leads`, `health`, `metrics`, `usage`, `audit`), l'endpoint `simulate` (chat in-app), et le mapping client-level super-admin.

**Architecture:** Deux nouveaux services lecture (`DashboardService` read-only + `SimulateService` à session éphémère en mémoire) montés dans le routeur admin existant sous `/bots/:botId` (scopé client). La persistance de la dernière erreur de push CRM est ajoutée à `bot_runtime_state` et câblée dans le runtime `crm-bridge` (fire-and-forget inchangé). Aucune écriture de lead/conversation par le simulateur. `validate()` des connecteurs non-HubSpot reste différé (pas de comptes de test).

**Tech Stack:** TypeScript strict ESM (imports en `.js`), Express 5, Zod (`src/contracts`), Vitest + supertest, better-sqlite3 (testé en CI) + pg (miroir mécanique).

## Global Constraints

- TypeScript strict : pas de `any`, `const` par défaut. (CLAUDE.md)
- Logs format `[Service] message`, sans emoji. (CLAUDE.md)
- Aucune référence aux thématiques de la démo Cyran (golf, immo, voyage, auto, acquisition) — y compris dans les fixtures de test. (CLAUDE.md). Fixtures neutres : `acme`/`sales`/`support`/`logistique`.
- Author git : `Francois Greze <francois@cyran.fr>`. Pas de signature Claude/Anthropic. Pas de commit/push sans validation explicite. (CLAUDE.md)
- Secrets **jamais** renvoyés en clair : GET credentials → `{ configured: true, masked: "••••1234" }`. (spec §6)
- Forme d'erreur unique `{ error: { code, message, details?, request_id } }` via `AppError` + fabriques de `src/api/errors.ts`. Codes machine stables. (spec §6)
- Toutes les méthodes `Database` sont `async`. SQLite est testé ; Postgres est un miroir mécanique : `SERIAL`/`TIMESTAMPTZ`, placeholders `$n`, `::text` sur les timestamps retournés, `JSONB` pour les colonnes JSON, casts `CASE WHEN $n::text IS NULL THEN NULL ELSE $n::jsonb END` pour un JSON nullable. (conventions repo)
- Middlewares dans l'ordre `requireAuth` → (`requireRole`) → `scopeToClient`. `scopeToClient` force le `client_id` du JWT (client_admin) ou lit `?client_id` (super_admin). Endpoints scopés → `requireScopedClient(req)`. (spec §6)
- Mutations admin tracées via `recordAudit(db, entry)` (best-effort, ne throw jamais). Les **lectures** ne sont pas auditées. (spec §9)
- Le simulateur appelle le LLM en **mode platform + Haiku par défaut** ; la capture `llm_usage` reste assurée par `chat()` (inchangé). (spec §6, §7)

---

## File Structure

**Création :**
- `src/core/services/dashboard-service.ts` — lectures read-only : `listLeads`, `getLead`, `health`, `metrics`, `usage`.
- `src/core/services/simulate-service.ts` — `SimulateService` : store de sessions éphémères en mémoire + `simulate()`.
- `src/api/admin/routes/dashboard.ts` — routes GET `leads`, `leads/:phone`, `health`, `metrics`, `usage` (montées sous `/bots/:botId`).
- `src/api/admin/routes/simulate.ts` — route POST `simulate` (montée sous `/bots/:botId`).
- `src/api/admin/routes/audit.ts` — route GET `/audit` (scopé client).
- `src/contracts/dashboard.ts` — schémas Zod `LeadsQuery`, `SimulateInput`.
- Tests : `src/core/database/__tests__/runtime-crm-error.test.ts`, `src/core/__tests__/crm-bridge-error.test.ts`, `src/core/services/__tests__/dashboard-service.test.ts`, `src/core/services/__tests__/simulate-service.test.ts`, `src/api/admin/__tests__/dashboard-routes.test.ts`, `src/api/admin/__tests__/simulate-routes.test.ts`, `src/api/admin/__tests__/audit-routes.test.ts`, `src/api/admin/__tests__/client-mappings-routes.test.ts`.

**Modification :**
- `src/core/database/types.ts` — `BotRuntimeStateRecord` (+2 champs), interface `Database` (+méthodes), types lecture (`LeadListResult`).
- `src/core/database/sqlite.ts` / `postgres.ts` — colonnes `bot_runtime_state`, `setLastCrmError`, `listLeadsByBot`, `getBotMetrics`, `listLlmUsageByBot`.
- `src/core/crm-bridge.ts` — persistance dernière erreur CRM (succès/échec).
- `src/core/db.ts` — wrappers `setLastCrmError`.
- `src/core/services/connections-service.ts` — `getClientMapping`, `putClientMapping`.
- `src/api/admin/router.ts` — `AdminRouterDeps` (+`dashboardService`, +`simulateService`), montage des nouvelles routes.
- `src/api/admin/routes/clients.ts` — GET/PUT `/:clientId/mappings/:connector`.
- `src/index.ts` — instanciation `DashboardService`/`SimulateService` + passage au routeur.
- `src/contracts/index.ts` — `export * from './dashboard.js'`.

---

### Task 1: `bot_runtime_state` — dernière erreur CRM (DB)

**Files:**
- Modify: `src/core/database/types.ts`
- Modify: `src/core/database/sqlite.ts`
- Modify: `src/core/database/postgres.ts`
- Modify: `src/core/db.ts`
- Test: `src/core/database/__tests__/runtime-crm-error.test.ts`

**Interfaces:**
- Consumes (existant) : `BotRuntimeStateRecord` (`client_id`, `bot_id`, `transport_validated_at`, `transport_error`, `updated_at`), `getBotRuntimeState(clientId, botId)`, `setTransportValidation(...)`.
- Produces : `BotRuntimeStateRecord` gagne `last_crm_error: string | null` et `last_crm_error_at: string | null`. Nouvelle méthode `Database.setLastCrmError(clientId: string, botId: string, error: string | null): Promise<void>` (error non-null ⇒ stocke message + horodate ; null ⇒ efface les deux). Wrapper `setLastCrmError` dans `db.ts`.

- [ ] **Step 1: Write the failing test**

Créer `src/core/database/__tests__/runtime-crm-error.test.ts` :

```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../sqlite.js';
import type { Database } from '../types.js';

describe('bot_runtime_state — dernière erreur CRM', () => {
  let db: Database;
  beforeEach(() => { db = createSqliteDriver(':memory:'); });

  it('stocke puis efface la dernière erreur CRM', async () => {
    await db.setLastCrmError('acme', 'sales', 'HubSpot 401 Unauthorized');
    const after = await db.getBotRuntimeState('acme', 'sales');
    expect(after?.last_crm_error).toBe('HubSpot 401 Unauthorized');
    expect(after?.last_crm_error_at).not.toBeNull();

    await db.setLastCrmError('acme', 'sales', null);
    const cleared = await db.getBotRuntimeState('acme', 'sales');
    expect(cleared?.last_crm_error).toBeNull();
    expect(cleared?.last_crm_error_at).toBeNull();
  });

  it('cohabite avec la validation transport sans l\'écraser', async () => {
    await db.setTransportValidation('acme', 'sales', '2026-06-22T10:00:00.000Z', null);
    await db.setLastCrmError('acme', 'sales', 'boom');
    const rt = await db.getBotRuntimeState('acme', 'sales');
    expect(rt?.transport_validated_at).toBe('2026-06-22T10:00:00.000Z');
    expect(rt?.last_crm_error).toBe('boom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/database/__tests__/runtime-crm-error.test.ts`
Expected: FAIL — `db.setLastCrmError is not a function`.

- [ ] **Step 3: Add the columns + type**

Dans `src/core/database/types.ts`, étendre `BotRuntimeStateRecord` :

```typescript
export interface BotRuntimeStateRecord {
  client_id: string;
  bot_id: string;
  transport_validated_at: string | null;
  transport_error: string | null;
  last_crm_error: string | null;
  last_crm_error_at: string | null;
  updated_at: string;
}
```

Et ajouter la méthode dans l'interface `Database` (à côté de `setTransportValidation`) :

```typescript
  setLastCrmError(clientId: string, botId: string, error: string | null): Promise<void>;
```

Dans `src/core/database/sqlite.ts`, à la création de la table `bot_runtime_state`, ajouter les deux colonnes (juste après `transport_error TEXT`) :

```sql
      last_crm_error TEXT,
      last_crm_error_at TEXT,
```

Dans `src/core/database/postgres.ts`, même table, ajouter :

```sql
      last_crm_error TEXT,
      last_crm_error_at TIMESTAMPTZ,
```

- [ ] **Step 4: Implement `setLastCrmError` (sqlite)**

Dans `src/core/database/sqlite.ts`, juste après l'implémentation de `setTransportValidation`, ajouter. Le pattern d'upsert sur table NEUVE suit la convention repo (UPDATE puis INSERT, jamais `ON CONFLICT`) :

```typescript
    async setLastCrmError(clientId: string, botId: string, error: string | null): Promise<void> {
      const at = error === null ? null : new Date().toISOString();
      const upd = db.prepare(
        `UPDATE bot_runtime_state SET last_crm_error = ?, last_crm_error_at = ?, updated_at = CURRENT_TIMESTAMP
         WHERE client_id = ? AND bot_id = ?`
      ).run(error, at, clientId, botId);
      if (upd.changes === 0) {
        db.prepare(
          `INSERT INTO bot_runtime_state (client_id, bot_id, last_crm_error, last_crm_error_at)
           VALUES (?, ?, ?, ?)`
        ).run(clientId, botId, error, at);
      }
    },
```

- [ ] **Step 5: Implement `setLastCrmError` (postgres)**

Dans `src/core/database/postgres.ts`, après `setTransportValidation`. Le repo utilise `upd.rowCount === 0` côté pg :

```typescript
    async setLastCrmError(clientId: string, botId: string, error: string | null): Promise<void> {
      const at = error === null ? null : new Date().toISOString();
      const upd = await pool.query(
        `UPDATE bot_runtime_state SET last_crm_error = $1, last_crm_error_at = $2, updated_at = NOW()
         WHERE client_id = $3 AND bot_id = $4`,
        [error, at, clientId, botId],
      );
      if (upd.rowCount === 0) {
        await pool.query(
          `INSERT INTO bot_runtime_state (client_id, bot_id, last_crm_error, last_crm_error_at)
           VALUES ($1, $2, $3, $4)`,
          [clientId, botId, error, at],
        );
      }
    },
```

Vérifier que `getBotRuntimeState` (sqlite ET postgres) renvoie bien les nouvelles colonnes. S'il fait `SELECT *`, rien à changer ; s'il liste les colonnes explicitement, ajouter `last_crm_error` et `last_crm_error_at` (avec `last_crm_error_at::text` côté postgres pour le timestamp).

- [ ] **Step 6: Add the `db.ts` wrapper**

Dans `src/core/db.ts`, ajouter après la ligne `getAllLeads` :

```typescript
export const setLastCrmError = (clientId: string, botId: string, error: string | null) => getDatabase().setLastCrmError(clientId, botId, error);
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npx vitest run src/core/database/__tests__/runtime-crm-error.test.ts && npx tsc --noEmit`
Expected: PASS, tsc sans erreur.

- [ ] **Step 8: Commit**

```bash
git add src/core/database/types.ts src/core/database/sqlite.ts src/core/database/postgres.ts src/core/db.ts src/core/database/__tests__/runtime-crm-error.test.ts
git commit -m "P4c: bot_runtime_state stocke la derniere erreur de push CRM"
```

---

### Task 2: crm-bridge — persistance de la dernière erreur de push

**Files:**
- Modify: `src/core/crm-bridge.ts`
- Test: `src/core/__tests__/crm-bridge-error.test.ts`

**Interfaces:**
- Consumes : `setLastCrmError(clientId, botId, error)` (wrapper de `src/core/db.ts`, Task 1).
- Produces : après chaque push CRM dans `handleLeadEvent`, l'état runtime reflète le dernier résultat (échec ⇒ message stocké ; succès ⇒ effacé). Le fire-and-forget reste inchangé (la persistance ne doit pas bloquer ni relancer la conversation).

- [ ] **Step 1: Write the failing test**

Créer `src/core/__tests__/crm-bridge-error.test.ts`. On teste directement `handleLeadEvent` n'étant pas exporté ; on passe donc par l'event bus après un `initCrmBridge` avec un connecteur factice. Le plus simple et robuste : tester le comportement via une fonction exportée. Ajouter à `crm-bridge.ts` un export de test n'est pas souhaitable ; à la place, on teste l'intégration réelle en stubbant le connecteur.

Approche : injecter un bot configuré CRM + stubber `createConnector` pour renvoyer un connecteur dont `pushLead` réussit ou échoue, puis publier un événement et vérifier `getBotRuntimeState`.

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteDriver } from '../database/sqlite.js';
import { __setDatabaseForTests } from '../database/index.js';
import { resetConfigStore, upsertBot } from '../config-store.js';
import type { Database, BotRecord } from '../database/types.js';

const botRec: BotRecord = {
  client_id: 'acme', bot_id: 'sales', name: 'Ventes', transport: 'meta-cloud', status: 'active',
  default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'p' }, lead_fields: '',
  welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null,
  crm: { connector: 'webhook-generic' },
};

describe('crm-bridge — persistance erreur push', () => {
  let db: Database;
  beforeEach(async () => {
    db = createSqliteDriver(':memory:'); __setDatabaseForTests(db); resetConfigStore();
    process.env['CREDENTIALS_ENCRYPTION_KEY'] = '0'.repeat(64);
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await upsertBot(botRec, ['+33611111111']);
    // credential webhook-generic pour que le bind réussisse
    await db.setCredentialRecord?.;
  });
  afterEach(() => { vi.resetModules(); vi.restoreAllMocks(); resetConfigStore(); });

  it('stocke l\'erreur quand pushLead échoue, l\'efface quand il réussit', async () => {
    // 1) pushLead échoue
    vi.resetModules();
    vi.doMock('../../connectors/registry.js', () => ({
      createConnector: () => ({ connectorName: 'webhook-generic', pushLead: async () => { throw new Error('boom 500'); }, updateLead: async () => {}, pushBooking: async () => {} }),
    }));
    const fail = await import('../crm-bridge.js');
    await fail.initCrmBridge();
    const events = (await import('../events.js')).events;
    events.publishLead({ type: 'qualified', lead: { phone: '+33611111111', client_id: 'acme', bot_id: 'sales' } as never, changed_fields: ['name'] } as never);
    await new Promise((r) => setTimeout(r, 20));
    const errState = await db.getBotRuntimeState('acme', 'sales');
    expect(errState?.last_crm_error).toContain('boom 500');
  });
});
```

> **Note d'implémentation pour le subagent :** l'API exacte de `events.publishLead` et de la fabrique de credentials (`setCredentialRecord`/store) doit être vérifiée dans `src/core/events.ts` et `src/core/credentials/store.ts` avant d'écrire le test — adapte les noms aux signatures réelles. La forme du `LeadEvent` est dans `src/core/events.ts`. L'objectif du test est : un push qui throw ⇒ `last_crm_error` non-null ; un push qui réussit ⇒ `last_crm_error` null. Si l'isolement par `vi.doMock` s'avère fragile, refactore en extrayant `handleLeadEvent` derrière un export testable plutôt que de contourner l'assertion.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/__tests__/crm-bridge-error.test.ts`
Expected: FAIL — `last_crm_error` est `null`/absent (pas encore câblé).

- [ ] **Step 3: Wire persistence into `handleLeadEvent`**

Dans `src/core/crm-bridge.ts`, importer le wrapper en tête :

```typescript
import { setLastCrmError } from './db.js';
```

Puis dans `handleLeadEvent`, remplacer le bloc `try/catch` interne par une version qui persiste le résultat (succès ⇒ efface, échec ⇒ stocke), sans jamais propager :

```typescript
  await Promise.all(matching.map(async entry => {
    try {
      if (event.type === 'qualified' || event.type === 'updated') {
        await entry.connector.pushLead(event.lead);
        console.log(`[CrmBridge] ${event.type} -> ${entry.connector.connectorName} OK (${entry.client_id}/${entry.bot_id}, fields: ${event.changed_fields.join(',')})`);
        setLastCrmError(entry.client_id, entry.bot_id, null).catch((e) => console.error(`[CrmBridge] persist clear failed: ${e instanceof Error ? e.message : String(e)}`));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[CrmBridge] ${event.type} -> ${entry.connector.connectorName} FAILED (${entry.client_id}/${entry.bot_id}): ${message}`);
      setLastCrmError(entry.client_id, entry.bot_id, message).catch((e) => console.error(`[CrmBridge] persist error failed: ${e instanceof Error ? e.message : String(e)}`));
      // P2 : pousser en dead letter queue ici
    }
  }));
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/core/__tests__/crm-bridge-error.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/crm-bridge.ts src/core/__tests__/crm-bridge-error.test.ts
git commit -m "P4c: crm-bridge persiste la derniere erreur de push CRM"
```

---

### Task 3: DashboardService + health endpoint + câblage routeur

**Files:**
- Create: `src/core/services/dashboard-service.ts`
- Create: `src/api/admin/routes/dashboard.ts`
- Modify: `src/api/admin/router.ts`
- Modify: `src/index.ts`
- Test: `src/api/admin/__tests__/dashboard-routes.test.ts`

**Interfaces:**
- Consumes : `Database` (`getBotRecord`, `getBotRuntimeState`, `listBotNumbers`), `getMapping`/`getLlm`-equivalents via `Database` + `CredentialsService` (pour `key_configured`/`crm configured`). Pour rester read-only et simple, `DashboardService` reçoit `{ db, credentials }` (même `CredentialsService` que `ConnectionsService`).
- Produces :
  - `class DashboardService` avec `constructor(deps: { db: Database; credentials: CredentialsService })`.
  - `async health(clientId: string, botId: string): Promise<BotHealth>` où
    ```typescript
    interface BotHealth {
      status: string;            // 'draft' | 'active' | 'paused'
      numbers: string[];
      languages: string[];
      whatsapp: { validated: boolean; validated_at: string | null; error: string | null };
      crm: { configured: boolean; connector: string | null; last_error: string | null; last_error_at: string | null };
      llm: { mode: string; key_configured: boolean };
    }
    ```
  - `AdminRouterDeps` gagne `dashboardService: DashboardService`.
  - Routeur monte `dashboardRoutes(deps.dashboardService, wrap)` sous `/bots/:botId` (après `requireAuth, scopeToClient`).

- [ ] **Step 1: Write the failing test**

Créer `src/api/admin/__tests__/dashboard-routes.test.ts` (calqué sur `connections-routes.test.ts`) :

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import { DashboardService } from '../../../core/services/dashboard-service.js';
import { SimulateService } from '../../../core/services/simulate-service.js';
import type { Mailer } from '../../../core/auth/mailer.js';
import { hashPassword } from '../../../core/auth/passwords.js';
import { createAdminRouter } from '../router.js';

class FakeMailer implements Mailer { async sendInvitation() {} async sendPasswordReset() {} }
const KEY = '0'.repeat(64);
const botRec: BotRecord = { client_id: 'acme', bot_id: 'sales', name: 'Ventes', transport: 'meta-cloud', status: 'draft', default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'a' }, lead_fields: '', welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null };

async function build(): Promise<{ app: express.Express; db: Database }> {
  process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!';
  process.env['ADMIN_BCRYPT_ROUNDS'] = '4';
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = KEY;
  const db = createSqliteDriver(':memory:'); __setDatabaseForTests(db); resetConfigStore();
  const mailer = new FakeMailer();
  const credentials = new CredentialsService({ db });
  const app = express();
  app.use('/api/admin/v1', createAdminRouter({
    db, authService: new AuthService({ db, mailer }), adminService: new AdminService({ db, mailer }),
    botService: new BotService({ db }), connectionsService: new ConnectionsService({ db, credentials }),
    dashboardService: new DashboardService({ db, credentials }),
    simulateService: new SimulateService({}),
  }));
  await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
  await db.createUser({ email: 'ca@acme.test', password_hash: await hashPassword('motdepasse123'), role: 'client_admin', client_id: 'acme', status: 'active' });
  await upsertBot(botRec, ['+33611111111']);
  return { app, db };
}
async function bearer(app: express.Express): Promise<string> {
  return (await request(app).post('/api/admin/v1/auth/login').send({ email: 'ca@acme.test', password: 'motdepasse123' })).body.access_token as string;
}

describe('dashboard routes — health', () => {
  let app: express.Express;
  beforeEach(async () => { ({ app } = await build()); });

  it('GET health renvoie l\'état des connexions', async () => {
    const tok = await bearer(app);
    const res = await request(app).get('/api/admin/v1/bots/sales/health').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('draft');
    expect(res.body.numbers).toEqual(['+33611111111']);
    expect(res.body.whatsapp.validated).toBe(false);
    expect(res.body.llm.mode).toBe('platform');
    expect(res.body.crm.configured).toBe(false);
  });

  it('health 404 pour un bot inconnu', async () => {
    const tok = await bearer(app);
    const res = await request(app).get('/api/admin/v1/bots/ghost/health').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(404);
  });

  it('health exige l\'auth', async () => {
    const res = await request(app).get('/api/admin/v1/bots/sales/health');
    expect(res.status).toBe(401);
  });
});
```

> Le subagent vérifiera la signature réelle du constructeur `SimulateService` (Task 6) ; pour cette task, `new SimulateService({})` doit compiler — définir `SimulateServiceDeps` avec tous les champs optionnels (voir Task 6). Si Task 6 n'est pas encore écrite au moment de cette task, créer un `simulate-service.ts` minimal avec un constructeur `constructor(_deps: { chatFn?: ... } = {})` est acceptable ; Task 6 l'étoffera.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/admin/__tests__/dashboard-routes.test.ts`
Expected: FAIL — module `dashboard-service.js` introuvable / `dashboardService` absent de `AdminRouterDeps`.

- [ ] **Step 3: Create `DashboardService` with `health`**

Créer `src/core/services/dashboard-service.ts` :

```typescript
import type { Database } from '../database/types.js';
import type { CredentialsService } from './credentials-service.js';
import { notFound } from '../../api/errors.js';

export interface BotHealth {
  status: string;
  numbers: string[];
  languages: string[];
  whatsapp: { validated: boolean; validated_at: string | null; error: string | null };
  crm: { configured: boolean; connector: string | null; last_error: string | null; last_error_at: string | null };
  llm: { mode: string; key_configured: boolean };
}

export interface DashboardServiceDeps { db: Database; credentials: CredentialsService; }

export class DashboardService {
  private readonly db: Database;
  private readonly credentials: CredentialsService;
  constructor(deps: DashboardServiceDeps) { this.db = deps.db; this.credentials = deps.credentials; }

  private async requireBot(clientId: string, botId: string) {
    const rec = await this.db.getBotRecord(clientId, botId);
    if (!rec) throw notFound('Bot introuvable.');
    return rec;
  }

  async health(clientId: string, botId: string): Promise<BotHealth> {
    const rec = await this.requireBot(clientId, botId);
    const numbers = (await this.db.listBotNumbers())
      .filter((n) => n.client_id === clientId && n.bot_id === botId)
      .map((n) => n.whatsapp_number);
    const rt = await this.db.getBotRuntimeState(clientId, botId);
    const connector = rec.crm?.connector ?? null;
    const crmConfigured = connector
      ? (await this.credentials.getMasked(clientId, botId, 'crm', connector)).configured
      : false;
    const llmMode = rec.llm?.mode ?? 'platform';
    const llmKey = await this.credentials.getMasked(clientId, botId, 'llm', 'anthropic');
    return {
      status: rec.status,
      numbers,
      languages: rec.languages,
      whatsapp: {
        validated: Boolean(rt?.transport_validated_at),
        validated_at: rt?.transport_validated_at ?? null,
        error: rt?.transport_error ?? null,
      },
      crm: {
        configured: crmConfigured,
        connector,
        last_error: rt?.last_crm_error ?? null,
        last_error_at: rt?.last_crm_error_at ?? null,
      },
      llm: { mode: llmMode, key_configured: llmMode === 'byo' && llmKey.configured },
    };
  }
}
```

> Vérifier la signature exacte de `CredentialsService.getMasked` (utilisée par `ConnectionsService.getCrmMasked`/`getLlm`) : `getMasked(clientId, botId, service, provider) => Promise<{ configured: boolean; fields?: ... }>`. Réutiliser telle quelle.

- [ ] **Step 4: Create the dashboard router with the health route**

Créer `src/api/admin/routes/dashboard.ts` :

```typescript
import { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import type { DashboardService } from '../../../core/services/dashboard-service.js';
import { forbidden } from '../../errors.js';

function requireScopedClient(req: Request): string {
  if (!req.scopedClientId) throw forbidden('client_id requis (super_admin : préciser ?client_id).');
  return req.scopedClientId;
}

export function dashboardRoutes(svc: DashboardService, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router({ mergeParams: true });

  r.get('/health', wrap(async (req, res) => {
    res.json(await svc.health(requireScopedClient(req), String(req.params['botId'])));
  }));

  return r;
}
```

- [ ] **Step 5: Wire into the admin router**

Dans `src/api/admin/router.ts` :
- importer `DashboardService` (type) et `dashboardRoutes`, plus `SimulateService` (type) et `simulateRoutes` (placeholders pour Task 6 — si Task 6 pas encore faite, créer un `simulate-service.ts`/`routes/simulate.ts` minimal ; sinon importer).
- étendre `AdminRouterDeps` :

```typescript
export interface AdminRouterDeps {
  db: Database;
  authService: AuthService;
  adminService: AdminService;
  botService: BotService;
  connectionsService: ConnectionsService;
  dashboardService: DashboardService;
  simulateService: SimulateService;
}
```

- monter, après la ligne `connectionsRoutes` (toutes deux sous `/bots/:botId`, scopées) :

```typescript
  r.use('/bots/:botId', requireAuth, scopeToClient, dashboardRoutes(deps.dashboardService, wrap));
```

> Express autorise plusieurs routeurs sur le même chemin ; `connectionsRoutes` et `dashboardRoutes` ont des sous-chemins disjoints. Garder l'ordre : connections puis dashboard.

- [ ] **Step 6: Wire `src/index.ts`**

Dans `src/index.ts`, importer et instancier :

```typescript
import { DashboardService } from './core/services/dashboard-service.js';
import { SimulateService } from './core/services/simulate-service.js';
```

et dans `main()`, après `connectionsService` :

```typescript
  const dashboardService = new DashboardService({ db: adminDb, credentials });
  const simulateService = new SimulateService({});
  app.use('/api/admin/v1', createAdminRouter({ db: adminDb, authService, adminService, botService, connectionsService, dashboardService, simulateService }));
```

(remplacer l'appel `createAdminRouter` existant).

- [ ] **Step 7: Run tests + typecheck**

Run: `npx vitest run src/api/admin/__tests__/dashboard-routes.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/core/services/dashboard-service.ts src/api/admin/routes/dashboard.ts src/api/admin/router.ts src/index.ts src/api/admin/__tests__/dashboard-routes.test.ts src/core/services/simulate-service.ts src/api/admin/routes/simulate.ts
git commit -m "P4c: DashboardService + endpoint health + cablage routeur"
```

---

### Task 4: Leads reads (DB + service + contracts + routes)

**Files:**
- Modify: `src/core/database/types.ts`
- Modify: `src/core/database/sqlite.ts`
- Modify: `src/core/database/postgres.ts`
- Create: `src/contracts/dashboard.ts`
- Modify: `src/contracts/index.ts`
- Modify: `src/core/services/dashboard-service.ts`
- Modify: `src/api/admin/routes/dashboard.ts`
- Test: `src/core/services/__tests__/dashboard-service.test.ts`
- Test: `src/api/admin/__tests__/dashboard-routes.test.ts` (étendre)

**Interfaces:**
- Consumes : `LeadRow` (existant : `phone`, `client_id`, `bot_id`, `name`, `qualified_data: string | null`, `rdv_requested: number`, `created_at`, `message_count`, `last_message_at`), `getRecentHistory(phone, clientId, botId, limit)` (renvoie `HistoryRow[]` = `{ role, content, created_at }` triés DESC), `getLeadData(phone, clientId, botId)`.
- Produces :
  - Type `LeadListResult = { leads: LeadRow[]; total: number }`.
  - `Database.listLeadsByBot(clientId: string, botId: string, opts: { search?: string; rdvOnly?: boolean; limit: number; offset: number }): Promise<LeadListResult>`.
  - Zod `LeadsQuery` (dans `dashboard.ts`) : `{ page: number≥1 (def 1), page_size: number 1..100 (def 20), search?: string, rdv?: boolean }`.
  - `DashboardService.listLeads(clientId, botId, q): Promise<{ leads: LeadRow[]; total: number; page: number; page_size: number }>`.
  - `DashboardService.getLead(clientId, botId, phone): Promise<{ phone; name; qualified_data; transcript: { role; content; created_at }[] }>` — 404 si lead inconnu.
  - Routes : `GET /bots/:botId/leads` (query → `LeadsQuery`), `GET /bots/:botId/leads/:phone`.

- [ ] **Step 1: Write the failing DB/service test**

Créer `src/core/services/__tests__/dashboard-service.test.ts` :

```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import type { Database } from '../../database/types.js';
import { CredentialsService } from '../credentials-service.js';
import { DashboardService } from '../dashboard-service.js';

describe('DashboardService — leads', () => {
  let db: Database; let svc: DashboardService;
  beforeEach(async () => {
    process.env['CREDENTIALS_ENCRYPTION_KEY'] = '0'.repeat(64);
    db = createSqliteDriver(':memory:');
    svc = new DashboardService({ db, credentials: new CredentialsService({ db }) });
    await db.saveLead('+33600000001', 'acme', 'sales', { phone: '+33600000001', name: 'Alice', budget: '10k' });
    await db.saveLead('+33600000002', 'acme', 'sales', { phone: '+33600000002', name: 'Bob' });
    await db.saveLead('+33600000003', 'acme', 'support', { phone: '+33600000003', name: 'Carol' });
    await db.addMessage('+33600000001', 'acme', 'sales', 'user', 'bonjour');
    await db.addMessage('+33600000001', 'acme', 'sales', 'assistant', 'salut Alice');
  });

  it('liste paginée scoping client+bot', async () => {
    const res = await svc.listLeads('acme', 'sales', { page: 1, page_size: 10 });
    expect(res.total).toBe(2);
    expect(res.leads.map((l) => l.phone).sort()).toEqual(['+33600000001', '+33600000002']);
  });

  it('filtre recherche par nom/téléphone', async () => {
    const res = await svc.listLeads('acme', 'sales', { page: 1, page_size: 10, search: 'Alice' });
    expect(res.total).toBe(1);
    expect(res.leads[0]?.name).toBe('Alice');
  });

  it('pagination : page_size=1 borne les résultats mais total reste global', async () => {
    const res = await svc.listLeads('acme', 'sales', { page: 1, page_size: 1 });
    expect(res.leads.length).toBe(1);
    expect(res.total).toBe(2);
  });

  it('détail lead = données qualifiées + transcript chrono', async () => {
    const d = await svc.getLead('acme', 'sales', '+33600000001');
    expect(d.qualified_data).toMatchObject({ budget: '10k' });
    expect(d.transcript.map((m) => m.content)).toEqual(['bonjour', 'salut Alice']);
  });

  it('détail lead inconnu → throw notFound', async () => {
    await expect(svc.getLead('acme', 'sales', '+33699999999')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
```

> `AppError` expose `.code` (vérifier dans `src/api/errors.ts`). Si la propriété diffère, adapter l'assertion.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/services/__tests__/dashboard-service.test.ts`
Expected: FAIL — `svc.listLeads is not a function`.

- [ ] **Step 3: Add `listLeadsByBot` (DB)**

Dans `src/core/database/types.ts`, ajouter le type (près de `LeadRow`) :

```typescript
export interface LeadListResult { leads: LeadRow[]; total: number; }
```

et dans l'interface `Database` (près de `getAllLeads`) :

```typescript
  listLeadsByBot(clientId: string, botId: string, opts: { search?: string; rdvOnly?: boolean; limit: number; offset: number }): Promise<LeadListResult>;
```

Dans `src/core/database/sqlite.ts`, après `getAllLeads` :

```typescript
    async listLeadsByBot(clientId, botId, opts): Promise<LeadListResult> {
      const where: string[] = ['l.client_id = ?', 'l.bot_id = ?'];
      const params: unknown[] = [clientId, botId];
      if (opts.rdvOnly) where.push('l.rdv_requested = 1');
      if (opts.search) {
        where.push('(l.name LIKE ? OR l.phone LIKE ?)');
        const like = `%${opts.search}%`;
        params.push(like, like);
      }
      const whereSql = where.join(' AND ');
      const total = (db.prepare(`SELECT COUNT(*) as n FROM leads l WHERE ${whereSql}`).get(...params) as { n: number }).n;
      const leads = db.prepare(`
        SELECT l.phone, l.client_id, l.bot_id, l.name, l.qualified_data, l.rdv_requested, l.created_at,
          COALESCE(c.msg_count, 0) as message_count,
          c.last_msg_at as last_message_at
        FROM leads l
        LEFT JOIN (
          SELECT phone, client_id, bot_id, COUNT(*) as msg_count, MAX(created_at) as last_msg_at
          FROM conversations GROUP BY phone, client_id, bot_id
        ) c ON c.phone = l.phone AND c.client_id = l.client_id AND c.bot_id = l.bot_id
        WHERE ${whereSql}
        ORDER BY l.created_at DESC
        LIMIT ? OFFSET ?
      `).all(...params, opts.limit, opts.offset) as LeadRow[];
      return { leads, total };
    },
```

> Préfixer le type des params de la signature TS si nécessaire pour satisfaire le typage du driver (le repo type souvent l'objet driver complet ; calquer `getAllLeads` voisin pour le style — si le fichier annote chaque méthode, reprends la signature de l'interface).

Dans `src/core/database/postgres.ts`, après `getAllLeads`, le miroir avec `$n` et `::text` sur les timestamps. ATTENTION : le placeholder count varie ; construire l'index dynamiquement :

```typescript
    async listLeadsByBot(clientId, botId, opts): Promise<LeadListResult> {
      const where: string[] = ['l.client_id = $1', 'l.bot_id = $2'];
      const params: unknown[] = [clientId, botId];
      let i = 3;
      if (opts.rdvOnly) where.push('l.rdv_requested = 1');
      if (opts.search) {
        where.push(`(l.name ILIKE $${i} OR l.phone ILIKE $${i + 1})`);
        const like = `%${opts.search}%`;
        params.push(like, like);
        i += 2;
      }
      const whereSql = where.join(' AND ');
      const totalRes = await pool.query(`SELECT COUNT(*)::int as n FROM leads l WHERE ${whereSql}`, params);
      const total = (totalRes.rows[0] as { n: number }).n;
      const res = await pool.query(`
        SELECT l.phone, l.client_id, l.bot_id, l.name,
          l.qualified_data, l.rdv_requested, l.created_at::text as created_at,
          COALESCE(c.msg_count, 0)::int as message_count,
          c.last_msg_at::text as last_message_at
        FROM leads l
        LEFT JOIN (
          SELECT phone, client_id, bot_id, COUNT(*)::int as msg_count, MAX(created_at) as last_msg_at
          FROM conversations GROUP BY phone, client_id, bot_id
        ) c ON c.phone = l.phone AND c.client_id = l.client_id AND c.bot_id = l.bot_id
        WHERE ${whereSql}
        ORDER BY l.created_at DESC
        LIMIT $${i} OFFSET $${i + 1}
      `, [...params, opts.limit, opts.offset]);
      return { leads: res.rows as LeadRow[], total };
    },
```

> Côté postgres `qualified_data` est `JSONB` : `getAllLeads` le renvoie tel quel. Vérifier comment `getAllLeads` postgres traite `qualified_data` (string vs objet) et reproduire le même traitement pour rester cohérent avec le type `LeadRow.qualified_data: string | null`. Si `getAllLeads` fait `JSON.stringify` ou un cast, faire pareil.

- [ ] **Step 4: Add contracts**

Créer `src/contracts/dashboard.ts` :

```typescript
import { z } from 'zod';

export const LeadsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional(),
  rdv: z.coerce.boolean().optional(),
});
export type LeadsQuery = z.infer<typeof LeadsQuery>;
```

Dans `src/contracts/index.ts`, ajouter :

```typescript
export * from './dashboard.js';
```

- [ ] **Step 5: Add `listLeads` + `getLead` to the service**

Dans `src/core/services/dashboard-service.ts`, ajouter les méthodes (et l'import `notFound` est déjà présent) :

```typescript
  async listLeads(clientId: string, botId: string, q: { page: number; page_size: number; search?: string; rdv?: boolean }): Promise<{ leads: import('../database/types.js').LeadRow[]; total: number; page: number; page_size: number }> {
    await this.requireBot(clientId, botId);
    const offset = (q.page - 1) * q.page_size;
    const { leads, total } = await this.db.listLeadsByBot(clientId, botId, {
      ...(q.search ? { search: q.search } : {}),
      ...(q.rdv ? { rdvOnly: true } : {}),
      limit: q.page_size,
      offset,
    });
    return { leads, total, page: q.page, page_size: q.page_size };
  }

  async getLead(clientId: string, botId: string, phone: string): Promise<{ phone: string; name: string | null; qualified_data: Record<string, unknown> | null; transcript: { role: string; content: string; created_at: string }[] }> {
    await this.requireBot(clientId, botId);
    const data = await this.db.getLeadData(phone, clientId, botId);
    if (data === null) throw notFound('Lead introuvable.');
    const history = await this.db.getRecentHistory(phone, clientId, botId, 200);
    const transcript = [...history].reverse();
    const name = (data['name'] as string | undefined) ?? (data['profileName'] as string | undefined) ?? null;
    return { phone, name, qualified_data: data, transcript };
  }
```

> `getLeadData` renvoie `null` si aucune ligne OU si `qualified_data` est null/illisible. Pour un lead créé via `saveLead` avec au moins `{ phone }`, `qualified_data` n'est jamais vide. C'est le comportement attendu (un lead sans données qualifiées est traité comme inexistant pour le détail). Acceptable pour V1.

- [ ] **Step 6: Add the routes**

Dans `src/api/admin/routes/dashboard.ts`, importer `LeadsQuery` et `notFound`, et ajouter avant le `return r;` :

```typescript
  r.get('/leads', wrap(async (req, res) => {
    const q = LeadsQuery.parse(req.query);
    res.json(await svc.listLeads(requireScopedClient(req), String(req.params['botId']), q));
  }));
  r.get('/leads/:phone', wrap(async (req, res) => {
    res.json(await svc.getLead(requireScopedClient(req), String(req.params['botId']), String(req.params['phone'])));
  }));
```

Imports en tête du fichier :

```typescript
import { LeadsQuery } from '../../../contracts/index.js';
```

- [ ] **Step 7: Extend the route test**

Ajouter à `src/api/admin/__tests__/dashboard-routes.test.ts` un `describe('dashboard routes — leads', ...)` :

```typescript
describe('dashboard routes — leads', () => {
  let app: express.Express; let db: Database;
  beforeEach(async () => {
    ({ app, db } = await build());
    await db.saveLead('+33600000001', 'acme', 'sales', { phone: '+33600000001', name: 'Alice' });
    await db.saveLead('+33600000002', 'acme', 'sales', { phone: '+33600000002', name: 'Bob' });
  });

  it('GET leads paginé', async () => {
    const tok = await bearer(app);
    const res = await request(app).get('/api/admin/v1/bots/sales/leads?page=1&page_size=10').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.page).toBe(1);
  });

  it('GET leads/:phone détail + transcript', async () => {
    const tok = await bearer(app);
    const res = await request(app).get('/api/admin/v1/bots/sales/leads/+33600000001').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Alice');
    expect(Array.isArray(res.body.transcript)).toBe(true);
  });

  it('isolation : un autre client ne voit pas les leads de acme', async () => {
    await db.upsertClient({ client_id: 'other', name: 'O', status: 'active' });
    await db.createUser({ email: 'o@o.test', password_hash: await (await import('../../../core/auth/passwords.js')).hashPassword('motdepasse123'), role: 'client_admin', client_id: 'other', status: 'active' });
    const tokO = (await request(app).post('/api/admin/v1/auth/login').send({ email: 'o@o.test', password: 'motdepasse123' })).body.access_token;
    const res = await request(app).get('/api/admin/v1/bots/sales/leads').set('Authorization', `Bearer ${tokO}`);
    expect(res.status).toBe(404); // bot 'sales' introuvable pour 'other'
  });
});
```

- [ ] **Step 8: Run tests + typecheck**

Run: `npx vitest run src/core/services/__tests__/dashboard-service.test.ts src/api/admin/__tests__/dashboard-routes.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/core/database/types.ts src/core/database/sqlite.ts src/core/database/postgres.ts src/contracts/dashboard.ts src/contracts/index.ts src/core/services/dashboard-service.ts src/api/admin/routes/dashboard.ts src/core/services/__tests__/dashboard-service.test.ts src/api/admin/__tests__/dashboard-routes.test.ts
git commit -m "P4c: endpoints leads (liste paginee/filtree + detail + transcript)"
```

---

### Task 5: Metrics + usage (DB + service + routes)

**Files:**
- Modify: `src/core/database/types.ts`
- Modify: `src/core/database/sqlite.ts`
- Modify: `src/core/database/postgres.ts`
- Modify: `src/core/services/dashboard-service.ts`
- Modify: `src/api/admin/routes/dashboard.ts`
- Test: `src/core/services/__tests__/dashboard-service.test.ts` (étendre)
- Test: `src/api/admin/__tests__/dashboard-routes.test.ts` (étendre)

**Interfaces:**
- Consumes : `LlmUsageRow` (existant : `client_id`, `bot_id`, `phone`, `call_type`, `mode`, `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `cost_usd`, `created_at`, …), `insertLlmUsage`, `listLlmUsage`.
- Produces :
  - `BotMetrics = { leads_total: number; rdv_total: number; conversations_total: number; messages_total: number }`.
  - `Database.getBotMetrics(clientId, botId): Promise<BotMetrics>`.
  - `Database.listLlmUsageByBot(clientId, botId, sinceIso?: string): Promise<LlmUsageRow[]>`.
  - `DashboardService.metrics(clientId, botId): Promise<BotMetrics>`.
  - `DashboardService.usage(clientId, botId, sinceIso?): Promise<UsageSummary>` où
    ```typescript
    interface UsageSummary {
      totals: { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_creation_tokens: number; cost_usd: number; calls: number };
      by_model: { model: string; calls: number; cost_usd: number; input_tokens: number; output_tokens: number }[];
      by_day: { day: string; cost_usd: number; calls: number }[];
    }
    ```
  - Routes : `GET /bots/:botId/metrics`, `GET /bots/:botId/usage` (optionnel `?since=ISO`, défaut 30 jours).

- [ ] **Step 1: Write the failing test (service)**

Ajouter à `src/core/services/__tests__/dashboard-service.test.ts` :

```typescript
describe('DashboardService — metrics & usage', () => {
  let db: Database; let svc: DashboardService;
  beforeEach(async () => {
    process.env['CREDENTIALS_ENCRYPTION_KEY'] = '0'.repeat(64);
    db = createSqliteDriver(':memory:');
    svc = new DashboardService({ db, credentials: new CredentialsService({ db }) });
    await db.saveLead('+33600000001', 'acme', 'sales', { phone: '+33600000001', name: 'Alice' });
    await db.saveLead('+33600000002', 'acme', 'sales', { phone: '+33600000002', name: 'Bob', rdv: true });
    await db.addMessage('+33600000001', 'acme', 'sales', 'user', 'a');
    await db.addMessage('+33600000001', 'acme', 'sales', 'assistant', 'b');
    await db.insertLlmUsage({ client_id: 'acme', bot_id: 'sales', phone: '+33600000001', call_type: 'chat', mode: 'platform', platform_key_id: null, model: 'claude-haiku-4-5-20251001', input_tokens: 100, output_tokens: 40, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: 0.001, pricing_version: null, anthropic_request_id: null });
    await db.insertLlmUsage({ client_id: 'acme', bot_id: 'sales', phone: '+33600000001', call_type: 'chat', mode: 'platform', platform_key_id: null, model: 'claude-haiku-4-5-20251001', input_tokens: 50, output_tokens: 20, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: 0.0005, pricing_version: null, anthropic_request_id: null });
  });

  it('metrics : compte leads/rdv/conversations/messages', async () => {
    const m = await svc.metrics('acme', 'sales');
    expect(m.leads_total).toBe(2);
    expect(m.conversations_total).toBe(1);
    expect(m.messages_total).toBe(2);
  });

  it('usage : totaux + agrégation par modèle', async () => {
    const u = await svc.usage('acme', 'sales');
    expect(u.totals.calls).toBe(2);
    expect(u.totals.input_tokens).toBe(150);
    expect(u.totals.cost_usd).toBeCloseTo(0.0015, 6);
    expect(u.by_model[0]?.model).toBe('claude-haiku-4-5-20251001');
    expect(u.by_model[0]?.calls).toBe(2);
  });
});
```

> Le champ `rdv` dans `qualified_data` n'incrémente PAS `leads.rdv_requested` (colonne distincte, mise à jour ailleurs dans le runtime). `rdv_total` reflète la colonne `rdv_requested` ; ce test ne l'asserte donc pas. Ne pas confondre.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/services/__tests__/dashboard-service.test.ts -t "metrics"`
Expected: FAIL — `svc.metrics is not a function`.

- [ ] **Step 3: Add DB methods**

`src/core/database/types.ts` — types + interface :

```typescript
export interface BotMetrics { leads_total: number; rdv_total: number; conversations_total: number; messages_total: number; }
```

```typescript
  getBotMetrics(clientId: string, botId: string): Promise<BotMetrics>;
  listLlmUsageByBot(clientId: string, botId: string, sinceIso?: string): Promise<LlmUsageRow[]>;
```

`src/core/database/sqlite.ts` :

```typescript
    async getBotMetrics(clientId, botId): Promise<BotMetrics> {
      const leads = (db.prepare('SELECT COUNT(*) as n FROM leads WHERE client_id = ? AND bot_id = ?').get(clientId, botId) as { n: number }).n;
      const rdv = (db.prepare('SELECT COUNT(*) as n FROM leads WHERE client_id = ? AND bot_id = ? AND rdv_requested = 1').get(clientId, botId) as { n: number }).n;
      const convs = (db.prepare('SELECT COUNT(DISTINCT phone) as n FROM conversations WHERE client_id = ? AND bot_id = ?').get(clientId, botId) as { n: number }).n;
      const msgs = (db.prepare('SELECT COUNT(*) as n FROM conversations WHERE client_id = ? AND bot_id = ?').get(clientId, botId) as { n: number }).n;
      return { leads_total: leads, rdv_total: rdv, conversations_total: convs, messages_total: msgs };
    },

    async listLlmUsageByBot(clientId, botId, sinceIso): Promise<LlmUsageRow[]> {
      if (sinceIso) {
        return db.prepare('SELECT * FROM llm_usage WHERE client_id = ? AND bot_id = ? AND created_at >= ? ORDER BY created_at DESC').all(clientId, botId, sinceIso) as LlmUsageRow[];
      }
      return db.prepare('SELECT * FROM llm_usage WHERE client_id = ? AND bot_id = ? ORDER BY created_at DESC').all(clientId, botId) as LlmUsageRow[];
    },
```

`src/core/database/postgres.ts` (miroir, `::int` sur les counts, `::text` sur les timestamps retournés par `SELECT *` — lister explicitement les colonnes pour caster `created_at`) :

```typescript
    async getBotMetrics(clientId, botId): Promise<BotMetrics> {
      const q = async (sql: string) => ((await pool.query(sql, [clientId, botId])).rows[0] as { n: number }).n;
      return {
        leads_total: await q('SELECT COUNT(*)::int as n FROM leads WHERE client_id = $1 AND bot_id = $2'),
        rdv_total: await q('SELECT COUNT(*)::int as n FROM leads WHERE client_id = $1 AND bot_id = $2 AND rdv_requested = 1'),
        conversations_total: await q('SELECT COUNT(DISTINCT phone)::int as n FROM conversations WHERE client_id = $1 AND bot_id = $2'),
        messages_total: await q('SELECT COUNT(*)::int as n FROM conversations WHERE client_id = $1 AND bot_id = $2'),
      };
    },

    async listLlmUsageByBot(clientId, botId, sinceIso): Promise<LlmUsageRow[]> {
      const cols = `id, client_id, bot_id, phone, call_type, mode, platform_key_id, model,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
        cost_usd, pricing_version, anthropic_request_id, created_at::text as created_at`;
      if (sinceIso) {
        const res = await pool.query(`SELECT ${cols} FROM llm_usage WHERE client_id = $1 AND bot_id = $2 AND created_at >= $3 ORDER BY created_at DESC`, [clientId, botId, sinceIso]);
        return res.rows as LlmUsageRow[];
      }
      const res = await pool.query(`SELECT ${cols} FROM llm_usage WHERE client_id = $1 AND bot_id = $2 ORDER BY created_at DESC`, [clientId, botId]);
      return res.rows as LlmUsageRow[];
    },
```

> Vérifier que `listLlmUsage` (existant) côté postgres caste déjà `created_at::text` ; reprendre la même liste de colonnes exacte que lui pour cohérence (le bloc ci-dessus reflète le schéma `llm_usage` du spec §5).

- [ ] **Step 4: Add service methods**

Dans `src/core/services/dashboard-service.ts` :

```typescript
  async metrics(clientId: string, botId: string): Promise<import('../database/types.js').BotMetrics> {
    await this.requireBot(clientId, botId);
    return this.db.getBotMetrics(clientId, botId);
  }

  async usage(clientId: string, botId: string, sinceIso?: string): Promise<{
    totals: { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_creation_tokens: number; cost_usd: number; calls: number };
    by_model: { model: string; calls: number; cost_usd: number; input_tokens: number; output_tokens: number }[];
    by_day: { day: string; cost_usd: number; calls: number }[];
  }> {
    await this.requireBot(clientId, botId);
    const rows = await this.db.listLlmUsageByBot(clientId, botId, sinceIso);
    const totals = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: 0, calls: 0 };
    const modelMap = new Map<string, { model: string; calls: number; cost_usd: number; input_tokens: number; output_tokens: number }>();
    const dayMap = new Map<string, { day: string; cost_usd: number; calls: number }>();
    for (const r of rows) {
      totals.input_tokens += r.input_tokens; totals.output_tokens += r.output_tokens;
      totals.cache_read_tokens += r.cache_read_tokens; totals.cache_creation_tokens += r.cache_creation_tokens;
      totals.cost_usd += r.cost_usd; totals.calls += 1;
      const m = modelMap.get(r.model) ?? { model: r.model, calls: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0 };
      m.calls += 1; m.cost_usd += r.cost_usd; m.input_tokens += r.input_tokens; m.output_tokens += r.output_tokens;
      modelMap.set(r.model, m);
      const day = r.created_at.slice(0, 10);
      const d = dayMap.get(day) ?? { day, cost_usd: 0, calls: 0 };
      d.cost_usd += r.cost_usd; d.calls += 1; dayMap.set(day, d);
    }
    return {
      totals,
      by_model: [...modelMap.values()].sort((a, b) => b.cost_usd - a.cost_usd),
      by_day: [...dayMap.values()].sort((a, b) => a.day.localeCompare(b.day)),
    };
  }
```

- [ ] **Step 5: Add routes**

Dans `src/api/admin/routes/dashboard.ts`, avant `return r;` :

```typescript
  r.get('/metrics', wrap(async (req, res) => {
    res.json(await svc.metrics(requireScopedClient(req), String(req.params['botId'])));
  }));
  r.get('/usage', wrap(async (req, res) => {
    const since = typeof req.query['since'] === 'string' && req.query['since']
      ? String(req.query['since'])
      : new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    res.json(await svc.usage(requireScopedClient(req), String(req.params['botId']), since));
  }));
```

- [ ] **Step 6: Extend the route test**

Ajouter à `dashboard-routes.test.ts` :

```typescript
describe('dashboard routes — metrics & usage', () => {
  let app: express.Express; let db: Database;
  beforeEach(async () => {
    ({ app, db } = await build());
    await db.insertLlmUsage({ client_id: 'acme', bot_id: 'sales', phone: null, call_type: 'chat', mode: 'platform', platform_key_id: null, model: 'claude-haiku-4-5-20251001', input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: 0.0001, pricing_version: null, anthropic_request_id: null });
  });
  it('GET metrics', async () => {
    const tok = await bearer(app);
    const res = await request(app).get('/api/admin/v1/bots/sales/metrics').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.leads_total).toBe('number');
  });
  it('GET usage agrège', async () => {
    const tok = await bearer(app);
    const res = await request(app).get('/api/admin/v1/bots/sales/usage').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(res.body.totals.calls).toBe(1);
    expect(res.body.by_model.length).toBe(1);
  });
});
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npx vitest run src/core/services/__tests__/dashboard-service.test.ts src/api/admin/__tests__/dashboard-routes.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/core/database/types.ts src/core/database/sqlite.ts src/core/database/postgres.ts src/core/services/dashboard-service.ts src/api/admin/routes/dashboard.ts src/core/services/__tests__/dashboard-service.test.ts src/api/admin/__tests__/dashboard-routes.test.ts
git commit -m "P4c: endpoints metrics + usage (agregation metering par bot)"
```

---

### Task 6: SimulateService + endpoint simulate

**Files:**
- Create/overwrite: `src/core/services/simulate-service.ts` (si un squelette a été créé en Task 3, l'étoffer)
- Create/overwrite: `src/api/admin/routes/simulate.ts`
- Modify: `src/api/admin/router.ts` (montage)
- Modify: `src/contracts/dashboard.ts` (ajout `SimulateInput`)
- Test: `src/core/services/__tests__/simulate-service.test.ts`
- Test: `src/api/admin/__tests__/simulate-routes.test.ts`

**Interfaces:**
- Consumes : `chat(systemPromptParts, messages, opts)` de `src/llm/anthropic.ts` (signature : `(SystemPromptPart[] | string, ChatMessage[], { clientId: string; botId: string | null; model?: string }) => Promise<string>`), `getBotRecord` de `Database`. Modèle Haiku : `'claude-haiku-4-5-20251001'`.
- Produces :
  - `SimulateServiceDeps = { chatFn?: typeof chat; ttlMs?: number; model?: string }` (tous optionnels → `new SimulateService({})` compile ; défaut `chatFn = chat`, `ttlMs = 30*60*1000`, `model = 'claude-haiku-4-5-20251001'`).
  - `class SimulateService` avec `async simulate(clientId: string, botId: string, input: { session_id?: string; message: string }): Promise<{ session_id: string; reply: string; model: string }>`. Session éphémère en mémoire (`Map`), créée si `session_id` absent/inconnu/expiré ; balayage des sessions périmées à chaque appel (pattern stale-sweep du rate-limiter). Le store est scopé `(clientId, botId)` : un `session_id` ne peut servir que pour le couple qui l'a créé.
  - Zod `SimulateInput = z.object({ session_id: z.string().optional(), message: z.string().min(1).max(4000) })`.
  - Route : `POST /bots/:botId/simulate`.

- [ ] **Step 1: Write the failing service test**

Créer `src/core/services/__tests__/simulate-service.test.ts` :

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import { __setDatabaseForTests } from '../../database/index.js';
import { resetConfigStore, upsertBot } from '../../config-store.js';
import type { Database, BotRecord } from '../../database/types.js';
import { SimulateService } from '../simulate-service.js';

const botRec: BotRecord = { client_id: 'acme', bot_id: 'sales', name: 'Ventes', transport: 'meta-cloud', status: 'draft', default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'Tu es un assistant ventes.' }, lead_fields: '', welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null };

describe('SimulateService', () => {
  let db: Database;
  beforeEach(async () => {
    db = createSqliteDriver(':memory:'); __setDatabaseForTests(db); resetConfigStore();
    await upsertBot(botRec, []);
  });

  it('crée une session et renvoie la réponse + le modèle', async () => {
    const chatFn = vi.fn().mockResolvedValue('Bonjour, comment puis-je aider ?');
    const svc = new SimulateService({ chatFn });
    const r = await svc.simulate('acme', 'sales', { message: 'salut' });
    expect(r.reply).toBe('Bonjour, comment puis-je aider ?');
    expect(r.model).toBe('claude-haiku-4-5-20251001');
    expect(r.session_id).toBeTruthy();
    // chat appelé avec Haiku et le system prompt du bot
    const call = chatFn.mock.calls[0];
    expect(call[2]).toMatchObject({ clientId: 'acme', botId: 'sales', model: 'claude-haiku-4-5-20251001' });
  });

  it('conserve l\'historique entre deux tours de la même session', async () => {
    const chatFn = vi.fn().mockResolvedValueOnce('R1').mockResolvedValueOnce('R2');
    const svc = new SimulateService({ chatFn });
    const a = await svc.simulate('acme', 'sales', { message: 'm1' });
    await svc.simulate('acme', 'sales', { session_id: a.session_id, message: 'm2' });
    // au 2e appel, messages contient m1/R1/m2
    const secondMessages = chatFn.mock.calls[1][1] as { role: string; content: string }[];
    expect(secondMessages.map((m) => m.content)).toEqual(['m1', 'R1', 'm2']);
  });

  it('ne persiste aucun lead ni conversation', async () => {
    const svc = new SimulateService({ chatFn: vi.fn().mockResolvedValue('x') });
    await svc.simulate('acme', 'sales', { message: 'salut' });
    const leads = await db.listLeadsByBot('acme', 'sales', { limit: 10, offset: 0 });
    expect(leads.total).toBe(0);
  });

  it('bot inconnu → notFound', async () => {
    const svc = new SimulateService({ chatFn: vi.fn() });
    await expect(svc.simulate('acme', 'ghost', { message: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('un session_id d\'un autre bot est ignoré (nouvelle session)', async () => {
    await upsertBot({ ...botRec, bot_id: 'support', name: 'Support' }, []);
    const svc = new SimulateService({ chatFn: vi.fn().mockResolvedValue('y') });
    const a = await svc.simulate('acme', 'sales', { message: 'm1' });
    const b = await svc.simulate('acme', 'support', { session_id: a.session_id, message: 'm2' });
    expect(b.session_id).not.toBe(a.session_id);
  });
});
```

> `SimulateService` lit le bot via `getDatabase()` (singleton, comme `crm-bridge`), d'où `__setDatabaseForTests(db)`. Le constructeur n'a donc PAS besoin de `db` ; il accède au bot via `getBotConfig`/`getDatabase`. Vérifier l'API : pour lire le system prompt d'un bot, utiliser `getBotConfig(clientId, botId)` du `config-store` (getter sync runtime) OU `getDatabase().getBotRecord(clientId, botId)` (async). Préférer `getDatabase().getBotRecord` pour rester cohérent avec les services. Adapter le test si l'accès au bot impose un autre helper.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/services/__tests__/simulate-service.test.ts`
Expected: FAIL — `SimulateService`/`simulate` absent ou squelette sans logique.

- [ ] **Step 3: Implement `SimulateService`**

Écrire `src/core/services/simulate-service.ts` :

```typescript
import { randomUUID } from 'crypto';
import { chat, type ChatMessage } from '../../llm/anthropic.js';
import { getDatabase } from '../database/index.js';
import { config } from '../config.js';
import { notFound } from '../../api/errors.js';

const SIMULATE_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_TTL_MS = 30 * 60 * 1000;

interface SimSession { key: string; messages: ChatMessage[]; expiresAt: number; }

export interface SimulateServiceDeps {
  chatFn?: typeof chat;
  ttlMs?: number;
  model?: string;
}

export class SimulateService {
  private readonly chatFn: typeof chat;
  private readonly ttlMs: number;
  private readonly model: string;
  private readonly sessions = new Map<string, SimSession>();

  constructor(deps: SimulateServiceDeps = {}) {
    this.chatFn = deps.chatFn ?? chat;
    this.ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
    this.model = deps.model ?? SIMULATE_MODEL;
  }

  private sweep(now: number): void {
    for (const [id, s] of this.sessions) {
      if (s.expiresAt <= now) this.sessions.delete(id);
    }
  }

  async simulate(clientId: string, botId: string, input: { session_id?: string; message: string }): Promise<{ session_id: string; reply: string; model: string }> {
    const rec = await getDatabase().getBotRecord(clientId, botId);
    if (!rec) throw notFound('Bot introuvable.');

    const now = Date.now();
    this.sweep(now);
    const key = `${clientId}/${botId}`;

    let id = input.session_id;
    let session = id ? this.sessions.get(id) : undefined;
    if (!session || session.key !== key || session.expiresAt <= now) {
      id = randomUUID();
      session = { key, messages: [], expiresAt: now + this.ttlMs };
      this.sessions.set(id, session);
    }

    session.messages.push({ role: 'user', content: input.message });

    // system prompt = prompt compilé du bot (fallback langue par défaut), placeholders neutralisés
    const promptByLang = rec.system_prompt as Record<string, string>;
    const rawPrompt = promptByLang[rec.default_language] ?? Object.values(promptByLang)[0] ?? '';
    const basePrompt = rawPrompt
      .replace(/\{\{BASE_URL\}\}/g, config.baseUrl)
      .replace(/\{\{PHONE\}\}/g, 'simulateur');

    const reply = await this.chatFn(
      [{ text: basePrompt, cache: true }],
      session.messages,
      { clientId, botId, model: this.model },
    );

    session.messages.push({ role: 'assistant', content: reply });
    session.expiresAt = now + this.ttlMs;

    return { session_id: id!, reply, model: this.model };
  }
}
```

> Note : `chat()` résout le mode via `resolveLlmCredentials`. Pour un bot `draft` sans config LLM, la résolution renvoie `mode: 'platform'` + clé `.env` → conforme à « platform + Haiku par défaut » (spec §6). On ne force pas explicitement le mode : forcer platform exigerait de modifier `chat()` ; le comportement par défaut (bot non configuré ⇒ platform) couvre le cas d'usage du simulateur (tester avant de configurer sa clé). Si le bot est en `byo` avec une clé valide, le simulateur utilisera cette clé — acceptable et cohérent.

- [ ] **Step 4: Add the contract**

Dans `src/contracts/dashboard.ts`, ajouter :

```typescript
export const SimulateInput = z.object({
  session_id: z.string().optional(),
  message: z.string().min(1).max(4000),
});
export type SimulateInput = z.infer<typeof SimulateInput>;
```

- [ ] **Step 5: Implement the route**

Écrire `src/api/admin/routes/simulate.ts` :

```typescript
import { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import type { SimulateService } from '../../../core/services/simulate-service.js';
import { SimulateInput } from '../../../contracts/index.js';
import { forbidden } from '../../errors.js';

function requireScopedClient(req: Request): string {
  if (!req.scopedClientId) throw forbidden('client_id requis (super_admin : préciser ?client_id).');
  return req.scopedClientId;
}

export function simulateRoutes(svc: SimulateService, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router({ mergeParams: true });
  r.post('/simulate', wrap(async (req, res) => {
    const body = SimulateInput.parse(req.body);
    res.json(await svc.simulate(requireScopedClient(req), String(req.params['botId']), body));
  }));
  return r;
}
```

Dans `src/contracts/index.ts`, `SimulateInput` est déjà ré-exporté via `export * from './dashboard.js'` (Task 4). Vérifier.

- [ ] **Step 6: Wire the route into the router**

Dans `src/api/admin/router.ts`, importer `simulateRoutes` et monter (sous `/bots/:botId`, après dashboard) :

```typescript
  r.use('/bots/:botId', requireAuth, scopeToClient, simulateRoutes(deps.simulateService, wrap));
```

(`AdminRouterDeps.simulateService` et l'instanciation dans `index.ts` ont été ajoutés en Task 3.)

- [ ] **Step 7: Write the route test**

Créer `src/api/admin/__tests__/simulate-routes.test.ts` (réutilise un `build()` local — copier le helper de `dashboard-routes.test.ts` en injectant un `SimulateService` à `chatFn` mocké) :

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import { DashboardService } from '../../../core/services/dashboard-service.js';
import { SimulateService } from '../../../core/services/simulate-service.js';
import type { Mailer } from '../../../core/auth/mailer.js';
import { hashPassword } from '../../../core/auth/passwords.js';
import { createAdminRouter } from '../router.js';

class FakeMailer implements Mailer { async sendInvitation() {} async sendPasswordReset() {} }
const KEY = '0'.repeat(64);
const botRec: BotRecord = { client_id: 'acme', bot_id: 'sales', name: 'Ventes', transport: 'meta-cloud', status: 'draft', default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'p' }, lead_fields: '', welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null };

describe('simulate routes', () => {
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
      dashboardService: new DashboardService({ db, credentials }),
      simulateService: new SimulateService({ chatFn: vi.fn().mockResolvedValue('réponse simulée') as never }),
    }));
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.createUser({ email: 'ca@acme.test', password_hash: await hashPassword('motdepasse123'), role: 'client_admin', client_id: 'acme', status: 'active' });
    await upsertBot(botRec, []);
  });

  it('POST simulate renvoie reply + session_id + model', async () => {
    const tok = (await request(app).post('/api/admin/v1/auth/login').send({ email: 'ca@acme.test', password: 'motdepasse123' })).body.access_token;
    const res = await request(app).post('/api/admin/v1/bots/sales/simulate').set('Authorization', `Bearer ${tok}`).send({ message: 'salut' });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('réponse simulée');
    expect(res.body.session_id).toBeTruthy();
    expect(res.body.model).toBe('claude-haiku-4-5-20251001');
  });

  it('message vide → 400', async () => {
    const tok = (await request(app).post('/api/admin/v1/auth/login').send({ email: 'ca@acme.test', password: 'motdepasse123' })).body.access_token;
    const res = await request(app).post('/api/admin/v1/bots/sales/simulate').set('Authorization', `Bearer ${tok}`).send({ message: '' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 8: Run tests + typecheck**

Run: `npx vitest run src/core/services/__tests__/simulate-service.test.ts src/api/admin/__tests__/simulate-routes.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/core/services/simulate-service.ts src/api/admin/routes/simulate.ts src/api/admin/router.ts src/contracts/dashboard.ts src/core/services/__tests__/simulate-service.test.ts src/api/admin/__tests__/simulate-routes.test.ts
git commit -m "P4c: SimulateService (session ephemere) + endpoint simulate"
```

---

### Task 7: Audit read + mapping client-level (super-admin)

**Files:**
- Create: `src/api/admin/routes/audit.ts`
- Modify: `src/api/admin/router.ts` (montage `/audit`)
- Modify: `src/core/services/connections-service.ts` (mappings client-level)
- Modify: `src/api/admin/routes/clients.ts` (GET/PUT `/:clientId/mappings/:connector`)
- Test: `src/api/admin/__tests__/audit-routes.test.ts`
- Test: `src/api/admin/__tests__/client-mappings-routes.test.ts`

**Interfaces:**
- Consumes : `Database.listAuditLog(clientId, limit?)` (existant → `AuditLogRow[]`), `getMapping(clientId, botId, connector)` / `upsertMapping(clientId, botId, connector, mapping)` de `config-store` (avec `botId = null` pour le client-level), `FieldMappingSchema`, `FieldMapping`.
- Produces :
  - Route `GET /audit` (montée sous `/audit`, `requireAuth` + `scopeToClient`) → `listAuditLog(scopedClientId, 100)`.
  - `ConnectionsService.getClientMapping(clientId, connector): Promise<FieldMapping | null>` → `getMapping(clientId, null, connector)`.
  - `ConnectionsService.putClientMapping(clientId, connector, actorUserId, mapping): Promise<void>` → `upsertMapping(clientId, null, connector, mapping)` + `recordAudit` (`action: 'mapping.client.set'`, `target: client:<clientId>`). Pas de check `getBotRecord` (mapping client-level, pas bot-scope).
  - Routes super-admin dans `clientsRoutes` : `GET /:clientId/mappings/:connector`, `PUT /:clientId/mappings/:connector`.

- [ ] **Step 1: Write the failing audit test**

Créer `src/api/admin/__tests__/audit-routes.test.ts` (réutiliser le `build()` complet, cf. dashboard-routes) :

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import { DashboardService } from '../../../core/services/dashboard-service.js';
import { SimulateService } from '../../../core/services/simulate-service.js';
import type { Mailer } from '../../../core/auth/mailer.js';
import { hashPassword } from '../../../core/auth/passwords.js';
import { createAdminRouter } from '../router.js';

class FakeMailer implements Mailer { async sendInvitation() {} async sendPasswordReset() {} }
const KEY = '0'.repeat(64);
const botRec: BotRecord = { client_id: 'acme', bot_id: 'sales', name: 'Ventes', transport: 'meta-cloud', status: 'draft', default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'p' }, lead_fields: '', welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null };

async function build() {
  process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!';
  process.env['ADMIN_BCRYPT_ROUNDS'] = '4';
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = KEY;
  const db = createSqliteDriver(':memory:'); __setDatabaseForTests(db); resetConfigStore();
  const mailer = new FakeMailer();
  const credentials = new CredentialsService({ db });
  const app = express();
  app.use('/api/admin/v1', createAdminRouter({
    db, authService: new AuthService({ db, mailer }), adminService: new AdminService({ db, mailer }),
    botService: new BotService({ db }), connectionsService: new ConnectionsService({ db, credentials }),
    dashboardService: new DashboardService({ db, credentials }),
    simulateService: new SimulateService({ chatFn: vi.fn() as never }),
  }));
  await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
  await db.createUser({ email: 'ca@acme.test', password_hash: await hashPassword('motdepasse123'), role: 'client_admin', client_id: 'acme', status: 'active' });
  await db.createUser({ email: 'sa@flowlabs.test', password_hash: await hashPassword('motdepasse123'), role: 'super_admin', client_id: null, status: 'active' });
  await upsertBot(botRec, []);
  return { app, db };
}

describe('audit routes', () => {
  it('GET /audit renvoie les mutations du client (créées par une action admin)', async () => {
    const { app } = await build();
    const tok = (await request(app).post('/api/admin/v1/auth/login').send({ email: 'ca@acme.test', password: 'motdepasse123' })).body.access_token;
    // déclenche une mutation auditée
    await request(app).post('/api/admin/v1/bots').set('Authorization', `Bearer ${tok}`).send({ bot_id: 'support', name: 'Support', transport: 'meta-cloud', system_prompt: { fr: 'p' }, welcome: { enabled: false, message: {} } });
    const res = await request(app).get('/api/admin/v1/audit').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((e: { action: string }) => e.action === 'bot.create')).toBe(true);
  });

  it('GET /audit exige l\'auth', async () => {
    const { app } = await build();
    const res = await request(app).get('/api/admin/v1/audit');
    expect(res.status).toBe(401);
  });
});
```

> Vérifier les champs requis exacts de `CreateBotInput` (certaines clés ont des `.default()`), pour que le POST `/bots` réussisse. Adapter le corps si besoin.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/admin/__tests__/audit-routes.test.ts`
Expected: FAIL — route `/audit` 404.

- [ ] **Step 3: Implement the audit route**

Créer `src/api/admin/routes/audit.ts` :

```typescript
import { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import type { Database } from '../../../core/database/types.js';
import { forbidden } from '../../errors.js';

function requireScopedClient(req: Request): string {
  if (!req.scopedClientId) throw forbidden('client_id requis (super_admin : préciser ?client_id).');
  return req.scopedClientId;
}

export function auditRoutes(db: Database, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router();
  r.get('/', wrap(async (req, res) => {
    res.json(await db.listAuditLog(requireScopedClient(req), 100));
  }));
  return r;
}
```

Dans `src/api/admin/router.ts`, importer `auditRoutes` et monter (avant `notFoundHandler`) :

```typescript
  r.use('/audit', requireAuth, scopeToClient, auditRoutes(deps.db, wrap));
```

- [ ] **Step 4: Write the failing client-mapping test**

Créer `src/api/admin/__tests__/client-mappings-routes.test.ts` (réutiliser `build()` ci-dessus — copier le helper) avec un mapping valide minimal conforme à `FieldMappingSchema` :

```typescript
// ... mêmes imports + build() que audit-routes.test.ts ...

const VALID_MAPPING = {
  version: '1',
  target_object: 'contact',
  field_mapping: [{ source: 'name', target: 'firstname' }],
  fixed_values: {},
  default_values: {},
  fallback: {},
  deduplication: { strategy: 'email' },
};

describe('client-level mappings (super-admin)', () => {
  it('PUT puis GET /clients/:id/mappings/:connector', async () => {
    const { app } = await build();
    const sa = (await request(app).post('/api/admin/v1/auth/login').send({ email: 'sa@flowlabs.test', password: 'motdepasse123' })).body.access_token;
    const put = await request(app).put('/api/admin/v1/clients/acme/mappings/hubspot').set('Authorization', `Bearer ${sa}`).send(VALID_MAPPING);
    expect(put.status).toBe(204);
    const get = await request(app).get('/api/admin/v1/clients/acme/mappings/hubspot').set('Authorization', `Bearer ${sa}`);
    expect(get.status).toBe(200);
    expect(get.body.target_object).toBe('contact');
  });

  it('client_admin interdit (super-admin only)', async () => {
    const { app } = await build();
    const ca = (await request(app).post('/api/admin/v1/auth/login').send({ email: 'ca@acme.test', password: 'motdepasse123' })).body.access_token;
    const res = await request(app).get('/api/admin/v1/clients/acme/mappings/hubspot').set('Authorization', `Bearer ${ca}`);
    expect(res.status).toBe(403);
  });
});
```

> Le corps exact de `VALID_MAPPING` doit satisfaire `FieldMappingSchema` (voir `src/contracts/connections.ts`). Vérifier les champs requis réels et ajuster ; l'objectif est un mapping qui parse.

- [ ] **Step 5: Add service methods for client-level mappings**

Dans `src/core/services/connections-service.ts`, ajouter (section Mappings) :

```typescript
  async getClientMapping(clientId: string, connector: string): Promise<FieldMapping | null> {
    return getMapping(clientId, null, connector);
  }

  async putClientMapping(clientId: string, connector: string, actorUserId: number | null, mapping: FieldMapping): Promise<void> {
    await upsertMapping(clientId, null, connector, mapping);
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'mapping.client.set', target: `client:${clientId}`, client_id: clientId, metadata: { connector } });
  }
```

> `getMapping(clientId, botId, connector)` accepte déjà `botId: string | null` (résolution bot→client). Vérifier la signature dans `config-store.ts` ; si `botId` n'est pas nullable, l'élargir à `string | null`.

- [ ] **Step 6: Add the super-admin routes**

Dans `src/api/admin/routes/clients.ts`, le routeur est déjà gardé par `requireAuth, requireRole('super_admin')`. Il faut accéder au `ConnectionsService` : étendre la signature `clientsRoutes(adminService, connectionsService, wrap)`.

Modifier la factory :

```typescript
import type { ConnectionsService } from '../../../core/services/connections-service.js';
import { FieldMappingSchema } from '../../../contracts/index.js';
import { notFound } from '../../errors.js';

export function clientsRoutes(adminService: AdminService, connectionsService: ConnectionsService, wrap: (fn: RequestHandler) => RequestHandler): Router {
```

et ajouter avant `return r;` :

```typescript
  r.get('/:clientId/mappings/:connector', wrap(async (req, res) => {
    const m = await connectionsService.getClientMapping(String(req.params['clientId']), String(req.params['connector']));
    if (!m) throw notFound('Mapping client introuvable.');
    res.json(m);
  }));
  r.put('/:clientId/mappings/:connector', wrap(async (req, res) => {
    const mapping = FieldMappingSchema.parse(req.body);
    await connectionsService.putClientMapping(String(req.params['clientId']), String(req.params['connector']), req.auth!.userId, mapping);
    res.sendStatus(204);
  }));
```

Dans `src/api/admin/router.ts`, mettre à jour l'appel :

```typescript
  r.use('/clients', clientsRoutes(deps.adminService, deps.connectionsService, wrap));
```

> Mettre à jour aussi les tests existants `clients-routes.test.ts` qui appellent `createAdminRouter` (ils passent déjà `connectionsService` dans les deps si on réutilise `createAdminRouter` ; sinon, vérifier qu'ils ne cassent pas). Comme `createAdminRouter` reçoit `deps.connectionsService`, aucune signature de test externe ne change.

- [ ] **Step 7: Run tests + typecheck**

Run: `npx vitest run src/api/admin/__tests__/audit-routes.test.ts src/api/admin/__tests__/client-mappings-routes.test.ts src/api/admin/__tests__/clients-routes.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/api/admin/routes/audit.ts src/api/admin/router.ts src/core/services/connections-service.ts src/api/admin/routes/clients.ts src/api/admin/__tests__/audit-routes.test.ts src/api/admin/__tests__/client-mappings-routes.test.ts
git commit -m "P4c: lecture audit_log + mapping client-level (super-admin)"
```

---

### Task 8: Suite complète + revue de cohérence

**Files:**
- (aucune création) — exécution et corrections éventuelles.

- [ ] **Step 1: Run the whole suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, tsc propre. Corriger toute régression (notamment les tests admin existants si `createAdminRouter`/`clientsRoutes` ont changé de signature).

- [ ] **Step 2: Lint conventions**

Vérifier qu'aucune fixture/identifiant n'utilise une thématique démo (golf, immo, voyage, auto, acquisition) :

Run: `grep -rniE "golf|immo|voyage|acquisition" src/ | grep -viE "node_modules" || echo "OK aucune thematique demo"`
Expected: `OK aucune thematique demo` (le mot « auto » seul reste autorisé s'il s'agit d'un champ d'API CM.com, pas d'une donnée d'exemple).

- [ ] **Step 3: Commit (si corrections)**

```bash
git add -A
git commit -m "P4c: corrections suite complete + conventions"
```

---

## Self-Review

**1. Spec coverage (§6 endpoints + §8/§9 dashboard) :**
- `bots/:botId/simulate` → Task 6. ✓
- `bots/:botId/leads` (paginé/filtré) → Task 4. ✓
- `.../leads/:phone` (+ conversation) → Task 4 (transcript via `getRecentHistory`). ✓
- `:botId/health` → Task 3 (chips WhatsApp/CRM/LLM/langues + dernière erreur CRM). ✓
- `:botId/metrics` → Task 5. ✓
- `:botId/usage` (lecture `llm_usage`) → Task 5. ✓
- `audit_log` lecture → Task 7. ✓
- `clients/:id/mappings/:connector` (super-admin) → Task 7. ✓
- §9 « dernière erreur de push CRM stockée par bot + affichée dans la santé » → Tasks 1+2+3. ✓
- §6 « secrets jamais renvoyés » → health/credentials réutilisent `getMasked` (Task 3). ✓
- Différé explicitement (hors scope 4c, décidé) : `validate()` des connecteurs non-HubSpot ; `bots/:botId/test/session` (lien wa.me/QR — non bloquant, relève de l'app Next.js Plan 7). ✓

**2. Placeholder scan :** chaque step de code porte le code complet. Les rares « vérifier la signature réelle » concernent des points où l'implémenteur DOIT lire le fichier voisin (API existante) — ce sont des consignes de vérification, pas des trous de spec. Aucun `TODO`/`TBD` fonctionnel.

**3. Type consistency :**
- `BotRuntimeStateRecord` étendu en Task 1, lu en Task 3 (`last_crm_error`/`last_crm_error_at`). ✓
- `LeadRow` réutilisé tel quel (Tasks 4) ; `LeadListResult` défini Task 4, consommé Task 4. ✓
- `BotMetrics` défini Task 5, consommé Task 5. ✓
- `SimulateServiceDeps` tous champs optionnels → `new SimulateService({})` (Task 3) ET `new SimulateService({ chatFn })` (Task 6) compilent. ✓
- `AdminRouterDeps` gagne `dashboardService` + `simulateService` en Task 3 ; toutes les constructions de test/`index.ts` les fournissent. ✓
- `chat` signature `(SystemPromptPart[]|string, ChatMessage[], { clientId, botId, model? })` respectée en Task 6. ✓
- `clientsRoutes` change de signature en Task 7 (ajout `connectionsService`) ; seul `router.ts` l'appelle → mis à jour même task. ✓

**Note de séquencement pour le contrôleur :** Task 3 introduit `dashboardService` ET `simulateService` dans `AdminRouterDeps` + `index.ts`. Pour que Task 3 compile avant Task 6, créer en Task 3 un `simulate-service.ts` minimal (`SimulateServiceDeps` tous optionnels, `simulate()` stub renvoyant `{ session_id, reply: '', model }`) et un `routes/simulate.ts` minimal ; Task 6 remplace les deux par la version complète + tests. C'est explicitement prévu dans les deux tasks.
