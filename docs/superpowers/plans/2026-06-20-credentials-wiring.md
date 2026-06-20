# Branchement du resolver de credentials — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire consommer par le moteur (LLM, transport, CRM) les credentials résolus par tenant via `src/core/credentials/resolver.ts`, au lieu de lire `config.*` en dur, avec fallback `.env` pour ne rien casser.

**Architecture:** Trois points d'instanciation sont rebranchés sur le resolver : `anthropic.ts` (client Anthropic par tenant, mis en cache par apiKey résolue), `transport/index.ts` (`getTransportForBot` async, cache rekeyé par `(client_id, bot_id, transportId)`, + réordonnancement du webhook pour résoudre le bot AVANT la vérif HMAC), `crm-bridge.ts` (init async, résolution par tenant, câblage de tous les connecteurs construits). Fallback `config.*` partout où le resolver ne renvoie rien.

**Tech Stack:** TypeScript (ESM, strict), `@anthropic-ai/sdk`, Express, Vitest (avec `vi.mock`).

## Global Constraints

- TypeScript strict : pas de `any`, `const` par défaut.
- Logs : format `[Service] message`, sans emoji.
- Aucun secret en clair dans les logs.
- Compatibilité ascendante : sans enregistrement DB, fallback `config.*` / `.env`.
- Signatures du resolver (existantes) : `resolveLlmCredentials(clientId: string, botId: string | null): Promise<{ apiKey: string; quotaContext?: unknown }>` ; `resolveTransportCredentials(clientId: string, botId: string | null, provider: string): Promise<Record<string, string>>` ; `resolveCrmCredentials(clientId: string, provider: string): Promise<Record<string, string>>`.
- Tests Vitest. Auteur git : `Francois Greze <francois@cyran.fr>`. Pas de signature Claude.
- Les 98 tests existants doivent rester verts ; `npx tsc --noEmit` propre après chaque tâche.

---

## File Structure

- `src/llm/anthropic.ts` (modifier) — supprime le singleton `client`, ajoute `getClientForTenant`, change la signature de `chat`.
- `src/core/handler.ts` (modifier) — câble `getClientForTenant` (extraction) et la nouvelle signature de `chat` ; `await getTransportForBot`.
- `src/llm/__tests__/anthropic.test.ts` (créer) — cache par apiKey, throw si clé vide, `chat` résout le bon client (SDK + resolver mockés).
- `src/transport/index.ts` (modifier) — `getTransportForBot` async, cache rekeyé, mapping blob→options, fallback config.
- `src/transport/__tests__/index.test.ts` (créer) — résolution + fallback + cache (resolver + factories mockés).
- `src/core/admin.ts` (modifier) — `await getTransportForBot`.
- `src/index.ts` (modifier) — réordonnancement de `handleIncomingWebhook` ; `await initCrmBridge()`.
- `src/core/crm-bridge.ts` (modifier) — `initCrmBridge` async, `instantiateConnector` async + exporté, résolution par tenant, câblage de tous les connecteurs.
- `src/core/__tests__/crm-bridge.test.ts` (créer) — instanciation par resolver + fallback + mad-crm throw (resolver mocké).
- `docs/ROADMAP.md` (modifier) — marquer le câblage runtime livré.

---

## Task 1: LLM — client Anthropic par tenant

**Files:**
- Modify: `src/llm/anthropic.ts`
- Modify: `src/core/handler.ts`
- Test: `src/llm/__tests__/anthropic.test.ts`

**Interfaces:**
- Consumes: `resolveLlmCredentials(clientId, botId)` (resolver existant).
- Produces:
  - `getClientForTenant(clientId: string, botId: string | null): Promise<Anthropic>`
  - `chat(systemPromptParts: SystemPromptPart[] | string, messages: ChatMessage[], opts: { clientId: string; botId: string | null; model?: string }): Promise<string>`

- [ ] **Step 1: Write the failing test**

Créer `src/llm/__tests__/anthropic.test.ts` :

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock du SDK Anthropic : enregistre les apiKey construites, messages.create renvoie un texte.
const constructedKeys: string[] = [];
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    apiKey: string;
    messages = { create: vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }], usage: {} })) };
    constructor(opts: { apiKey: string }) {
      this.apiKey = opts.apiKey;
      constructedKeys.push(opts.apiKey);
    }
  },
}));

