# Plan 2b-1 Fiabilisation : chemin des messages sûr

> **Pour les agents d'exécution :** sous-skill requise : superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans, tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** rendre le chemin d'un message WhatsApp sûr pour plusieurs organisations (routage, statut, identifiants, authentification des webhooks, concurrence Postgres) et installer les garde-fous permanents (tests d'isolation, tests Postgres, CI, règles dans `CLAUDE.md`, revue d'isolation).

**Architecture :** le modèle actuel (identifiants et numéros par agent IA) est conservé et rendu sûr ; le lot 2b-2 le remplacera par les comptes WhatsApp d'organisation. Le webhook est sorti de `src/index.ts` vers une application Express testable (`createApp`) et un pipeline explicite : authentifier, router par numéro destinataire, vérifier le statut, dédoublonner, traiter sous verrou (numéro, contact). Les parseurs de webhook deviennent des fonctions pures sans identifiants.

**Tech :** Node 24, TypeScript strict, Express 5, better-sqlite3, pg, Vitest, supertest, Docker (Postgres jetable), GitHub Actions.

**Spec :** `docs/superpowers/specs/2026-11-08-connexions-whatsapp-2b-design.md` (§4 et §5), avec l'audit `docs/superpowers/research/2026-11-08-audit-zone-2b.md` (constats cités « audit 1.1 »). L'exécutant lit la spec et l'audit avant de commencer.

## Contraintes globales

- TypeScript strict, pas de `any`, `const` par défaut.
- Journaux : format `[Service] message`, sans emoji. Jamais d'identifiant (jeton, secret, clé) dans un journal.
- Aucun tiret cadratin ni demi-cadratin dans le code, les commentaires, les messages et les textes. Textes français avec accents.
- Commits : 1 commit = 1 sujet, message en français au format `type(portée): résumé` puis corps factuel ; auteur `Francois Greze <francois@cyran.fr>` (config du dépôt) ; aucune signature Claude ou Anthropic ; aucun push sans accord explicite de François.
- Ne pas écrire de référence aux thématiques de la démo Cyran (golf, immo, voyage, auto, acquisition).
- Vocabulaire : « agent IA », « organisation », « contact » ; jamais « agent » tout court dans un texte destiné à l'utilisateur.
- Chaque test qui protège un constat d'audit porte en commentaire le numéro du constat (`// audit 1.1`).
- Aucun test existant n'est affaibli pour passer ; un test qui teste un comportement supprimé est supprimé avec le comportement, et le message de commit le dit.
- Toute donnée d'exécution est clée par organisation (`client_id`) et par agent IA ou numéro.
- Aucun repli sur les identifiants de la plateforme (`META_*`, `CM_*`) pour envoyer ou vérifier un webhook. Seul `META_VERIFY_TOKEN` reste global en 2b-1 (jeton du GET de vérification Meta), il devient par compte en 2b-2.
- Rien n'est déployé : les migrations peuvent supprimer des données d'exécution éphémères (sessions), jamais des conversations, leads ou identifiants.

## Points d'attention de la revue (non couverts par la spec, tests ajoutés aux tâches)

1. POST Meta groupé qui contient des messages pour deux numéros de deux organisations (app Meta partagée) : chaque message est authentifié avec le secret de l'agent IA de son numéro et servi par lui seul. Test ajouté à la tâche 10.
2. Redémarrage sur une base SQLite existante (fichier, pas `:memory:`) : les migrations (sessions, numéros en E.164, colonnes de dédoublonnage et de compteur) sont idempotentes au second démarrage et ne perdent ni conversation ni lead. Test ajouté aux tâches 2, 4 et 5.
3. Agent IA mis en pause pendant qu'un message attend son tour derrière le verrou : le message n'est pas servi. Test ajouté à la tâche 10.
4. Échec du LLM ou de l'envoi au milieu du traitement : le contact reçoit le message d'erreur, le message est marqué traité, le verrou est libéré et le message suivant du même contact est traité. Test ajouté à la tâche 10.
5. Message arrivé par le mauvais webhook (numéro d'un agent IA CM.com reçu sur `/webhook/meta`, ou numéro d'un autre agent IA reçu sur l'URL CM.com d'un agent IA) : ignoré sans effet de bord. Test ajouté à la tâche 10.

---

## Carte des fichiers

| Fichier | Rôle | Tâches |
|---|---|---|
| `src/test-support/test-database.ts` (nouveau) | base de test SQLite ou Postgres selon `TEST_DATABASE_URL` | 1 |
| `docker-compose.test.yml`, `scripts/test-pg.sh` (nouveaux) | Postgres jetable et commande `npm run test:pg` | 1 |
| `src/core/phone.ts` (nouveau) | normalisation E.164 unique | 2 |
| `src/core/admin.ts` | supprimé (commandes WhatsApp) | 3 |
| `src/core/database/types.ts`, `sqlite.ts`, `postgres.ts`, `src/core/db.ts` | interface et pilotes : suppressions, écritures atomiques, sessions, compteur | 3, 4, 5 |
| `src/transport/index.ts`, `types.ts`, `meta-cloud.ts`, `cm-com.ts` | fabrique sans repli, cache invalidable, erreurs classées, parseurs purs | 6, 7, 8 |
| `src/core/providers.ts`, `src/core/services/credentials-service.ts`, `connections-service.ts` | champs requis, secret de webhook CM.com | 6 |
| `src/core/config.ts` | suppression des `CM_*`, `META_*` d'envoi, `ADMIN_PHONES`, `DASHBOARD_API_KEY` ; version Graph, seuils | 3, 6, 7, 10 |
| `src/core/router.ts`, `bot-config.ts`, `config-store.ts` | routage par numéro destinataire, statut à l'exécution | 2, 9 |
| `src/core/handler.ts` | contexte de conversation, accueil, historique LLM | 3, 9 |
| `src/app.ts`, `src/webhooks/meta.ts`, `src/webhooks/cm-com.ts`, `src/webhooks/pipeline.ts` (nouveaux) | application Express et pipeline webhook | 10 |
| `src/core/conversation-lock.ts`, `src/core/in-flight.ts`, `src/core/maintenance.ts` (nouveaux) | verrou, suivi des traitements, purges périodiques | 10 |
| `src/index.ts` | démarrage seulement, arrêt propre | 3, 10 |
| `src/__tests__/isolation/` (nouveau) | suite « deux organisations » | 11 |
| `.github/workflows/ci.yml` (nouveau) | intégration continue | 12 |
| `CLAUDE.md` | état réel et règles non négociables | 13 |

---

### Tâche 1 : tests de base de données sur SQLite et sur Postgres

Spec §4.2. Fondation : les tâches suivantes écrivent leurs tests de base avec ce helper.

**Fichiers :**
- Créer : `src/test-support/test-database.ts`, `docker-compose.test.yml`, `scripts/test-pg.sh`
- Modifier : `package.json` (script `test:pg`), les 10 fichiers de `src/core/database/__tests__/`
- Modifier selon les échecs : `src/core/database/postgres.ts`, `src/core/database/accounts-postgres.ts`

**Interfaces :**
- Produit : `createTestDatabase(): Promise<Database>` (SQLite `:memory:` si `TEST_DATABASE_URL` est absent ; sinon crée une base Postgres neuve `wab_test_<8 hex>` sur ce serveur, renvoie `createPostgresDriver` dessus, et son `close()` ferme le pool puis supprime la base) ; `testEngine(): 'sqlite' | 'postgres'`.

- [ ] **Étape 1 : écrire le test du helper** (`src/test-support/__tests__/test-database.test.ts`)

```ts
it('donne une base vide et isolée à chaque appel', async () => {
  const a = await createTestDatabase();
  const b = await createTestDatabase();
  await a.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
  expect(await b.getClient('acme')).toBeUndefined();
  await a.close(); await b.close();
});
it('annonce le moteur utilisé', () => {
  expect(testEngine()).toBe(process.env['TEST_DATABASE_URL'] ? 'postgres' : 'sqlite');
});
```

