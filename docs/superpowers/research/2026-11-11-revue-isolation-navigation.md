# Revue d'isolation : lot « Refonte de la navigation » (tâche 16)

Date : 11 novembre 2026. Branche : `feat/refonte-navigation` (tête `80b5a02`). Relecteur : lecture indépendante, sans les rapports des exécutants ni le registre des décisions.

Sources lues : `CLAUDE.md` (règles non négociables), spec `docs/superpowers/specs/2026-11-10-refonte-navigation-design.md` (sections 7, 8, 9, 13, 15), plan `docs/superpowers/plans/2026-11-10-refonte-navigation.md` (tâche 16).

Périmètre : `git diff main --stat -- src packages apps/web/src/app/api apps/web/e2e/mock-engine.ts` (52 fichiers), `scripts/create-organization.ts`, et le code appelé ou appelant : `resolveAccess`, `createRequireOrganization`, `requireAction`, `can()`, `canSeeContactNumbers`, `presentBotForViewer`, `maskContactNumber`, `loadBotNumberSummary`, `displayedAccountState`, `checkRoute` (lecture seule), `getClient`, `getAllowlist`, `createClientWithEntity`, `AuthService.me`, `usableGrants`, et toutes les routes qui renvoient `allowlist`, `phone` ou un coût (`grep -rn "allowlist\|\.phone\|phone:" src/api src/core/services`).

## Résultat

| Gravité | Nombre |
|---|---|
| Bloquant | 0 |
| Important | 0 |
| Mineur | 4 |

Aucune fuite entre organisations ni entre membres d'une organisation n'a été trouvée sur le code du lot.

## Contrôle de la spec 15.8

`git diff --stat main -- src/webhooks src/transport src/whatsapp src/core/router.ts` : sortie vide. Ni le chemin des messages, ni les identifiants, ni les webhooks, ni le routeur ne sont modifiés. `src/core/handler.ts` et `src/webhooks/pipeline.ts` ne figurent pas non plus dans le diff.

## Tests lancés

- `npm test` (SQLite) : 138 fichiers, 1889 tests passés, 4 ignorés.
- `npm run typecheck` : vert.
- `npm run check:logs` : vert (aucune nouvelle ligne `console.*` dans `src`, `packages` ni le BFF du lot).
- `npm run check:tests` : vert.
- Tests BFF du web (`apps/web/src/app/api/usage`, `apps/web/src/app/api/bots`) : 7 fichiers, 70 tests passés.
- `npm run test:pg` : **non lancé**. Docker n'a pas pu tirer l'image (`unable to get image 'postgres:16-alpine': unexpected end of JSON input`) et `TEST_DATABASE_URL` n'est pas posé. Les nouveaux tests passent par `createTestDatabase()` et la requête Postgres de `listLeadsByBot` a été relue (indices `$i` cohérents dans les deux branches), mais leur passage sur Postgres n'est pas constaté par cette revue. À lancer par le contrôleur avant le commit (étape 2 de la tâche).

## Constats

### m-1 (mineur) : champs libres des leads non masqués pour un membre masqué