// Mock du resolver : clé par client.
vi.mock('../../core/credentials/resolver.js', () => ({
  resolveLlmCredentials: vi.fn(async (clientId: string) => ({
    apiKey: clientId === 'empty' ? '' : `sk-${clientId}`,
  })),
}));

import { getClientForTenant, chat } from '../anthropic.js';

describe('anthropic per-tenant', () => {
  beforeEach(() => {
    constructedKeys.length = 0;
  });
  afterEach(() => vi.clearAllMocks());

  it('résout et met en cache par apiKey', async () => {
    const a = await getClientForTenant('c1', null);
    const b = await getClientForTenant('c1', null);
    expect(a).toBe(b); // même instance (cache)
    expect(constructedKeys.filter((k) => k === 'sk-c1')).toHaveLength(1);
  });

  it('deux clés distinctes -> deux clients distincts', async () => {
    const a = await getClientForTenant('c1', null);
    const b = await getClientForTenant('c2', null);
    expect(a).not.toBe(b);
  });

  it('apiKey vide -> erreur explicite', async () => {
    await expect(getClientForTenant('empty', null)).rejects.toThrow(/\[LLM\]/);
  });

  it('chat utilise le client résolu et renvoie le texte', async () => {
    const out = await chat('sys', [{ role: 'user', content: 'hi' }], { clientId: 'c3', botId: null });
    expect(out).toBe('ok');
    expect(constructedKeys).toContain('sk-c3');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/llm/__tests__/anthropic.test.ts`
Expected: FAIL — `getClientForTenant` n'est pas exporté / `chat` signature.

- [ ] **Step 3: Modify `anthropic.ts`**

Dans `src/llm/anthropic.ts` :

a) Remplacer les imports en tête (retirer `config`, ajouter le resolver) :

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { resolveLlmCredentials } from '../core/credentials/resolver.js';
```

b) Supprimer la ligne du singleton :

```typescript
export const client = new Anthropic({ apiKey: config.anthropic.apiKey, timeout: 60000 });
```

et la remplacer par le cache + la factory par tenant :

```typescript
// Cache des clients Anthropic par apiKey résolue : deux tenants BYO avec la même
// clé partagent un client ; des clés distinctes -> pools de rate limit isolés.
const clientCache = new Map<string, Anthropic>();

export async function getClientForTenant(clientId: string, botId: string | null): Promise<Anthropic> {
  const { apiKey } = await resolveLlmCredentials(clientId, botId);
  if (!apiKey) {
    throw new Error(`[LLM] No API key resolved for client ${clientId} (bot=${botId ?? '-'})`);
  }
  const cached = clientCache.get(apiKey);
  if (cached) return cached;
  const created = new Anthropic({ apiKey, timeout: 60000 });
  clientCache.set(apiKey, created);
  return created;
}
```

c) Changer la signature de `chat` et résoudre le client en interne. Remplacer l'en-tête de `chat` :

```typescript
export async function chat(
  systemPromptParts: SystemPromptPart[] | string,
  messages: ChatMessage[],
  opts: { clientId: string; botId: string | null; model?: string }
): Promise<string> {
  const client = await getClientForTenant(opts.clientId, opts.botId);
```

et, dans le corps de `chat`, remplacer `const plan = buildModelPlan(modelOverride);` par :

```typescript
  const plan = buildModelPlan(opts.model);
```

Le reste de `chat` (boucle de cascade utilisant `client.messages.create`, prompt caching, fallback) est inchangé.

- [ ] **Step 4: Update `handler.ts`**

Dans `src/core/handler.ts` :

a) Ligne 4, remplacer l'import :

```typescript
import { chat, withRetry, getClientForTenant } from '../llm/anthropic.js';
```

b) Dans `extractAndSaveLead`, juste avant `const response = await llmLimit(...)` (ligne ~33), ajouter la résolution du client, et utiliser ce `client` local :

```typescript
  const client = await getClientForTenant(botCfg.client_id, botCfg.bot_id);
  const response = await llmLimit(() =>
    withRetry(() =>
      client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      })
    )
  );
```

