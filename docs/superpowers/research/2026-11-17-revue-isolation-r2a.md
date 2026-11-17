# Revue d'isolation du lot R2a (guide en deux temps, profil WhatsApp, nom d'affichage)

Date : 17 nov. 2026. Branche : `feat/r2a-guide-profil-nom` (HEAD `a85540f`), base du diff `1f07bc7`.
Relecteur indépendant : aucune conclusion des implémenteurs reçue ; les commentaires du code (rulings, « surface d'isolation ») ont été lus comme des affirmations à vérifier, jamais comme acquis.

## Bilan

- Bloquant : 0
- Important : 0
- Mineur : 4 (M-1 à M-4)

Les neuf questions sont « tenu », avec les réserves des mineurs pour les questions 3, 5 et 8.

## 1. Méthode

Lu :
- `CLAUDE.md` (règles multi-organisations, routes de webhook, obligations de méthode) ;
- la spec `docs/superpowers/specs/2026-11-17-r2a-guide-profil-nom-design.md`, en entier, §2, §6, §9 et §13 en particulier ;
- le diff `git diff 1f07bc7..HEAD -- src packages apps/web/src scripts` (90 fichiers) ;
- le code appelé ou appelant, hors diff compris : `src/webhooks/meta.ts` (ordre d'authentification, `processBatch`, `siblingFinder`), `src/whatsapp/meta-events.ts`, `src/whatsapp/refresh-scheduler.ts`, `src/whatsapp/meta-graph.ts`, `src/whatsapp/meta-profile.ts`, `src/whatsapp/inventory-plan.ts`, `src/whatsapp/provider-common.ts` (`sanitizeProviderText`, `httpJson`), `src/core/services/whatsapp-account-service.ts` (create, createMeta, replaceCredentials, verify, verifyWebhooks, refreshNumbers, refreshOnProviderEvent, claimConnection), `src/core/services/whatsapp-number-profile-service.ts`, `src/core/services/bot-number-summary.ts`, les pilotes `whatsapp-sqlite.ts`, `whatsapp-postgres.ts`, `whatsapp-types.ts`, `src/api/admin/router.ts`, `src/api/admin/routes/whatsapp-accounts.ts`, `src/api/middleware/error-handler.ts`, `src/api/errors.ts`, `scripts/check-logs.ts` ;
- web : `apps/web/src/lib/proxy.ts`, `api-fetch.ts`, `engine-fetch.ts`, `engine-client.ts`, `api-response.ts`, `request-body.ts`, `zod-fr.ts`, `meta-input.ts`, `whatsapp-display.ts`, les routes BFF `apps/web/src/app/api/whatsapp-accounts/[accountId]/numbers/[numberId]/**`, `display-name-panel.tsx`, `profile-dialog.tsx`, les appelants de `metaLinks` et `whatsAppManagerUrl` ;
- contrats : `packages/contracts/src/whatsapp.ts`, `meta-links.ts`, `errors.ts` ;
- tests : `src/__tests__/isolation/profil-nom.test.ts` et `graph-fake.ts`, `whatsapp-number-profile-service.test.ts`, `whatsapp-number-profile-routes.test.ts`, la section R2a de `whatsapp-store.test.ts`, le test BFF `number-profile-routes.test.ts`, le test web §9.7 de `connexions/__tests__/page.test.tsx`.

Lancé :
- SQLite : `npx vitest run src/__tests__/isolation/profil-nom.test.ts src/core/services/__tests__/whatsapp-number-profile-service.test.ts src/api/admin/__tests__/whatsapp-number-profile-routes.test.ts` : 53 tests verts ;
- Postgres (conteneur jetable, `npm run test:pg`) : `profil-nom.test.ts`, `whatsapp-number-profile-service.test.ts`, `whatsapp-store.test.ts` : 105 tests verts ;
- web : test BFF du profil, page Connexions, encart du nom : 58 tests verts ;
- `npm run check:logs` et `npm run check:tests` : ok ;
- mutation temporaire : retrait de `|| number.account_id !== account.id` dans `whatsapp-number-profile-service.ts:252`. Le test « les cinq routes avec un compte ou un numéro de B depuis A » casse (cas du numéro du compte CM.com de beta sous le compte Meta de beta). Fichier restauré à l'identique depuis une copie (vérifié par `git diff --stat` vide et `git status` propre).

## 2. Constats

### Bloquant

Aucun.

### Important

Aucun.

### Mineur

**M-1. Le code de vérification en deux étapes n'est cherché dans les octets bruts de la base que sous SQLite.**
- Preuve : `src/core/services/__tests__/whatsapp-number-profile-service.test.ts:646` à `:692` lit les fichiers de la base SQLite ; sous Postgres, le test « deux moteurs » (`:627` à `:641`) et l'isolation (`profil-nom.test.ts:232` et `:233`) ne relisent que `listAuditLog`, `listWhatsAppNumbers` et `listWhatsAppAccounts` en JSON.
- Scénario : une évolution qui écrirait le code dans une autre table (sessions, journal d'une file, colonne ajoutée hors de ces trois lectures) passerait la suite sous Postgres. Aucun chemin actuel n'écrit le code en base (vérifié : `pin` ne sort de `applyDisplayName` que vers `registerNumber`, `meta-profile.ts:260`, et la trace d'audit ne porte que `number_id`, `ok`, `reason`, `whatsapp-number-profile-service.ts:325` à `:336`).
- Proposition : sous Postgres, parcourir toutes les colonnes texte et JSONB de toutes les tables (`information_schema.columns`) à la recherche du code reconnaissable, après réussite et après échec.

**M-2. La garde statique du code ne couvre que le moteur ; dans le web le code vit sous le nom `code`.**
- Preuve : `scripts/check-logs.ts:80` ajoute `pin` aux mots sensibles, appliqués au moteur seulement (CLAUDE.md : « dans le moteur, aucune donnée sensible »). Dans le web, le code est l'état `code` de `apps/web/src/components/connections/display-name-panel.tsx:69`, envoyé en `{ pin: code }` (`:120`). Le test BFF de l'application (`apps/web/src/app/api/whatsapp-accounts/__tests__/number-profile-routes.test.ts:163` à `:176`) contrôle la réponse mais ne capture pas les journaux du BFF.
- Scénario : un `console.error('[Connections] ...', code)` ajouté plus tard dans l'encart, ou un journal du BFF qui recopierait le corps, ne serait refusé par aucune garde ni aucun test. Aujourd'hui aucun journal web ne porte le code (vérifié : `api-fetch.ts:239`, `api-response.ts`, `engine-client.ts` ne journalisent ni corps ni en-têtes).
- Proposition : étendre au web la règle des mots sensibles pour `pin` et `code` dans les composants de Connexions, ou capturer `console` dans le test BFF de l'application.

**M-3. « Vérifier maintenant » relit le portefeuille même quand la vérification des webhooks a constaté un remplacement concurrent.**
- Preuve : `whatsapp-account-service.ts:1229` à `:1236` appelle `syncBusiness` dès que `hooks.tokenRefused === null`, y compris quand `verifyWebhooks` est sorti par `waba.stale` (`:1274`) ou par `!stillCurrent` (`:1284`) ; le remplacement des identifiants, lui, s'en garde (`:1142`, ruling R-16).
- Scénario : pendant un remplacement concurrent, la vérification lit le portefeuille avec les anciens identifiants et l'écrit. La WABA est la même (le remplacement ne peut pas en changer, `:1066`), la ligne écrite est celle du compte de cette organisation (`setWhatsAppAccountBusiness(account.client_id, account.id, …)`, SQL filtré par `client_id`), et le propriétaire d'une WABA ne dépend pas du jeton : aucune fuite entre organisations, seulement une incohérence avec la règle R-16 et une trace `business_changed` possible avec un acteur qui n'a pas fait le changement.
- Proposition : sauter `syncBusiness` quand `verifyWebhooks` a constaté un état périmé, comme au remplacement.

**M-4. Délai entre la recherche du numéro et l'appel à Meta (TOCTOU), sans nouvelle lecture de l'état du numéro.**
- Preuve : `target()` (`whatsapp-number-profile-service.ts:248` à `:262`) lit compte et numéro une fois ; `applyDisplayName` ne relit sous verrou que la demande de nom (`:218`), pas `provider_state` ni l'état du compte ; les autres opérations ne relisent rien.
- Scénario : l'organisation A a un compte en erreur dont le numéro P est encore présent ; l'admin de B fait « Rafraîchir les numéros » et reprend P (reprise permise, `inventory-plan.ts:76` à `:81`) entre la lecture de `target()` et l'appel de A. L'appel part avec le jeton de A, sur P. Meta n'accepte que si le jeton de A a encore accès à P, donc avec des droits que A tient de Meta et non de WABAGENT ; la fenêtre est de quelques millisecondes. Ce n'est pas un repli d'identifiants ni une lecture de données de B en base.
- Proposition : relire le numéro (présent, même compte) juste avant l'appel à Meta dans les écritures, ou accepter et documenter la limite, comme pour les autres appels hérités.

## 3. Réponses aux questions

### Question 1. Profil, nom, code, portefeuille ou appel à Meta pour un compte ou un numéro d'une autre organisation, ou d'un autre compte de la même organisation : tenu

- Les cinq routes passent par `target()` avant tout appel extérieur : compte par `getWhatsAppAccount(clientId, accountId)` (`whatsapp-number-profile-service.ts:249`, SQL `WHERE client_id = ? AND id = ?`, `whatsapp-sqlite.ts:525`, `whatsapp-postgres.ts:553`), numéro par `getWhatsAppNumber(clientId, numberId)` (SQL filtré par `client_id`, `whatsapp-sqlite.ts:710`, `whatsapp-postgres.ts:761`), puis `number.account_id !== account.id` (`:252`), 404 avec le même texte qu'un inconnu. Puis seulement l'état du compte, le mode, l'état du numéro, le déchiffrement et le contexte Graph (`:254` à `:260`).
- Routes : les identifiants de chemin sont lus avant le corps, sauf le corps binaire de la photo, lu après `requireAuth`, la résolution de l'organisation et `connections.manage` (`routes/whatsapp-accounts.ts:114`, `router.ts:76`) et avant toute recherche, sans effet extérieur.
- Écritures SQL nouvelles, toutes bornées par l'organisation et le compte : `setWhatsAppNumberNameRequest`, `setWhatsAppNumberDisplayName`, `setWhatsAppNumberPinEnabled` (`WHERE client_id = ? AND account_id = ? AND id = ?`, `whatsapp-sqlite.ts:754` à `:775`, `whatsapp-postgres.ts:808` à `:832`) ; `setWhatsAppAccountBusiness` (lecture `WHERE client_id = ? AND id = ? AND state <> 'disconnected'` sous transaction et verrou de ligne, puis `UPDATE … WHERE id = ?` sur la ligne verrouillée, `whatsapp-sqlite.ts:650`, `whatsapp-postgres.ts:675`) ; `clearWhatsAppAccountBusiness` (`WHERE client_id AND id`). Dans l'inventaire, la demande de nom réconciliée vient de la ligne du compte lui-même (`byId.get(u.id)` sur `plan.updates`, qui ne référence que `own`, `inventory-plan.ts:84`) ; une insertion part de rien (`reconcileNameState(undefined, …)`). Une ligne reprise à un autre compte n'apporte donc jamais sa demande de nom.
- Raccordement : la lecture du portefeuille (`whatsapp-account-service.ts:386`) suit la vérification (lecture seule) et précède `claimConnection` (`:530`), les contrôles d'unicité et toute écriture chez Meta (`readEntryBeforeWrite` puis inscription, `:549` et suivantes). Elle n'utilise que les identifiants saisis. Le refus `business_mismatch` ne dit rien de l'appartenance de la WABA à une autre organisation : il nomme le portefeuille lu avec le jeton de l'appelant (`profil-nom.test.ts:301` à `:316`).
- Vérification, remplacement, relecture des numéros : `syncBusiness` reçoit le compte retrouvé dans l'organisation et ses propres secrets (`:1143`, `:1234`, `:1352`).
- Autre compte de la même organisation : refusé par `number.account_id !== account.id`, prouvé par mutation (méthode) ; le test de service « numéro d'un autre compte de la même organisation » (deux comptes Meta d'acme aux jetons distincts) le couvre aussi.

### Question 2. Identifiants envoyés à Meta : tenu

- Un seul constructeur de contexte : `makeContext` avec les secrets déchiffrés du compte du numéro (`whatsapp-number-profile-service.ts:260`), contexte créé à chaque requête, jamais gardé. `readMetaBusiness` par défaut : `readOwnerBusiness(makeContext(c), c.waba_id)` avec les identifiants passés (`whatsapp-account-service.ts:64`). Aucune lecture de `process.env` ni de `config.meta` autre que `graphVersion` dans `meta-profile.ts` et `meta-graph.ts`.
- `withSecrets` rend un nouveau contexte sans modifier l'original (`meta-profile.ts:63`).
- L'envoi de la photo vers la session ne part qu'à une adresse de Graph contrôlée (`uploadSessionUrl`, `meta-profile.ts:49` à `:55`), sans redirection (`httpJson`, `provider-common.ts:94`).
- Test : `profil-nom.test.ts:157` à `:239` pose des variables d'environnement de plateforme reconnaissables et contrôle, pour chaque appel des deux organisations, jeton, `appsecret_proof`, chemin et absence des marqueurs de l'autre organisation et de l'environnement ; le faux Meta (`graph-fake.ts`) refuse un jeton sur un numéro d'une WABA qui ne lui est pas partagée.

### Question 3. Code de vérification en deux étapes : tenu (réserves M-1 et M-2)

- Base : jamais écrit. `applyDisplayName` ne le passe qu'à `registerNumber` (`whatsapp-number-profile-service.ts:220`) ; les écritures en base de cette méthode ne portent que le nom demandé et la demande effacée.
- Trace d'audit : `audited` n'écrit que `number_id`, `ok`, `reason` (`:325` à `:336`).
- Journaux : aucun journal n'a le code ; `check:logs` refuse `pin` dans le moteur (`scripts/check-logs.ts:80`, test `src/__tests__/check-logs.test.ts`).
- Réponses et détails d'erreur : refus de forme Zod avec un message fixe sans la valeur (`ApplyDisplayNameInput`, `packages/contracts/src/whatsapp.ts`, `errorMap` sur le type et regex) ; le gestionnaire d'erreurs ne recopie que `path` et `message` des issues (`error-handler.ts:60` à `:62`) ; corps JSON illisible ou trop gros : seul le `type` de `body-parser` est journalisé (`:65` à `:68`) ; texte de Meta masqué avec le code ajouté aux secrets du contexte (`meta-profile.ts:260`, `sanitizeProviderText`).
- URL : le code part dans le corps du réenregistrement, jamais dans l'adresse (`profil-nom.test.ts:229` et `:230`).
- BFF : validé par le même schéma, message français fixe (`zod-fr.ts` garde le message écrit), aucun journal du corps ; le relais en cas de 401 renvoie le même corps au moteur, rien n'est gardé.
- Navigateur : état React seulement, vidé après chaque réponse (`display-name-panel.tsx:121`), champ `type="text"`, `autoComplete="one-time-code"`, sans attribut `name` ni `<form>` (aucun envoi GET de formulaire, rien dans l'historique), aucune écriture dans `sessionStorage` ou `localStorage` (recherche faite dans `components/connections/`).
- Recherche dans les octets bruts : sous SQLite seulement (M-1).

### Question 4. Événements Meta (`phone_number_*`, `account_update`) : tenu

- `src/webhooks/meta.ts` n'est pas modifié par le lot. L'ordre reste : en-tête de signature, compte par l'empreinte de la clé, corps brut, signature avec le secret de l'app du compte, puis seulement `processBatch`.
- `handleMetaEvents` ne garde que les événements dont l'entrée est la WABA du compte (`meta-events.ts:49`) et ne fait qu'un `scheduler.schedule(account.client_id, account.id)` (`:92`) ; il ne lit jamais le `phone_number_id` d'un événement de nom. Les événements d'une autre WABA ne sont traités que pour un compte `connected` de la même organisation et de la même app (`siblingFinder`, hérité de R1).
- La relecture qui suit (`refreshOnProviderEvent`, sans reprise) relit les numéros et maintenant le portefeuille du seul compte planifié, avec ses identifiants.
- Tests : `profil-nom.test.ts:321` (événement signé pour A qui nomme le numéro de B : seul A est relu, état de B identique en base, en vue, en audit et chez Meta) et `:358` (liste de A chez Meta qui déclare l'identifiant du numéro de B : refusé, rien de B ne bouge).

### Question 5. Portefeuille : tenu (réserve M-3)

- Origine : uniquement `readOwnerBusiness` sur la WABA du compte (`input.waba_id` au raccordement et au remplacement, `account.provider_account_id` à la vérification et à la relecture), avec le jeton du compte ; un portefeuille n'est rendu que si Meta donne un identifiant en chiffres et un nom (`meta-profile.ts:94` à `:104`).
- Écriture : dans la ligne du compte de cette organisation (question 1), jamais sur un compte déconnecté ; exposé par `presentBusiness` dans la seule vue de compte (`bot-number-summary.ts:71`), elle-même réservée à `connections.manage` et retrouvée dans l'organisation active. Aucune autre vue (agent IA, résumé du numéro) ne le porte.
- Règle « aucune écriture chez Meta avant les lectures de vérification » (spec 2b §7.1) : tenue au raccordement, la lecture du portefeuille est la dernière lecture qui peut refuser et précède toute écriture (`:386` puis `:530` et suivantes). Au remplacement et à la vérification, la lecture suit les écritures, mais elle ne peut rien refuser (spec R2a §5.1 : relu, jamais demandé) : la règle ne s'y applique pas.
- Tests : `profil-nom.test.ts:242` (portefeuille gardé lu avec le jeton du compte ; vue, liste, vérification, relecture, renommage de B depuis A en 404 sans appel ; refus `business_mismatch` sans aucun `POST` chez Meta, qui ne nomme que le portefeuille d'A) ; `whatsapp-store.test.ts` (« portefeuille écrit avec une autre organisation : rien de changé »).

### Question 6. Verrou en mémoire et autre état du processus : tenu

- Seul état nouveau : `appliesInFlight` (`whatsapp-number-profile-service.ts:101`), clé `clientId:accountId:numberId` (`:104`), libéré dans un `finally`. Il ne bloque qu'une seconde application du même numéro de la même organisation ; il ne porte jamais le code.
- `meta-profile.ts` n'a aucun cache ; le planificateur hérité est clé par organisation et compte. `claimConnection` (hérité) est clé par WABA seule, par conception (une WABA ne se raccorde que dans une organisation à la fois), et le lot ne change pas son usage.

### Question 7. Liens web : tenu

- `metaLinks` ne recopie qu'un identifiant de 5 à 25 chiffres (`meta-links.ts:15`, `:81` et `:82`). Tous les appelants passent le portefeuille et la WABA du compte affiché : `account-alerts.tsx:148`, `numbers-table.tsx:144`, `number-menu.tsx:68`, `display-name-panel.tsx:90`, `account-card.tsx:105` et `connect-result.tsx:61` (vers `account-webhooks.tsx:154`) ; le guide n'utilise que la saisie de l'utilisateur (`business-step.tsx:38`, `guide-paths.tsx:44`).
- Test : `connexions/__tests__/page.test.tsx` (« liens précis : deux comptes de portefeuilles différents… ») contrôle menu, alertes, échec de remise et état Meta, et l'absence du portefeuille et de la WABA de l'autre compte.

### Question 8. Tests des invariants du §9 : tenu (réserves M-1 et M-2)

1. §9.1 (autre organisation, 404 sans appel) : `profil-nom.test.ts:114`, SQLite et Postgres ; contrôle aussi `fetch` global, la base de B, la trace et l'état chez Meta.
2. §9.2 (autre compte de la même organisation) : même test, cas CM.com et Meta de beta ; la mutation de `:252` le fait casser. Test de service « numéro d'un autre compte de la même organisation » avec deux comptes Meta d'acme.
3. §9.3 (identifiants) : `profil-nom.test.ts:157` ; test de service « jeton et appsecret_proof du compte du numéro ».
4. §9.4 (code) : `profil-nom.test.ts:228` à `:233` ; `whatsapp-number-profile-service.test.ts:627` (deux moteurs) et `:646` (octets SQLite) ; `whatsapp-number-profile-routes.test.ts:233` (réponses HTTP et journaux, réussite, refus 133005, refus générique, forme) ; `check-logs.test.ts` pour `pin`. Lacunes : M-1, M-2.
5. §9.5 (portefeuille) : `profil-nom.test.ts:242`.
6. §9.6 (événement de nom) : `profil-nom.test.ts:321` et `:358`. Remarque : `meta-events.ts` ne lit pas le `phone_number_id` d'un événement de nom ; ces tests sont des gardes de régression, avec contrôle positif (A est bien relu).
7. §9.7 (liens) : test web cité à la question 7.

Aucun test relu ne passerait si l'isolation cassait sur le chemin qu'il cible : chaque test d'isolation a un contrôle positif (la même action par le propriétaire appelle bien Meta avec ses identifiants), et le faux Meta applique les règles d'accès de Meta.

### Question 9. Autres menaces dans le diff et le code touché : tenu (réserve M-4)

- Les routes du profil acceptent un compte en `error` (pas seulement `connected`). Les appels partent alors avec les identifiants de ce compte, sur son propre numéro : pas de traversée d'organisation. La spec ne tranche pas ce cas ; à noter pour le produit, pas pour l'isolation.
- Un refus « jeton invalide » sur une route du profil met le compte en erreur (`setWhatsAppAccountError(t.account.id, …)` avec comparaison du secret chiffré), comme la relecture des numéros : effet borné au compte de l'organisation.
- La reprise d'un numéro d'un autre compte (requête des détenteurs sans filtre d'organisation, `whatsapp-sqlite.ts:326` et suivantes) est héritée et voulue (unicité sur la plateforme, spec 2b) ; le lot ne l'élargit pas : la relecture lancée par une demande de nom se fait sans reprise (`refreshNumbers` par défaut `allowTakeover: false`).
- Corps binaire de la photo : limite propre à la route (`express.raw`, 5 Mo), la limite JSON de 256 ko des autres routes ne change pas (test « limite JSON inchangée »), erreur de l'analyseur remplacée par `photo_invalid` sans le corps.
- Adresse de la photo servie par Meta : seulement en `https` (`meta-profile.ts:111`), rendue à l'admin de l'organisation du numéro.