- Fichier : `src/core/services/dashboard-service.ts:68` à `75`.
- Scénario : dans l'organisation A, l'admin configure les champs extraits d'un agent IA de l'entité « Lyon » (`lead_fields`, injectés tels quels dans le prompt d'extraction, `src/core/handler.ts:30`) avec un champ « telephone » ou « numero_rappel ». Le contact donne son numéro dans la conversation ; l'extraction l'écrit sous cette clé. Un conseiller de l'entité « Paris » lit `GET /bots/:botId/leads` : `phone` et `qualified_data.phone` sont masqués, mais `qualified_data.telephone` est renvoyé en entier.
- Portée : même organisation, donnée personnelle ; pas de fuite entre organisations. La clé écrite par le moteur lui-même (`phone`, `handler.ts:498`) est bien masquée, y compris quand l'extraction la réécrit en nombre. Le détail d'un lead (`transcript`) est refusé en 403 au membre masqué, donc le texte des messages n'est pas atteignable.
- Statut : limite écrite par la spec (9.2, « `qualified_data` et `transcript` sont du texte libre […] hors périmètre »). Le constat sert à garder la trace que la limite couvre aussi des clés configurées par l'admin, pas seulement du texte tapé.
- Test : aucun, voulu (hors périmètre). À reprendre dans le chantier Conversations et leads.

### m-2 (mineur) : masquage des agents IA appliqué route par route, sans garde qui casse si une lecture l'oublie

- Fichiers : `src/api/admin/routes/bots.ts:16` et `:26` (seuls appels de `presentBotForViewer`) ; `src/core/services/bot-service.ts:199` à `311` (toutes les écritures renvoient `getBot` en entier).
- Scénario : une future route ouverte à `org.read` (par exemple une recherche d'agents IA, ou une route d'entité qui renvoie ses agents IA) appelle `botService.getBot` ou `listBots` sans passer par `presentBotForViewer` ; ou bien `bots.configure` est un jour ouvert à un manager d'entité. Un conseiller d'une autre entité recevrait alors la whitelist en entier. Aujourd'hui aucune route ne le fait : les deux lectures masquent, et les écritures sont réservées à `bots.configure`, que `can()` n'accorde qu'à l'admin et à l'opérateur (`permissions.ts:44` à `52`).
- Asymétrie : pour les leads, la règle est dans le service (`listLeads` et `getLead` exigent un `Access`, donc le compilateur force l'appelant à le fournir) ; pour les agents IA, elle est dans la route. Pour les coûts, une garde statique existe (`src/__tests__/cost-readers.test.ts`) ; il n'y a pas d'équivalent pour la whitelist.
- Règle concernée : « Tout invariant a un test qui casse quand on le viole » (`CLAUDE.md`). L'invariant tenu ici (« toute réponse d'agent IA à un non-admin passe par `presentBotForViewer` ») n'est protégé que par les tests des deux routes existantes (`contact-numbers.test.ts`).
- Test manquant : une garde du type `cost-readers.test.ts` (tout appel de `listBots(`/`getBot(` dans `src/api` est soit sous `requireAction('bots.configure')`, soit enveloppé par `presentBotForViewer`), ou un test qui vérifie que `bots.configure` reste refusé à `manager` et `advisor` avec un commentaire qui lie ce refus au masquage.

### m-3 (mineur) : faux moteur moins strict que le moteur sur deux points

- Fichiers : `apps/web/e2e/mock-engine.ts:169` à `177` (`accessOf` pose toujours `platformAdmin: false`) ; `apps/web/e2e/mock-engine.ts:1040` (seule `/leads` est servie, `GET /bots/:botId/leads/:phone` n'existe pas et sa règle 403 n'est pas reproduite).
- Scénario : aucun dans le produit (le faux moteur ne sert qu'aux parcours Playwright, et n'a pas de compte opérateur). Un parcours e2e qui ouvrirait le détail d'un lead en tant que conseiller d'une autre entité recevrait un 404 du faux moteur, là où le moteur répond 403.
- Point positif : le faux moteur importe `canSeeContactNumbers` du moteur et `maskContactNumber` des contrats, sans recopier la règle.
- Test : sans objet ; à aligner si un parcours e2e touche le détail d'un lead ou l'opérateur.

### m-4 (mineur) : règle « coûts réservés à l'admin » dupliquée dans le BFF

- Fichier : `apps/web/src/app/api/usage/summary/route.ts:17` à `30`.
- Scénario : le BFF refuse lui-même (403) quand `/auth/me` donne pour l'organisation active un rôle autre que `admin`, avant tout appel au moteur. C'est plus strict que le moteur, jamais moins : si le rôle est indéterminé (cookie absent avec plusieurs organisations, cookie inconnu), la décision revient au moteur, qui refuse chaque `/usage` sans `usage.read`, et un 403 d'une ligne rend toute la réponse 403 (`route.ts:47`). L'opérateur reçoit `role: 'admin'` pour toutes les organisations (`auth-service.ts:152`), donc il n'est pas bloqué.
- Risque : deux sources de la même règle. Si `usage.read` est un jour ouverte à un autre rôle dans `permissions.ts`, le BFF refusera seul, sans qu'un test du moteur le signale. Aucun risque de fuite.
- Test : `summary.test.ts` couvre les trois cas (admin de l'organisation active, conseiller sans cookie, organisation indéterminée). Une note dans `permissions.ts` à côté de `usage.read` qui renvoie vers ce BFF suffirait.

## Vérifié sans constat

### Entre deux organisations

- `resolveAccess` (`src/core/auth/access-service.ts`) : appartenances filtrées par `user_id` et `client_id` de l'organisation demandée ; `entityRoles` ne contient que des entités de cette organisation, car les grants sont validés contre `getEntity(clientId, …)` à l'acceptation (`auth-service.ts:234` à `245`) et à l'écriture (`user-admin-service.ts:295`). Les entités d'un agent IA sont validées de même (`bot-service.ts:153` à `158`). `canSeeContactNumbers` ne peut donc pas rapprocher une appartenance d'une organisation d'un agent IA d'une autre, même avec des identifiants d'entité entiers globaux.
- `createRequireOrganization` pose `req.access` et `req.scopedClientId` d'un même appel ; `activeAccess` (nouveau, `auth.ts:68`) refuse sans droits résolus, comme `activeClientId`.
- Mention « Ne répond pas », `BotService.detail` : numéro, compte, whitelist et statut d'organisation lus avec `rec.client_id` ; `listBots` filtre les enregistrements sur `clientId` avant de lire une seule fois le statut de cette organisation (`bot-service.ts:182` à `186`) ; `getBot` passe par `getBotRecord(clientId, …)`.
- `loadNotResponding` (`bot-responding.ts:25` à `34`) : tout est lu avec le `clientId` du compte WhatsApp ; l'agent IA est relu par `getBotRecord(clientId, n.bot_id)` dans `numberView` (`whatsapp-account-service.ts:537`). La vue des comptes reste réservée à `connections.manage`.
- `loadBotNumberSummary` et `displayedAccountState` : lectures filtrées par organisation ; `isSignatureRejected` est indexé par l'identifiant global du compte, sans collision entre organisations.
- `decideResponding` (`packages/contracts/src/bot-status.ts`) : fonction pure, mêmes conditions et même ordre que `checkRoute` (`router.ts:50` à `62`) pour Preview et Online. L'équivalence est prouvée sur les deux moteurs par `src/core/__tests__/not-responding-equivalence.test.ts` (combinaisons, plus les trois écarts voulus : Draft et Offline, état affiché pour signatures rejetées, absence de numéro). Le faux moteur appelle la même fonction.
- Suite d'isolation `src/__tests__/isolation/navigation.test.ts` : mention chez l'organisation au compte en erreur seulement, dans les deux sens ; même 403 sur les coûts pour un agent IA d'acme et de beta ; numéros masqués pour un conseiller d'acme hors entité, 404 pour un membre de beta. Le harnais (`harness.ts`) gagne `memberApi` sans changer le chemin réel (`createApp`, vrai routeur, vraie connexion) ; aucun test existant n'est affaibli (les seuls changements d'attentes sont des textes de vocabulaire et l'ajout de `first_entity_name`).
- Coûts : `GET /bots/:botId/usage` porte `requireAction('usage.read')` avant toute lecture de l'agent IA ; un non-admin reçoit le même 403 générique pour son agent IA, un inconnu et un agent IA d'une autre organisation ; l'admin de A sur un agent IA de B reçoit 404 (`usage-access.test.ts`). `listLlmUsage*` n'est appelée que par `DashboardService.usage`, et la seule route qui l'appelle porte `usage.read` (`cost-readers.test.ts`). La réponse d'usage n'agrège ni `phone` ni contact (les lignes `llm_usage` portent un `phone`, jamais renvoyé).
- Première entité (spec 13) : `createClientWithEntity` insère l'organisation et l'entité avec le même `rec.client_id`, dans une transaction (SQLite `db.transaction`, Postgres `BEGIN`/`ROLLBACK` sur une connexion dédiée) ; INSERT strict, donc aucune organisation existante n'est écrasée ; `POST /clients` reste réservé à l'opérateur. Test : `clients-routes.test.ts` (une seule entité, nommée ainsi, entités des autres inchangées ; 400 sans le champ ou avec un nom invalide), `admin-service.test.ts` (création concurrente). Le script `scripts/create-organization.ts` valide le nom avec `EntityName` et ne renomme pas l'entité d'une organisation déjà créée.

### Entre deux membres d'une même organisation

- `can()` : `usage.read` absente de `MEMBER_ACTIONS` et de `READ_ONLY_ACTIONS`, donc refusée au super manager (avec ou sans lecture seule), au manager et au conseiller ; accordée à l'admin et à l'opérateur. Testé par `permissions.test.ts` et `usage-access.test.ts`.
- `canSeeContactNumbers` (`permissions.ts:60` à `64`) : en entier pour opérateur, admin, super manager (lecture seule comprise), et pour un manager ou un conseiller de l'entité de l'agent IA ; masqué sinon, y compris pour un agent IA sans entité. Droit calculé par agent IA dans une liste, jamais une fois pour toute la liste (`contact-numbers.test.ts`).
- `GET /bots` et `GET /bots/:botId` : whitelist masquée par `presentBotForViewer` ; le numéro de l'agent IA (`whatsapp_number`) n'est pas masqué, conformément à la spec 8.
- `GET /bots/:botId/leads` : `phone` et `qualified_data.phone` masqués (valeur non textuelle convertie puis masquée) ; la recherche ne porte que sur le nom pour un membre masqué, sur les deux pilotes (`sqlite.ts:446` à `456`, `postgres.ts:405` à `417`) ; tri par `created_at`, sans indice sur l'ordre des numéros. Tests : `contact-numbers.test.ts`, `leads-search.test.ts`.
- `GET /bots/:botId/leads/:phone` : 404 si l'agent IA n'est pas de l'organisation, puis 403 pour un membre masqué avant toute lecture du lead, donc même réponse que le numéro soit un contact ou non.
- Écritures (PATCH, PUT number, unassign, status, allowlist, activate, POST) : toutes sous `bots.configure`, que `can()` n'accorde qu'à l'admin et à l'opérateur ; leurs réponses entières ne vont donc qu'à eux (voir m-2 pour l'absence de garde structurelle).
- `maskContactNumber` (`packages/contracts/src/contact-mask.ts`) : un numéro de 8 chiffres ou plus garde au plus 3 premiers chiffres et 2 derniers, au moins 6 cachés, format fixe qui ne trahit pas la longueur ; moins de 8 chiffres : entièrement masqué ; BSUID : 2 premiers caractères. Ne renvoie jamais la valeur entière (`contact-mask.test.ts`). Distinct de `maskContact` des journaux.
- Autres routes ouvertes à `org.read` ou `simulate.use` relues : `/health` (numéro de l'agent IA, état CRM et LLM, pas de contact), `/metrics` (compteurs), `/entities`, `/settings`, `/simulate` (réponse : `session_id`, `reply`, `model`). Aucune ne renvoie de whitelist, de `phone` de contact ni de coût. `/audit` est réservé à `audit.read` (admin) et ne journalise que le nombre d'entrées de la whitelist.
- BFF : `/api/bots/summary` relaie `not_responding`, `status_reason` et l'état du compte, sans whitelist ni contact ; `/api/bots/[botId]/leads` relaie la réponse masquée du moteur et ne transmet que `page`, `page_size`, `search`, `rdv` ; `/api/bots/[botId]/usage` relaie le 403 (`usage-route.test.ts`) ; `/api/usage/summary` rend 403 entier sur un refus du moteur, sans ligne « indisponible » (`summary.test.ts`). Le web ne contient plus de fonction de masquage propre (`apps/web/src/lib/mask-number.ts` supprimé) : il affiche ce que le moteur renvoie.
- Journaux : aucun nouvel appel `console.*` dans le code moteur du lot ; `check:logs` vert.

## Limites de cette revue

- Suite Postgres non exécutée (voir « Tests lancés »).
- Les écrans web hors BFF (rail, colonne du milieu, pages) n'étaient pas dans le périmètre ; seul l'appel de `/api/bots/:id/usage` par la Vue d'ensemble a été repéré (`apps/web/src/app/[locale]/(app)/agents/[botId]/page.tsx:39`), sans vérifier ici qu'il n'est pas émis pour un conseiller (spec 15.5, test web).

## Suite donnée

- m-1 : hors périmètre de ce lot (spec 9.2), traité par le chantier « Conversations et leads ».
- m-2 : corrigé par `src/__tests__/allowlist-readers.test.ts` (commentaires `// revue isolation navigation m-2`). Le test casse si une route de `src/api` renvoie le résultat de `getBot`, `listBots` ou d'une écriture de `BotService` sans `presentBotForViewer` ou sans être sous `requireAction('bots.configure')` seule, si une lecture `org.read` ne passe pas par le masquage, si `getAllowlist` ou `BotService` est appelé hors de `bots.ts` dans `src/api`, ou si `can()` accorde `bots.configure` à un autre rôle que l'administrateur et l'opérateur. Rouge vérifié par mutation puis mutations retirées : route de lecture ajoutée sans `presentBotForViewer`, `getBot` et `listBots` rendus sans masquage, `bots.configure` ouverte aux membres dans `permissions.ts`, route d'écriture rendue à `org.read`.
- m-3 : sans effet, le web n'appelle pas le détail d'un lead ; à aligner si un parcours e2e l'ouvre un jour.
- m-4 : accepté, le BFF est plus strict que le moteur, jamais moins (aucun risque de fuite).
- Suite Postgres : lancée sur le Postgres local (`TEST_DATABASE_URL=postgres://francoisgreze@localhost:5432/postgres`, Docker ne répondait pas, une base jetable par test) : 140 fichiers, 1896 tests passés. Suite SQLite : 139 fichiers passés (1 ignoré), 1892 tests passés (4 ignorés). `typecheck`, `typecheck:tests`, `check:tests` et `check:logs` verts.
