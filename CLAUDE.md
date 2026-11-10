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
    - la machine d'états des agents IA et les décisions de branchement sont dans `packages/contracts/src/bot-status.ts` (`decideTransition`, `decideAssign`), appelées par le moteur et par le web ;
    - les contrôles de vérification d'un compte sont `VERIFICATION_CHECK_KEYS` (contrats), source unique du moteur et du web ;
    - un corps JSON mal formé ou trop gros sur l'API d'administration répond 400 `VALIDATION_ERROR` et n'est jamais journalisé.

- lot « Restitution des erreurs et vocabulaire », exécuté sur la branche `feat/restitution-erreurs`, pas encore mergé (recette en réel avec François, revue finale, puis merge).
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

Ensuite : recette en réel du lot « Restitution des erreurs et vocabulaire » avec François, revue finale, puis merge ; ensuite chantier S « Sécurité, conformité et données en Europe » (`docs/ROADMAP.md`) avant toute mise en ligne. Rien n'est déployé.

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
- Rien n'est déployé : les migrations peuvent supprimer des données d'exécution éphémères (sessions), jamais des conversations, leads ou identifiants.

## Commandes

- `npm test` : tests moteur sur SQLite
- `npm run test:pg` : tests moteur sur Postgres (utilise `TEST_DATABASE_URL` si défini, sinon un conteneur Docker jetable de `docker-compose.test.yml`)
- `npm run typecheck` : typecheck du moteur
- `npm run typecheck:tests` : typecheck des fichiers de test
- `npm run check:tests` : vérifie la règle des tests HTTP (ci-dessous)
- `npm run check:logs` : garde statique des journaux (`scripts/check-logs.ts`) : aucun appel `console.*` du moteur (`src/`) ni du web (`apps/web/src`) ne reçoit un objet d'erreur entier ; dans le moteur, aucune donnée sensible (corps, texte, jeton, contact) n'est journalisée hors masquage ; refuse aussi une exemption `check-logs-ignore` sans raison
- `npm test -w @wabagent/web` : tests du back-office web

La suite d'isolation « deux organisations » est dans `src/__tests__/isolation/`. Elle est obligatoire sur SQLite et sur Postgres.

La CI (`.github/workflows/ci.yml`) lance typecheck, gardes (`check:tests`, `check:logs`) et tests à chaque push. Elle ne déploie rien.

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

## Vocabulaire

Agent IA, organisation, entité, contact, conseiller. Ne jamais dire « agent » tout court dans un texte destiné à l'utilisateur.
