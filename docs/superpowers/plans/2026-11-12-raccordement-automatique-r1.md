# Lot R1 : raccordement automatique du compte WhatsApp, plan d'exécution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** un compte Meta se raccorde avec trois saisies (WABA ID, jeton, secret de l'app) ; le moteur inscrit lui-même le webhook de la WABA et celui de l'app chez Meta, lit l'état du compte chez Meta, et plus aucun écran ne demande de recopier une URL ou un jeton dans Meta.

**Architecture :** le client Graph (`src/whatsapp/`) gagne les appels d'inscription, de retrait et de lecture d'état ; un registre en mémoire répond au GET de vérification de Meta pendant le raccordement ; le service des comptes orchestre lectures, unicité, écriture obligatoire (WABA), enregistrement, puis écriture complémentaire (app) ; l'état des webhooks et l'état lu chez Meta sont stockés sur le compte et exposés dans sa vue ; le web remplace le guide et la boîte webhook (Meta seulement).

**Tech Stack :** TypeScript strict, Express, SQLite et Postgres, Vitest, Next.js (apps/web), next-intl, Playwright (faux moteur).

**Spec :** `docs/superpowers/specs/2026-11-12-raccordement-automatique-r1-design.md` (lire aussi `docs/superpowers/research/2026-11-12-essai-raccordement-automatique.md` et `2026-11-12-limites-api-meta-raccordement.md`).

## Global Constraints

- Règles de `CLAUDE.md` : TypeScript strict, pas de `any`, `const` par défaut ; journaux `[Service] message` sans emoji ; jamais de jeton, secret, clé ni URL de webhook complète (elle contient la clé) dans un journal ; `npm run check:logs` vert.
- Textes français avec accents, sans tiret cadratin ni demi-cadratin ; vocabulaire : agent IA, organisation, entité, contact ; les sept mots anglais gardés (Draft, Preview, Online, Offline, Whitelist, New, Soon).
- Tests HTTP : `request(await serve(app))` ; tests de base : `createTestDatabase()` ; suite d'isolation sur SQLite et Postgres.
- Tout invariant a un test qui casse quand on le viole ; un test qui protège une ligne du §8 de la spec porte `// spec R1 §8`.
- Aucune écriture chez Meta avant la réussite de toutes les lectures et du contrôle d'unicité (spec 2b §7.1, revue 2b-2 I-1).
- Aucun repli sur les identifiants de la plateforme (`.env`) pour un appel Graph.
- Version Graph : `config.meta.graphVersion` (inchangée).
- `override_callback_uri` : 200 caractères au plus (Meta) ; refuser avant l'appel si l'URL dépasse.
- Un échec Meta « non concluant » (délai, injoignable, 5xx, limite de débit, 2200 à « Vérifier maintenant ») ne met jamais un compte en `error` (revue 2b-2 M-1).
- Le web ne lit un refus que par `describeFailure` ; chaque nouvelle raison a sa clé dans `ERROR_REASONS`, son texte dans `messages/fr.json` et `messages/en.json`, et un test de restitution.
- Pas de commit sans validation de François pour le merge ; commits sur la branche `feat/raccordement-r1`, auteur `Francois Greze <francois@cyran.fr>`, sans signature Claude.

## Review Focus

1. Meta répond 2200 au POST `subscribed_apps` parce que le GET de vérification arrive avant que le registre en mémoire soit prêt, ou sur une autre instance : l'utilisateur doit voir « webhook injoignable » avec quoi faire, et rien ne doit rester enregistré. Test : tâche 4, `webhook GET servi par le registre avant la création du compte` ; tâche 5, `2200 au POST : rien en base, registre libéré`.
2. `PUBLIC_BASE_URL` avec une barre finale ou un chemin : l'URL inscrite doit être exactement `<base>/webhook/meta/<clé>`, sans double barre. Test : tâche 5, `URL inscrite sans double barre`.
3. Jeton valide mais app non abonnée et WABA déjà abonnée à une autre app (portefeuille partagé) : seule l'entrée de l'app du jeton compte pour la relecture. Test : tâche 3, `relecture : override lu sur l'entrée de l'app du jeton seulement`.
4. « Vérifier maintenant » sur un compte raccordé avant ce lot (aucun `webhook_state` en base) : il doit réinscrire sans planter et afficher l'état. Test : tâche 6, `compte sans webhook_state : réinscription et état renseigné`.
5. Deux comptes de la même organisation sur la même app, l'un déconnecté : le webhook de l'app doit passer sur l'autre, jamais sur un compte d'une autre organisation. Test : tâche 8, `déconnexion : webhook de l'app repointé sur l'autre compte de la même app`.

---

## Carte des fichiers