c) Dans `handleMessage`, remplacer l'appel `chat(...)` (ligne ~451) :

```typescript
    const chatModel = botCfg.llm?.model;
    const rawResponse = await llmLimit(() =>
      chat(
        [
          { text: basePrompt, cache: true },
          ...dynamicParts,
        ],
        messages,
        { clientId: botCfg.client_id, botId: botCfg.bot_id, model: chatModel }
      )
    );
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/llm/__tests__/anthropic.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: typecheck propre ; tous les tests verts (102).

- [ ] **Step 7: Commit**

```bash
git add src/llm/anthropic.ts src/core/handler.ts src/llm/__tests__/anthropic.test.ts
git -c user.name="Francois Greze" -c user.email="francois@cyran.fr" commit -m "P3: client Anthropic resolu par tenant (getClientForTenant + chat)"
```

---

## Task 2: Transport par tenant + réordonnancement du webhook

**Files:**
- Modify: `src/transport/index.ts`
- Modify: `src/core/handler.ts` (2 appels)
- Modify: `src/core/admin.ts` (1 appel)
- Modify: `src/index.ts` (`handleIncomingWebhook`)
- Test: `src/transport/__tests__/index.test.ts`

**Interfaces:**
- Consumes: `resolveTransportCredentials(clientId, botId, provider)` ; `createMetaCloudTransport({ phoneNumberId, accessToken, appSecret })` ; `createCmComTransport(opts?)`.
- Produces: `getTransportForBot(bot: BotConfig): Promise<Transport>` (désormais async). `getTransport(id: TransportId): Transport` reste synchrone (parse webhook / listing).

- [ ] **Step 1: Write the failing test**

Créer `src/transport/__tests__/index.test.ts` :

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BotConfig } from '../../core/bot-config.js';

vi.mock('../../core/credentials/resolver.js', () => ({
  resolveTransportCredentials: vi.fn(),
}));
vi.mock('../meta-cloud.js', () => ({
  createMetaCloudTransport: vi.fn((opts: unknown) => ({ kind: 'meta', opts })),
}));
vi.mock('../cm-com.js', () => ({
  createCmComTransport: vi.fn((opts: unknown) => ({ kind: 'cm', opts })),
}));

import { getTransportForBot } from '../index.js';
import { resolveTransportCredentials } from '../../core/credentials/resolver.js';
import { createMetaCloudTransport } from '../meta-cloud.js';

const resolveMock = vi.mocked(resolveTransportCredentials);
const metaFactory = vi.mocked(createMetaCloudTransport);

function bot(overrides: Partial<BotConfig> = {}): BotConfig {
  return { client_id: 'c1', bot_id: 'b1', transport: 'meta-cloud', ...overrides } as BotConfig;
}

describe('getTransportForBot', () => {
  beforeEach(() => {
    vi.stubEnv('META_PHONE_NUMBER_ID', 'env-pid');
    vi.stubEnv('META_ACCESS_TOKEN', 'env-tok');
    vi.stubEnv('META_APP_SECRET', 'env-sec');
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('instancie meta-cloud avec les credentials résolus', async () => {
    resolveMock.mockResolvedValue({ phone_number_id: 'p', access_token: 'a', app_secret: 's' });
    const t = await getTransportForBot(bot({ bot_id: 'resolved' })) as { opts: unknown };
    expect(t.opts).toEqual({ phoneNumberId: 'p', accessToken: 'a', appSecret: 's' });
  });

  it('fallback config quand le resolver renvoie {}', async () => {
    resolveMock.mockResolvedValue({});
    const t = await getTransportForBot(bot({ bot_id: 'fallback' })) as { opts: unknown };
    expect(t.opts).toEqual({ phoneNumberId: 'env-pid', accessToken: 'env-tok', appSecret: 'env-sec' });
  });

  it('cache rekeyé par (client_id, bot_id, transport)', async () => {
    resolveMock.mockResolvedValue({ phone_number_id: 'p', access_token: 'a', app_secret: 's' });
    const a1 = await getTransportForBot(bot({ bot_id: 'same' }));
    const a2 = await getTransportForBot(bot({ bot_id: 'same' }));
    expect(a1).toBe(a2); // cache
    await getTransportForBot(bot({ bot_id: 'other' }));
    expect(metaFactory).toHaveBeenCalledTimes(2); // 'same' (1x) + 'other' (1x)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/transport/__tests__/index.test.ts`