- [ ] **Étape 2 : lancer, constater l'échec** : `npx vitest run src/test-support` ; attendu : FAIL, module introuvable.

- [ ] **Étape 3 : implémenter le helper, `docker-compose.test.yml` et `scripts/test-pg.sh`**

`docker-compose.test.yml` : un service `postgres:16-alpine`, port hôte `54329`, utilisateur et mot de passe `wab`/`wab`, base `wab`, commande `postgres -c max_connections=300 -c fsync=off`, healthcheck `pg_isready`. `scripts/test-pg.sh` : si `TEST_DATABASE_URL` est déjà défini (CI), lance `npx vitest run "$@"` ; sinon démarre le conteneur (`docker compose -f docker-compose.test.yml up -d --wait`), exporte `TEST_DATABASE_URL=postgres://wab:wab@localhost:54329/wab`, lance `npx vitest run "$@"`, arrête le conteneur (`down -v`) même en cas d'échec (`trap`), et rend le code de sortie de vitest. `package.json` : `"test:pg": "bash scripts/test-pg.sh"`.

- [ ] **Étape 4 : convertir les tests de `src/core/database/__tests__/`** : remplacer `createSqliteDriver(':memory:')` par `await createTestDatabase()`, ajouter `afterEach(() => db.close())`. Les tests qui inspectent SQLite directement (PRAGMA, fichier) restent SQLite et le disent en commentaire.

- [ ] **Étape 5 : vérifier SQLite** : `npm test` ; attendu : tout passe (631 tests au départ, plus les 2 nouveaux).

- [ ] **Étape 6 : vérifier Postgres** : `npm run test:pg -- src/core/database src/test-support` ; corriger dans `postgres.ts` et `accounts-postgres.ts` chaque écart révélé (types renvoyés, booléens, dates, dialecte SQL), sans toucher aux assertions. Si plus de dix défauts distincts ou un défaut de conception apparaissent, s'arrêter et faire un rapport à François avant de continuer.

- [ ] **Étape 7 : commit**

```bash
git add src/test-support docker-compose.test.yml scripts/test-pg.sh package.json src/core/database
git commit -m "test(db): tests de base sur SQLite et Postgres jetable (npm run test:pg)"
```

---

### Tâche 2 : normalisation E.164 unique des numéros WhatsApp

Spec §5.11, audit 6.1. Les numéros WhatsApp des organisations sont stockés en E.164 (`+33612345678`). L'identifiant du contact n'est pas concerné.

**Fichiers :**
- Créer : `src/core/phone.ts`, `src/core/__tests__/phone.test.ts`
- Modifier : `src/core/services/bot-service.ts` (`normalizeNumbers`, `setNumbers`), `src/core/config-store.ts` (`normalizePhone`, `botRecordToConfig`, `findBotConfigByNumber`), `sqlite.ts` et `postgres.ts` (`setBotNumbers`, migration), tests existants de `bot-service`, `config-store`, `router`

