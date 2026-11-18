# Lot R2a : guide en deux temps, profil WhatsApp et nom d'affichage, plan d'exécution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** l'administrateur raccorde un compte Meta en partant de son portefeuille Meta Business, avec des liens qui ouvrent la bonne page ; il lit et modifie depuis WABAGENT le profil WhatsApp d'un numéro et son nom d'affichage, jusqu'à l'application du nom approuvé avec le code de vérification en deux étapes.

**Architecture :**
- Le client Graph gagne un module `src/whatsapp/meta-profile.ts` : portefeuille, profil, photo, demande de nom et réenregistrement.
- Un nouveau service `src/core/services/whatsapp-number-profile-service.ts` porte le profil et le nom. Le service des comptes, déjà long, ne gagne que la lecture et la comparaison du portefeuille.
- Le profil n'est jamais stocké (approche A). Le portefeuille est stocké sur le compte, l'état de la demande de nom sur le numéro, mis à jour par la relecture des numéros qui existe déjà.
- Les liens précis et l'extraction des identifiants d'une adresse Meta sont des fonctions des contrats, source unique du web.

**Tech Stack :** TypeScript strict, Express, SQLite et Postgres, Vitest, Next.js (apps/web), next-intl, Playwright (faux moteur).

**Spec :** `docs/superpowers/specs/2026-11-17-r2a-guide-profil-nom-design.md`. Lire aussi la spec R1 (§12 compris), le registre R1 `.superpowers/sdd/2026-11-12-raccordement-automatique-r1/progress.md` (lignes 166 à 175, adresses Meta) et les maquettes citées en tête de la spec.

## Global Constraints

- Règles de `CLAUDE.md` :
  - TypeScript strict, pas de `any`, `const` par défaut ;
  - journaux `[Service] message` sans emoji ; jamais de jeton, secret, clé, code de vérification ni corps de profil dans un journal ; `npm run check:logs` vert.
- Textes :
  - français avec accents, sans tiret cadratin ni demi-cadratin ;
  - vocabulaire : agent IA, organisation, entité, contact ; les sept mots anglais gardés ;
  - le code s'appelle « code de vérification en deux étapes » à l'écran, jamais « PIN » seul (spec §5.3).
- Tests :
  - tests HTTP : `request(await serve(app))` ; tests de base : `createTestDatabase()` ;
  - suite d'isolation sur SQLite et Postgres ;
  - un test qui protège une ligne du §9 de la spec porte `// spec R2a §9.n`.
- Aucune écriture chez Meta avant la réussite de toutes les lectures de vérification, lecture du portefeuille comprise (spec 2b §7.1, spec R2a §5.1).
- Aucun repli sur les identifiants de la plateforme (`.env`) pour un appel Graph ; chaque appel part avec le jeton, le secret (`appsecret_proof`) et le `provider_number_id` du compte et du numéro visés.
- Le code de vérification n'est jamais écrit en base, jamais gardé au-delà de la requête, jamais renvoyé dans une réponse, un détail d'erreur ou une trace d'audit ; il est validé comme `^\d{6}$` avant l'appel.
- Le profil n'est jamais écrit en base.
- La limite de corps des routes d'administration (`express.json({ limit: '256kb' })`, `src/api/admin/router.ts:57`) ne change pas ; seule la route de la photo accepte un corps binaire, avec sa propre limite.
- Chaque nouvelle raison a :
  - sa clé dans `ERROR_REASONS` ;
  - son texte dans `apps/web/messages/fr.json` et `en.json` ;
  - un test de restitution.
- Le web ne lit un refus que par `describeFailure`.
- Git :
  - branche `feat/r2a-guide-profil-nom` ;
  - auteur `Francois Greze <francois@cyran.fr>`, sans signature Claude ;
  - pas de merge ni de push sans l'accord de François.

- Raisons d'erreur (Ruling R-11 du registre d'exécution) : une raison est ajoutée à `ERROR_REASONS` par la tâche qui l'émet, avec ses textes fr et en (`apps/web/messages/*.json`) et son test de restitution, dans le même commit ; la tâche 1 n'en ajoute aucune. Les tâches 4 et 5 touchent donc aussi les fichiers de messages du web.

## Review Focus

1. **Adresse collée inhabituelle** : adresse de `business.facebook.com` avec `asset_id` mais sans `business_id`, paramètres en double, fragment `#`, adresse d'un autre domaine qui contient `business_id=`, identifiant avec espaces. On attend une extraction seulement depuis `business.facebook.com` ou depuis des chiffres seuls, et « adresse non reconnue » sinon. Test : tâche 1, `extractMetaIds : cas limites`.
2. **Champ du profil vidé exprès** (l'administrateur efface l'adresse) : la valeur vide doit être envoyée à Meta pour effacer, et non ignorée comme « non modifiée ». Test : tâche 5, `profil : un champ vidé est envoyé vide`.
3. **Numéro retiré chez Meta entre l'ouverture de la fenêtre et l'enregistrement** : refus `whatsapp_account.number_removed` lisible dans la fenêtre, sans appel à Meta. Test : tâche 5, `profil : numéro retiré entre lecture et écriture`.
4. **Photo trop grosse ou d'un type refusé** : la réponse doit être `whatsapp_account.photo_invalid` restituée, et non un 413 ou un 400 générique. Test : tâche 5, `photo : 6 Mo et type gif refusés avec photo_invalid`.
5. **Double clic sur « Appliquer le nouveau nom »** : un seul réenregistrement doit partir, parce que chaque appel compte dans le quota de Meta. Tests :
   - tâche 9, `appliquer : bouton inactif pendant l'appel` ;
   - tâche 5, `apply : deux appels simultanés, un seul POST register`, avec un verrou par numéro dans le service.