Expected: FAIL — `getTransportForBot` n'est pas async / signature.

- [ ] **Step 3: Convertir `config.meta` et `config.cm` en getters live**

`config.meta.*` et `config.cm.*` sont aujourd'hui figés à l'import, ce qui empêche un fallback testable (`vi.stubEnv` n'a aucun effet) et toute relecture d'env. Les convertir en getters (même patron que `config.credentials.encryptionKey`, déjà en place). Dans `src/core/config.ts`, remplacer les blocs `cm:` et `meta:` :

```typescript
  cm: {
    get productToken(): string { return process.env['CM_PRODUCT_TOKEN'] || ''; },
    get serviceUrl(): string { return process.env['CM_SERVICE_URL'] || 'https://gw.cmtelecom.com/v1.0/message'; },
    get fromNumber(): string { return process.env['CM_FROM_NUMBER'] || ''; },
  },
  meta: {
    get phoneNumberId(): string { return process.env['META_PHONE_NUMBER_ID'] || ''; },
    get accessToken(): string { return process.env['META_ACCESS_TOKEN'] || ''; },
    get appSecret(): string { return process.env['META_APP_SECRET'] || ''; },
    get verifyToken(): string { return process.env['META_VERIFY_TOKEN'] || ''; },
  },
```

(Les autres champs de `config` restent inchangés. L'objet `config` reste `as const` — les getters sont compatibles.)

- [ ] **Step 4: Rewrite `transport/index.ts`**

Remplacer le contenu de `src/transport/index.ts` par :

```typescript
/**
 * Factory de transport — instancie le bon driver selon la config bot.
 *
 * Les credentials de transport sont résolus par tenant (resolveTransportCredentials).
 * Fallback config global (.env) quand aucun enregistrement n'existe.
 */

import { config } from '../core/config.js';
import type { BotConfig } from '../core/bot-config.js';
import type { Transport } from './types.js';
import { createCmComTransport } from './cm-com.js';
import { createMetaCloudTransport } from './meta-cloud.js';
import { resolveTransportCredentials } from '../core/credentials/resolver.js';

export type TransportId = 'cm-com' | 'meta-cloud';

// Cache global (config-based), utilisé pour le parse de webhook et le listing.
const cache = new Map<TransportId, Transport>();
// Cache par tenant : clé `${client_id}:${bot_id}:${transportId}`.
const tenantCache = new Map<string, Transport>();

export function getTransport(id: TransportId): Transport {
  const cached = cache.get(id);
  if (cached) return cached;

  let transport: Transport;
  if (id === 'cm-com') {
    transport = createCmComTransport();
  } else if (id === 'meta-cloud') {
    transport = createMetaCloudTransport({
      phoneNumberId: config.meta.phoneNumberId,
      accessToken: config.meta.accessToken,
      appSecret: config.meta.appSecret,
    });
  } else {
    throw new Error(`[Transport] Unknown transport id: ${id}`);
  }

  cache.set(id, transport);
  return transport;
}

export async function getTransportForBot(bot: BotConfig): Promise<Transport> {
  const id = bot.transport as TransportId;
  const key = `${bot.client_id}:${bot.bot_id}:${id}`;
  const cached = tenantCache.get(key);
  if (cached) return cached;

  const creds = await resolveTransportCredentials(bot.client_id, bot.bot_id, id);
  const hasCreds = Object.keys(creds).length > 0;

  let transport: Transport;
  if (id === 'cm-com') {
    transport = hasCreds
      ? createCmComTransport({
          productToken: creds['product_token'],
          fromNumber: creds['from_number'],
          serviceUrl: creds['service_url'],
        })
      : createCmComTransport();
  } else if (id === 'meta-cloud') {
    transport = createMetaCloudTransport(
      hasCreds
        ? {
            phoneNumberId: creds['phone_number_id'] ?? '',
            accessToken: creds['access_token'] ?? '',
            appSecret: creds['app_secret'] ?? '',
          }
        : {
            phoneNumberId: config.meta.phoneNumberId,
            accessToken: config.meta.accessToken,
            appSecret: config.meta.appSecret,
          }
    );
  } else {
    throw new Error(`[Transport] Unknown transport id: ${id}`);
  }

  tenantCache.set(key, transport);
  return transport;
}

export function listConfiguredTransports(): TransportId[] {
  const ids: TransportId[] = [];
  if (config.cm.productToken && config.cm.fromNumber) ids.push('cm-com');
  if (config.meta.phoneNumberId && config.meta.accessToken) ids.push('meta-cloud');
  return ids;
}

export type { Transport, IncomingMessage } from './types.js';
```

> Note : `createCmComTransport(opts?)` applique déjà un fallback `config.cm.*` clé par clé pour les valeurs `undefined`, donc passer un objet partiel est sûr.

- [ ] **Step 5: Run transport test to verify it passes**

Run: `npx vitest run src/transport/__tests__/index.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Await dans `handler.ts` et `admin.ts`**

Dans `src/core/handler.ts`, les deux occurrences (`handleMessage` ligne ~380, `handleWelcome` ligne ~509) :

```typescript
  const transport = await getTransportForBot(botCfg);
```

Dans `src/core/admin.ts` (ligne ~33) :

```typescript
  const transport = await getTransportForBot(currentBot);
```

- [ ] **Step 7: Réordonner `handleIncomingWebhook` dans `index.ts`**

Dans `src/index.ts`, remplacer le corps de `handleIncomingWebhook` (de `res.sendStatus(200);` jusqu'à la fin de la fonction) par la version réordonnée — parse → route → résolution transport du bot → vérif HMAC :

```typescript
  res.sendStatus(200);

  // Parse de structure (sans secret) pour obtenir le numéro destinataire et router.
  const parser = getTransport(transportId);
  const message = parser.parseWebhookPayload(req.body);
  if (!message) return;

  const route = await routeIncomingMessage(message.phone, message.toNumber);
  if (!route) {
    console.warn(`[Webhook/${transportId}] No bot configured for ${message.toNumber}, ignoring`);
    return;
  }

  if (route.config.transport !== transportId) {
    console.warn(`[Webhook/${transportId}] Bot ${route.client_id}/${route.bot_id} expects transport=${route.config.transport}, but webhook came from ${transportId}. Ignoring.`);
    return;
  }

  // Transport du bot (app_secret par tenant) -> vérification HMAC.
  const transport = await getTransportForBot(route.config);
  if (transport.verifyWebhookSignature && req.rawBody) {
    const ok = transport.verifyWebhookSignature(req.rawBody, req.headers as Record<string, string | string[] | undefined>);
    if (!ok) {
      console.warn(`[Webhook/${transportId}] Invalid HMAC signature, ignoring`);
      return;
    }
  }

  console.log(`[Webhook/${transportId}] Incoming from ${message.phone} -> ${message.toNumber}: ${message.text.slice(0, 80)}`);

  if (await isMessageProcessed(message.messageId)) {
    console.log(`[Webhook/${transportId}] Duplicate ignored: ${message.messageId}`);
    return;
  }

  if (message.text === '[audio]') {
    transport.sendText(message.phone, 'Les messages vocaux ne sont pas encore supportés. Écrivez-moi votre réponse.').catch(() => {});
    return;
  }

  if (message.text === '[message non-texte]') {
    transport.sendText(message.phone, 'Je ne peux traiter que les messages texte. Écrivez-moi votre question.').catch(() => {});
    return;
  }

  const handled = await handleControlCommand(message.phone, message.text, route.client_id, route.bot_id).catch((err) => {
    console.error('[Admin] Command error:', err);
    return false;
  });
  if (handled) return;

  if (route.is_new_session && route.config.welcome.enabled) {
    withPhoneLock(message.phone, () =>
      handleWelcome(message.phone, route.config, message.messageId, message.profileName).catch((err) => {
        console.error('[Welcome] Error:', err);
      })
    );
    return;
  }

  withPhoneLock(message.phone, () =>
    handleMessage(message.phone, message.text, route.config, message.messageId, message.profileName).catch((err) => {
      console.error('[Webhook] Handler error:', err);
    })
  );
```

> Couverture : la résolution des credentials transport est testée unitairement (Step 1) ; le réordonnancement de `index.ts` est vérifié par le typecheck et la revue de branche finale (le serveur Express n'a pas de harnais de test unitaire dans ce repo — pas de gap silencieux : c'est un choix de périmètre explicite).

- [ ] **Step 8: Typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: typecheck propre ; tous les tests verts (105).

- [ ] **Step 9: Commit**

```bash
git add src/core/config.ts src/transport/index.ts src/transport/__tests__/index.test.ts src/core/handler.ts src/core/admin.ts src/index.ts
git -c user.name="Francois Greze" -c user.email="francois@cyran.fr" commit -m "P3: transport resolu par tenant + bot resolu avant verif HMAC"
```

---

## Task 3: CRM bridge par tenant + câblage de tous les connecteurs

**Files:**
- Modify: `src/core/crm-bridge.ts`
- Modify: `src/index.ts` (`await initCrmBridge()`)
- Modify: `docs/ROADMAP.md`
- Test: `src/core/__tests__/crm-bridge.test.ts`

**Interfaces:**
- Consumes: `resolveCrmCredentials(clientId, provider)` ; `createConnector({ type, credentials })`.
- Produces: `initCrmBridge(): Promise<void>` (async) ; `instantiateConnector(bot: BotConfig): Promise<CRMConnector>` (async + exporté).

- [ ] **Step 1: Write the failing test**

Créer `src/core/__tests__/crm-bridge.test.ts` :

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BotConfig } from '../bot-config.js';

vi.mock('../credentials/resolver.js', () => ({
  resolveCrmCredentials: vi.fn(),
}));

import { instantiateConnector } from '../crm-bridge.js';
import { resolveCrmCredentials } from '../credentials/resolver.js';

const resolveMock = vi.mocked(resolveCrmCredentials);

// client_id 'default' : loadMappingConfig (appelé par les constructeurs hubspot/pipedrive)
// ne retombe PAS sur 'default' automatiquement ; il exige connectors-config/{clientId}/{type}.json.
// Seul 'default' possède des mappings dans le repo, donc on l'utilise ici.
function bot(connector: string): BotConfig {
  return { client_id: 'default', bot_id: 'b1', crm: { connector } } as unknown as BotConfig;
}

describe('instantiateConnector', () => {
  beforeEach(() => vi.stubEnv('HUBSPOT_TOKEN', 'pat-env'));
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('hubspot via credentials résolus', async () => {
    resolveMock.mockResolvedValue({ access_token: 'pat-resolved' });
    const c = await instantiateConnector(bot('hubspot'));
    expect(c.connectorName).toBe('hubspot');
  });

  it('hubspot fallback config quand resolver vide', async () => {
    resolveMock.mockResolvedValue({});
    const c = await instantiateConnector(bot('hubspot'));
    expect(c.connectorName).toBe('hubspot');
  });

  it('pipedrive via credentials résolus', async () => {
    resolveMock.mockResolvedValue({ api_token: 'pd-token' });
    const c = await instantiateConnector(bot('pipedrive'));
    expect(c.connectorName).toBe('pipedrive');
  });

  it('mad-crm throw sans dépendre du resolver', async () => {
    resolveMock.mockResolvedValue({});
    await expect(instantiateConnector(bot('mad-crm'))).rejects.toThrow(/mad-crm/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/__tests__/crm-bridge.test.ts`
Expected: FAIL — `instantiateConnector` non exporté / non async.

- [ ] **Step 3: Convertir `config.hubspot` en getter live**

Même raison qu'en Task 2 (testabilité du fallback + relecture d'env). Dans `src/core/config.ts`, remplacer le bloc `hubspot:` :

```typescript
  hubspot: {
    get accessToken(): string { return process.env['HUBSPOT_TOKEN'] || ''; },
    get clientSecret(): string { return process.env['HUBSPOT_SECRET'] || ''; },
  },
```

- [ ] **Step 4: Rewrite `crm-bridge.ts` instanciation**

Dans `src/core/crm-bridge.ts` :

a) Ajouter l'import du resolver après les imports existants :

