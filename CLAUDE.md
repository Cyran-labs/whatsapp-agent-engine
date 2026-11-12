# WABAGENT Engine

## Contexte

Produit : WABAGENT. Dépôt : `cyran-labs-engine`.

Moteur d'agents IA WhatsApp pour le e-commerce, portable, agnostique du transport, du CRM et du modèle IA, multi-organisations.

Trois blocs :
- moteur : `src/` (Express, SQLite ou Postgres) ;
- back-office web : `apps/web` (Next.js) ;
- contrats partagés : `packages/contracts`.

## État du projet

Livré :
- plan 1 moteur « Comptes et équipes » ;
- plan 2a web ;
- lot 2b-1 « Fiabilisation » (chemin des messages sûr pour plusieurs organisations) ;
- lot 2b-2 « Comptes WhatsApp d'organisation » (moteur et API d'administration, sans écrans).
  - spec : `docs/superpowers/specs/2026-11-08-connexions-whatsapp-2b-design.md` (§6 à §8)
  - plan : `docs/superpowers/plans/2026-11-08-connexions-whatsapp-2b-2-comptes-whatsapp.md`

- lot 2b-3 « Écrans » (Connexions, raccordement d'un compte, assistant Numéro et Activer, encarts de la page de l'agent IA), mergé sur `main` le 9 nov. 2026 après recette en réel.
  - plan : `docs/superpowers/plans/2026-11-09-connexions-whatsapp-2b-3-ecrans.md`
  - contrats changés par le lot :
    - le webhook (chemin, adresse, jeton de vérification) n'est plus dans la vue de compte : route dédiée `GET /whatsapp-accounts/:id/webhook`, relue par chaque boîte webhook ;
    - `expected_bot_id` (brancher, activer) et `expected_number_id` (débrancher) sont obligatoires : le détenteur ou le numéro que l'écran affichait est comparé dans la transaction du store, sinon 409 « Ce numéro a changé » (`HOLDER_CHANGED_PATH`) et rien n'est écrit ; le débranchement est `POST /bots/:botId/number/unassign` (l'ancien `DELETE` n'existe plus) ;
    - la machine d'états des agents IA et les décisions de branchement sont dans `packages/contracts/src/bot-status.ts` (`decideTransition`, `decideActivation`, `decideAssign`), appelées par le moteur et par le web ;
    - les contrôles de vérification d'un compte sont `VERIFICATION_CHECK_KEYS` (contrats), source unique du moteur et du web ;
    - un corps JSON mal formé ou trop gros sur l'API d'administration répond 400 `VALIDATION_ERROR` et n'est jamais journalisé.

- lot « Restitution des erreurs et vocabulaire », mergé sur `main` le 10 nov. 2026 après recette en réel.
  - plan : `docs/superpowers/plans/2026-11-09-restitution-erreurs-vocabulaire.md`
  - audit : `docs/superpowers/research/2026-11-09-audit-restitution-erreurs.md`
  - revue d'isolation : `docs/superpowers/research/2026-11-10-revue-isolation-restitution.md`
  - contre-audit : `docs/superpowers/research/2026-11-10-contre-audit-restitution.md`
  - contrats changés par le lot :
    - un refus métier du moteur porte une clé stable `error.reason` (`ERROR_REASONS`, `packages/contracts/src/errors.ts`, de la forme `<domaine>.<cas>`) en plus du code et du texte français, et la référence `request_id` ; le BFF relaie les deux, le web traduit par clé ;
    - un agent IA déjà en accès limité peut enregistrer une liste d'accès vide (il ne répond alors à personne) ; entrer en accès limité, activation depuis l'assistant comprise, exige toujours au moins une entrée (spec 2b, §8.1, §8.2 et §8.3 amendés le 9 nov. 2026) ;
    - `WhatsAppAccountView` porte `error_detail`, `error_cause` et `provider_text`, repris dans le résumé du numéro de l'agent IA ; `BotNumberSummary` porte `delivery_failures` et `last_delivery_error_code` ;
    - `/auth/me` liste aussi les organisations suspendues d'un membre (`status: 'suspended'`), jamais ouvrables ;
    - le web ne lit un refus que par `describeFailure` : `MutationFailure.engineText` (texte brut du moteur) n'est lu que par `api-fetch.ts` et `describe-failure.ts`, garanti par le compilateur (l'ancien champ `error` n'existe plus) et par `engine-text-readers.test.ts` ;
    - `npm run check:logs` (moteur et web) est dans la CI ; `MAILER_LOG_LINKS` commande les liens écrits par le mailer console.