---

## Carte des fichiers

Moteur :
- `packages/contracts/src/whatsapp.ts` : `business` sur la vue de compte, `display_name_request` sur la vue de numéro, types du profil et entrées, `business_id` facultatif à la création, `business_repointed` sur le résultat de raccordement.
- `packages/contracts/src/meta-links.ts` (nouveau) : `extractMetaIds`, `metaLinks`.
- `packages/contracts/src/errors.ts` : nouvelles raisons.
- `src/core/database/whatsapp-types.ts`, `whatsapp-sqlite.ts`, `whatsapp-postgres.ts` : colonnes et méthodes du store.
- `src/whatsapp/meta-graph.ts` : champs de nom ajoutés à `fetchNumbers`, règle du nom affiché dans `toProviderNumber`.
- `src/whatsapp/meta-profile.ts` (nouveau) : appels Graph du lot.
- `src/core/services/whatsapp-account-service.ts` : portefeuille au raccordement, à la vérification, au remplacement et à la relecture ; phrase reportée de R1.
- `src/core/services/whatsapp-number-profile-service.ts` (nouveau) : profil, photo, nom.
- `src/api/admin/routes/whatsapp-accounts.ts` : cinq routes nouvelles.
- `scripts/check-logs.ts` : `pin` dans les mots sensibles.

Web :
- `apps/web/src/components/connections/` :
  - `connect-guide-meta.tsx` (refait) ;
  - nouveaux `business-step.tsx`, `guide-paths.tsx`, `profile-dialog.tsx`, `display-name-panel.tsx`, `profile-preview.tsx` ;
  - `connect-form.tsx`, `connect-result.tsx`, `numbers-table.tsx`, `number-menu.tsx`, `account-alerts.tsx`.
- `apps/web/src/lib/whatsapp-display.ts` : `whatsAppManagerUrl` délègue à `metaLinks`.
- `apps/web/src/lib/proxy.ts` : `proxyEngineBinary`.
- BFF : `apps/web/src/app/api/whatsapp-accounts/[accountId]/numbers/[numberId]/` avec `profile/route.ts`, `profile/photo/route.ts`, `display-name/route.ts` et `display-name/apply/route.ts`.
- `apps/web/messages/fr.json`, `en.json` ; `apps/web/src/lib/describe-failure.ts`.
- `apps/web/e2e/mock-engine.ts`, `mock-state.ts`, `connections.spec.ts`.

---

### Task 0 : essais sur la WABA de dev (aucun code produit)

But : remplacer par des faits les points « à essayer » du §4 de la spec avant d'écrire le code. Aucune écriture chez Meta sans l'accord de François, demandé au moment de chaque écriture (demande de nom, réenregistrement, changement de profil, photo).

**Files :**
- Create : `docs/superpowers/research/2026-11-1x-essai-r2a-profil-nom.md`
- Create (jetable, hors dépôt) : scripts d'essai dans le dossier de travail de la session