```typescript
import { resolveCrmCredentials } from './credentials/resolver.js';
```

b) Rendre `initCrmBridge` async et awaiter l'instanciation. Remplacer la signature et la boucle :

```typescript
export async function initCrmBridge(): Promise<void> {
  if (initialized) {
    console.warn('[CrmBridge] Already initialized, skipping');
    return;
  }

  const bots = listBots();
  for (const bot of bots) {
    if (!bot.crm?.connector) continue;

    try {
      const connector = await instantiateConnector(bot);
      entries.push({
        client_id: bot.client_id,
        bot_id: bot.bot_id,
        connector,
      });
      console.log(`[CrmBridge] Bound ${bot.client_id}/${bot.bot_id} -> ${bot.crm.connector}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[CrmBridge] Failed to bind ${bot.client_id}/${bot.bot_id} -> ${bot.crm.connector}: ${message}`);
    }
  }
```

(le reste de `initCrmBridge`, à partir de `if (entries.length === 0)`, est inchangé.)

c) Remplacer entièrement la fonction `instantiateConnector` par la version async + exportée + multi-connecteurs :

```typescript
/**
 * Instancie un connecteur avec les credentials résolus par tenant
 * (resolveCrmCredentials), fallback config global (.env) pour hubspot.
 * mad-crm reste un stub : il ne doit pas bloquer le bridge.
 */
export async function instantiateConnector(bot: BotConfig): Promise<CRMConnector> {
  const connectorType = bot.crm!.connector;

  if (connectorType === 'mad-crm') {
    throw new Error('mad-crm connector pending API access (skeleton only, see src/connectors/mad-crm.ts)');
  }

  const resolved = await resolveCrmCredentials(bot.client_id, connectorType);
  let credentials: Record<string, string> = resolved;

  // Fallback config pour hubspot (rétrocompat avec le câblage P1).
  if (Object.keys(resolved).length === 0 && connectorType === 'hubspot') {
    if (!config.hubspot.accessToken) {
      throw new Error('HUBSPOT_TOKEN env var is missing and no DB credential found');
    }
    credentials = { access_token: config.hubspot.accessToken };
  }

  // hubspot a besoin du client_id pour la déduplication par tenant.
  if (connectorType === 'hubspot') {
    credentials = { ...credentials, client_id: bot.client_id };
  }

  switch (connectorType) {
    case 'hubspot':
    case 'attio':
    case 'pipedrive':
    case 'salesforce':
    case 'zoho':
    case 'webhook-generic':
      return createConnector({ type: connectorType, credentials });
    default:
      throw new Error(`Unknown CRM connector type: ${connectorType}`);
  }
}
```

