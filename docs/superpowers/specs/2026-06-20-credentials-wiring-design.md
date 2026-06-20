# Design — Branchement du resolver de credentials dans le moteur

Statut : validé en brainstorming, à implémenter.
Date : 20 juin 2026.
Item ROADMAP : suite directe de la fondation P3 « credentials chiffrés par tenant » (livrée). Clôt le câblage runtime annoncé dans `2026-06-19-tenant-credentials-design.md` (§ « Suite »).

## Objectif

Faire consommer par le moteur (LLM, transport, CRM) les credentials résolus par tenant via la couche `src/core/credentials/resolver.ts`, au lieu de lire `config.*` (globals `.env`) en dur. Conserver une compatibilité ascendante totale : en l'absence d'enregistrement DB, le moteur retombe sur `.env` et rien ne casse.

Hors scope : UI d'onboarding (P3), pool multi-clés / quotas LLM (item résilience), connecteur MAD CRM (reste un stub qui throw, ne doit pas bloquer).

## Contexte et état actuel

- `resolveLlmCredentials(clientId, botId)`, `resolveTransportCredentials(clientId, botId, provider)`, `resolveCrmCredentials(clientId, provider)` existent et sont testés. Le fallback `.env` est natif pour le LLM ; pour transport/CRM le resolver renvoie `{}` et délègue le fallback à l'appelant (c'est cet appelant qu'on écrit ici).
- **LLM** (`src/llm/anthropic.ts`) : `export const client = new Anthropic({ apiKey: config.anthropic.apiKey })` est un singleton créé à l'import. `chat(parts, messages, modelOverride?)` l'utilise en dur. Seul appelant : `src/core/handler.ts` (cascade `chat()` ligne ~451 ET extraction directe `client.messages.create` ligne ~35), qui a `botCfg` (client_id/bot_id) en portée.
- **Transport** (`src/transport/index.ts`) : `getTransport(id)` met en cache par `TransportId` global et lit `config.meta.*`. `getTransportForBot(bot)` délègue à `getTransport(bot.transport)`. Appelants : `handler.ts` ×2 (envoi, a le bot), `admin.ts` ×1 (envoi, a le bot), `index.ts` (réception webhook, n'a PAS encore le bot). Les factories `createCmComTransport(opts?)` et `createMetaCloudTransport({phoneNumberId, accessToken, appSecret})` acceptent déjà des credentials en argument avec fallback `config.*`.
- **CRM** (`src/core/crm-bridge.ts`) : `initCrmBridge()` synchrone, scanne les bots au boot. `instantiateConnector(bot)` ne câble QUE `hubspot` (lit `config.hubspot`) ; `attio`/`pipedrive`/`salesforce`/`zoho`/`webhook-generic` y lèvent encore des `throw "pending"` obsolètes alors que ces connecteurs sont construits et testés. `createConnector({type, credentials})` attend `credentials: Record<string, string>` — exactement le type renvoyé par le resolver.

## Décisions structurelles (validées)

1. **LLM** : `chat()` résout le client en interne. Pas de factory exposée à l'appelant ; on ajoute `getClientForTenant(clientId, botId)` dans `anthropic.ts`, mis en cache **par apiKey résolue**.
2. **Transport** : le bot est résolu AVANT la vérification HMAC à la réception du webhook, pour permettre un `app_secret` par bot. `getTransportForBot` devient async.
3. **CRM** : `initCrmBridge` devient async, résout via le resolver avec fallback `config.*`, et câble TOUS les connecteurs construits. `mad-crm` reste un stub.

## 1. LLM

`src/llm/anthropic.ts` :
- Supprimer `export const client = new Anthropic(...)`.
- Ajouter un cache `Map<string, Anthropic>` (clé = apiKey résolue) et :
  ```
  export async function getClientForTenant(clientId: string, botId: string | null): Promise<Anthropic>
  ```
  Résout via `resolveLlmCredentials(clientId, botId)`, renvoie le client mis en cache pour cette apiKey (le crée au premier accès). Si l'apiKey résolue est vide, lève une erreur explicite `[LLM]`.
- `chat()` : remplacer le 3e paramètre `modelOverride?: string` par `opts: { clientId: string; botId: string | null; model?: string }`. À l'intérieur, `const client = await getClientForTenant(opts.clientId, opts.botId)` puis utiliser `client` dans la boucle de cascade. `buildModelPlan(opts.model)` inchangé.
- `withRetry`, `MODEL_CASCADE`, `DEFAULT_MODEL`, le prompt caching, la cascade : inchangés.

`src/core/handler.ts` :
- Import : `import { chat, withRetry, getClientForTenant } from '../llm/anthropic.js'` (retirer `client`).
- Extraction (ligne ~35) : `const client = await getClientForTenant(botCfg.client_id, botCfg.bot_id);` avant `client.messages.create(...)`.
- Cascade (ligne ~451) : `chat([...parts], messages, { clientId: botCfg.client_id, botId: botCfg.bot_id, model: chatModel })`.

Isolation des rate limits : deux tenants BYO avec des clés distinctes ont des clients Anthropic distincts (pools séparés) ; le mode platform partage la clé `.env` (un seul client) — conforme au design fondation.

## 2. Transport

`src/transport/index.ts` :
- Cache rekeyé : `Map<string, Transport>` avec clé `${client_id}:${bot_id}:${transportId}`.
- `getTransportForBot(bot)` devient async :
  ```
  export async function getTransportForBot(bot: BotConfig): Promise<Transport>
  ```
  Sur miss : `const creds = await resolveTransportCredentials(bot.client_id, bot.bot_id, bot.transport)`. Si `creds` non vide, instancier la factory avec ces valeurs ; sinon fallback `config.*` (comportement actuel). Mapping des clés du blob vers les options de factory :
  - `meta-cloud` : `{ phoneNumberId: creds.phone_number_id, accessToken: creds.access_token, appSecret: creds.app_secret }`
  - `cm-com` : `{ productToken: creds.product_token, fromNumber: creds.from_number, serviceUrl: creds.service_url }`
- `getTransport(id)` (variante sans bot) : conservé pour `index.ts` legacy / `listConfiguredTransports`, lit `config.*`. Reste synchrone.

`src/index.ts` — réordonnancement de `handleIncomingWebhook` :
1. `res.sendStatus(200)`
2. `const message = transport.parseWebhookPayload(req.body)` — mais `transport` n'est plus pré-résolu ; on parse via une instance basée sur `transportId` (le parse ne dépend pas des credentials). Utiliser `getTransport(transportId)` UNIQUEMENT pour `parseWebhookPayload` (lecture de structure, pas de secret).
3. `if (!message) return`
4. `const route = await routeIncomingMessage(message.phone, message.toNumber)` ; si `!route` → log + return.
5. `if (route.config.transport !== transportId)` → log mismatch + return.
6. `const botTransport = await getTransportForBot(route.config)` — instance avec l'`app_secret` du bot.
7. Vérif HMAC : `if (botTransport.verifyWebhookSignature && req.rawBody) { if (!botTransport.verifyWebhookSignature(req.rawBody, headers)) return; }`
8. Suite inchangée : dedup (`isMessageProcessed`), audio/non-texte (via `botTransport.sendText`), `handleControlCommand`, welcome/`handleMessage`.
- La vérif GET `hub.verify_token` et le path legacy `/webhook` restent sur `config.meta.verifyToken` (handshake d'abonnement, pas par-message).
- Sécurité : le body est parsé avant vérification UNIQUEMENT pour lire `toNumber` et sélectionner le bon secret ; aucune action (dedup, réponse, persistance) n'a lieu avant que la signature soit validée.

`src/core/handler.ts` (×2) et `src/core/admin.ts` (×1) : `const transport = await getTransportForBot(botCfg)` (ajout de `await` ; ces fonctions sont déjà async).

## 3. CRM

`src/core/crm-bridge.ts` :
- `initCrmBridge()` → `async function initCrmBridge(): Promise<void>`.
- `instantiateConnector(bot)` → `async function instantiateConnector(bot): Promise<CRMConnector>` :
  - `const creds = await resolveCrmCredentials(bot.client_id, connectorType)`.
  - Construire `credentials: Record<string, string>` = `creds` si non vide, sinon fallback `config.*` selon le type (hubspot : `{ access_token: config.hubspot.accessToken, client_id: bot.client_id }`). Toujours injecter `client_id: bot.client_id` pour les connecteurs qui en ont besoin (hubspot).
  - Appeler `createConnector({ type: connectorType, credentials })` pour : `hubspot`, `attio`, `pipedrive`, `salesforce`, `zoho`, `webhook-generic`.
  - `mad-crm` : `throw new Error('mad-crm connector pending API access (skeleton only)')` (inchangé, ne doit pas bloquer — le bridge logge et continue).
  - Type inconnu : throw explicite.
- La boucle de `initCrmBridge` est déjà entourée d'un `try/catch` par bot qui logge et continue ; elle devient `await instantiateConnector(bot)`.

`src/index.ts` : `await initCrmBridge()` dans `main()`.

## Gestion d'erreurs

- LLM : apiKey résolue vide → `getClientForTenant` throw `[LLM]` explicite (fail-closed ; aujourd'hui couvert par le fallback `.env` du resolver).
- Transport : credentials résolus vides ET `config.*` vide → la factory échoue (meta-cloud refuse déjà sans `app_secret`). À la réception, un transport non instanciable → log `[Webhook]` + return (pas de crash du serveur).
- CRM : ni record ni `config.*` → `createConnector` ou la garde lève → le `try/catch` par bot logge `[CrmBridge]` et continue (les autres bots restent câblés).
- Aucun secret en clair dans les logs (déjà respecté par les modules existants ; à ne pas régresser).

## Tests (Vitest)

- **LLM** : `getClientForTenant` met en cache par apiKey (deux appels même tenant → même instance ; clés différentes → instances différentes) ; apiKey vide → throw. `chat` résout le client attendu (resolver/env stubbé). Mock du SDK Anthropic pour ne pas appeler le réseau.
- **Transport** : `getTransportForBot` instancie avec les credentials résolus quand un record existe ; fallback `config.*` quand le resolver renvoie `{}` ; cache rekeyé `(client_id, bot_id, transportId)` (deux bots du même client → deux instances si credentials différents). Réordonnancement `index.ts` : un test du chemin webhook (bot résolu avant vérif HMAC ; signature invalide → ignoré ; signature valide → traité).
- **CRM** : `instantiateConnector` construit le bon connecteur via credentials résolus ; fallback `config.*` pour hubspot ; un type construit (ex. pipedrive) s'instancie via record DB ; `mad-crm` throw sans casser le bridge.
- **Non-régression** : les 98 tests existants restent verts ; `npx tsc --noEmit` propre.

## Architecture des modules (isolation)

- `anthropic.ts` : ajoute la résolution+cache par tenant ; dépend du resolver. `chat` reste l'unique surface d'appel LLM côté handler, plus `getClientForTenant` pour l'extraction directe.
- `transport/index.ts` : seul point d'instanciation transport ; dépend du resolver ; le mapping blob→options y est centralisé.
- `crm-bridge.ts` : seul point d'instanciation CRM ; dépend du resolver ; câble tous les connecteurs.
- `index.ts` : orchestration du flux webhook (réordonné) ; `await` sur l'init CRM.

## Hors scope (non bloqués par ce design)

- Vérification HMAC par-app distincte à l'abonnement (GET) — reste global tant qu'une seule app Meta existe.
- Pool multi-clés plateforme / quotas / `quotaContext` (item résilience ; place déjà réservée).
- Seed des credentials des connecteurs autres que hubspot/meta/anthropic (le script seed actuel couvre les globals `.env` présents ; les autres viendront par upsert/UI).
- UI d'onboarding (P3).
- **Parse de webhook sans credentials (limitation connue, M3)** : à la réception, `getTransport(transportId)` instancie un transport basé sur `config.*` juste pour `parseWebhookPayload`. Pour `meta-cloud`, la factory exige un `app_secret` (durcissement fail-closed) ; un déploiement Meta 100% BYO sans `META_APP_SECRET` dans `.env` plateforme ferait échouer le parse avant routage. Non bloquant aujourd'hui (le `.env` plateforme porte les credentials Meta). Correctif futur : un parse statique sans credentials.
- **Test d'intégration du flux webhook réordonné** : `handleIncomingWebhook` n'est pas exporté de `src/index.ts` et n'a pas de test unitaire ; l'invariant « routage lecture seule, persistance après vérif HMAC » est couvert au niveau du router (`routeIncomingMessage` prouvé sans écriture) + revue. Un test d'intégration de l'ordre complet nécessiterait d'extraire `handleIncomingWebhook` dans un module testable — à planifier si le flux d'entrée se complexifie.
