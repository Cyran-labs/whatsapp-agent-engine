# Revue d'isolation entre organisations, lot 2b-3 (écrans Connexions, assistant Numéro et Activer, encarts de l'agent IA)

Date : 9 novembre 2026. Relecteur indépendant, sans conclusions des implémenteurs.

Branche `feat/2b-3-ecrans` (HEAD ceea0c6), comparée à `4ad4c0b` (`git diff 4ad4c0b..HEAD -- . ':(exclude)marketing' ':(exclude)docs'`). Lecture seule : aucun fichier de code modifié, aucun commit, `git status` inchangé (seul `marketing/brief-landing-claude-design.md`, non suivi, préexistant). Aucun appel réseau vers Meta ou CM.com.

Références : spec 2b §2 (anti-objectifs), §4.5, §8, §9, §10 ; `CLAUDE.md` (règles non négociables multi-organisations) ; revue 2b-2 (`2026-11-09-revue-isolation-2b-2.md`, notamment M-6 accepté).

Compte : 0 bloquant, 3 mineurs.

## 1. Périmètre couvert

### Fichiers lus

- BFF : toutes les routes `apps/web/src/app/api/**/route.ts` (41 fichiers ; lecture complète des routes `whatsapp-accounts/**` et `bots/**`, diff des routes `auth/**` et `usage/**`), `apps/web/src/lib/{engine-fetch,engine-client,proxy,api-fetch,api-json,api-response,session,session-errors,org-cookie,bot-transitions,whatsapp-display,onboarding,bot-draft}.ts`, `apps/web/src/middleware.ts`, `apps/web/next.config.ts`.
- Écrans : `app/[locale]/(app)/organisation/{layout,connexions/page,connexions/raccorder/page}.tsx`, `agents/new/page.tsx`, `agents/[botId]/layout.tsx`, `(app)/page.tsx` (diff), `components/connections/*` (webhook-box, connect-form, connect-result, account-run-dialog, assign-bot-dialog, number-menu, test-flag-dialog, et survol des autres), `components/numbers/number-picker.tsx`, `components/wizard/{wizard,step-number,step-activate,success}.tsx`, `components/agent/{number-panel,status-panel,assign-number-dialog,allowlist-panel,overview,agent-context}.tsx`, `components/providers/session-provider.tsx` (liaison d'`apiFetch`), `components/agents/{setup-banner,agents-table}.tsx`.
- Contrats : `packages/contracts/src/{bot-status,bots,whatsapp,index}.ts` ; comparaison ligne à ligne de `packages/contracts/src/bot-status.ts` avec `src/core/bot-status.ts` de `4ad4c0b`.
- Moteur : `src/api/admin/router.ts`, `src/api/admin/routes/{whatsapp-accounts,bots}.ts`, `src/api/middleware/auth.ts` (`requireAuth`, `createRequireOrganization`, `requireAction`, `activeClientId`), `src/core/auth/permissions.ts`, `src/api/errors.ts`, `src/core/services/{whatsapp-account-service,bot-service,bot-number-summary}.ts`, diffs de `connections-service`, `dashboard-service`, `simulate-service`, `src/core/database/whatsapp-sqlite.ts` (topologie : `assign`, `transition`, `activateWithNumber`, `unassignNumber`, `replaceAllowlist`, `setWhatsAppNumberTestFlag`, schéma), `whatsapp-postgres.ts` (diff et schéma), `whatsapp-types.ts`.

### Tests exécutés (sans modification)

- `npm test -w @wabagent/web -- src/app/api src/lib` : 29 fichiers, 257 tests, tous passent.
- `npx vitest run packages/contracts src/api/admin/__tests__/bots-routes.test.ts src/api/admin/__tests__/whatsapp-accounts-routes.test.ts src/api/admin/__tests__/org-isolation.test.ts src/__tests__/isolation` : 10 fichiers, 155 tests, tous passent (SQLite).

## 2. Réponses aux questions imposées

### Q1. Une route BFF peut-elle appeler le moteur sans l'organisation du cookie, ou avec une autre que celle de l'onglet ?

Non.

- Toutes les routes du lot passent par `proxyEngine` (`apps/web/src/lib/proxy.ts:33-63`), qui appelle `engineFetch`. Les autres routes `bots/**` appellent `engineFetch` directement. Aucune route n'appelle `engineCall` avec un en-tête d'organisation de son choix (seule `auth/refresh` et les routes d'authentification appellent `engineCall`, sans organisation).
- `engineFetch` lit l'organisation du seul cookie `wab_org`, et seulement si elle a été posée par l'utilisateur du jeton (`engine-fetch.ts:64-66`, `org-cookie.ts:11-19`). L'en-tête `X-Organization-Id` envoyé au moteur est toujours cette valeur (`engine-fetch.ts:23-30`), y compris après un renouvellement de jeton (`engine-fetch.ts:96`). Le corps et les paramètres de la requête n'influent jamais sur l'organisation.
- Organisation de l'onglet : `X-Wab-Org` différent du cookie (cookie absent compris) donne un 409 `ORG_CHANGED` sans appel au moteur (`engine-fetch.ts:67-71`). Les cookies sont ceux de la requête entrante : la comparaison et l'appel voient la même valeur.
- Côté client, tous les appels des écrans du lot passent par `apiFetch` ou `sendMutation` (recherche faite : aucun `fetch('/api/…')` direct hors des parcours d'authentification). La liaison est posée pendant le rendu du `SessionProvider` et ses enfants ne sont rendus qu'une fois la session lue (`session-provider.tsx:197-206, 254-256`) : le premier appel d'une page porte déjà `X-Wab-Org`. Le 409 déclenche un rechargement complet (`session-provider.tsx:87-89`), qui vide tout état client (choix de numéro de l'assistant, liste locale de l'accès limité).
- Sans `X-Wab-Org` (appel hors `apiFetch`), le BFF utilise l'organisation du cookie : c'est la règle du 2a, et le moteur reste juge de l'appartenance (`createRequireOrganization`, `auth.ts:48-57`).
- Tests : `whatsapp-accounts-routes.test.ts:187` et `bot-actions-routes.test.ts:142` (409 sans appel au moteur), `engine-fetch.test.ts`.

### Q2. Un identifiant d'une autre organisation produit-il autre chose qu'un 404 neutre ?

Non.

- Compte : `requireAccount` lit par `(client_id, id)` et répond « Compte WhatsApp introuvable. » (`whatsapp-account-service.ts:445-448`), le même texte pour un identifiant inconnu. Numéro : `setWhatsAppNumberTestFlag` filtre par `(client_id, account_id, id)` (`whatsapp-sqlite.ts:565-570`), 404 « Numéro WhatsApp introuvable. » (`whatsapp-account-service.ts:413`). Agent IA : `BOT_NOT_FOUND` unique « Agent IA introuvable. » (`errors.ts`, `bot-service.ts:143-148`, et les quatre services alignés par le lot). Branchement et activation : `assign` lit l'agent IA et le numéro par `client_id` (`whatsapp-sqlite.ts:290-300`), refus `not_found` traduit en « Agent IA ou numéro WhatsApp introuvable. » quel que soit l'élément absent (`bot-service.ts:51-53, 214, 261`).
- Temps : mêmes requêtes filtrées dans les deux cas, aucune branche supplémentaire pour un identifiant existant ailleurs.
- BFF : `rejectNonNumericId` répond « Ressource introuvable. » selon la forme de l'identifiant seulement, sans appel (`proxy.ts:20-23`). Le web traite ces 404 comme un refus ordinaire (`orgErrorKind` ne réagit qu'à « Organisation introuvable. », `api-fetch.ts:35-41`).
- Les vues ne portent aucun champ d'une autre organisation : `numberView` lit l'agent IA branché par `(client_id, bot_id)` (`whatsapp-account-service.ts:508-509`), `loadBotNumberSummary` lit numéro et compte par organisation (`bot-number-summary.ts:21-35`). Le bilan d'inventaire ne donne qu'un compte `refused`.
- Tests : `org-isolation.test.ts:173-193` (« Agent IA introuvable. »), `bots-routes.test.ts:251-253` (numéro de beta, numéro et agent IA inconnus : 404).

### Q3. Un membre non admin peut-il déclencher une écriture ?

Non, des deux côtés.

- Moteur : toutes les routes des comptes exigent `connections.manage`, lecture comprise (`whatsapp-accounts.ts:26-71`) ; branchement, débranchement, statut, liste et activation exigent `bots.configure` (`bots.ts:32-58`). `can()` n'accorde que `org.read` et `simulate.use` aux membres, et seulement `org.read` en lecture seule (`permissions.ts:33-50`) ; `read_only` n'existe que pour `super_manager` (contrainte CHECK, `accounts-sqlite.ts:38`). Tests : `whatsapp-accounts-routes.test.ts:206-212` (super manager, super manager en lecture seule, manager, conseiller : 403 sur chaque route, sans appel au fournisseur), `bots-routes.test.ts:352` (activation par un conseiller : 403).
- Web : l'espace Organisation (donc Connexions et Raccorder) ne se rend que pour un admin et redirige sinon (`organisation/layout.tsx:28-30, 70`) ; l'assistant exige admin hors lecture seule (`agents/new/page.tsx:12-25`) ; les encarts Numéro, Statut et Liste n'affichent leurs actions qu'avec `canEdit = isAdmin && !readOnly` (`overview.tsx:41`, `number-panel.tsx:49, 64`, `status-panel.tsx:54`) ; le bouton « Connecter WhatsApp » de l'accueil aussi (`setup-banner.tsx`, `canConnect`). La liste des comptes n'est jamais lue par une page de membre (le dialogue `AssignNumberDialog` ne s'ouvre qu'avec `canEdit`).

### Q4. Un secret peut-il revenir dans une réponse, un journal ou le DOM ? Jeton de vérification et URL de webhook limités à l'admin ?

Aucun jeton d'accès, secret d'app ni `productToken` ne revient : la vue du compte ne porte que des champs publics, `meta_app_id` ajouté par le lot compris (identifiant public, `whatsapp-account-service.ts:474-490`). La clé d'URL (seule authentification CM.com) et le jeton de vérification Meta reviennent dans `webhook` de chaque vue de compte (`whatsapp-account-service.ts:492-505`), par des routes réservées à `connections.manage`.

- Réponses : le BFF relaie le JSON du moteur sans l'enrichir ; `errorResponse` ne relaie que `code`, `message` et `details` (`api-response.ts:5-13`).
- Journaux web : les `console.error` du lot ne journalisent qu'un message fixe et l'erreur (statut HTTP, erreur réseau), jamais un corps (`api-fetch.ts:171`, `step-number.tsx:53`, `step-activate.tsx:111`, `assign-number-dialog.tsx:51`, `assign-bot-dialog.tsx:56`). Journaux moteur : inchangés depuis la revue 2b-2, identifiants de compte seulement.
- DOM : les champs secrets du raccordement sont en `type="password"`, `autoComplete="new-password"`, vidés au changement de mode et après la création (`connect-form.tsx:65-66, 111-112, 141-143`). Le jeton de vérification est masqué par défaut (`webhook-box.tsx:47-49, 79`) ; l'URL de webhook s'affiche en clair, comme le demande la spec (§9.1). La copie ne journalise rien (`webhook-box.tsx:22-33`). Le QR code est généré localement (`success.tsx:71`).
- Limite : la liste complète, avec ses secrets de webhook, est lue aussi par le compteur du rail sur chaque page Organisation, par les étapes Numéro et Activer de l'assistant et par le dialogue de branchement de la page de l'agent IA, qui n'en ont pas besoin. Toujours admin seulement : voir M-2.

### Q5. Une liste périmée peut-elle mener à brancher un numéro sur le mauvais agent IA, ou activer un agent IA sur un numéro qui n'est plus le sien ?

Pas vers une autre organisation, ni vers un autre agent IA que celui choisi, ni vers un autre numéro que celui choisi. Mais une liste périmée peut faire débrancher sans avertissement un agent IA qui sert (M-1).

- Tenu : les identifiants de numéro et de compte ne sont jamais réutilisés (`AUTOINCREMENT` sur SQLite, `SERIAL` sur Postgres, `whatsapp-sqlite.ts:22, 46`, `whatsapp-postgres.ts:58, 82`) ; un numéro supprimé (déconnexion) ou retiré répond 404 ou 409 `number_removed`. Le moteur relit tout dans la transaction (`assign`, `transition`, `activateWithNumber`, `whatsapp-sqlite.ts:290-339, 382-397`) : le statut demandé est contrôlé sur les faits du moment (un démarquage entre l'étape 4 et l'activation donne 409 `not_from_draft`). Le changement d'organisation dans un autre onglet est coupé par le 409 `ORG_CHANGED` (Q1).
- Non tenu : `AssignNumberInput` et `ActivateBotInput` ne portent que `number_id` (`packages/contracts/src/whatsapp.ts:47, 57-61`), sans le détenteur attendu ; l'avertissement « l'agent IA X le perdra » repose sur la dernière lecture du navigateur. Voir M-1.
- La confirmation de l'assistant affiche le numéro de la lecture précédente, pas celui de la réponse du moteur : voir M-3.

### Q6. Une réponse authentifiée du BFF peut-elle être mise en cache et servie à un autre utilisateur ?

Non.

- Toutes les réponses des 41 routes `src/app/api/**` sont construites par `jsonResponse` ou `emptyResponse`, qui posent `Cache-Control: private, no-store` (`api-json.ts:8-18`), succès, 204, 400, refus du moteur, 500 et 404 de forme compris (`proxy.ts:20-27, 58-62`, `api-response.ts:5-13`).
- Filet : `next.config.ts:10-12` pose le même en-tête sur `/api/:path*`, donc aussi sur une erreur levée hors des `try` et rendue par Next.
- Cache de données de Next : `engineCall` force `cache: 'no-store'` après l'étalement de `init`, aucun appelant ne peut le remplacer (`engine-client.ts:27-31`). Next 15.5.19 : les gestionnaires `GET` ne sont plus mis en cache par défaut, et tous lisent `cookies()`. Aucune directive `revalidate`, `force-static` ni `unstable_cache` (recherche faite).
- Pages : toutes les pages de `app/[locale]` sont des composants client sans donnée ; les mises en page serveur ne lisent que la langue (`app/[locale]/layout.tsx`). Aucune page serveur ne lit une donnée d'utilisateur ou d'organisation.
- Test qui garde l'en-tête : `app/api/__tests__/api-no-store.test.ts` (fonctions, absence de construction de réponse hors `lib/api-json` dans `app/api`, `proxy.ts`, `api-response.ts`, règle de `next.config`), `proxy.test.ts` (six cas), `engine-client.test.ts` (`no-store` imposé), `auth-routes.test.ts`. Limite mineure, sans constat : l'expression contrôlée ne couvre ni `Response.redirect(` ni `NextResponse.rewrite(` ; le filet de `next.config` (testé) couvre ces cas.

### Q7. Un agent IA peut-il répondre en brouillon, en pause ou organisation suspendue par un chemin ouvert par ce lot ?

Non. Le lot n'ajoute aucun chemin d'écriture au moteur ; les écrans appellent les routes du 2b-2, qui décident avec `decideTransition` et `decideAssign` sur les faits relus dans la transaction, et le routage relit statut, compte et organisation à chaque message (revue 2b-2, invariant 4).

- Activation : `activateWithNumber` branche, écrit la liste puis applique `transition` ; un refus annule tout (`whatsapp-sqlite.ts:382-397`). `active` depuis le brouillon n'est accepté que sur un numéro marqué de test au moment de la transaction (`bot-status.ts:64`).
- Changement de numéro : un agent IA en brouillon ou en pause garde son statut (`decideAssign`, `bot-status.ts:96-104`) ; l'agent IA qui perd le numéro repasse en brouillon s'il servait (`whatsapp-sqlite.ts:313-315`).
- Changement de statut : `transition` relit numéro, compte (signatures rejetées en série comptées comme erreur, `whatsapp-sqlite.ts:179-183`) et liste (`whatsapp-sqlite.ts:324-339`).
- Organisation suspendue : `createRequireOrganization` refuse les routes d'administration (403 « Organisation suspendue. ») et le routage refuse de servir (revue 2b-2).
- Marquage et démarquage d'un numéro de test : `setWhatsAppNumberTestFlag` ne touche aucun statut (`whatsapp-sqlite.ts:565-570`). Le marquage permet `draft` vers `active` sur n'importe quel numéro de l'organisation (M-6 de la revue 2b-2, accepté) ; le démarquage laisse ouvert à tous un agent IA déjà actif. L'écran le dit dans les deux sens (`messages/fr.json:662, 665`). Ce n'est pas un agent IA en brouillon, en pause ou suspendu qui répond.

### Q8. Le déplacement de la machine d'états dans les contrats a-t-il changé une règle ?

Non. Comparaison ligne à ligne de `src/core/bot-status.ts` (`4ad4c0b`) et `packages/contracts/src/bot-status.ts` : seuls changent l'import des types (`WhatsAppAccountStateView`, union identique `'connected' | 'error' | 'disconnected'`, `whatsapp.ts:65`) et `BOT_STATUSES`, devenu exporté `as const` avec la même liste et le même ordre. `toBotStatus`, `isServingStatus`, `decideTransition`, `decideAssign` et `TRANSITION_MESSAGES` sont identiques. `SetBotStatusInput` dérive de la même liste (`bots.ts`). Les pilotes importent les mêmes fonctions depuis `@wabagent/contracts`, résolu vers les sources TypeScript (`packages/contracts/package.json`, `exports: ./src/index.ts`), sans copie compilée qui pourrait diverger. Le test déplacé est inchangé et complété (`isServingStatus`, `toBotStatus`) ; il tourne avec `npm test` (`vitest.config` inclut `packages/*/src/**`) et est typé par `tsconfig.test.json`. Le web appelle la même `decideTransition` (`bot-transitions.ts:34-47`), avec l'état affiché du compte, qui est aussi celui du moteur (`bot-number-summary.ts:13-18`).

## 3. Constats

Aucun constat bloquant.

### M-1 (mineur) : une liste périmée fait débrancher sans avertissement un agent IA qui sert

- Fichiers : `packages/contracts/src/whatsapp.ts:47, 57-61` (pas de détenteur attendu) ; `src/core/database/whatsapp-sqlite.ts:290-321` et l'équivalent Postgres (`whatsapp-postgres.ts:318`) ; `apps/web/src/components/connections/assign-bot-dialog.tsx:69, 76, 88-92` (détenteur lu dans la liste de la page, jamais relu) ; `apps/web/src/app/[locale]/(app)/organisation/connexions/page.tsx:55-78` (aucune relecture au retour sur l'onglet) ; `apps/web/src/components/agent/assign-number-dialog.tsx:76` (statut de l'agent IA lu sur la page) ; `apps/web/src/components/wizard/step-activate.tsx:226-245` (relu au montage et au retour sur l'onglet seulement).
- Scénario : chez acme, l'admin garde Connexions ouvert dans l'onglet 1, où le numéro N est « Libre ». Dans l'onglet 2 (ou un second admin), il branche N sur l'agent IA « Ventes » et l'active en accès limité ; les testeurs lui écrivent. De retour sur l'onglet 1 (pas de relecture), il choisit « Brancher sur un agent IA » pour N et « Support ». Le dialogue n'affiche aucun avertissement (`current` est `null`), le moteur accepte, « Ventes » repasse en brouillon et ne répond plus, sans que personne ne l'ait vu annoncé. Même chose depuis deux fenêtres côte à côte de l'assistant (pas d'événement `visibilitychange`). Variante : la page de l'agent IA affiche « brouillon » alors qu'il vient d'être activé ailleurs ; « Changer de numéro » ne prévient pas que le nouveau numéro servira tout de suite.
- Gravité : mineure. Intra-organisation, action d'admin, aucune fuite, aucun agent IA qui répond à tort (l'effet est un agent IA muet). Mais la spec (§9.3, §7.5) exige l'avertissement qui nomme l'agent IA qui perd le numéro, et l'anti-objectif « un élément d'interface sans effet qui ne le dit pas » est voisin : ici l'interface ne dit pas un effet réel.
- Correction proposée : ajouter au contrat un champ `expected_bot_id: string | null` (détenteur vu par l'écran) à `AssignNumberInput` et `ActivateBotInput`, comparé dans la transaction de `assign` (les deux pilotes) ; différent : 409 « Ce numéro a changé depuis votre lecture : vérifiez la liste. » sans rien écrire. Le web l'envoie depuis la vue affichée et relit la liste sur ce 409. En complément, relire la page Connexions au retour sur l'onglet, comme l'assistant. Test : deux branchements successifs avec le même `expected_bot_id: null` : le second répond 409 et le premier agent IA reste `limited` (SQLite et Postgres).

### M-2 (mineur) : les secrets de webhook sont servis à chaque lecture de la liste des comptes

- Fichiers : `src/core/services/whatsapp-account-service.ts:488, 492-505` (`webhook.path` porte la clé d'URL, `verify_token` le jeton) ; lecteurs côté web qui n'en ont pas besoin : `apps/web/src/app/[locale]/(app)/organisation/layout.tsx:44` (compteur du rail, sur chaque page Organisation), `components/wizard/step-number.tsx:46`, `components/wizard/step-activate.tsx:104`, `components/agent/assign-number-dialog.tsx:44`.
- Scénario : un admin d'acme ouvre Organisation › Entités ; le navigateur reçoit, pour compter les comptes, la clé d'URL CM.com (seule authentification du webhook CM.com) et le jeton de vérification Meta de chaque compte. Une extension de navigateur, un enregistreur de session ou un outil d'observabilité branché plus tard sur le web, qui capture les réponses réseau, les recueille sur des écrans sans rapport avec le webhook. Quiconque détient la clé CM.com peut injecter des messages entrants dans l'agent IA d'acme.
- Gravité : mineure. Les routes restent réservées à `connections.manage` de la même organisation ; aucune fuite entre organisations ni vers un non-admin. C'est une exposition plus large que nécessaire d'un secret d'authentification.
- Correction proposée : retirer `webhook` de la vue de liste (ou n'y garder qu'un indicateur « configuré ») et le servir par `GET /whatsapp-accounts/:id` ou une route dédiée `GET /whatsapp-accounts/:id/webhook`, lue par la seule boîte webhook ; le compteur du rail et les sélecteurs de numéro lisent la liste sans secret. Test : `GET /whatsapp-accounts` ne contient ni la clé d'URL ni le jeton de vérification d'aucun compte (recherche dans le texte JSON).

### M-3 (mineur) : la confirmation de l'assistant affiche le numéro de la dernière lecture, pas celui du moteur

- Fichiers : `apps/web/src/components/wizard/step-activate.tsx:178-188` (`onActivated({ status, phone: found.number.phone_e164 })`, la réponse du moteur est ignorée) ; `components/wizard/success.tsx:71` (QR code et lien `wa.me` construits sur ce numéro).
- Scénario : entre la lecture de l'étape 5 et le clic, un rafraîchissement d'inventaire met à jour la ligne N (même identifiant fournisseur, autre E.164 : cas prévu par le moteur, `whatsapp-sqlite.ts:266-272`). L'activation porte sur N (bon numéro), mais le QR code et le lien `wa.me` pointent vers l'ancien E.164, qui peut être tenu par une autre organisation depuis. Le testeur écrit alors à un numéro qui n'est pas celui de l'agent IA.
- Gravité : mineure, cas rare ; aucune donnée ne traverse (le message du testeur est traité, ou non, par le détenteur réel du numéro, selon ses propres règles).
- Correction proposée : lire le numéro et le statut dans la réponse du moteur (`BotDetail.whatsapp_number.phone_e164`, `BotDetail.status`, déjà renvoyés par `POST /bots/:id/activate`) ; illisible : confirmation sans QR code. Test : réponse du moteur avec un autre E.164 que la liste : le QR code et le lien portent celui du moteur.

## 4. Invariants vérifiés tenus (avec la preuve)

1. **Organisation du cookie seule, liée à l'utilisateur du jeton** : `engine-fetch.ts:64-73, 96`, `org-cookie.ts:11-37`. Tests : `engine-fetch.test.ts`, `org-cookie.test.ts`.
2. **Onglet et cookie concordants, sinon 409 sans appel** : `engine-fetch.ts:67-71`, `api-fetch.ts:60-77`, `session-provider.tsx:197-212`. Tests : `whatsapp-accounts-routes.test.ts:187`, `bot-actions-routes.test.ts:142`, `api-fetch.test.ts`.
3. **Identifiants de chemin** : compte et numéro numériques contrôlés par le BFF (`proxy.ts:20-23`) puis par le moteur (`whatsapp-accounts.ts:11-16`) ; identifiant d'agent IA encodé (`bots/[botId]/{number,status,allowlist,activate}/route.ts`). Test : `bot-actions-routes.test.ts:118`.
4. **Corps validés avant tout appel** avec les schémas des contrats (`proxy.ts:44-53`), puis revalidés par le moteur. Tests : `bot-actions-routes.test.ts:45-116`, `whatsapp-accounts-routes.test.ts:70-120`.
5. **404 neutres** pour compte, numéro et agent IA d'une autre organisation (Q2).
6. **Écritures réservées à l'admin**, masquées par le web et refusées par le moteur (Q3).
7. **Aucun cache** des réponses du BFF ni des appels au moteur (Q6).
8. **Machine d'états inchangée et partagée** (Q8).
9. **Aucune persistance client** d'un état d'organisation : pas de `localStorage` ; seul un type de message de session dans `sessionStorage` (`session-provider.tsx:56-65`) ; rechargement complet au changement d'organisation.
10. **Liens externes** sans fuite d'adresse : `rel="noopener noreferrer"` ; aucune URL de page ne porte de secret.

## 5. Observations héritées ou hors périmètre

- Routes BFF `GET /api/bots/[botId]`, `health`, `metrics`, `leads`, `usage` : identifiant interpolé sans `encodeURIComponent` (lignes touchées par le lot pour `jsonResponse` seulement). Un identifiant contenant `../` encodé pourrait viser une autre route `GET` du moteur, toujours avec le jeton et l'organisation de l'utilisateur : aucun gain de droit ni d'organisation. Je n'ai pas vérifié si Next décode `%2F` dans les paramètres. À aligner sur les routes du lot (encodage systématique).
- Le moteur ne pose aucun `Cache-Control` sur ses réponses d'administration (et Express ajoute un `ETag`). Le BFF appelle en `no-store` et les caches partagés ne stockent pas une réponse à une requête portant `Authorization` ; à fixer quand même à l'audit avant mise en ligne si l'API d'administration passe par le tunnel public.
- Pages HTML statiques (sans donnée) : Next peut leur donner un `s-maxage` long ; sans conséquence d'isolation, à garder en tête pour la configuration du tunnel.
- Le numéro de l'organisation est masqué à l'écran pour un non-admin (`number-panel.tsx:56`, `agents-table.tsx:54`) mais présent en clair dans le JSON (`/api/bots`, `/api/bots/summary`) : masquage d'affichage seulement. La liste d'accès limité (numéros personnels des testeurs) est lisible par tout membre, conseillers d'autres entités compris (`org.read` sans filtre par entité, déjà relevé par l'audit de la zone ; lecture voulue par la spec §9.4).
- M-6 de la revue 2b-2 (marquage manuel « numéro de test », accepté) : désormais accessible en deux clics depuis l'écran ; le texte du dialogue le dit. À réexaminer à l'audit complet.
- Perte de mise à jour possible sur la liste d'accès limité entre deux onglets (le `PUT` remplace la liste) ; l'encart signale une liste changée entre-temps. Intra-organisation.