En cours :
- lot « Refonte de la navigation » (rail à gauche, colonne du milieu ouverte par le bloc Organisation, en-tête de page à la place de la barre du haut, statuts Draft, Preview, Online, Offline, mention « Ne répond pas », droits du conseiller tenus par le moteur), exécuté sur la branche `feat/refonte-navigation`, pas encore mergé (recette en réel avec François, revue finale, puis merge).
  - spec : `docs/superpowers/specs/2026-11-10-refonte-navigation-design.md`
  - plan : `docs/superpowers/plans/2026-11-10-refonte-navigation.md`
  - revue d'isolation : `docs/superpowers/research/2026-11-11-revue-isolation-navigation.md`
  - registre des décisions : `docs/superpowers/research/2026-11-11-registre-decisions-navigation.md`
  - audit des décisions : `docs/superpowers/research/2026-11-11-audit-decisions-navigation.md` (étape 2 de la tâche 17)
  - contrats changés par le lot :
    - la règle « Ne répond pas » est une fonction des contrats (`decideResponding`, `NOT_RESPONDING_REASONS`, `packages/contracts/src/bot-status.ts`), calculée par le moteur (`src/core/services/bot-responding.ts`) et exposée en champ `not_responding` sur la vue d'un agent IA et sur `WhatsAppNumberView.bot` ; le web ne la recalcule jamais ; un test d'équivalence la lie à `checkRoute` ;
    - les coûts sont sous l'action `usage.read`, accordée à l'administrateur et à l'opérateur seulement (super manager compris dans le refus) : `GET /bots/:botId/usage` répond 403 générique avant toute lecture de l'agent IA, le BFF de l'usage de l'organisation répond 403 en entier, et `src/__tests__/cost-readers.test.ts` garde les seuls lecteurs des coûts ;
    - les numéros des contacts sont masqués par le moteur : `canSeeContactNumbers` (`src/core/auth/permissions.ts`) les donne en entier à l'opérateur, à l'administrateur et au super manager, et sinon seulement aux membres de l'entité de l'agent IA ; `presentBotForViewer` masque la Whitelist de `GET /bots` et `GET /bots/:botId`, `maskContactNumber` (contrats) donne le masque, `phone` et `qualified_data.phone` des leads sont masqués, la recherche des leads d'un membre masqué ne porte que sur le nom, et le détail d'un lead (`/leads/:phone`) lui est refusé ; `src/__tests__/allowlist-readers.test.ts` garde les lectures de la Whitelist ;
    - `first_entity_name` est obligatoire à la création d'une organisation (`POST /clients`) : l'organisation et sa première entité sont écrites dans une seule transaction (`createClientWithEntity`), et le script `scripts/create-organization.ts` prend le nom de l'entité en quatrième argument ;
    - les parcours e2e sont typés (`apps/web/tsconfig.e2e.json`, enchaîné dans `npm run typecheck -w @wabagent/web`, donc dans la CI).