- [ ] **Step 5: `await initCrmBridge()` dans `index.ts`**

Dans `src/index.ts`, fonction `main()`, remplacer `initCrmBridge();` par :

```typescript
  await initCrmBridge();
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/core/__tests__/crm-bridge.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Update ROADMAP**

Dans `docs/ROADMAP.md`, remplacer la ligne P2 du câblage credentials (commençant par `- [~] Externaliser les credentials Meta`) par :

```markdown
- [x] Externaliser les credentials Meta : passage de `.env` → DB par tenant (chiffrés) *(fondation P3 + câblage runtime livrés : resolver consommé par LLM (`getClientForTenant`), transport (`getTransportForBot` async, bot résolu avant vérif HMAC) et CRM (`initCrmBridge` async, tous connecteurs câblés). Fallback `.env` conservé.)*
```

- [ ] **Step 8: Typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: typecheck propre ; tous les tests verts (109).

- [ ] **Step 9: Commit**

```bash
git add src/core/config.ts src/core/crm-bridge.ts src/index.ts src/core/__tests__/crm-bridge.test.ts docs/ROADMAP.md
git -c user.name="Francois Greze" -c user.email="francois@cyran.fr" commit -m "P3: crm-bridge resolu par tenant + cablage de tous les connecteurs"
```

---

## Suite (hors ce plan)

- Seed des credentials des connecteurs autres que hubspot/meta/anthropic (via upsert ou UI P3).
- Vérification HMAC par-app distincte à l'abonnement (GET) si plusieurs apps Meta.
- Pool multi-clés plateforme / quotas LLM (item résilience ; `quotaContext` déjà réservé).