- [ ] **Step 1 : identifiants.** Prendre le jeton et le secret de la WABA de dev `1122051030798254` dans une variable d'environnement de session donnée par François (`! export META_DEV_TOKEN=… META_DEV_APP_SECRET=…`). Ils ne sont jamais écrits dans un fichier du dépôt ni dans le rapport.
- [ ] **Step 2 : lectures.** Pour le numéro de test, lire les champs du numéro (`verified_name`, `name_status`, `new_name_status`, `new_display_name`, et tout champ de nom rendu par `?fields=`), `whatsapp_business_profile` avec tous ses champs, et `owner_business_info` de la WABA. Consigner les réponses en retirant tout identifiant de jeton.
- [ ] **Step 3 : écritures (accord de François à chacune).**
  - **Profil** : longueurs maximales de `about`, `description`, `address` et `email` (dépasser d'un caractère), liste des `vertical` acceptés, champ vidé, 3 sites web.
  - **Photo** : `POST /<APP_ID>/uploads` puis envoi du fichier, puis `profile_picture_handle` ; noter les formats et la taille maximale.
  - **Nom** : `new_display_name` sur le numéro de test (refusé ou accepté), valeurs de `name_status` observées.
  - **Réenregistrement** : `POST /<PHONE_NUMBER_ID>/register` avec un mauvais code (erreur rendue), sans code réglé, et effet sur `GET /<WABA>/subscribed_apps` et sur la réception d'un message de François.
- [ ] **Step 4 : rapport.** Pour chaque question 1 à 6 du §4 de la spec : réponse, preuve, et conséquence sur le plan.
- [ ] **Step 5 : porte de sortie.** Si une réponse contredit la spec (réenregistrement qui touche aux webhooks, nom du numéro de test non modifiable, photo impossible), s'arrêter et présenter à François la conséquence avant la tâche 1. Les valeurs relevées (longueurs, types, taille, champs de nom, valeurs de statut) remplacent les marqueurs `‹essai›` des tâches suivantes.
- [ ] **Step 6 : commit** `docs(research): essais Meta du lot R2a (profil, photo, nom, réenregistrement)`.

### Task 1 : contrats

**Files :**
- Create : `packages/contracts/src/meta-links.ts`, `packages/contracts/src/__tests__/meta-links.test.ts`
- Modify : `packages/contracts/src/whatsapp.ts`, `packages/contracts/src/errors.ts`, `packages/contracts/src/index.ts`

**Interfaces :**
- Produces :
  - `extractMetaIds(input: string): { business_id: string | null; asset_id: string | null } | null`. Rend `null` pour une entrée non reconnue. Des chiffres seuls (5 à 25, espaces retirés) sont lus comme `business_id`. Une adresse n'est lue que si son hôte est `business.facebook.com`, et seulement ses paramètres `business_id` et `asset_id`.
  - `metaLinks(ids: { business_id: string | null; waba_id: string | null }): MetaLinks`, où `MetaLinks` a les clés suivantes, chacune `{ url: string; precise: boolean }` :
    - `businessInfo` ;
    - `whatsappAccounts` ;
    - `systemUsers` ;
    - `phoneNumbers` ;
    - `managerOverview` ;
    - `developerApps` (toujours `precise: false`).
  - Adresses :
    - formes précises : celles du registre R1, lignes 169 à 174 ;
    - forme des utilisateurs système : celle confirmée par la tâche 0 ;
    - sans `business_id`, ou sans WABA quand la forme l'exige : l'adresse générique d'aujourd'hui, avec `precise: false`.
  - `WhatsAppAccountView.business: { id: string; name: string } | null`.
  - `WhatsAppNumberView.display_name_request: DisplayNameRequestView | null`, avec `DisplayNameRequestView = { requested_name: string; status: 'in_review' | 'rejected' | 'approved_pending'; rejection_reason: string | null; requested_at: string | null; approved_at: string | null; apply_before: string | null; apply_before_approx: boolean }`. Pas de valeur `applied` : une demande appliquée devient `null`.
  - `CreateWhatsAppAccountInput.business_id?: string` (`^\d{5,25}$`).
  - `WhatsAppAccountCreated.business_repointed: boolean`. Vrai quand la WABA était déjà abonnée à l'app et que le webhook de l'app pointait vers un autre produit ; il porte la phrase reportée de R1.
  - `WhatsAppBusinessProfileView = { about: string; description: string; address: string; email: string; websites: string[]; vertical: string; photo_url: string | null; read_at: string }`.
  - `UpdateWhatsAppBusinessProfileInput` : objet partiel des cinq champs texte, `websites` et `vertical`, avec les longueurs `‹essai›` et `vertical` dans `WHATSAPP_VERTICALS` (liste `‹essai›`, exportée).
  - `RequestDisplayNameInput = { new_display_name: string }` (1 à `‹essai›` caractères, espaces de bord retirés).
  - `ApplyDisplayNameInput = { pin: string }` (`^\d{6}$`). Le seul type qui porte le code.
  - `ERROR_REASONS` gagne :
    - `whatsapp_account.business_mismatch` ;
    - `whatsapp_account.business_unreadable` ;
    - `whatsapp_account.pin_rejected` ;
    - `whatsapp_account.name_change_limit` ;
    - `whatsapp_account.name_apply_expired` ;
    - `whatsapp_account.profile_unsupported` ;
    - `whatsapp_account.photo_invalid` ;
    - `whatsapp_account.number_removed` (si absente) ;
    - plus celles de la tâche 0.

- [ ] **Step 1 : tests** `extractMetaIds` :
  - `'1270659448489249'` donne `{ business_id: '1270659448489249', asset_id: null }` ;
  - l'adresse du registre R1 ligne 172 avec `business_id=1270659448489249&asset_id=1122051030798254` donne les deux ;
  - `https://evil.example/?business_id=1` donne `null` ;
  - `asset_id` seul donne `{ business_id: null, asset_id: '…' }` ;
  - un paramètre en double : la première valeur est prise ;
  - un fragment est ignoré ;
  - `' 1270 6594 4848 9249 '` donne l'identifiant sans espaces.

  Tests `metaLinks` :
  - avec le portefeuille, `phoneNumbers.url` vaut exactement l'adresse de la ligne 174 et `precise: true` ;
  - sans portefeuille, `precise: false` partout ;
  - `developerApps.precise === false` toujours.

  Nom des tests : `extractMetaIds : cas limites`, `metaLinks : précis seulement avec le portefeuille`.
- [ ] **Step 2 : lancer** `npx vitest run packages/contracts` : FAIL (module absent).
- [ ] **Step 3 : implémenter** les fonctions et les types ci-dessus.
- [ ] **Step 4 : lancer** `npx vitest run packages/contracts` puis `npm run typecheck` : PASS.
- [ ] **Step 5 : commit** `feat(contracts): portefeuille, profil, nom d'affichage, liens Meta précis`.

### Task 2 : stockage

**Files :**
- Modify : `src/core/database/whatsapp-types.ts`, `whatsapp-sqlite.ts`, `whatsapp-postgres.ts`
- Test : `src/core/database/__tests__/whatsapp-store.test.ts` (fichier existant du store, sinon le créer à côté)

**Interfaces :**
- Produces :
  - Colonnes de `whatsapp_accounts` : `meta_business_id TEXT`, `meta_business_name TEXT`. Colonnes de `whatsapp_numbers` : `name_request TEXT` sur SQLite, `JSONB` sur Postgres, au format `DisplayNameRequestView` ou nul. Toutes sont ajoutées par `ensureColumn` ou par `ADD COLUMN IF NOT EXISTS`.
  - `setWhatsAppAccountBusiness(clientId: string, id: number, b: { id: string; name: string }): Promise<{ changed: boolean; previous: { id: string; name: string } | null }>`.
  - `setWhatsAppNumberNameRequest(clientId: string, accountId: number, numberId: number, r: DisplayNameRequestView | null): Promise<boolean>`.
  - `setWhatsAppNumberDisplayName(clientId: string, accountId: number, numberId: number, name: string): Promise<boolean>`.
  - `WhatsAppAccountRecord` et `WhatsAppNumberRecord` portent les nouveaux champs. Ils remontent dans les vues `business` et `display_name_request`.

- [ ] **Step 1 : tests** sur les deux moteurs :
  - écriture puis relecture du portefeuille ;
  - `previous` rendu quand il change ;
  - demande de nom écrite puis effacée par `null` ;
  - écritures avec un `clientId` ou un `accountId` d'un autre compte : `false` et rien d'écrit (`// spec R2a §9.1`) ;
  - base créée avant le lot (colonnes absentes) : migration sans perte des numéros existants.
- [ ] **Step 2 : lancer** `npm test -- whatsapp-store` puis `npm run test:pg -- whatsapp-store` : FAIL.
- [ ] **Step 3 : implémenter** colonnes, méthodes et passage aux vues.
- [ ] **Step 4 : lancer** les deux commandes : PASS.
- [ ] **Step 5 : commit** `feat(db): portefeuille du compte et demande de nom du numéro`.

### Task 3 : client Graph

**Files :**
- Create : `src/whatsapp/meta-profile.ts`, `src/whatsapp/__tests__/meta-profile.test.ts`
- Modify : `src/whatsapp/meta-graph.ts:303-330`, `src/whatsapp/__tests__/meta-graph.test.ts`

**Interfaces :**
- Consumes :
  - `GraphContext`, `graphCall`, `graphUrl`, `makeContext` et `describeFailure` de `meta-graph.ts` ;
  - les types de la tâche 1.
- Produces (fichier `meta-profile.ts`) :
  - `readOwnerBusiness(ctx: GraphContext, wabaId: string): Promise<{ ok: true; business: { id: string; name: string } } | { ok: false; failure: GraphFailure }>` ;
  - `readBusinessProfile(ctx, providerNumberId: string): Promise<{ ok: true; profile: WhatsAppBusinessProfileView } | { ok: false; failure: GraphFailure }>` ;
  - `writeBusinessProfile(ctx, providerNumberId, patch: UpdateWhatsAppBusinessProfileInput): Promise<{ ok: true } | { ok: false; failure: GraphFailure; field: string | null }>` ;
  - `uploadProfilePhoto(ctx, appId: string, file: { bytes: Uint8Array; type: 'image/jpeg' | 'image/png' }): Promise<{ ok: true; handle: string } | { ok: false; failure: GraphFailure }>` ;
  - `requestDisplayName(ctx, providerNumberId, name: string): Promise<{ ok: true } | { ok: false; failure: GraphFailure }>` ;
  - `registerNumber(ctx, providerNumberId, pin: string): Promise<{ ok: true } | { ok: false; failure: GraphFailure; pinRejected: boolean; expired: boolean }>`.

  Règles :
  - `field` désigne le champ refusé quand Meta le nomme ;
  - les codes d'erreur Meta de `pinRejected`, `expired` et de la limite des 10 changements sont ceux relevés à la tâche 0 ;
  - le code n'apparaît dans aucun `GraphFailure` ni message.
- Produces (fichier `meta-graph.ts`) :
  - `fetchNumbers` demande en plus les champs de nom `‹essai›` ;
  - `ProviderNumber` gagne `name_request: DisplayNameRequestView | null` ;
  - règle du nom affiché (spec §6.3) : si Meta signale un nom approuvé non appliqué, `display_name` garde le nom réellement affiché, qui vient du champ `‹essai›` ou, à défaut, de la valeur en base, et le nom approuvé va dans `name_request`.

- [ ] **Step 1 : tests** avec `stubFetch()` :
  - chaque appel part avec le jeton du contexte, l'`appsecret_proof` et le chemin `/<id>/…` attendus ;
  - `registerNumber` avec un mauvais code donne `pinRejected: true` ;
  - capture des messages d'échec et des `GraphFailure` : le code `482915` n'y figure jamais (`// spec R2a §9.4`) ;
  - `writeBusinessProfile` avec `{ address: '' }` envoie `address: ''` (Review Focus 2) ;
  - `toProviderNumber` sur une réponse « approuvé, à appliquer » : `display_name` ancien, `name_request.status === 'approved_pending'`. Test `règle du nom affiché : approuvé non appliqué jamais affiché`.
- [ ] **Step 2 : lancer** `npm test -- meta-profile meta-graph` : FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : lancer** la même commande : PASS.
- [ ] **Step 5 : commit** `feat(whatsapp): appels Graph du profil, du nom et du portefeuille`.

### Task 4 : portefeuille au raccordement et ensuite

**Files :**
- Modify : `src/core/services/whatsapp-account-service.ts`, `src/core/services/__tests__/whatsapp-account-service.test.ts`

**Interfaces :**
- Consumes : `readOwnerBusiness` (tâche 3), `setWhatsAppAccountBusiness` (tâche 2), `CreateWhatsAppAccountInput.business_id` (tâche 1).
- Produces :
  - `create` lit le portefeuille parmi les lectures de vérification, avant toute écriture chez Meta. Les cas sont les suivants :
    - `business_id` fourni et différent du portefeuille lu : refus `business_mismatch`, avec dans le détail le nom et l'identifiant lus ;
    - `business_id` fourni et lecture en échec : refus `business_unreadable`, avec un détail transitoire ;
    - `business_id` absent (appel par l'API) : pas de comparaison, le portefeuille est gardé s'il a été lu.
  - `verify`, `replaceCredentials` et `refreshNumbers` relisent le portefeuille. Une lecture en échec ne change rien. Un portefeuille différent remplace l'ancien et est tracé par `recordAudit` (action `whatsapp_account.business_changed`, ancien et nouvel identifiant).
  - `create` remplit `business_repointed`.

- [ ] **Step 1 : tests** (faux Graph du fichier de test) :
  - `raccordement : portefeuille différent refusé sans aucun POST` (`// spec R2a §9.5`) ;
  - `raccordement : portefeuille illisible refusé, réessayable, sans POST` ;
  - `raccordement par l'API sans business_id : portefeuille gardé sans comparaison` ;
  - `vérifier : portefeuille changé chez Meta remplacé et tracé` ;
  - `compte R1 sans portefeuille : lu à la vérification` ;
  - `business_repointed vrai quand la WABA était abonnée et l'app pointait ailleurs`.
- [ ] **Step 2 : lancer** `npm test -- whatsapp-account-service` : FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : lancer** la même commande, puis `npm run test:pg -- whatsapp-account-service` : PASS.
- [ ] **Step 5 : commit** `feat(engine): portefeuille Meta Business vérifié au raccordement et gardé avec le compte`.

### Task 5 : service du profil et du nom, routes

**Files :**
- Create : `src/core/services/whatsapp-number-profile-service.ts`, `src/core/services/__tests__/whatsapp-number-profile-service.test.ts`, `src/api/admin/__tests__/whatsapp-number-profile-routes.test.ts`
- Modify : `src/api/admin/routes/whatsapp-accounts.ts`, le câblage du service (là où `WhatsAppAccountService` est construit), `scripts/check-logs.ts`

**Interfaces :**
- Consumes : tâches 1 à 3 ; `recordAudit` ; déchiffrement des identifiants du compte comme dans `whatsapp-account-service.ts`.
- Produces, dans la classe `WhatsAppNumberProfileService` :
  - `getProfile(clientId: string, accountId: number, numberId: number): Promise<WhatsAppBusinessProfileView>` ;
  - `updateProfile(clientId, accountId, numberId, actorUserId: number | null, patch: UpdateWhatsAppBusinessProfileInput): Promise<WhatsAppBusinessProfileView>` (relit après écriture) ;
  - `updatePhoto(clientId, accountId, numberId, actorUserId, file: { bytes: Uint8Array; type: string }): Promise<WhatsAppBusinessProfileView>` ;
  - `requestDisplayName(clientId, accountId, numberId, actorUserId, name: string): Promise<WhatsAppNumberView>` ;
  - `applyDisplayName(clientId, accountId, numberId, actorUserId, pin: string): Promise<WhatsAppNumberView>`.

  Règles communes :
  - chaque méthode retrouve le compte dans `clientId`, puis le numéro dans ce compte, avant tout appel extérieur (404 `whatsapp_account.not_found` ou `whatsapp_account.number_not_found`) ;
  - compte CM.com : `profile_unsupported` ; numéro retiré : `number_removed` ;
  - après une demande réussie, `requestDisplayName` écrit `name_request` (statut `in_review`, `requested_at`) et relit les numéros ;
  - `applyDisplayName` :
    - prend un verrou en mémoire par numéro : un second appel pendant le premier reçoit 409, sans appel à Meta ;
    - en cas de réussite, écrit le nom affiché et efface `name_request` ;
    - sur `expired`, efface `name_request` et répond `name_apply_expired`.
  - Trace d'audit des actions `whatsapp_number.profile_updated`, `photo_updated`, `name_requested` et `name_applied`, avec le numéro et la réussite ou la raison, sans aucun contenu.
- Routes sous `/:accountId/numbers/:numberId`, toutes derrière `connections.manage` :
  - `GET /profile` ;
  - `PUT /profile` ;
  - `POST /profile/photo`, monté avec `express.raw({ type: ['image/jpeg', 'image/png'], limit: '‹essai›' })` sur cette route seulement. Un autre type ou une taille au-delà donne `photo_invalid` ;
  - `POST /display-name` ;
  - `POST /display-name/apply`.
- `check-logs.ts` : `pin` ajouté à `SENSITIVE_WORDS`. Le corps d'une écriture de profil est nommé `patch` ou `profilePatch` et n'est jamais passé à un journal (relecture de la tâche).

- [ ] **Step 1 : tests du service** :
  - `profil : numéro d'un autre compte de la même organisation, 404 sans appel` (`// spec R2a §9.2`) ;
  - `profil : jeton et appsecret_proof du compte du numéro`, avec deux comptes aux identifiants distincts (`// spec R2a §9.3`) ;
  - `profil : un champ vidé est envoyé vide` ;
  - `profil : numéro retiré entre lecture et écriture` ;
  - `profil : enregistré puis relu, la réponse est la version relue` ;
  - `apply : code refusé, pin_rejected` ;
  - `apply : deux appels simultanés, un seul POST register` ;
  - `apply : délai dépassé, demande effacée et name_apply_expired` ;
  - `apply : code absent de la base, des journaux capturés, de la réponse et de la trace d'audit, en réussite et en échec`, avec le code `482915` et une recherche de `482915` dans le fichier SQLite et dans les lignes d'audit (`// spec R2a §9.4`) ;
  - `demande de nom : limite des 10 changements restituée en name_change_limit`.
- [ ] **Step 2 : tests des routes** (`request(await serve(app))`) :
  - `photo : 6 Mo et type gif refusés avec photo_invalid` ;
  - `limite JSON inchangée : corps de 300 ko sur PUT /profile refusé en 400 VALIDATION_ERROR` ;
  - `conseiller : 403 sur les cinq routes`.
- [ ] **Step 3 : test de la garde** : `scripts/__tests__/check-logs.test.ts` (ou le fichier existant de la garde) refuse `console.log('[X] pin', pin)`.
- [ ] **Step 4 : lancer** `npm test -- whatsapp-number-profile check-logs` : FAIL.
- [ ] **Step 5 : implémenter.**
- [ ] **Step 6 : lancer** `npm test`, `npm run test:pg`, `npm run check:logs`, `npm run check:tests`, `npm run typecheck`, `npm run typecheck:tests` : PASS.
- [ ] **Step 7 : commit** `feat(engine): profil WhatsApp et nom d'affichage d'un numéro`.

### Task 6 : état du nom par la relecture et l'événement Meta

**Files :**
- Modify : `src/core/services/whatsapp-account-service.ts` (application de l'inventaire), la méthode `applyInventory` des pilotes SQLite et Postgres, `src/whatsapp/__tests__/meta-events.test.ts`, `src/core/services/__tests__/whatsapp-account-service.test.ts`

**Interfaces :**
- Consumes : `ProviderNumber.name_request` (tâche 3).
- Produces :
  - `applyInventory` écrit `name_request` pour chaque numéro présent. Elle n'écrase jamais `display_name` avec un nom approuvé non appliqué (règle de la tâche 3).
  - `apply_before` vaut la date d'approbation plus 14 jours : la date portée par Meta si la tâche 0 l'a trouvée, sinon la première relecture qui observe l'approbation, avec `apply_before_approx: true`. Une relecture suivante ne repousse pas cette date.

- [ ] **Step 1 : tests** :
  - `phone_number_name_update : relecture, état approved_pending, date limite posée` ;
  - `relecture suivante : date limite inchangée` ;
  - `nom appliqué chez Meta hors WABAGENT : demande effacée, nom affiché mis à jour` ;
  - `relecture ordinaire : nom approuvé non appliqué jamais dans display_name`.
- [ ] **Step 2 : lancer** `npm test -- meta-events whatsapp-account-service` : FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : lancer** la même commande puis `npm run test:pg` : PASS.
- [ ] **Step 5 : commit** `feat(engine): état de la demande de nom suivi par la relecture des numéros`.

### Task 7 : suite d'isolation

**Files :**
- Create : `src/__tests__/isolation/profil-nom.test.ts`
- Modify : `src/__tests__/isolation/graph-fake.ts` (profil, photo, nom, register, `owner_business_info`)

- [ ] **Step 1 : tests** sur deux organisations A et B, sur SQLite et Postgres :
  - `les cinq routes avec un compte ou un numéro de B depuis A : 404, aucun appel au faux Meta` (`// spec R2a §9.1`) ;
  - `vue de compte de B jamais lisible depuis A, portefeuille compris` (`// spec R2a §9.5`) ;
  - `événement phone_number_name_update signé pour le compte de A, qui nomme le numéro de B : état du nom de B inchangé, aucune relecture du compte de B` (`// spec R2a §9.6`). Un même `provider_number_id` ne peut pas exister deux fois (index `active_provider_id` unique) ; le test envoie donc l'identifiant du numéro de B dans un événement reçu sur l'URL du compte de A.
  - `appels du faux Meta : chaque requête porte le jeton du compte visé` (`// spec R2a §9.3`).
- [ ] **Step 2 : lancer** `npm test -- isolation` et `npm run test:pg -- isolation` : PASS, ou corriger le code et non le test.
- [ ] **Step 3 : commit** `test(isolation): profil, nom d'affichage et portefeuille entre deux organisations`.

### Task 8 : web, guide en deux temps et raccordement

**Files :**
- Create : `apps/web/src/components/connections/business-step.tsx`, `guide-paths.tsx` et leurs tests dans `__tests__/`
- Modify : `connect-guide-meta.tsx`, `connect-form.tsx`, `connect-result.tsx`, `apps/web/src/lib/whatsapp-display.ts`, `apps/web/src/lib/describe-failure.ts`, `apps/web/messages/fr.json`, `en.json`

**Interfaces :**
- Consumes : `extractMetaIds`, `metaLinks`, `business_repointed` et les raisons de la tâche 1.

**Comportements :**
- **Étape 1**, selon la maquette 01, variante A :
  - un seul champ ;
  - l'aide « Où trouver l'identifiant ? » est dépliée, avec un schéma dessiné en HTML et CSS (pas d'image) de la page « Informations sur le portefeuille business » ;
  - « Portefeuille <identifiant> reconnu » sans nom ; « Adresse non reconnue » sinon ;
  - la suite du guide est grisée tant que le portefeuille n'est pas reconnu.
- **Choix du chemin**, selon la maquette 03 :
  - présélection du chemin 1 quand `asset_id` est extrait, avec la WABA préremplie ;
  - le champ WABA accepte aussi une adresse (`asset_id`) ;
  - ligne « Votre compte WhatsApp est géré par un autre prestataire (360dialog, Twilio…) ? Contactez-nous. » ;
  - bloc « Recommandé » de R1 en bas.
- **Liens** : chaque lien vient de `metaLinks`. Un lien `precise: false` garde son texte générique.
- **Résultat du raccordement** : « Portefeuille <nom> » ; refus `business_mismatch` et `business_unreadable` restitués ; phrase `business_repointed`.
- `whatsAppManagerUrl` délègue à `metaLinks`, avec le portefeuille du compte quand il est connu (spec §5.4). Là où l'appelant n'a pas le portefeuille dans ses données (encart Numéro de la page de l'agent IA, si `BotNumberSummary` ne le porte pas), le lien reste générique ; ajouter le portefeuille à `BotNumberSummary` seulement si le relecteur de tâche le juge nécessaire, sinon noter la limite au registre des décisions.

- [ ] **Step 1 : tests** :
  - `guide : liens précis avec le portefeuille, génériques sans` ;
  - `guide : collage d'une adresse WhatsApp Manager, chemin 1 et WABA préremplis` ;
  - `guide : suite grisée sans portefeuille` ;
  - `résultat : business_mismatch nomme le portefeuille lu` ;
  - `résultat : phrase business_repointed` ;
  - test de restitution de chaque nouvelle raison ;
  - `messages-style.test.ts` vert.
- [ ] **Step 2 : lancer** `npm test -w @wabagent/web` : FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : lancer** `npm test -w @wabagent/web` puis `npm run typecheck -w @wabagent/web` : PASS.
- [ ] **Step 5 : commit** `feat(web): guide de raccordement en deux temps, portefeuille d'abord`.

### Task 9 : web, profil et nom d'affichage

**Files :**
- Create :
  - `apps/web/src/components/connections/profile-dialog.tsx`, `display-name-panel.tsx`, `profile-preview.tsx` et leurs tests ;
  - les quatre routes BFF de la carte des fichiers.
- Modify : `numbers-table.tsx`, `number-menu.tsx`, `account-alerts.tsx`, `apps/web/src/lib/proxy.ts`, `messages/fr.json`, `en.json`

**Interfaces :**
- Produces : `proxyEngineBinary(enginePath: string, request: Request, allowedTypes: readonly string[], maxBytes: number): Promise<NextResponse>`. Le BFF refuse lui-même un type ou une taille hors limite (`photo_invalid`) et relaie le corps sans le lire en JSON.

**Comportements**, selon la maquette 04 :
- colonne « Nom affiché » avec l'étiquette de la demande ;
- « Profil WhatsApp » en tête du menu « Gérer » d'un numéro Meta présent, absent pour un numéro CM.com ou retiré ;
- fenêtre :
  - squelette pendant la lecture ;
  - échec restitué avec « Réessayer » ;
  - champs avec compteurs `‹essai›` ;
  - aperçu qui suit la saisie ;
  - « Enregistrer » envoie seulement les champs modifiés, un champ vidé compris ;
  - après l'enregistrement : « Profil enregistré chez Meta. » et la version relue ;
  - un refus de champ s'affiche sous le champ.
- encart du nom à quatre états (spec §5.3) :
  - libellé « Code de vérification en deux étapes » ;
  - aide sous le champ, texte exact de la spec §5.3, point 2, avec le lien `metaLinks().phoneNumbers` ;
  - bouton « Appliquer le nouveau nom » inactif pendant l'appel ;
  - le champ du code est vidé après chaque réponse et n'est jamais gardé dans un état persistant (ni `sessionStorage` ni URL).
- alerte de la carte du compte pour un nom `approved_pending`, avec la date limite (« environ » si `apply_before_approx`).

- [ ] **Step 1 : tests** :
  - `menu : Profil WhatsApp absent pour CM.com et numéro retiré` ;
  - `fenêtre : lecture en échec, Réessayer` ;
  - `fenêtre : seuls les champs modifiés sont envoyés, champ vidé compris` ;
  - `encart : quatre états` ;
  - `appliquer : bouton inactif pendant l'appel` ;
  - `appliquer : champ du code vidé après refus` ;
  - `alerte : nom approuvé à appliquer avec date limite` ;
  - `BFF photo : gif refusé sans appel au moteur` ;
  - `messages-style.test.ts` vert, dont un contrôle qu'aucun texte fr ne contient « PIN » seul.
- [ ] **Step 2 : lancer** `npm test -w @wabagent/web` : FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : lancer** `npm test -w @wabagent/web`, `npm run typecheck -w @wabagent/web` et `npm run check:logs` : PASS.
- [ ] **Step 5 : commit** `feat(web): profil WhatsApp et nom d'affichage depuis Connexions`.

### Task 10 : faux moteur et parcours e2e

**Files :**
- Modify : `apps/web/e2e/mock-engine.ts`, `mock-state.ts`, `connections.spec.ts`

- [ ] **Step 1 :** le faux moteur sert `business`, `display_name_request`, les cinq routes, `business_mismatch` et `pin_rejected`.
- [ ] **Step 2 : parcours** :
  - `raccordement : adresse WhatsApp Manager collée, chemin 1, résultat avec portefeuille` ;
  - `profil : lecture, modification, enregistrement relu` ;
  - `nom : demande, approuvé à appliquer, code refusé puis accepté`.
- [ ] **Step 3 : lancer** `npm run test:e2e -w @wabagent/web` : PASS.
- [ ] **Step 4 : commit** `test(e2e): guide en deux temps, profil et nom d'affichage`.

### Task 11 : revue d'isolation (relecteur indépendant)

- [ ] **Step 1 :** un relecteur neuf, qui ne reçoit ni les rapports des tâches ni les conclusions de l'implémenteur, reçoit :
  - la spec, son §9 et `CLAUDE.md` (règles multi-organisations) ;
  - le diff de la branche ;
  - le code appelé ou appelant : `src/webhooks/meta.ts`, `src/webhooks/account-key.ts`, `src/whatsapp/meta-events.ts`, `src/whatsapp/refresh-scheduler.ts`, `src/core/services/whatsapp-account-service.ts`, les pilotes de base WhatsApp, `src/core/audit.ts`, `apps/web/src/lib/proxy.ts`.
- [ ] **Step 2 :** rapport versionné `docs/superpowers/research/2026-11-1x-revue-isolation-r2a.md`, avec des constats Bloquant, Important et Mineur, chacun avec son fichier et sa ligne.
- [ ] **Step 3 :** chaque constat Bloquant ou Important est corrigé avec un test qui casse sans la correction (`// revue R2a I-n`), à raison d'un commit par constat.

### Task 12 : audit des décisions, recette en réel, merge

- [ ] **Step 1 : registre des décisions** prises pendant l'exécution (`docs/superpowers/research/2026-11-1x-registre-decisions-r2a.md`), triées en trois familles : produit, interprétation d'une règle validée, technique. Les choix du rédacteur du §12 de la spec et les choix de la tâche 0 y figurent comme contestables.
- [ ] **Step 2 : audit** par un relecteur neuf, qui reçoit les sources d'autorité et le code, mais pas les justifications comme règles.
- [ ] **Step 3 : recette en réel pilotée par Claude Code** (navigateur et terminal, sans relais de copier-coller), dans la copie de recette `/Users/francoisgreze/www/Cyran-projects/wabagent-recette-r1` mise à jour sur la branche (ou une copie neuve de la base), moteur avec `PUBLIC_BASE_URL=https://dev.wabagent.com`, tunnel lancé par François :
  1. compte retiré puis raccordé de nouveau avec l'adresse de WhatsApp Manager collée : portefeuille « Wabagent » reconnu, chemin 1, liens précis ouverts un par un dans les vraies pages avec François ;
  2. chemin 2 relu avec François dans les vraies pages, sans le jouer jusqu'au bout ;
  3. portefeuille faux saisi : refus `business_mismatch` ;
  4. profil : lecture, modification, photo, vérification sur le téléphone de François (fiche de l'entreprise dans WhatsApp) ;
  5. nom : demande, attente de la revue, application avec le code. Si la tâche 0 a montré que le nom du numéro de test ne change pas, ce parcours se fait sur un vrai numéro de François, ou bien il est déclaré non recetté en réel dans le rapport ;
  6. message de François après le réenregistrement : l'agent IA répond (webhook intact) ;
  7. chaque décision produit du registre validée par François.
- [ ] **Step 4 : fin du lot.**
  - Rapport de recette `docs/debug/2026-11-1x-recette-r2a.md`.
  - Mise à jour de `CLAUDE.md` (état du projet, contrats changés) et de `docs/ROADMAP.md` (R2a livré, R2b suivant).
  - Merge `--no-ff` et push seulement avec l'accord de François.