**Interfaces :**
- Produit : `normalizeWhatsAppNumber(input: string): string | null`. Règles : retirer espaces, points, tirets, parenthèses ; `+` initial ou `00` initial retirés ; reste exclusivement des chiffres, de 8 à 15, premier chiffre différent de `0` ; sinon `null` (un numéro national `06…` est refusé, faute d'indicatif). Résultat `'+' + chiffres`.

- [ ] **Étape 1 : tests de la fonction**

```ts
it.each([
  ['+33 6 12 34 56 78', '+33612345678'],
  ['0033612345678', '+33612345678'],
  ['33612345678', '+33612345678'],
  ['+1 (555) 123-4567', '+15551234567'],
  ['0612345678', null],
  ['', null], ['abc', null], ['+1234567', null], ['+1234567890123456', null],
])('normalise %s', (input, expected) => {
  expect(normalizeWhatsAppNumber(input)).toBe(expected);
});
```

- [ ] **Étape 2 : tests d'usage** (dans les fichiers de test existants)
  - `BotService.setNumbers(['0033612345678', '+33 6 12 34 56 78'])` enregistre une seule entrée `+33612345678` (doublon dédoublonné, plus de 500) ; `setNumbers(['0612345678'])` lève une erreur de validation sur `numbers.0` avec le message « Numéro au format international attendu (ex. +33612345678). ».
  - Unicité contournée par le format refusée : numéro `+33612345678` pris par l'agent IA A, `setNumbers(['0033612345678'])` sur B lève le conflit existant. `// audit 6.1`
  - `findBotConfigByNumber('33612345678')` et `findBotConfigByNumber('+33 6 12 34 56 78')` trouvent l'agent IA dont le numéro est `+33612345678`.
  - Migration (test SQLite sur un fichier temporaire, car une base `:memory:` ne se rouvre pas) : une ligne `bot_numbers` `33612345678` écrite par l'ancien schéma devient `+33612345678` à l'ouverture du pilote, et une seconde ouverture ne change rien.

- [ ] **Étape 3 : lancer, constater l'échec** : `npx vitest run src/core` ; attendu : FAIL sur les nouveaux tests.

- [ ] **Étape 4 : implémenter** : `phone.ts` ; remplacer les trois `normalizePhone`/`normalizeNumbers` locaux par la fonction partagée ; `setNumbers` valide, dédoublonne et rejette ; migration dans les deux pilotes à l'initialisation du schéma : `UPDATE bot_numbers SET whatsapp_number = '+' || whatsapp_number WHERE whatsapp_number NOT LIKE '+%'`. Les transports ne normalisent plus le numéro destinataire (fait au routage, tâche 9).

- [ ] **Étape 5 : vérifier** : `npm test` puis `npm run test:pg -- src/core/database` ; attendu : PASS. Vérifier aussi `npm test -w @wabagent/web` (l'affichage des numéros passe au format `+…`).

- [ ] **Étape 6 : commit** : `feat(numeros): normalisation E.164 unique des numéros WhatsApp`

---

### Tâche 3 : suppressions (commandes WhatsApp, /dashboard, historique cross-bot, mot-clé reset)

Spec §5.6, audit 1.2, 1.3, 1.4, 5.10.

**Fichiers :**
- Supprimer : `src/core/admin.ts`
- Modifier : `src/index.ts` (appel `handleControlCommand`, route `/dashboard`, `safeKeyEqual`, journal de démarrage), `src/core/config.ts` (`adminPhones`, `dashboardApiKey`), `src/core/handler.ts` (bloc « Historique cross-bot », `'/dashboard'` de `INTERNAL_ROUTES`), `src/core/db.ts`, `src/core/database/types.ts`, `sqlite.ts`, `postgres.ts`
- Test : `src/core/__tests__/handler-prompt.test.ts` (nouveau)

**Interfaces :**
- Retire de `Database` et de `db.ts` : `getAllSessions`, `resetSession`, `resetBotSession`, `resetAll`, `getCrossConversations`, `getAllLeads`, et le type `CrossConversationRow`. `getRecentHistory` reste (utilisé par `dashboard-service`).

- [ ] **Étape 1 : test du prompt** (LLM simulé par `vi.mock('../../llm/anthropic.js')`, transport factice, base `createTestDatabase`)

```ts
// audit 1.2
it("le prompt de l'agent IA de B ne contient rien de ce que le contact a échangé avec A", async () => {
  await db.addMessage('33600000001', 'acme', 'ventes', 'user', 'SECRET-ACME');
  await db.addMessage('33600000001', 'acme', 'ventes', 'assistant', 'REPONSE-ACME');
  await handleMessage(/* contexte de l'agent IA beta/accueil, contact 33600000001, texte 'bonjour' */);
  const [systemParts, messages] = chatMock.mock.calls[0];
  expect(JSON.stringify([systemParts, messages])).not.toMatch(/SECRET-ACME|REPONSE-ACME/);
});
```

La signature exacte de `handleMessage` change à la tâche 9 ; ici, utiliser la signature actuelle et laisser la tâche 9 adapter l'appel. Le mot-clé « reset » et les commandes `/…` sont traités dans `src/index.ts`, hors de `handleMessage` : leur suppression est prouvée par la suite d'isolation (tâche 11), qui passe par HTTP.

- [ ] **Étape 2 : lancer, constater l'échec** : `npx vitest run src/core/__tests__/handler-prompt.test.ts` ; attendu : FAIL (contenu d'ACME présent dans la partie « Historique cross-bot »).

- [ ] **Étape 3 : supprimer** le code listé. `GET /dashboard` renvoie désormais 404 (route absente). `README.md` et `docs/` qui documentent ces commandes ou cette route : retirer la mention.

- [ ] **Étape 4 : vérifier** : `npm run typecheck && npm test` ; attendu : PASS ; `grep -rn "ADMIN_PHONES\|DASHBOARD_API_KEY\|getCrossConversations\|resetAll" src docs README.md` ne renvoie rien d'actif.

- [ ] **Étape 5 : commit** : `fix(isolation): suppression des commandes WhatsApp, de /dashboard et de l'historique cross-bot` (corps : constats 1.2, 1.3, 1.4, 5.10 ; tests supprimés avec le comportement, s'il y en a).

---

### Tâche 4 : écritures atomiques, dédoublonnage en deux temps, compteur de messages non servis

Spec §5.7 (dédoublonnage, `saveLead`, upserts), §5.2 (compte), audit 5.3, 5.4, 5.5, 6.5.

**Fichiers :**
- Modifier : `src/core/database/types.ts`, `sqlite.ts`, `postgres.ts`, `src/core/db.ts`
- Test : `src/core/database/__tests__/concurrency.test.ts` (nouveau, via `createTestDatabase`)

**Interfaces :**
- Produit (remplace `isMessageProcessed` et `markMessageProcessed`) :
  - `claimMessage(key: string, staleAfterSeconds: number): Promise<boolean>` : `true` si la clé est nouvelle, ou si elle est en état `processing` depuis plus de `staleAfterSeconds` (traitement interrompu, reprise permise) ; `false` sinon. Une seule requête : `INSERT … ON CONFLICT (message_id) DO UPDATE SET state = 'processing', created_at = <maintenant> WHERE processed_messages.state = 'processing' AND processed_messages.created_at < <maintenant - délai> RETURNING message_id`.
  - `completeMessage(key: string): Promise<void>` : passe l'état à `done`.
  - `incrementUnserved(clientId: string, botId: string): Promise<void>` : upsert atomique sur `bot_runtime_state` (`unserved_count = unserved_count + 1`, `unserved_last_at = maintenant`).
  - `BotRuntimeStateRecord` gagne `unserved_count: number` et `unserved_last_at: string | null`.
- Migration : `processed_messages.state TEXT NOT NULL DEFAULT 'done'` ; `bot_runtime_state.unserved_count INTEGER NOT NULL DEFAULT 0`, `unserved_last_at`. Les lignes existantes valent `done` et `0`.
- `saveLead` : Postgres, une requête `INSERT … ON CONFLICT (phone, client_id, bot_id) DO UPDATE SET qualified_data = COALESCE(leads.qualified_data, '{}'::jsonb) || EXCLUDED.qualified_data, name = COALESCE(EXCLUDED.name, leads.name)` ; SQLite, la lecture, la fusion (même sémantique que l'étalement actuel, valeurs `null` conservées) et l'écriture dans une transaction `db.transaction()` (synchrone, donc atomique). Ne pas utiliser `json_patch`, qui supprime les clés à `null`.
- `setTransportValidation`, `setLastCrmError`, `upsertCredential`, `upsertBotRecord` (Postgres) : `ON CONFLICT … DO UPDATE` (pour `tenant_credentials`, cible `(client_id, COALESCE(bot_id, ''), service, provider)`, qui correspond à l'index unique existant).

- [ ] **Étape 1 : tests** (exécutés sur les deux moteurs)

```ts
// audit 5.3
it('dix réclamations simultanées du même message : une seule réussit', async () => {
  const results = await Promise.all(Array.from({ length: 10 }, () => db.claimMessage('+33600000000:wamid.1', 300)));
  expect(results.filter(Boolean)).toHaveLength(1);
});
it('un message terminé ne se réclame plus ; un message bloqué en cours se réclame après le délai', async () => {
  expect(await db.claimMessage('k1', 300)).toBe(true);
  await db.completeMessage('k1');
  expect(await db.claimMessage('k1', 0)).toBe(false);
  expect(await db.claimMessage('k2', 300)).toBe(true);
  expect(await db.claimMessage('k2', 300)).toBe(false);
  expect(await db.claimMessage('k2', 0)).toBe(true); // délai écoulé : reprise
});
// audit 5.4
it('saveLead concurrents : aucun champ perdu, aucune erreur d’unicité', async () => {
  await Promise.all(['a', 'b', 'c', 'd', 'e'].map((k) => db.saveLead('336', 'acme', 'ventes', { [k]: k })));
  expect(await db.getLeadData('336', 'acme', 'ventes')).toMatchObject({ a: 'a', b: 'b', c: 'c', d: 'd', e: 'e' });
});
// audit 6.5
it('écritures concurrentes de bot_runtime_state sans erreur', async () => {
  await Promise.all([
    db.setTransportValidation('acme', 'ventes', null, 'x'),
    db.setLastCrmError('acme', 'ventes', 'y'),
    db.incrementUnserved('acme', 'ventes'),
    db.incrementUnserved('acme', 'ventes'),
  ]);
  expect(await db.getBotRuntimeState('acme', 'ventes')).toMatchObject({ transport_error: 'x', last_crm_error: 'y', unserved_count: 2 });
});
```

Et un test SQLite sur fichier temporaire : une base créée avec l'ancien schéma (`processed_messages` sans `state`, `bot_runtime_state` sans compteur) s'ouvre, migre, et s'ouvre une seconde fois sans erreur.

- [ ] **Étape 2 : lancer, constater l'échec** : `npm run test:pg -- src/core/database/__tests__/concurrency.test.ts` ; attendu : FAIL (méthodes absentes, puis courses sur Postgres).

- [ ] **Étape 3 : implémenter** dans les deux pilotes ; mettre à jour l'appel de `src/index.ts` (`isMessageProcessed` devient `claimMessage(...)` provisoirement avec la clé `messageId` ; la tâche 10 pose la clé définitive).

- [ ] **Étape 4 : vérifier** : `npm test && npm run test:pg -- src/core/database` ; attendu : PASS.

- [ ] **Étape 5 : commit** : `fix(db): dédoublonnage en deux temps, saveLead et upserts atomiques, compteur de messages non servis`

---

### Tâche 5 : sessions clées par (numéro WhatsApp, contact)

Spec §5.1 (stockage), §5.12 (sessions inactives), audit 1.1, 6.6.

**Fichiers :**
- Modifier : `src/core/database/types.ts`, `sqlite.ts`, `postgres.ts`, `src/core/db.ts`
- Test : `src/core/database/__tests__/sessions.test.ts` (nouveau, deux moteurs)

**Interfaces :**
- `Session` : `{ wa_number: string; phone: string; client_id: string; bot_id: string; created_at: string; updated_at: string }`. `wa_number` est le numéro destinataire en E.164 ; `phone` est l'identifiant opaque du contact tel que fourni par le transport (jamais normalisé).
- Table `sessions (wa_number, phone, client_id, bot_id, created_at, updated_at, PRIMARY KEY (wa_number, phone))`.
- Produit : `getSession(waNumber: string, contactId: string): Promise<Session | undefined>` ; `createSessionIfAbsent(waNumber: string, contactId: string, clientId: string, botId: string): Promise<boolean>` (`true` si créée, une seule requête `INSERT … ON CONFLICT DO NOTHING RETURNING`) ; `touchSession(waNumber: string, contactId: string): Promise<void>` ; `purgeInactiveSessions(days: number): Promise<number>`. L'ancien `createSession(phone, …)` disparaît.
- Migration : si la table `sessions` existe sans colonne `wa_number`, elle est supprimée puis recréée, avec le journal `[DB] Sessions migrated to (wa_number, phone), <n> legacy row(s) dropped`. Conversations et leads ne sont pas touchés.

- [ ] **Étape 1 : tests**

```ts
// audit 1.1
it('un même contact a une session distincte par numéro destinataire', async () => {
  expect(await db.createSessionIfAbsent('+33100000001', '33600000001', 'acme', 'ventes')).toBe(true);
  expect(await db.createSessionIfAbsent('+33100000002', '33600000001', 'beta', 'accueil')).toBe(true);
  expect((await db.getSession('+33100000001', '33600000001'))?.client_id).toBe('acme');
  expect((await db.getSession('+33100000002', '33600000001'))?.client_id).toBe('beta');
});
it('création concurrente : une seule renvoie true', async () => {
  const r = await Promise.all(Array.from({ length: 5 }, () => db.createSessionIfAbsent('+331', 'c', 'acme', 'ventes')));
  expect(r.filter(Boolean)).toHaveLength(1);
});
// audit 6.6
it('purgeInactiveSessions supprime les sessions sans activité depuis N jours et elles seules', async () => { /* une session vieillie par UPDATE direct, une récente */ });
```

Plus le test de migration sur fichier SQLite (ancien schéma `sessions(phone PRIMARY KEY, …)` avec une ligne, une conversation et un lead : après ouverture, nouvelle table vide, conversation et lead intacts, seconde ouverture sans erreur).

- [ ] **Étape 2 : lancer, constater l'échec** ; attendu : FAIL.

- [ ] **Étape 3 : implémenter** dans les deux pilotes ; adapter `src/index.ts` et `src/core/router.ts` au minimum pour compiler (la tâche 9 réécrit le routage, la tâche 10 le pipeline).

- [ ] **Étape 4 : vérifier** : `npm test && npm run test:pg -- src/core/database` ; attendu : PASS.

- [ ] **Étape 5 : commit** : `feat(sessions): session clée par (numéro destinataire, contact), purge des sessions inactives`

---

### Tâche 6 : transports sans repli sur la plateforme, cache invalidé, secret de webhook CM.com

Spec §5.3, §5.8, et la partie « secret par agent IA CM.com » du §5.5 ; audit 2.1, 2.2, 5.8.

**Fichiers :**
- Modifier : `src/transport/index.ts`, `src/transport/types.ts`, `src/transport/cm-com.ts`, `src/transport/meta-cloud.ts`, `src/core/config.ts` (supprimer `config.cm` et `config.meta.phoneNumberId|accessToken|appSecret` ; garder `config.meta.verifyToken`), `src/core/providers.ts`, `src/core/services/credentials-service.ts`, `src/core/services/connections-service.ts`, `src/core/config-store.ts` (`upsertBot` invalide le cache), `packages/contracts` si la réponse de `GET /transport` y est typée
- Tests : `src/transport/__tests__/index.test.ts` (réécrit), `validate.test.ts`, `src/core/services/__tests__/credentials-service.test.ts`, `connections-service.test.ts`, `src/core/__tests__/providers.test.ts`

**Interfaces :**
- `Transport` gagne `readonly senderId: string` (Meta : `phone_number_id` ; CM.com : `from_number`).
- `createCmComTransport(opts: CmComTransportOptions)` avec `CmComTransportOptions = { productToken: string; fromNumber: string }`, options obligatoires, aucune lecture de `config` ; l'URL d'envoi est la constante `CM_SEND_URL = 'https://gw.cmtelecom.com/v1.0/message'` du module.
- `buildTransport(provider: TransportId, creds: Record<string, string>): Transport | null` : `null` si un champ requis du fournisseur manque ou est vide. Seule fabrique, utilisée aussi par `ConnectionsService.validateTransport` (sa méthode privée `buildTransport` disparaît).
- `getTransportForBot(bot: BotConfig): Promise<Transport | null>` : identifiants de l'agent IA puis de son organisation (résolveur actuel), jamais `.env` ; `null` n'est pas mis en cache.
- `invalidateTransports(clientId: string, botId?: string): void` : appelé par `upsertBot` (agent IA) et par `CredentialsService.setCredentials` quand `service === 'transport'` (agent IA, ou toute l'organisation si `botId` est `null`).
- `getCmWebhookSecret(clientId: string, botId: string): Promise<string | null>`.
- `getTransport` et `listConfiguredTransports` disparaissent.
- `PROVIDERS.transport['cm-com'].fields` : `product_token` (secret), `from_number` ; `service_url` retiré.
- `CredentialsService.setCredentials(clientId, botId, service, provider, values, mode?, internal?: Record<string, string>)` : pour `service === 'transport'`, chaque champ du fournisseur est requis et non vide (erreur de validation `values.<champ>` « Champ requis. ») ; `internal` contient des champs posés par la plateforme, hors liste autorisée, jamais saisis.
- `ConnectionsService.setTransport` pour `cm-com` : conserve le `webhook_secret` déjà enregistré, sinon en génère un (`randomBytes(24).toString('base64url')`), passé par `internal`. `getTransportMasked` renvoie en plus, pour `cm-com` configuré, `webhook_path: '/webhook/cm-com/<client_id>/<bot_id>/<secret>'` (segments encodés). Le secret n'apparaît jamais dans `fields`.

- [ ] **Étape 1 : tests**

```ts
// audit 2.1
it("un agent IA sans identifiants n'a pas de transport, même avec META_* et CM_* dans l'environnement", async () => {
  vi.stubEnv('META_PHONE_NUMBER_ID', 'env-pid'); vi.stubEnv('META_ACCESS_TOKEN', 'env-tok'); vi.stubEnv('META_APP_SECRET', 'env-sec');
  vi.stubEnv('CM_PRODUCT_TOKEN', 'env-cm'); vi.stubEnv('CM_FROM_NUMBER', '0033100000000');
  resolveMock.mockResolvedValue({});
  expect(await getTransportForBot(bot({ transport: 'meta-cloud' }))).toBeNull();
  expect(await getTransportForBot(bot({ transport: 'cm-com', bot_id: 'cm' }))).toBeNull();
});
// audit 2.2
it('identifiants CM.com incomplets : pas de transport, pas de complétion depuis l’environnement', async () => {
  resolveMock.mockResolvedValue({ product_token: 'tok' });
  expect(await getTransportForBot(bot({ transport: 'cm-com' }))).toBeNull();
});
// audit 5.8
it('le cache est invalidé quand les identifiants changent', async () => { /* deux appels résolus différemment séparés par invalidateTransports('c1','b1') : deux transports distincts */ });
```

Tests de service : `setCredentials` transport sans `app_secret` refusé ; `service_url` fourni refusé (« Champ non reconnu ») ; `setTransport` CM.com deux fois conserve le même `webhook_path` ; `getTransportMasked` ne contient pas le secret dans `fields`.

- [ ] **Étape 2 : lancer, constater l'échec** : `npx vitest run src/transport src/core` ; attendu : FAIL.

- [ ] **Étape 3 : implémenter.** `scripts/seed-credentials.ts` : ne rien changer d'autre que retirer `verify_token` du record Meta (champ non reconnu) ; un seed sans `META_APP_SECRET` produit des identifiants incomplets, donc un agent IA non routable, ce qui est le comportement voulu.

- [ ] **Étape 4 : vérifier** : `npm run typecheck && npm test` ; `grep -rn "config\.cm\|config\.meta\.\(phoneNumberId\|accessToken\|appSecret\)" src` vide. Attendu : PASS.

- [ ] **Étape 5 : commit** : `fix(transport): aucun repli sur les identifiants de la plateforme, cache invalidé, secret de webhook CM.com par agent IA`

---

### Tâche 7 : erreurs d'envoi classées, version Graph centralisée

Spec §5.9, §5.10 ; audit 5.9, 5.14.

**Fichiers :**
- Modifier : `src/transport/types.ts`, `meta-cloud.ts`, `cm-com.ts`, `src/core/config.ts`
- Test : `src/transport/__tests__/send-errors.test.ts` (nouveau, `fetch` simulé par `vi.stubGlobal`)

**Interfaces :**
- `type SendErrorKind = 'auth' | 'window_closed' | 'transient' | 'other'` ; `class TransportSendError extends Error { readonly kind: SendErrorKind; readonly status?: number; readonly code?: number }`.
- `classifyMetaError(status: number, body: string): SendErrorKind` : code d'erreur Graph `190` ou statut 401 → `auth` ; `131047` → `window_closed` ; statut 429, 5xx, codes `130429` et `131056` → `transient` ; sinon `other`.
- `classifyCmError(status: number): SendErrorKind` : 401, 403 → `auth` ; 429, 5xx → `transient` ; sinon `other`.
- Erreur réseau ou délai dépassé (`fetch` qui lève) → `transient`.
- Seules les erreurs `transient` sont réessayées (2 nouvelles tentatives, délais actuels 1 s et 3 s) ; l'échec final lève `TransportSendError`.
- `config.meta.graphVersion` lu depuis `META_GRAPH_VERSION`, défaut fixé à l'étape 3 ; toutes les URL Graph de `meta-cloud.ts` l'utilisent.

- [ ] **Étape 1 : tests**

```ts
it.each([
  [401, '{"error":{"code":190}}', 'auth'],
  [400, '{"error":{"code":190}}', 'auth'],
  [400, '{"error":{"code":131047}}', 'window_closed'],
  [429, '{}', 'transient'],
  [503, '', 'transient'],
  [400, '{"error":{"code":100}}', 'other'],
])('Meta %i %s : %s', (status, body, kind) => expect(classifyMetaError(status, body)).toBe(kind));
it("jeton refusé : une seule tentative, TransportSendError('auth')", async () => { /* fetch appelé 1 fois */ });
it('erreur réseau puis succès : renvoyé et réussi', async () => { /* fetch lève puis 200 ; 2 appels */ });
it('URL Graph construite avec META_GRAPH_VERSION', async () => { /* vi.stubEnv('META_GRAPH_VERSION','v99.0') ; URL contient /v99.0/ */ });
```

- [ ] **Étape 2 : lancer, constater l'échec** ; attendu : FAIL.

- [ ] **Étape 3 : fixer la version par défaut** : lire le journal des versions Graph (`https://developers.facebook.com/docs/graph-api/changelog`) et prendre la version stable la plus récente ; la citer avec sa date d'expiration dans le message de commit. Si la page est inaccessible, garder `v22.0` et le dire dans le commit et le rapport de tâche.

- [ ] **Étape 4 : implémenter**, faire passer les tests (utiliser `vi.useFakeTimers` pour les délais).

- [ ] **Étape 5 : vérifier** : `npm test` ; attendu : PASS.

- [ ] **Étape 6 : commit** : `fix(transport): erreurs d'envoi classées et réessais limités aux erreurs transitoires, version Graph configurable`

---

### Tâche 8 : parseurs de webhook purs

Spec §5.4, partie types du §5.7 ; audit 2.3, 5.1, 5.2, 5.12.

**Fichiers :**
- Modifier : `src/transport/types.ts`, `meta-cloud.ts`, `cm-com.ts`
- Test : `src/transport/__tests__/parse-meta.test.ts`, `parse-cm.test.ts` (nouveaux)

**Interfaces :**
- `type IncomingKind = 'text' | 'audio' | 'media' | 'order' | 'unsupported' | 'ignored'`.
- `IncomingMessage` : `{ contactId: string; toNumber: string; recipientId?: string; kind: IncomingKind; providerType: string; text: string; messageId: string; timestamp: string; profileName?: string; mediaUrl?: string; mediaType?: string; order?: { catalog_id: string; items: OrderItem[] } }`. `contactId` : `msg.from` Meta tel quel (pas de normalisation, un BSUID passe) ; CM.com `from.number` sans le préfixe `00` (format actuel, conservé). `toNumber` : brut (`display_phone_number` Meta, `to.number` CM.com) ; normalisé par le pipeline. `recipientId` : `metadata.phone_number_id` Meta. `text` vide sauf pour `text` et `order`.
- `parseMetaWebhook(body: unknown): MetaWebhookBatch` avec `MetaWebhookBatch = { messages: IncomingMessage[]; statuses: Array<{ recipientId: string; status: string; errorCodes: number[] }>; accountEvents: Array<{ field: string; entryId: string }> }` : itère toutes les entrées, tous les changements, tous les messages et statuts ; un changement dont `field` n'est pas `messages` va dans `accountEvents`. Ne lève jamais.
- `parseCmWebhook(body: unknown): IncomingMessage | null`.
- Correspondance des types Meta : `text` → `text` ; `interactive` (`button_reply`, `list_reply`) et `button` (réponse rapide de modèle, `button.text`) → `text` ; `audio` → `audio` ; `image`, `video`, `document` → `media` ; `order` → `order` ; `reaction` → `ignored` (choix du rédacteur du plan : une réaction n'appelle pas de réponse ; journalisée) ; tout autre type (`sticker`, `location`, `contacts`, `unsupported`, inconnu) → `unsupported`.
- Identifiant de repli : `meta_<randomUUID>` et `cm_<randomUUID>` (le préfixe `cm_` reste reconnu par `sendReadReceipt`).
- `parseWebhookPayload` disparaît de l'interface `Transport` et des deux transports.

- [ ] **Étape 1 : tests**

```ts
// audit 5.1
it('lit tous les messages de toutes les entrées et de tous les changements', () => {
  const batch = parseMetaWebhook(payloadWith2Entries2Messages);
  expect(batch.messages.map((m) => m.messageId)).toEqual(['wamid.A1', 'wamid.A2', 'wamid.B1', 'wamid.B2']);
  expect(batch.messages[2]).toMatchObject({ toNumber: '+33 1 00 00 00 02', recipientId: 'PNID-B' });
});
it('sépare statuts et événements de compte', () => { /* statuses avec errors[{code:131026}] ; field account_update */ });
// audit 5.2
it.each([['sticker', 'unsupported'], ['location', 'unsupported'], ['reaction', 'ignored'], ['button', 'text']])('type %s : %s', (type, kind) => { /* … */ });
// audit 2.3
it("n'exige aucun identifiant : fonctionne sans aucune variable META_*", () => { /* vi.unstubAllEnvs ; parse réussit */ });
// audit 5.12
it('identifiant de repli aléatoire et unique', () => { /* deux messages sans id : ids différents, préfixe meta_ */ });
it('corps invalide (null, tableau, chaîne) : lot vide, aucune exception', () => { /* … */ });
```

Équivalents CM.com : texte, interactif, média audio et image, commande, absence de `from.number` → `null`.

- [ ] **Étape 2 : lancer, constater l'échec** ; attendu : FAIL.

- [ ] **Étape 3 : implémenter** ; adapter `src/index.ts` au minimum pour compiler (appel des parseurs) ; la tâche 10 le remplace.

- [ ] **Étape 4 : vérifier** : `npm run typecheck && npm test` ; attendu : PASS.

- [ ] **Étape 5 : commit** : `refactor(transport): parseurs de webhook purs, lots Meta complets, types non pris en charge explicites`

---

### Tâche 9 : routage par numéro destinataire, statut à l'exécution, contexte de conversation

Spec §5.1 (routage), §5.2, §5.7 (accueil, historique) ; audit 1.1, 3.1, 5.6.

**Fichiers :**
- Modifier : `src/core/router.ts` (réécrit), `src/core/bot-config.ts`, `src/core/config-store.ts`, `src/core/handler.ts`
- Tests : `src/core/__tests__/router.test.ts` (réécrit), `src/core/__tests__/handler-context.test.ts` (nouveau), `handler-prompt.test.ts` (adapté)

**Interfaces :**
- `BotConfig` gagne `status: string` (copié de `BotRecord.status` par `botRecordToConfig`).
- `findRoute(toNumber: string): BotConfig | null` : synchrone, lecture seule, normalise `toNumber` (tâche 2) ; `null` si non normalisable ou inconnu. Ne consulte jamais la session.
- `checkServable(bot: BotConfig): Promise<'ok' | 'bot_inactive' | 'org_inactive'>` : `bot.status === 'active'` et `getClient(bot.client_id)?.status === 'active'` (statut d'organisation lu en base à chaque appel, toujours frais). En 2b-1, seul `active` est servi ; `limited` arrive en 2b-2.
- `ConversationContext = { bot: BotConfig; transport: Transport; waNumber: string; contactId: string; messageId: string; profileName?: string }`.
- `handleMessage(ctx: ConversationContext, text: string): Promise<void>` : ne résout plus le transport ; attend l'extraction de lead (plus de tâche détachée, pour qu'elle reste sous le verrou de la tâche 10) ; une `TransportSendError` de genre `auth` appelle `setTransportValidation(client, bot, null, 'Jeton refusé par le fournisseur WhatsApp.')`.
- `handleWelcome(ctx: ConversationContext): Promise<void>` : envoie l'accueil et enregistre le texte réellement envoyé (après remplacement de `{profileName}`) comme message `assistant`, plus `[Welcome]`.
- `buildLlmMessages(history: Array<{ role: string; content: string }>): { messages: ChatMessage[]; leadingAssistant: string[] }` : retire les messages `assistant` en tête (l'API attend un premier message `user`) ; `handleMessage` les passe au LLM dans une partie de prompt « ## Messages déjà envoyés au contact » quand la liste n'est pas vide.

- [ ] **Étape 1 : tests du routage**

```ts
// audit 1.1
it("route par le numéro destinataire même si le contact a une session avec une autre organisation", async () => {
  await db.createSessionIfAbsent('+33100000001', '33600000001', 'acme', 'ventes');
  expect(findRoute('+33100000002')?.client_id).toBe('beta');
});
// audit 3.1
it.each([['draft', 'active', 'bot_inactive'], ['paused', 'active', 'bot_inactive'], ['active', 'suspended', 'org_inactive'], ['active', 'active', 'ok']])(
  'agent IA %s, organisation %s : %s', async (botStatus, orgStatus, expected) => { /* … */ });
it('le passage en pause est vu sans redémarrage', async () => { /* setStatus via BotService puis checkServable */ });
```

- [ ] **Étape 2 : tests du contexte de conversation** (LLM simulé, transport factice qui enregistre les envois)
  - `handleWelcome` puis `handleMessage(ctx, 'Bonjour')` : deux envois (accueil puis réponse), l'historique contient le texte réel de l'accueil, le LLM reçoit `messages[0].role === 'user'` et le texte de l'accueil dans une partie de prompt. `// audit 5.6`
  - `buildLlmMessages` : `[assistant A, user B, assistant C]` donne `messages = [user B, assistant C]`, `leadingAssistant = ['A']`.
  - Un envoi qui lève `TransportSendError('auth')` met `transport_error` à « Jeton refusé par le fournisseur WhatsApp. ». `// audit 5.9`
  - Le LLM qui lève : le contact reçoit « Désolé, je rencontre un problème technique. Réessayez dans un instant. » et `handleMessage` se résout.

- [ ] **Étape 3 : lancer, constater l'échec** ; attendu : FAIL.

- [ ] **Étape 4 : implémenter** ; adapter `src/index.ts` au minimum pour compiler.

- [ ] **Étape 5 : vérifier** : `npm run typecheck && npm test && npm run test:pg -- src/core` ; attendu : PASS.

- [ ] **Étape 6 : commit** : `fix(routage): numéro destinataire d'abord, statut agent IA et organisation lus à l'exécution, accueil suivi du message`

---

### Tâche 10 : webhooks authentifiés, pipeline, verrou, arrêt propre, purges périodiques

Spec §5.5, §5.7 (dédoublonnage, verrou, ancienneté, arrêt), §5.12 ; audit 4.1, 4.2, 4.3, 5.5, 5.7, 5.13, 6.6, et le 1.5 au minimum (le `phone_number_id` du message doit être celui des identifiants de l'agent IA).

**Fichiers :**
- Créer : `src/app.ts`, `src/webhooks/meta.ts`, `src/webhooks/cm-com.ts`, `src/webhooks/pipeline.ts`, `src/core/conversation-lock.ts`, `src/core/in-flight.ts`, `src/core/maintenance.ts`
- Modifier : `src/index.ts` (ne garde que le démarrage), `src/core/config.ts`
- Tests : `src/webhooks/__tests__/meta-webhook.test.ts`, `cm-webhook.test.ts`, `pipeline.test.ts`, `src/core/__tests__/conversation-lock.test.ts`, `in-flight.test.ts`, `maintenance.test.ts` (nouveaux ; webhooks via supertest sur `createApp`, base `createTestDatabase`, LLM simulé, `fetch` simulé)

**Interfaces :**
- `createApp(deps: AppDeps): express.Express` avec `AppDeps = { tracker: InFlightTracker; adminRouter?: express.Router }` : `express.json` conserve le corps brut en `Buffer` (`req.rawBody`), routes webhook, `/health`, routeur admin si fourni. `src/index.ts` construit les services, appelle `createApp`, `listen`, `startMaintenance`, gère l'arrêt.
- `createInFlightTracker(): InFlightTracker` avec `track<T>(p: Promise<T>): Promise<T>`, `drain(timeoutMs: number): Promise<boolean>` (`true` si tout s'est terminé à temps), `size(): number`.
- `withConversationLock(key: string, fn: () => Promise<void>): Promise<void>` : sérialise par clé, en mémoire, libère la clé en fin de file, propage l'erreur de `fn` sans bloquer les suivants.
- `serveMessage(input: { bot: BotConfig; transport: Transport; waNumber: string; message: IncomingMessage }, tracker: InFlightTracker): Promise<void>` : appelée seulement après authentification. Ordre :
  1. `checkServable` ; sinon `incrementUnserved` et journal, fin ;
  2. message plus ancien que `config.webhook.maxMessageAgeHours` (`MESSAGE_MAX_AGE_HOURS`, défaut 24) : journal, fin ; `// audit 5.13`
  3. `kind === 'ignored'` : journal, fin ;
  4. `claimMessage('<waNumber>:<messageId>', 300)` ; `false` : doublon, fin (clé préfixée par le numéro destinataire : un identifiant de message réutilisé par un fournisseur ne peut pas bloquer une autre organisation) ;
  5. `withConversationLock('<waNumber>|<contactId>', …)` suivi par `tracker` : `checkServable` à nouveau (sinon compteur, `completeMessage`, fin) ; `createSessionIfAbsent` ou `touchSession` ; `audio`, `media`, `unsupported` : réponse fixe et journal du `providerType` ; sinon accueil si session créée et accueil actif, puis `handleMessage` ; `completeMessage` dans tous les cas (y compris après une erreur, qui est journalisée).
  Réponses fixes : audio « Les messages vocaux ne sont pas encore supportés. Écrivez-moi votre réponse. » ; média et non pris en charge « Je ne peux traiter que les messages texte. Écrivez-moi votre question. » (textes actuels).
- `POST /webhook/meta` : sans corps brut ou sans en-tête `x-hub-signature-256` : 401 et rien d'autre ; sinon 200, puis pour chaque message du lot : `findRoute(toNumber)`, agent IA de transport `meta-cloud`, `getTransportForBot` non nul, signature vérifiée sur le `Buffer` avec le secret de cet agent IA, `recipientId === transport.senderId` ; tout échec : journal sans contenu du message, message suivant. `verifyWebhookSignature(rawBody: Buffer, headers)` remplace la version `string`. Statuts et événements de compte : journal du nombre et du champ seulement.
- `GET /webhook/meta` : 403 si `META_VERIFY_TOKEN` est vide ou différent (comparaison à temps constant) ; sinon 200 `text/plain` avec le challenge.
- `POST /webhook/cm-com/:clientId/:botId/:secret` : agent IA connu, de transport `cm-com`, secret égal à `getCmWebhookSecret` (temps constant) ; sinon 404 sans effet. Puis 200, `parseCmWebhook`, numéro destinataire normalisé qui doit appartenir à `bot.whatsapp_numbers`, `getTransportForBot` non nul, `serveMessage`.
- Routes supprimées : `POST /webhook`, `GET /webhook`, `POST /webhook/cm-com`, `GET /webhook/cm-com` (404).
- `startMaintenance(db: Database, opts?: { intervalMs?: number; conversationDays?: number; sessionDays?: number }): () => void` : exécute tout de suite puis toutes les 6 h par défaut `cleanupProcessedMessages`, `purgeOldConversations(90)`, `purgeInactiveSessions(30)` ; une erreur est journalisée, jamais levée ; la fonction renvoyée arrête le minuteur.
- Arrêt (`SIGTERM`, `SIGINT`) : `server.close()`, arrêt de la maintenance, `tracker.drain(config.shutdownTimeoutMs)` (`SHUTDOWN_TIMEOUT_MS`, défaut 15000) avec journal du nombre de traitements abandonnés, fermeture de la base, sortie.

- [ ] **Étape 1 : tests du verrou, du suivi et de la maintenance** (unitaires)
  - Deux `withConversationLock('k', …)` : le second commence après la fin du premier ; une erreur dans le premier n'empêche pas le second ; deux clés différentes tournent en parallèle.
  - `drain(50)` renvoie `true` quand les promesses suivies se terminent avant, `false` sinon.
  - `startMaintenance` avec `vi.useFakeTimers` : appels immédiats puis après `intervalMs` ; une purge qui lève n'arrête pas les autres ; l'arrêt annule le minuteur.

- [ ] **Étape 2 : tests des webhooks** (supertest)

```ts
// audit 4.2
it('POST /webhook/meta sans signature : 401, ni base, ni LLM, ni envoi', async () => { /* … */ });
it('signature calculée avec un autre secret : rien', async () => { /* 200, puis tracker.drain ; aucune écriture */ });
it('signature sur les octets reçus : un corps re-sérialisé différemment est refusé', async () => { /* JSON avec espaces signé tel quel : accepté ; même objet re-sérialisé : refusé */ });
// audit 1.5
it('phone_number_id différent de celui des identifiants de l’agent IA : rien', async () => { /* … */ });
// audit 4.3
it('GET /webhook/meta sans META_VERIFY_TOKEN configuré : 403', async () => { /* … */ });
it('GET /webhook/meta jeton correct : 200 text/plain avec le challenge', async () => { /* content-type text/plain */ });
// audit 4.1
it('POST /webhook/cm-com sans secret, POST /webhook : 404', async () => { /* … */ });
it('URL CM.com avec un mauvais secret : 404, aucune écriture', async () => { /* … */ });
```

Points d'attention de la revue, dans `meta-webhook.test.ts` et `cm-webhook.test.ts` :
  - (1) lot Meta avec un message pour le numéro d'ACME et un pour celui de BETA, même secret d'app : chaque agent IA répond avec son propre jeton (en-tête `Authorization` des appels `fetch`), une réponse chacun.
  - (5) message pour le numéro d'un agent IA CM.com reçu sur `/webhook/meta` : rien ; message vers le numéro de l'agent IA B reçu sur l'URL CM.com de l'agent IA A : rien.

- [ ] **Étape 3 : tests du pipeline** (`pipeline.test.ts`)
  - Relivraison concurrente : le même POST envoyé deux fois en parallèle donne un seul appel LLM et une seule réponse. `// audit 5.3`
  - Deux premiers messages simultanés d'un nouveau contact, accueil actif : un seul accueil, deux réponses, l'accueil avant la première réponse. `// audit 5.6, 5.7`
  - Message plus vieux que 24 h : rien, sauf journal.
  - Point d'attention (3) : agent IA passé en pause pendant que le message attend derrière le verrou (premier traitement bloqué sur une promesse contrôlée par le test) : le second message n'appelle pas le LLM et incrémente le compteur.
  - Point d'attention (4) : LLM qui lève sur le premier message : message d'erreur envoyé, `claimMessage` de la même clé renvoie ensuite `false`, le message suivant du même contact est traité.
  - Agent IA en brouillon : `unserved_count` passe à 1, aucune session, aucun appel LLM, aucun envoi. `// audit 3.1`

- [ ] **Étape 4 : lancer, constater l'échec** : `npx vitest run src/webhooks src/core/__tests__` ; attendu : FAIL.

- [ ] **Étape 5 : implémenter** ; `src/index.ts` ne contient plus de logique de webhook ; journal de démarrage mis à jour (plus de ligne `/dashboard`, URL `/webhook/cm-com/:clientId/:botId/:secret`).

- [ ] **Étape 6 : vérifier** : `npm run typecheck && npm test && npm run test:pg -- src/webhooks` ; attendu : PASS.

- [ ] **Étape 7 : commit** : `fix(webhook): authentification avant tout effet, pipeline sous verrou (numéro, contact), arrêt propre et purges périodiques`

---

### Tâche 11 : suite d'isolation « deux organisations »

Spec §4.1 (points du lot 2b-1), §10.

**Fichiers :**
- Créer : `src/__tests__/isolation/harness.ts`, `src/__tests__/isolation/two-orgs.test.ts`

**Interfaces :**
- Consomme : `createTestDatabase`, `createApp`, `createInFlightTracker`, `upsertBot`, `CredentialsService`, `resetConfigStore`, `invalidateTransports`.
- `harness.ts` produit : `setupTwoOrgs(): Promise<TwoOrgs>` qui crée les organisations `acme` et `beta`, un agent IA Meta actif chacune (`acme/ventes` sur `+33100000001`, `beta/accueil` sur `+33100000002`), des identifiants distincts (`PNID-A`/`TOKEN-A`/`SECRET-A`, `PNID-B`/`TOKEN-B`/`SECRET-B`), un agent IA CM.com actif `beta/cm` sur `+33100000003`, et renvoie `{ db, app, tracker, sent: SentRequest[], llmCalls: LlmCall[], postMeta(payload, secret), postCm(clientId, botId, secret, payload), metaMessage(opts), cmMessage(opts), dataOf(contactId) }` ; `dataOf` renvoie sessions (via `getSession` sur chaque numéro), conversations, leads et compteurs des agents IA pour ce contact. `fetch` est remplacé par un enregistreur qui répond 200 ; le LLM est simulé (`vi.mock` dans le fichier de test, fabrique fournie par le harnais).

- [ ] **Étape 1 : écrire les tests** (chacun porte son constat ; aucun ne passe par une fonction interne, tout passe par HTTP)
  - Contact commun : le contact `33699999999` écrit à ACME puis à BETA ; chaque message est traité par l'agent IA du numéro destinataire ; les envois vers le contact portent `Bearer TOKEN-A` puis `Bearer TOKEN-B` et visent `PNID-A` puis `PNID-B`. `// audit 1.1`
  - Prompt de B : aucun contenu échangé avec A (texte de A unique, cherché dans tout l'appel LLM de B). `// audit 1.2`
  - Brouillon, pause, organisation suspendue : aucun appel LLM, aucun `fetch`, aucune session ; compteur incrémenté. `// audit 3.1`
  - Agent IA sans identifiants avec `META_*` et `CM_*` présents dans l'environnement : aucun `fetch`. `// audit 2.1`
  - Signature Meta fausse ou absente, URL CM.com sans secret valide : aucune session, conversation, lead, dédoublonnage (`claimMessage` de la clé renvoie `true` ensuite), compteur, appel LLM ni `fetch`. `// audit 4.1, 4.2`
  - Relivraison concurrente du même message : une seule réponse. `// audit 5.3`
  - Commandes `/sessions`, `/leads`, `/reset all` envoyées par un contact : traitées comme du texte par le LLM de l'agent IA, aucune donnée d'une autre organisation dans la réponse ni dans le prompt. `// audit 1.3`
  - Mot « reset » envoyé par un contact : message ordinaire, historique et lead du contact intacts. `// audit 5.10`

- [ ] **Étape 2 : lancer sur les deux moteurs** : `npx vitest run src/__tests__/isolation && npm run test:pg -- src/__tests__/isolation` ; attendu : PASS (le code a été livré par les tâches 3 à 10). Tout échec est un défaut de ces tâches : le corriger dans le module fautif, dans cette tâche, et le décrire dans le commit.

- [ ] **Étape 3 : vérifier que la suite casse** : réintroduire temporairement, l'un après l'autre, (a) le repli `.env` dans `getTransportForBot`, (b) le routage par session dans `findRoute`, (c) l'historique cross-bot ; constater à chaque fois l'échec du test correspondant ; annuler (`git checkout -- <fichier>`). Noter les trois résultats dans le rapport de tâche.

- [ ] **Étape 4 : commit** : `test(isolation): suite deux organisations sur le vrai chemin webhook, SQLite et Postgres`

---

### Tâche 12 : intégration continue GitHub Actions

Spec §4.3.

**Fichiers :**
- Créer : `.github/workflows/ci.yml`

**Interfaces :**
- Déclencheurs : `push` et `pull_request`, toutes branches. Aucun déploiement, aucun secret du dépôt requis.
- Job unique `ci` sur `ubuntu-latest`, Node 24 (`actions/setup-node` avec cache npm), service `postgres:16-alpine` (utilisateur, mot de passe et base `wab`, port 5432, healthcheck `pg_isready`). Variables : `ANTHROPIC_API_KEY: ci-dummy` (lue à l'import de `config.ts`), `CREDENTIALS_ENCRYPTION_KEY` de 64 zéros, `ADMIN_JWT_SECRET` factice de 32 caractères au moins.
- Étapes : `npm ci` ; `npm run typecheck` ; `npm run typecheck -w @wabagent/web` ; `npm test` ; `npm run test:pg` avec `TEST_DATABASE_URL=postgres://wab:wab@localhost:5432/wab` ; `npm test -w @wabagent/web`.

- [ ] **Étape 1 : rejouer localement chaque commande depuis un clone propre** (`git clone` du dépôt dans un répertoire temporaire, puis `npm ci && …`, avec les mêmes variables et `TEST_DATABASE_URL` vers le conteneur de la tâche 1) ; attendu : tout passe. Corriger ce qui dépendait de l'environnement local (`.env`, `store/`, base de démo) dans les tests, pas dans le workflow.

- [ ] **Étape 2 : écrire `ci.yml`** et le valider avec `npx --yes @action-validator/cli .github/workflows/ci.yml` (si l'outil est indisponible, le dire dans le rapport).

- [ ] **Étape 3 : commit** : `ci: typecheck et tests moteur (SQLite, Postgres) et web à chaque push`. Le workflow ne tournera qu'au premier push, soumis à l'accord de François : le noter dans le rapport.

---

### Tâche 13 : règles non négociables dans `CLAUDE.md`

Spec §4.4.

**Fichiers :**
- Modifier : `CLAUDE.md` (projet)

- [ ] **Étape 1 : réécrire** en gardant les conventions existantes :
  - État réel : plans 1 moteur et 2a web livrés, lot 2b-1 en cours ; pointeurs vers `docs/superpowers/specs/` (spec 2b et spec comptes et équipes), `docs/superpowers/research/2026-11-08-audit-zone-2b.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/CRM_INTEGRATION.md`. Retirer « Phase actuelle : P0 ».
  - Section « Règles non négociables multi-organisations » : les anti-objectifs du §2 de la spec 2b ; « toute donnée d'exécution est clée par organisation et par numéro ou agent IA » ; « aucun repli sur les identifiants de la plateforme » ; « aucun effet de bord avant authentification du webhook » ; « tout invariant a un test qui casse quand on le viole » ; « 1 numéro = 1 agent IA, une seule façon de router ».
  - Obligation dans toute spec d'une section « Impact multi-organisation » (ce qui pourrait fuir, répondre à tort ou utiliser de mauvais identifiants, et le test qui l'empêche) ; dans tout plan, d'une tâche de revue d'isolation (§4.5 de la spec 2b).
  - Commandes : `npm test`, `npm run test:pg`, suite d'isolation `src/__tests__/isolation/`.
- [ ] **Étape 2 : vérifier** : `grep -nP "\x{2014}|\x{2013}" CLAUDE.md` vide (aucun tiret cadratin ni demi-cadratin).
- [ ] **Étape 3 : commit** : `docs(claude): état réel du projet et règles non négociables multi-organisations`

---

### Tâche 14 : revue d'isolation dédiée

Spec §4.5. Tâche de revue, pas d'implémentation.

- [ ] **Étape 1 : confier la revue à un relecteur neuf** (sous-agent sur le modèle le plus capable) qui reçoit seulement : la spec 2b (§2, §5, §10), l'audit, la liste des fichiers modifiés de la branche (`git diff --stat main...HEAD`) et la consigne : pour chaque fichier modifié, lire aussi le code qu'il appelle et qui l'appelle ; chercher ce qui pourrait faire fuir une donnée entre organisations, faire répondre un agent IA qui ne devrait pas, utiliser des identifiants qui ne sont pas ceux de l'organisation, ou produire un effet de bord avant authentification ; relever aussi les défauts hérités hors périmètre. Il ne reçoit ni les rapports des tâches ni les conclusions de l'implémenteur.
- [ ] **Étape 2 : trier** les constats avec François (bloquant à corriger dans ce lot, ou noté pour 2b-2, 2b-3 ou l'audit complet) ; chaque correction suit le cycle test qui échoue, correction, test qui passe, commit `fix(isolation): …`.
- [ ] **Étape 3 : consigner** le rapport dans `docs/superpowers/research/2026-11-XX-revue-isolation-2b-1.md` (constats, décision, commit de correction) et le committer : `docs(isolation): revue d'isolation du lot 2b-1`.

---

### Tâche 15 : test en live

Spec §11 ; règle de François : tester l'application en réel à chaque livraison.

- [ ] **Étape 1 : préparer** un worktree jetable de la branche, une copie de `store/demo.db`, moteur et web lancés ; deux organisations simulées (une existante de la copie et une créée par l'API admin), chacune avec un agent IA Meta actif et des identifiants factices distincts, et un agent IA CM.com.
- [ ] **Étape 2 : vérifier au démarrage** que la copie migre (sessions, numéros en `+…`, colonnes ajoutées) et qu'un second démarrage ne change rien ; conversations et leads intacts (comptes avant et après).
- [ ] **Étape 3 : rejouer des webhooks** avec `curl` (corps signés avec `openssl dgst -sha256 -hmac`) : contact commun aux deux organisations, signature fausse, agent IA en pause, organisation suspendue, URL CM.com avec et sans bon secret, POST groupé, relivraison. Les envois sortants échouent faute de vrais jetons : vérifier dans les journaux que l'envoi est tenté avec le bon `phone_number_id` et que l'erreur est classée (`auth` attendu), et dans le back-office que l'état de connexion de l'agent IA le montre.
- [ ] **Étape 4 : parcourir le back-office** (web) : pages des agents IA, statut, numéros au format `+…`, santé ; aucune régression visible.
- [ ] **Étape 5 : arrêt propre** : `SIGTERM` pendant un traitement en cours, constater l'attente puis la sortie dans les journaux.
- [ ] **Étape 6 : rapport** à François (ce qui a été vérifié, ce qui n'a pas pu l'être, par exemple l'envoi réel). Aucun envoi depuis le compte CM.com de production.

Puis revue finale de branche (subagent-driven-development), merge local avec l'accord de François, push seulement avec son accord explicite.

---

## Hors lot 2b-1 (rappel, pour ne pas les traiter ici)

- Changement de transport ou d'identifiants d'un agent IA actif sans retour en brouillon (audit 3.2), course validation et identifiants (3.3), validation Meta complète (3.4), machine d'états (3.5), fusion des identifiants champ par champ et rejet des masques (6.4), branchement transactionnel (6.2, 6.3) : lot 2b-2, remplacés par les comptes WhatsApp.
- Statut `limited`, liste d'accès limité, mot-clé « reset » réservé à cette liste : lot 2b-2.
- CrmBridge câblé au démarrage seulement (audit 5.11) : plan CRM.
- Section 7 de l'audit (mode LLM, PATCH de l'assistant, données personnelles dans les journaux, etc.) : audit complet de fin de 2b.
