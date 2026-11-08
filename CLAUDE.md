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
- plan 2a web (mergé localement sur `main`, non poussé).

En cours : lot 2b-1 « Fiabilisation » (chemin des messages sûr pour plusieurs organisations), branche `feat/2b-1-fiabilisation`.
- spec : `docs/superpowers/specs/2026-11-08-connexions-whatsapp-2b-design.md`
- plan : `docs/superpowers/plans/2026-11-08-connexions-whatsapp-2b-1-fiabilisation.md`

Ensuite : lot 2b-2 (comptes WhatsApp d'organisation) puis lot 2b-3 (écrans). Rien n'est déployé.

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
- Aucun repli sur les identifiants de la plateforme (`META_*`, `CM_*`) pour envoyer un message ou vérifier un webhook. Seul `META_VERIFY_TOKEN` reste global en 2b-1 (jeton du GET de vérification Meta), il devient propre à chaque compte en 2b-2.
- Aucun effet de bord (session, écriture en base, appel LLM, envoi) avant l'authentification du webhook.
- Tout invariant a un test qui casse quand on le viole. Un test qui protège un constat d'audit porte en commentaire le numéro du constat (`// audit 1.1`). Aucun test n'est affaibli pour passer.
- 1 numéro = 1 agent IA. Une seule façon de router un message : par le numéro destinataire.

Routes de webhook :
- Meta : `POST /webhook/meta`. La signature `x-hub-signature-256` est vérifiée avec le secret d'application de l'agent IA.
- CM.com : `POST /webhook/cm-com/<organisation>/<agent IA>/<secret>`.
- Les anciennes routes `/webhook` et `/webhook/cm-com` sans secret n'existent plus. `/dashboard` et les commandes d'administration par WhatsApp ont été supprimés.

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
- `npm test -w @wabagent/web` : tests du back-office web

La suite d'isolation « deux organisations » est dans `src/__tests__/isolation/`. Elle est obligatoire sur SQLite et sur Postgres.

La CI (`.github/workflows/ci.yml`) lance typecheck et tests à chaque push. Elle ne déploie rien.

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