- sous-lot « En-tête de page et corrections » de recette (11 et 12 nov. 2026, même branche), exécuté après la première recette en réel : en-tête de page unique, corrections 1 à 15 de la recette, recette des points corrigés à faire avec François (dernière section du guide `docs/superpowers/research/2026-11-11-recette-refonte-navigation.md`).
  - spec : `docs/superpowers/specs/2026-11-11-entete-de-page-et-corrections-design.md`
  - plan : `docs/superpowers/plans/2026-11-11-entete-de-page-et-corrections.md` (registre d'exécution : `.superpowers/sdd/2026-11-11-entete-de-page-et-corrections/progress.md`)
  - revue d'isolation : `docs/superpowers/research/2026-11-12-revue-isolation-entete.md` (0 Bloquant, 0 Important, 4 Mineurs ; M-1 et M-4 à corriger dans la vague finale avant le merge)
  - contrats changés par le sous-lot :
    - la barre du haut n'existe plus : `PageHeader` et `PageContent` (`apps/web/src/components/shell/page-header.tsx`) donnent à chaque page une ligne des parents facultative (jamais le nom de l'organisation ni le titre), le titre en seul `h1`, une description et une zone `data-page-action` (actions du titre, puis bouton rond de création, collant, `isAdmin && !readOnly`) ; `PageBar` et ses constats de test sont retirés ; le nom d'une entité affiché vient des entités de l'organisation ouverte, jamais de l'adresse (« Entité indisponible » sinon) ;
    - le BFF répond 503 `ENGINE_UNREACHABLE` (« Le moteur ne répond pas. ») quand le moteur ne répond pas, au lieu d'un 500, et garde la session si le moteur est injoignable au renouvellement du jeton ; une lecture de session en échec garde le cadre et affiche sur place « Impossible de lire votre session pour le moment. » avec « Réessayer » (`SessionUnreadable`, `AppRailView`) ;
    - `/api/auth/me` (BFF) porte `refused_client_id` : l'organisation enregistrée refusée parce que suspendue, lue pour l'utilisateur du jeton seulement ; le bandeau de suspension ne nomme que l'organisation tentée ;
    - les écrans décident d'un branchement par `assignRefusal` (`apps/web/src/lib/assign-choice.ts`), qui appelle `decideAssign` des contrats : un agent IA Draft ou Offline se branche sur le numéro d'un compte en erreur, Preview et Online sont refusés avec la raison ; l'assistant, qui ne branche qu'à l'activation, ne propose pas ces numéros à l'étape Numéro ; `assign-readers.test.ts` garde les écrans ;
    - le moteur dit clairement qu'un identifiant n'est pas celui d'une WABA (erreur Meta code 100 « nonexisting field (subscribed_apps) », contrôle `waba_access`, texte seulement, `src/whatsapp/meta-graph.ts`) ;
    - la Whitelist vide est présentée comme un état (étiquette et encadré neutres « Whitelist vide »), le motif `empty_allowlist` et le test d'équivalence avec `checkRoute` ne changent pas ; `bot-status.ts` ne change que dans ses commentaires (sortie compilée identique) ;
    - le thème sombre a `--surface: #0f251d` (choix de François du 12 nov. 2026, qui remplace `#03130e` ; `--bg` reste `#0C1A15`) et `--muted-2: #8A9F95`, avec un test de contraste calculé (WCAG 2.1, `theme-tokens.test.ts`) ; `--muted-2` en clair reste à 2,9:1 sur blanc, à trancher par François.
  - reste avant le merge : recette en réel (section « Corrections du 11 nov. 2026 » du guide, avec les décisions du PO à trancher), vague finale de corrections (mineurs différés du registre : M-1 et M-4 de la revue d'isolation, bouton rond pendant le chargement de Connexions et sur une liste filtrée par entité dont les entités sont illisibles, couverture manquante), puis revue finale de la branche.

Ensuite : recette en réel du lot « Refonte de la navigation » avec François, revue finale, puis merge ; ensuite chantier S « Sécurité, conformité et données en Europe » (`docs/ROADMAP.md`) avant toute mise en ligne. Rien n'est déployé.

Pointeurs :
- `docs/superpowers/specs/` : specs (dont la spec 2b et la spec « Comptes et équipes »)
- `docs/superpowers/research/2026-11-08-audit-zone-2b.md` : audit ciblé de la zone du 2b
- `docs/ROADMAP.md` : plan d'ensemble
- `docs/ARCHITECTURE.md` : architecture en 4 couches (transport, core, LLM, connecteurs CRM)
- `docs/CRM_INTEGRATION.md` : spécification du connecteur CRM (format des événements, signature HMAC, retry, idempotency). C'est le document partagé avec MAD CRM et tout futur partenaire.

## Repo de référence (production actuelle)

La logique éprouvée vient de `/Users/francoisgreze/www/whatsapp-cyran-bot/`. Quand on développe ici :
1. Reprendre la logique éprouvée (sessions, dedup, mutex, prompt caching, lead extraction).
2. La découpler des spécificités de la démo Cyran.
3. Clé `client_id` (l'organisation) partout dans les schémas de base de données.
4. Abstraire le transport, le LLM et le CRM derrière des interfaces.

## Règles non négociables multi-organisations

Ce projet héberge les données de plusieurs organisations clientes. Une fuite entre organisations est un échec, même si tout le reste fonctionne.

Anti-objectifs (spec 2b, §2) :
- Un message, un historique, un lead ou une commande qui traverse la frontière d'une organisation, même dans un cas limite.
- Un agent IA qui répond avec des identifiants qui ne sont pas ceux de son organisation (repli `.env` compris).
- Un agent IA qui répond alors qu'il est en brouillon, en pause, ou que son organisation est suspendue.
- Un webhook traité sans authentification vérifiée.
- Deux façons de router un message (par exemple un routage par mot-clé « seulement pour le test »).
- Un invariant affirmé dans un document sans test qui casse quand on le viole.
- Un élément d'interface sans effet qui ne le dit pas.

Règles qui en découlent :
- Toute donnée d'exécution est clée par organisation (`client_id`) et par numéro ou agent IA.
- Aucun repli sur les identifiants de la plateforme pour envoyer un message ou vérifier un webhook. Il n'y a plus de jeton de vérification global : le jeton du GET de vérification Meta est propre à chaque compte WhatsApp et vit en base (chiffré).
- Aucun effet de bord (session, écriture en base, appel LLM, envoi) avant l'authentification du webhook.
- Tout invariant a un test qui casse quand on le viole. Un test qui protège un constat d'audit porte en commentaire le numéro du constat (`// audit 1.1`). Aucun test n'est affaibli pour passer.
- 1 numéro = 1 agent IA. Une seule façon de router un message : par le numéro destinataire.

Routes de webhook (une URL propre à chaque compte WhatsApp d'organisation, clé secrète de 32 octets en base64url, retrouvée par son empreinte SHA-256) :
- Meta : `GET` et `POST /webhook/meta/<clé>`. Le `GET` de vérification compare `hub.verify_token` au jeton propre au compte. Le `POST` contrôle d'abord la présence de l'en-tête `x-hub-signature-256` et le compte (retrouvé par l'empreinte de la clé d'URL), avant de lire le corps ; la signature est ensuite calculée sur le corps brut lu, avec le secret d'application du compte, avant tout effet de bord (session, écriture en base, appel LLM, envoi).
- CM.com : `POST /webhook/cm-com/<clé>`. La clé d'URL est le secret d'authentification.
- Ordre strict : identifier le compte par la clé, authentifier, puis seulement router vers le numéro destinataire, qui doit appartenir à ce compte.
- Les anciennes routes `/webhook`, `/webhook/meta` sans clé, `/webhook/cm-com` et `/webhook/cm-com/<organisation>/<agent IA>/<secret>` n'existent plus. `/dashboard` et les commandes d'administration par WhatsApp ont été supprimés.
- Les identifiants WhatsApp vivent par compte d'organisation, chiffrés en base ; le transport découle du compte du numéro, jamais de l'agent IA.
- Variables d'environnement liées : `PUBLIC_BASE_URL` (optionnelle, forme exigée, sert à afficher l'URL de webhook complète), `WELCOME_DELAY_MS` (délai d'accueil, nul dans les tests), `MAILER_LOG_LINKS` (le mailer console n'écrit les liens d'invitation et de réinitialisation dans les journaux que si elle vaut exactement `true`, quel que soit `NODE_ENV` ; sinon seule l'adresse masquée est journalisée ; à poser pour le développement et la recette, jamais en ligne).

Obligations de méthode :
- Toute spec contient une section « Impact multi-organisation » : ce qui pourrait fuir, répondre à tort ou utiliser de mauvais identifiants, et le test qui l'empêche.
- Tout plan contient une tâche de revue d'isolation dédiée (spec 2b, §4.5), faite par un relecteur qui ne reçoit pas les conclusions de l'implémenteur, sur le code modifié et sur le code qu'il appelle ou qui l'appelle.
- Audit complet avant chaque mise en ligne majeure (spec 2b, §4.6).
- Avant le merge d'un plan exécuté en autonomie, audit des décisions prises en cours d'exécution : tri des décisions du registre (produit, interprétation d'une règle validée, technique), audit par un relecteur neuf qui reçoit les sources d'autorité et le code mais pas les justifications comme règles, puis recette en réel où chaque décision produit visible devient une étape à valider par François. Les relecteurs de tâche reçoivent ces décisions comme contestables, jamais comme acquises.
- Rien n'est déployé : les migrations peuvent supprimer des données d'exécution éphémères (sessions), jamais des conversations, leads ou identifiants.

## Commandes

- `npm test` : tests moteur sur SQLite
- `npm run test:pg` : tests moteur sur Postgres (utilise `TEST_DATABASE_URL` si défini, sinon un conteneur Docker jetable de `docker-compose.test.yml`)
- `npm run typecheck` : typecheck du moteur
- `npm run typecheck:tests` : typecheck des fichiers de test
- `npm run check:tests` : vérifie la règle des tests HTTP (ci-dessous)
- `npm run check:logs` : garde statique des journaux (`scripts/check-logs.ts`), sur le moteur (`src/`) et le web (`apps/web/src`) : la console ne s'utilise que par un appel direct `console.log|info|warn|error|debug|trace(...)` (référence nue comme `.catch(console.error)`, crochets, alias, déstructuration ou autre méthode refusés) ; aucun de ces appels ne reçoit un identifiant d'erreur nu (`err`, `e`, `error`, `xxxErr`), seul, entre parenthèses, typé `as Error`, dans un objet littéral ou en alternative d'un ternaire ; dans le moteur, aucune donnée sensible (corps, texte, jeton, contact) n'est journalisée hors masquage ; refuse aussi une exemption `check-logs-ignore` sans raison. Limite : garde textuelle, une erreur recopiée sous un autre nom (`const failure = err`) n'est pas reconnue
- `npm test -w @wabagent/web` : tests du back-office web

La suite d'isolation « deux organisations » est dans `src/__tests__/isolation/`. Elle est obligatoire sur SQLite et sur Postgres.

La CI (`.github/workflows/ci.yml`) lance typecheck, gardes (`check:tests`, `check:logs`) et tests à chaque push, et la suite Playwright du web sur le faux moteur (job `e2e`, Chromium seul). Elle ne déploie rien.

Règles de test :
- Tests HTTP : `request(await serve(app))` avec `serve` de `src/test-support/http.ts`, jamais `request(app)` (collision de ports sur macOS, contrôlé par `npm run check:tests`).
- Tests de base de données : `createTestDatabase()`, pour qu'ils tournent sur les deux moteurs.

## Conventions code

- Console.log : `[Service] message` sans emoji. Jamais de jeton, secret ou clé dans un journal.
- TypeScript strict, pas de `any`, `const` par défaut.
- Pas de commit sans validation explicite. 1 commit = 1 sujet. Jamais de push sans accord de François.
- Author git : Francois Greze <francois@cyran.fr>
- Pas de référence aux thématiques de la démo Cyran (golf, immo, voyage, auto, acquisition).
- Textes français avec tous les accents. Pas de tiret cadratin ni demi-cadratin, ni dans le code, ni dans les documents, ni dans les messages.
- Exception aux textes français (spec de la refonte de la navigation, 6.3) : sept mots anglais sont gardés dans l'interface française, Draft, Preview, Online, Offline, Whitelist, New, Soon. Ce sont des noms d'état ou d'étiquette, toujours avec leur majuscule (Whitelist compris, en milieu de phrase aussi), jamais accordés ni conjugués (« passer en Preview », « un agent IA Online »). En anglais, Whitelist se dit Allowlist. Contrôlé par `apps/web/src/i18n/__tests__/messages-style.test.ts`.

## Vocabulaire

Agent IA, organisation, entité, contact, conseiller. Ne jamais dire « agent » tout court dans un texte destiné à l'utilisateur.