Moteur :
- `packages/contracts/src/whatsapp.ts` : clés de contrôle, types `WhatsAppWebhooksView`, `MetaHealthView`, champs de vue, réponse de déconnexion, type de l'action « webhook de l'app ».
- `packages/contracts/src/errors.ts` : nouvelles raisons.
- `src/core/database/whatsapp-types.ts`, `whatsapp-sqlite.ts`, `whatsapp-postgres.ts` : colonnes `webhook_state` et `meta_health`, méthodes du store.
- `src/whatsapp/meta-graph.ts` : vérification en lecture seule, lecture de l'état, export des aides Graph.
- `src/whatsapp/meta-webhooks.ts` (nouveau) : inscription, retrait, relecture des webhooks WABA et app.
- `src/webhooks/pending-verification.ts` (nouveau) : registre en mémoire des GET de vérification attendus.
- `src/webhooks/meta.ts` : GET servi par le registre ; événements de compte croisés ; alerte de webhook absent.
- `src/core/services/whatsapp-account-service.ts` : orchestration (création, vérification, remplacement, déconnexion, action webhook de l'app).
- `src/core/services/meta-webhook-plan.ts` (nouveau) : décisions pures du §5.4 (où pointer le webhook de l'app).
- `src/api/admin/routes/whatsapp-accounts.ts` : réponse de déconnexion, route `POST /:accountId/app-webhook`, route webhook restreinte à CM.com.
- `src/core/config.ts` : rien à changer (`config.webhook.publicBaseUrl` existe).

Web :
- `apps/web/src/components/connections/connect-guide-meta.tsx`, `connect-result.tsx`, `account-card.tsx`, `account-alerts.tsx`, `disconnect-dialog.tsx`, nouveau `account-webhooks.tsx`.
- `apps/web/src/app/api/whatsapp-accounts/[accountId]/app-webhook/route.ts` (nouveau), `disconnect/route.ts`.
- `apps/web/messages/fr.json`, `en.json` ; `apps/web/src/lib/describe-failure.ts` (raisons).
- `apps/web/e2e/mock-engine.ts`, `mock-state.ts`, `connections.spec.ts`.

---

### Task 1 : contrats

**Files :**
- Modify : `packages/contracts/src/whatsapp.ts`, `packages/contracts/src/errors.ts`
- Test : `packages/contracts/src/__tests__/whatsapp.test.ts` (créer s'il n'existe pas), `packages/contracts/src/__tests__/errors.test.ts` (existant ou à créer)

**Interfaces :**
- Produces :
  - `VERIFICATION_CHECK_KEYS` gagne `'webhook_waba'` et `'webhook_app'` (en fin de liste).
  - `export type WabaWebhookState = 'ok' | 'missing' | 'unknown'` ; `export type AppWebhookState = 'ok' | 'elsewhere' | 'failed' | 'unknown'`.
  - `export interface WhatsAppWebhooksView { waba: WabaWebhookState; app: AppWebhookState; /** domaine seul (jamais le chemin), si app = 'elsewhere' */ app_host: string | null; checked_at: string | null }`.
  - `export type MetaSendCapability = 'available' | 'limited' | 'blocked'` ; `export interface MetaHealthIssue { code: number | null; text: string | null }` ; `export interface MetaHealthView { can_send: MetaSendCapability | null; business_verification: string | null; issues: MetaHealthIssue[]; read_at: string }`.
  - `WhatsAppAccountView` gagne `webhooks: WhatsAppWebhooksView | null` (null pour CM.com et un compte déconnecté) et `meta_health: MetaHealthView | null`.
  - `BotNumberSummary.account` gagne `webhooks: WhatsAppWebhooksView | null` et `meta_health: MetaHealthView | null`.
  - `WhatsAppAccountCreated.webhook` devient `WhatsAppWebhookView | null` (null pour Meta).
  - `export interface WhatsAppAccountDisconnected { waba_cleanup: 'done' | 'failed' | 'not_applicable'; app_webhook: 'repointed' | 'left' | 'not_applicable' }`.
  - `export type WhatsAppAppWebhookResult = WhatsAppAccountView & { checks: WhatsAppVerificationCheck[] }`.
  - `ERROR_REASONS` gagne : `'whatsapp_account.public_url_missing'`, `'whatsapp_account.webhook_unreachable'`, `'whatsapp_account.webhook_unconfirmed'`, `'whatsapp_account.webhook_url_too_long'`, `'whatsapp_account.app_webhook_failed'`.

- [ ] **Step 1 : test** `VERIFICATION_CHECK_KEYS contient les deux webhooks` (`expect(VERIFICATION_CHECK_KEYS).toEqual(expect.arrayContaining(['webhook_waba', 'webhook_app']))`) et `ERROR_REASONS contient les cinq raisons R1`.
- [ ] **Step 2 : lancer** `npx vitest run packages/contracts` : FAIL.
- [ ] **Step 3 : ajouter** types et constantes ci-dessus, chacun avec un commentaire d'une ligne en français qui dit qui le calcule (le moteur).
- [ ] **Step 4 : lancer** `npx vitest run packages/contracts && npm run typecheck && npm run typecheck -w @wabagent/web` : les tests passent ; les erreurs de typage du moteur et du web (champs manquants) sont attendues et listées dans le rapport de tâche, corrigées par les tâches 2 à 10. Si le typage casse la CI entre deux tâches, mettre `webhooks: null, meta_health: null` dans `view()` et `BotNumberSummary` dès cette tâche.
- [ ] **Step 5 : commit** `feat(contrats): webhooks inscrits et état du compte lu chez Meta (R1)`.

### Task 2 : stockage de l'état des webhooks et de l'état Meta

**Files :**
- Modify : `src/core/database/whatsapp-types.ts`, `src/core/database/whatsapp-sqlite.ts`, `src/core/database/whatsapp-postgres.ts`
- Test : `src/core/database/__tests__/whatsapp-store.test.ts` (fichier existant des tests du store WhatsApp ; sinon le créer avec `createTestDatabase()`)

**Interfaces :**
- Consumes : `WhatsAppWebhooksView`, `MetaHealthView` (tâche 1).
- Produces :
  - `WhatsAppAccountRecord` gagne `webhook_state: WhatsAppWebhooksView | null` et `meta_health: MetaHealthView | null`.
  - Store : `setWhatsAppAccountWebhookState(id: number, state: WhatsAppWebhooksView): Promise<void>` ; `setWhatsAppAccountMetaHealth(id: number, health: MetaHealthView): Promise<void>` ; `listConnectedMetaAccountsForApp(clientId: string, metaAppId: string): Promise<WhatsAppAccountRecord[]>` (comptes `connected` en `meta_manual` de cette organisation et de cette app, ordre `id`) ; `findConnectedMetaAccountByWaba(clientId: string, metaAppId: string, wabaId: string): Promise<WhatsAppAccountRecord | undefined>` (même filtre plus la WABA).
- Colonnes : `webhook_state TEXT` et `meta_health TEXT` (SQLite, JSON sérialisé, ajout par `ensureColumn`) ; `JSONB` en Postgres (`ADD COLUMN IF NOT EXISTS`). JSON illisible en lecture : `null` et un `console.warn('[DB] État de webhook illisible (compte <id>)')`.

- [ ] **Step 1 : tests** (SQLite et Postgres par `createTestDatabase()`) :
  - `écrit et relit webhook_state et meta_health` ;
  - `listConnectedMetaAccountsForApp ne rend que l'organisation et l'app demandées` (comptes A1, A2 sur app X en org A, B1 sur app Y en org B, A3 déconnecté sur X : rend `[A1, A2]`) `// spec R1 §8` ;
  - `findConnectedMetaAccountByWaba ignore un compte d'une autre organisation de même WABA et même app` `// spec R1 §8`.
- [ ] **Step 2 : lancer** `npx vitest run src/core/database` : FAIL.
- [ ] **Step 3 : implémenter** colonnes, sérialisation et méthodes dans les deux pilotes.
- [ ] **Step 4 : lancer** `npx vitest run src/core/database && npm run test:pg -- src/core/database` : PASS.
- [ ] **Step 5 : commit** `feat(base): état des webhooks et état Meta d'un compte WhatsApp`.

### Task 3 : client Graph, vérification en lecture seule, webhooks et état

**Files :**
- Modify : `src/whatsapp/meta-graph.ts`
- Create : `src/whatsapp/meta-webhooks.ts`
- Test : `src/whatsapp/__tests__/meta-graph.test.ts`, `src/whatsapp/__tests__/meta-webhooks.test.ts`

**Interfaces :**
- Consumes : `MetaHealthView`, `MetaHealthIssue` (tâche 1).
- Produces :
  - `verifyMetaManual(c, opts?)` devient **lecture seule** : plus de `POST subscribed_apps`, plus de `beforeWrite`. Le check `subscription` vaut `ok` si l'app du jeton est abonnée, `pending` sinon (détail « Abonnement fait au raccordement »). Le premier appel lit `fields=id,name,health_status,business_verification_status`. Le résultat `ok: true` gagne `meta_health: MetaHealthView | null` (null si les champs manquent ; pas d'échec pour autant).
  - Exportés de `meta-graph.ts` pour `meta-webhooks.ts` : `makeContext`, `graphCall`, `graphUrl`, `describeFailure`, types `GraphContext`, `GraphFailure`. `classify` reconnaît `code === 2200` : `{ kind: 'callback_failed'; provider_text?: string }` ; `describeFailure` le traduit en `{ key: step, reason: 'other', message: "Meta n'a pas pu joindre l'adresse du webhook de WABAGENT", transient: false }` plus un champ `callbackFailed: true` dans `FailureDescription`.
  - `meta-webhooks.ts` :
    - `readWabaOverride(c: MetaManualCredentials, metaAppId: string, opts?: ProviderClientOptions): Promise<{ ok: true; subscribed: boolean; override: string | null } | { ok: false; failure: GraphFailure }>` : lit `GET /<WABA>/subscribed_apps`, ne regarde que l'entrée dont `whatsapp_business_api_data.id === metaAppId`.
    - `setWabaOverride(c, target: { callbackUrl: string; verifyToken: string }, opts?): Promise<{ ok: true } | { ok: false; failure: GraphFailure }>` : `POST /<WABA>/subscribed_apps` avec `override_callback_uri` et `verify_token` en paramètres, `success !== true` = échec `other`.
    - `clearWabaOverride(c, opts?)` : `POST /<WABA>/subscribed_apps` sans paramètre.
    - `readAppWebhook(app: { appId: string; appSecret: string }, opts?): Promise<{ ok: true; callbackUrl: string | null } | { ok: false; failure: GraphFailure }>` : `GET /<APP_ID>/subscriptions` avec `access_token=<appId>|<appSecret>` (jeton d'app, sans `appsecret_proof`), entrée `object === 'whatsapp_business_account'`.
    - `setAppWebhook(app, target: { callbackUrl: string; verifyToken: string; fields: readonly string[] }, opts?)` : `POST /<APP_ID>/subscriptions` avec `object=whatsapp_business_account`, `callback_url`, `verify_token`, `fields` joints par des virgules.
    - `readMetaHealth(c: MetaManualCredentials, opts?): Promise<MetaHealthView | null>` : même lecture que le premier appel de `verifyMetaManual` (`fields=health_status,business_verification_status`), null sur tout échec (jamais d'erreur levée), pour « Rafraîchir les numéros ».
    - `export const APP_WEBHOOK_FIELDS = ['messages', 'account_alerts', 'account_update', 'account_review_update', 'phone_number_name_update', 'phone_number_quality_update', 'message_template_status_update', 'security'] as const`.
    - Le jeton d'app ne passe jamais dans une URL journalisée et figure dans les `secrets` masqués de `sanitizeProviderText`.

- [ ] **Step 1 : tests** sur le faux Meta existant (`graph()` étendu) :
  - `verifyMetaManual n'écrit jamais chez Meta` (aucun appel `POST`, même si l'app n'est pas abonnée ; check `subscription` = `pending`) ;
  - `verifyMetaManual lit health_status` : `meta_health.can_send === 'limited'`, `issues` contient `{ code: 141010, text: <description masquée et bornée> }`, `business_verification === 'pending_need_more_info'` ;
  - `relecture : override lu sur l'entrée de l'app du jeton seulement` (deux entrées, l'autre app porte un override : `override` = celui de l'app du jeton) ;
  - `setWabaOverride envoie override_callback_uri et verify_token` ; `2200 donne callback_failed, non transitoire` ;
  - `setAppWebhook utilise le jeton d'app et jamais le jeton du compte` ; `le jeton d'app n'apparaît pas dans provider_text` ;
  - `clearWabaOverride : POST sans paramètre d'override`.
- [ ] **Step 2 : lancer** `npx vitest run src/whatsapp` : FAIL.
- [ ] **Step 3 : implémenter.** Les tests existants qui attendaient le `POST subscribed_apps` dans `verifyMetaManual` sont réécrits pour attendre `subscription: 'pending'` ; aucun autre test n'est affaibli.
- [ ] **Step 4 : lancer** `npx vitest run src/whatsapp && npm run typecheck` : PASS.
- [ ] **Step 5 : commit** `feat(meta): inscription des webhooks et lecture de l'état du compte par l'API Graph`.

### Task 4 : registre des vérifications attendues et GET du webhook

**Files :**
- Create : `src/webhooks/pending-verification.ts`
- Modify : `src/webhooks/meta.ts` (route GET)
- Test : `src/webhooks/__tests__/pending-verification.test.ts`, `src/webhooks/__tests__/meta-webhook.test.ts`

**Interfaces :**
- Produces :
  - `registerPendingVerification(webhookKey: string, verifyToken: string, ttlMs?: number): () => void` : enregistre sous `hashWebhookKey(webhookKey)` (jamais la clé en clair), expire seul après `ttlMs` (défaut 60 000), renvoie la fonction de libération.
  - `matchPendingVerification(webhookKey: string, token: string): boolean` : comparaison en temps constant (`constantTimeEqual`).
  - Route GET : si aucun compte n'est trouvé pour la clé, consulte le registre ; même réponse que pour un compte (défi, `text/plain`, `nosniff`) ; sinon 403. Le POST n'est pas touché : une clé seulement en attente répond 404 (rien n'est servi).

- [ ] **Step 1 : tests** :
  - `webhook GET servi par le registre avant la création du compte` (200 et défi) ;
  - `GET avec le jeton d'un autre raccordement en attente : 403` `// spec R1 §8` ;
  - `après libération ou expiration : 403` ;
  - `POST signé sur une clé en attente : 404, aucun effet de bord` `// spec R1 §8` ;
  - `le registre ne garde que l'empreinte de la clé` (inspection du module : aucune entrée égale à la clé en clair).
- [ ] **Step 2 : lancer** `npx vitest run src/webhooks` : FAIL.
- [ ] **Step 3 : implémenter.** Limite notée dans le commentaire d'en-tête : registre propre au processus (multi-instance différé au chantier Infra, spec §5.2).
- [ ] **Step 4 : lancer** `npx vitest run src/webhooks` : PASS.
- [ ] **Step 5 : commit** `feat(webhook): vérification Meta servie pendant le raccordement`.

### Task 5 : raccordement (création d'un compte Meta)

**Files :**
- Create : `src/core/services/meta-webhook-plan.ts`
- Modify : `src/core/services/whatsapp-account-service.ts` (`create`, `view`, `webhookView`, fournisseurs injectables), `src/core/services/bot-number-summary.ts`
- Test : `src/core/services/__tests__/whatsapp-account-service.test.ts`, `src/core/services/__tests__/meta-webhook-plan.test.ts`

**Interfaces :**
- Consumes : tâches 2, 3, 4.
- Produces :
  - `WhatsAppProviders` gagne `metaWebhooks: MetaWebhookClient` (interface regroupant `readWabaOverride`, `setWabaOverride`, `clearWabaOverride`, `readAppWebhook`, `setAppWebhook`), injectable pour les tests ; `verifyMeta` perd `hooks`.
  - `meta-webhook-plan.ts` : `metaWebhookUrl(base: string, webhookKey: string): string` (retire les barres finales de `base`) ; `classifyAppWebhook(current: string | null, base: string, ownAccountUrls: readonly string[]): 'ours' | 'empty' | 'elsewhere' | 'other_account_of_ours'` (`ours` = URL d'un compte `connected` de la même organisation et de la même app ; `other_account_of_ours` = une URL sous `base` qui n'est pas dans la liste) ; `hostOf(url: string): string | null`.
  - Ordre de `create` pour `meta_manual` (spec §5.1) : `publicBaseUrl` null : `AppError('WA_VALIDATION_FAILED', …, 'whatsapp_account.public_url_missing')` avant tout appel ; URL > 200 caractères : `whatsapp_account.webhook_url_too_long` ; vérification (lecture seule) ; unicité (`findProviderAccountHolder`, puis app) ; clé et jeton générés ; `registerPendingVerification` ; `setWabaOverride` ; `readWabaOverride` (doit rendre l'URL) ; `createWhatsAppAccountWithInventory` ; libération du registre (dans un `finally`) ; puis webhook de l'app (règle tâche 7, appelée ici par `this.applyAppWebhookRule(account, secrets, { allowReplaceElsewhere: false })`) ; `setWhatsAppAccountWebhookState` et `setWhatsAppAccountMetaHealth` ; audit avec `{ webhook_waba: 'ok', webhook_app: <état> }`.
  - Échecs : 2200 au `setWabaOverride` : `whatsapp_account.webhook_unreachable` (texte : « Meta n'a pas pu joindre WABAGENT pour vérifier l'adresse du webhook. Réessayez dans quelques minutes ; si cela continue, contactez le support. »), rien en base ; relecture qui ne montre pas l'URL ou enregistrement en échec : `clearWabaOverride` tenté, raison `whatsapp_account.webhook_unconfirmed`, détail qui dit si le retrait a réussi ; panne passagère au `setWabaOverride` : `whatsapp_account.webhook_unreachable` aussi, avec `transient` dans le détail.
  - `WhatsAppAccountCreated.webhook` : `null` pour Meta, la boîte actuelle pour CM.com.
  - `view()` remplit `webhooks` (depuis `webhook_state`, null pour CM.com ou déconnecté) et `meta_health`.
  - `src/core/services/bot-number-summary.ts` : `BotNumberSummary.account.webhooks` et `.meta_health` remplis avec les mêmes règles que la vue (la page de l'agent IA affiche la même phrase que Connexions).

- [ ] **Step 1 : tests** (faux fournisseurs) :
  - `PUBLIC_BASE_URL absente : refus public_url_missing, aucun appel Meta` ;
  - `ordre des appels : lectures, unicité, override, relecture, enregistrement, webhook de l'app` (journal d'appels du faux client) ;
  - `URL inscrite sans double barre` (base `https://dev.wabagent.com/`) ;
  - `2200 au POST : rien en base, registre libéré` ;
  - `relecture sans notre adresse : retrait tenté, raison webhook_unconfirmed` ;
  - `WABA tenue par une autre organisation : aucune écriture chez Meta` `// spec R1 §8` ;
  - `l'URL inscrite est celle du compte créé dans l'organisation de la requête` `// spec R1 §8` ;
  - `la vue porte webhooks et meta_health ; webhook null pour Meta dans la réponse de création`.
- [ ] **Step 2 : lancer** `npx vitest run src/core/services` : FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : lancer** `npx vitest run src/core/services src/webhooks && npm run typecheck` : PASS.
- [ ] **Step 5 : commit** `feat(comptes): raccordement Meta avec inscription automatique des webhooks`.

### Task 6 : vérifier maintenant et remplacer les identifiants

**Files :**
- Modify : `src/core/services/whatsapp-account-service.ts` (`verify`, `replaceCredentials`, `refreshNumbers`)
- Test : `src/core/services/__tests__/whatsapp-account-service.test.ts`

**Interfaces :**
- Consumes : tâches 3 à 5.
- Produces :
  - `verify` (Meta) : après une vérification `ok` et acceptée, `readWabaOverride` ; si l'URL n'est pas celle du compte : `registerPendingVerification` puis `setWabaOverride` puis relecture ; check `webhook_waba` = `ok`, `created` (réinscrit) ou `failed`. Échec (2200, délai, 5xx) : état du compte inchangé, `webhook_state.waba = 'missing'`, issue `inconclusive` si rien d'autre n'a échoué. Puis règle de l'app (tâche 7, `allowReplaceElsewhere: false`). `meta_health` réécrit. `publicBaseUrl` null : issue `inconclusive`, check `webhook_waba` `failed` avec le texte de `public_url_missing`, état inchangé.
  - `refreshNumbers` (Meta) : après l'inventaire, `readMetaHealth` ; résultat non nul : `setWhatsAppAccountMetaHealth`.
  - `replaceCredentials` (Meta) : même séquence que `create` (tâche 5) après l'écriture des identifiants, avec la clé et le jeton de vérification **existants** ; échec d'inscription : identifiants gardés, `webhook_state.waba = 'missing'`, check `failed` (pas de retour en arrière des identifiants, qui ont été vérifiés).
- [ ] **Step 1 : tests** :
  - `compte sans webhook_state : réinscription et état renseigné` ;
  - `override présent et correct : aucune écriture chez Meta` ;
  - `réinscription en 2200 : compte reste connected, waba missing, issue inconclusive` ;
  - `jeton refusé : error comme avant (règle 2b inchangée)` ;
  - `replaceCredentials garde la clé d'URL et réinscrit avec le même jeton de vérification` ;
  - `refreshNumbers met à jour meta_health ; lecture en échec : meta_health inchangé`.
- [ ] **Step 2 : lancer** `npx vitest run src/core/services` : FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : lancer** `npx vitest run src/core/services` : PASS.
- [ ] **Step 5 : commit** `feat(comptes): réinscription des webhooks à la vérification et au remplacement`.

### Task 7 : webhook de l'app, événements croisés, action « Faire pointer vers WABAGENT »

**Files :**
- Modify : `src/core/services/whatsapp-account-service.ts` (`applyAppWebhookRule`, `pointAppWebhook`), `src/webhooks/meta.ts` (`processBatch`), `src/api/admin/routes/whatsapp-accounts.ts`
- Test : `src/core/services/__tests__/whatsapp-account-service.test.ts`, `src/webhooks/__tests__/meta-webhook.test.ts`, `src/api/admin/__tests__/whatsapp-accounts-routes.test.ts` (fichier existant des routes, sinon le créer)

**Interfaces :**
- Consumes : tâches 2, 3, 5.
- Produces :
  - `private applyAppWebhookRule(account: WhatsAppAccountRecord, secrets: MetaSecrets, opts: { allowReplaceElsewhere: boolean }): Promise<{ state: AppWebhookState; app_host: string | null; check: VerificationCheck }>` : lit le webhook de l'app ; `ours` : `ok` sans écrire ; `empty` ou `other_account_of_ours` : écrit l'URL du compte (`APP_WEBHOOK_FIELDS`, registre en attente pendant l'appel) ; `elsewhere` : n'écrit que si `allowReplaceElsewhere`, sinon `elsewhere` avec `app_host` ; échec d'écriture ou de lecture : `failed` (jamais `error` sur le compte).
  - `async pointAppWebhook(clientId: string, id: number, actorUserId: number | null): Promise<WhatsAppAppWebhookResult>` : compte `connected` en `meta_manual` seulement (sinon 409 `whatsapp_account.disconnected` ou 404), applique la règle avec `allowReplaceElsewhere: true`, audit `whatsapp_account.app_webhook` avec `{ result: <état> }` (jamais l'URL).
  - Route `POST /:accountId/app-webhook` (admin), réponse `WhatsAppAppWebhookResult`.
  - `processBatch` : les **événements de compte** d'une WABA B reçus sur l'adresse du compte A sont passés à `handleMetaEvents(B, …)` seulement si `findConnectedMetaAccountByWaba(A.client_id, A.meta_app_id, B)` rend B ; les **messages et statuts** d'une autre WABA restent ignorés ; pour chaque WABA étrangère qui a envoyé un message et qui correspond à un compte B de la même organisation et de la même app, `setWhatsAppAccountWebhookState(B.id, { …B.webhook_state, waba: 'missing' })` (au plus une écriture par lot et par compte) ; journal en nombres seulement.
- [ ] **Step 1 : tests** :
  - `webhook de l'app déjà sur un compte de la même app : aucune écriture` ;
  - `webhook de l'app ailleurs : pas d'écriture au raccordement, état elsewhere et domaine seul` ;
  - `pointAppWebhook remplace après confirmation et audite sans URL` ;
  - `événement de compte pour B (même organisation, même app) reçu sur A : traité pour B` ;
  - `événement de compte pour une WABA d'une autre organisation reçu sur A : ignoré` `// spec R1 §8` ;
  - `message de B reçu sur A : jamais routé, B marqué waba missing` `// spec R1 §8` ;
  - `route app-webhook : compte d'une autre organisation répond 404` `// spec R1 §8`.
- [ ] **Step 2 : lancer** `npx vitest run src/core/services src/webhooks src/api` : FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : lancer** les mêmes : PASS.
- [ ] **Step 5 : commit** `feat(comptes): webhook de l'app inscrit par WABAGENT et événements de compte d'une même app`.

### Task 8 : déconnexion

**Files :**
- Modify : `src/core/services/whatsapp-account-service.ts` (`disconnect`), `src/api/admin/routes/whatsapp-accounts.ts` (réponse 200 avec `WhatsAppAccountDisconnected` au lieu de 204), route `GET /:accountId/webhook` (CM.com seulement : un compte Meta répond 404 `whatsapp_account.not_found`)
- Test : `src/core/services/__tests__/whatsapp-account-service.test.ts`, test des routes

**Interfaces :**
- Produces : `disconnect(...)` renvoie `Promise<WhatsAppAccountDisconnected>`. Meta : avant `disconnectWhatsAppAccount`, lire les secrets ; après la déconnexion en base réussie, `clearWabaOverride` (`done` ou `failed`, sans bloquer) ; si le webhook de l'app pointait vers ce compte, le repointer vers le premier autre compte de `listConnectedMetaAccountsForApp` (`repointed`), sinon `left`. CM.com : `not_applicable` partout. Refus `in_use` inchangé (rien n'est appelé chez Meta).
- [ ] **Step 1 : tests** :
  - `déconnexion : retrait de l'override sur la WABA du compte seulement` `// spec R1 §8` ;
  - `déconnexion : webhook de l'app repointé sur l'autre compte de la même app` ;
  - `déconnexion : dernier compte de l'app, webhook laissé, app_webhook = left` ;
  - `Meta injoignable au retrait : compte déconnecté quand même, waba_cleanup = failed` ;
  - `compte en usage : refus, aucun appel Meta` ;
  - `GET webhook d'un compte Meta : 404`.
- [ ] **Step 2 à 4 :** FAIL, implémenter, PASS (`npx vitest run src/core/services src/api`).
- [ ] **Step 5 : commit** `feat(comptes): retrait du webhook chez Meta à la déconnexion`.

### Task 9 : suite d'isolation

**Files :**
- Modify : `src/__tests__/isolation/whatsapp-account-service.test.ts`, `src/__tests__/isolation/two-orgs.test.ts`
- Test : ces fichiers, sur SQLite et Postgres

- [ ] **Step 1 : tests** (organisations A et B, faux Meta qui enregistre chaque appel avec son jeton et son URL) `// spec R1 §8` :
  - `raccordement de A : aucun appel Graph ne porte une URL ni un jeton de B` ;
  - `vérification de B pendant un raccordement en attente de A : le GET de A refuse le jeton de B` ;
  - `déconnexion de A : aucun appel sur la WABA ni l'app de B` ;
  - `app partagée entre A et B : raccordement de B refusé avant toute écriture chez Meta` ;
  - `aucun appel Graph avec les identifiants .env` (variables `META_*` posées dans le test).
- [ ] **Step 2 : lancer** `npx vitest run src/__tests__/isolation && npm run test:pg -- src/__tests__/isolation` : les tests doivent passer avec le code des tâches 2 à 8 ; un échec est un défaut à corriger dans la tâche concernée, jamais en affaiblissant le test.
- [ ] **Step 3 : lancer** `npm test && npm run test:pg && npm run typecheck && npm run typecheck:tests && npm run check:tests && npm run check:logs` : tout vert.
- [ ] **Step 4 : commit** `test(isolation): raccordement automatique entre deux organisations`.

### Task 10 : web, guide, résultat, carte du compte, déconnexion

**Files :**
- Modify : `apps/web/src/components/connections/connect-guide-meta.tsx`, `connect-result.tsx`, `account-card.tsx`, `disconnect-dialog.tsx`, `apps/web/src/lib/describe-failure.ts` (ou le fichier qui traduit les raisons), `apps/web/messages/fr.json`, `apps/web/messages/en.json`, `apps/web/src/app/api/whatsapp-accounts/[accountId]/disconnect/route.ts`
- Create : `apps/web/src/components/connections/account-webhooks.tsx`, `apps/web/src/app/api/whatsapp-accounts/[accountId]/app-webhook/route.ts`
- Test : `apps/web/src/components/connections/__tests__/` (guide, résultat, carte, `account-webhooks.test.tsx`, déconnexion, `restitution.test.tsx`), `apps/web/src/app/api/whatsapp-accounts/__tests__/whatsapp-accounts-routes.test.ts`

**Interfaces :**
- Consumes : contrats de la tâche 1.
- Produces :
  - Guide Meta (spec §6.1) : étapes 1 à 5 obligatoires (app avec le cas d'usage WhatsApp, numéro dédié avec le texte actuel, utilisateur système et jeton sans expiration avec `whatsapp_business_management` et `whatsapp_business_messaging`, où lire le WABA ID avec la mise en garde « pas l'identifiant d'un numéro ni de l'app », où lire le secret : Paramètres de l'app, Général, Clé secrète, Afficher) ; bloc « Recommandé » : publier l'app, moyen de paiement du compte WhatsApp (pas celui des publicités), vérification d'entreprise, « Clé requise » (Paramètres de l'app, Avancé). Aucune étape webhook.
  - `AccountWebhooks` : `({ webhooks, metaHealth, accountId, isAdmin, readOnly }: { webhooks: WhatsAppWebhooksView | null; metaHealth: MetaHealthView | null; accountId: number; isAdmin: boolean; readOnly: boolean }) => JSX.Element | null` : « Webhook inscrit chez Meta » ou « Webhook absent chez Meta : lancez Vérifier maintenant » ; app `elsewhere` : « Le webhook de votre app Meta pointe vers {host} : les alertes de compte de Meta n'arrivent pas à WABAGENT. » avec le bouton « Faire pointer vers WABAGENT » (confirmation qui répète le domaine, `isAdmin && !readOnly`) ; app `failed` : texte et « Vérifier maintenant » ; état Meta : envoi limité ou bloqué, causes par code connu (141010 : « Vérification d'entreprise à faire chez Meta ») sinon texte de Meta replié, lien vers la page Meta concernée.
  - Encart Numéro de la page de l'agent IA : même composant `AccountWebhooks` en lecture seule (sans bouton), alimenté par `BotNumberSummary.account` (règle « même phrase aux deux endroits »).
  - Carte du compte : `AccountWebhook` (boîte à copier) seulement pour CM.com ; `AccountWebhooks` pour Meta. Résultat du raccordement : `WebhookBox` seulement si `account.webhook !== null` ; contrôles `webhook_waba` et `webhook_app` libellés.
  - Fenêtre de déconnexion : après réussite, phrase selon `app_webhook` (`left` : « Le webhook de votre app Meta pointe encore vers ce compte retiré ; changez-le dans Meta si l'app sert à autre chose. ») et `waba_cleanup` (`failed` : « WABAGENT n'a pas pu retirer son adresse chez Meta ; elle ne reçoit plus rien. »).
  - BFF : `POST /api/whatsapp-accounts/[accountId]/app-webhook` relaie vers le moteur ; `disconnect` relaie le corps 200.
  - Textes des cinq raisons (tâche 1) en français et en anglais ; `public_url_missing` : « La plateforme n'a pas d'adresse publique pour recevoir les messages. Contactez le support. »
- [ ] **Step 1 : tests** : `le guide Meta ne parle plus de webhook` (aucun texte « webhook » ni « jeton de vérification ») ; `la carte d'un compte Meta n'affiche pas de boîte à copier` ; `la carte CM.com garde la boîte` ; `app elsewhere : bouton seulement pour un admin hors lecture seule` ; `restitution : les cinq raisons R1 ont un texte` ; `déconnexion : phrase app_webhook left` ; route BFF `app-webhook` relaie le refus avec `reason` et `request_id`.
- [ ] **Step 2 à 4 :** FAIL, implémenter, PASS (`npm test -w @wabagent/web && npm run typecheck -w @wabagent/web`). Test de style des messages (`messages-style.test.ts`) vert.
- [ ] **Step 5 : commit** `feat(web): raccordement Meta sans recopie de webhook, état du compte lu chez Meta`.

### Task 11 : faux moteur et parcours e2e

**Files :**
- Modify : `apps/web/e2e/mock-engine.ts`, `apps/web/e2e/mock-state.ts`, `apps/web/e2e/connections.spec.ts`
- [ ] **Step 1 :** le faux moteur renvoie `webhook: null`, `webhooks`, `meta_health` pour Meta ; route `app-webhook` ; déconnexion en 200.
- [ ] **Step 2 : parcours** `raccordement Meta : aucun écran de webhook à recopier, contrôles webhook affichés` ; `app elsewhere puis Faire pointer vers WABAGENT`.
- [ ] **Step 3 : lancer** `npm run test:e2e -w @wabagent/web` : PASS.
- [ ] **Step 4 : commit** `test(e2e): raccordement Meta automatique`.

### Task 12 : revue d'isolation (relecteur indépendant)

- [ ] **Step 1 :** relecteur neuf, qui ne reçoit ni les rapports des tâches ni les conclusions de l'implémenteur : la spec, le §8, `CLAUDE.md` (règles multi-organisations) et le diff de la branche, plus le code appelé ou appelant : `src/webhooks/meta.ts`, `src/webhooks/account-key.ts`, `src/whatsapp/meta-events.ts`, `src/core/services/whatsapp-account-service.ts`, pilotes de base WhatsApp.
- [ ] **Step 2 :** rapport versionné `docs/superpowers/research/2026-11-1x-revue-isolation-r1.md` (constats Bloquant, Important, Mineur, avec fichier et ligne).
- [ ] **Step 3 :** chaque Bloquant et Important corrigé avec un test qui casse sans la correction (`// revue R1 I-n`) ; commit par constat.

### Task 13 : audit des décisions, recette en réel, merge

- [ ] **Step 1 : registre** des décisions prises pendant l'exécution (`docs/superpowers/research/2026-11-1x-registre-decisions-r1.md`), triées produit, interprétation d'une règle validée, technique ; les choix du rédacteur du §11 de la spec y figurent comme contestables.
- [ ] **Step 2 : audit** par un relecteur neuf (sources d'autorité et code, pas les justifications comme règles).
- [ ] **Step 3 : recette en réel pilotée par Claude Code** (navigateur et terminal, sans relais de copier-coller) sur une copie jetable de la base, moteur sur 3800 avec `PUBLIC_BASE_URL=https://dev.wabagent.com`, web sur 3000, tunnel `wabagent-dev` lancé par François (`! cloudflared tunnel --config ~/.cloudflared/wabagent-dev.yml run wabagent-dev`) :
  1. raccordement de la WABA de dev `1122051030798254` avec les trois saisies, aucune action chez Meta ; relecture chez Meta : override de la WABA et webhook de l'app sur l'URL du compte ;
  2. message de François au +1 555 164 9072 : l'agent IA répond ;
  3. retrait manuel de l'override (appel Graph depuis le terminal), « Vérifier maintenant » : réinscrit ;
  4. tunnel arrêté, « Vérifier maintenant » : compte reste connecté, alerte « Webhook absent » ;
  5. webhook de l'app mis ailleurs (adresse d'essai), raccordement d'un second compte : état `elsewhere` puis « Faire pointer vers WABAGENT » ;
  6. déconnexion : override retiré, message de la fenêtre ;
  7. guide relu étape par étape par François dans les vraies pages Meta, libellés corrigés ;
  8. chaque décision produit du registre validée par François.
- [ ] **Step 4 :** rapport de recette `docs/debug/2026-11-1x-recette-r1.md` ; `CLAUDE.md` (état du projet, contrats changés) et `docs/ROADMAP.md` (R1 livré, R2 suivant) mis à jour ; merge `--no-ff` et push seulement avec l'accord de François.
