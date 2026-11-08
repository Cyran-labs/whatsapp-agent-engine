# Plan 2b-2 Comptes WhatsApp d'organisation (moteur)

> **Pour les agents d'exécution :** sous-skill requise : superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans, tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** déplacer le raccordement WhatsApp au niveau de l'organisation (comptes WhatsApp Meta manuel et CM.com, inventaire automatique des numéros, un numéro par agent IA), avec les statuts `draft` / `limited` / `active` / `paused`, la liste d'accès limité, les webhooks par compte et le traitement des événements Meta ; supprimer le modèle « identifiants et numéros par agent IA ».

**Architecture :** deux nouvelles tables (`whatsapp_accounts`, `whatsapp_numbers`) et une liste d'accès limité (`bot_allowlist`). Les décisions (inventaire et reprise d'un numéro, branchement, machine d'états) sont des fonctions pures ; chaque pilote (SQLite, Postgres) lit les faits et applique la décision dans une seule transaction. Le chemin d'un message devient : URL du compte, authentification (signature Meta une fois par POST avec le secret du compte, ou clé d'URL CM.com), numéro cherché en base dans l'inventaire du compte, agent IA branché, statut relu en base, traitement. Plus aucun index des numéros en mémoire.

**Tech :** Node 24, TypeScript strict, Express 5, better-sqlite3, pg, Zod, Vitest, supertest, Graph API Meta (version `config.meta.graphVersion`), API Channels de CM.com.

**Spec :** `docs/superpowers/specs/2026-11-08-connexions-whatsapp-2b-design.md` (§2, §4.1, §6, §7, §8, §10, §11), avec l'audit `docs/superpowers/research/2026-11-08-audit-zone-2b.md` et la revue d'isolation du lot 2b-1 `docs/superpowers/research/2026-11-08-revue-isolation-2b-1.md`. L'exécutant lit les trois avant de commencer.

## Contraintes globales

- TypeScript strict, pas de `any`, `const` par défaut.
- Journaux : format `[Service] message`, sans emoji. Jamais de jeton, secret, clé d'URL ni contenu de liste d'accès limité dans un journal ou un audit (nombres seulement).
- Aucun tiret cadratin ni demi-cadratin dans le code, les commentaires, les messages et les textes. Textes français avec accents.
- Commits : 1 commit = 1 sujet, message en français au format `type(portée): résumé` puis corps factuel ; auteur `Francois Greze <francois@cyran.fr>` ; aucune signature Claude ou Anthropic ; aucun push sans accord explicite de François.
- Aucune référence aux thématiques de la démo Cyran (golf, immo, voyage, auto, acquisition).
- Vocabulaire : « agent IA », « organisation », « contact », « compte WhatsApp » ; jamais « agent » tout court dans un texte destiné à l'utilisateur.
- Chaque test qui protège un constat porte le numéro du constat en commentaire (`// audit 6.3`, `// revue 2b-1 M-1`, `// revue finale 2b-1 m8`).
- Aucun test existant n'est affaibli ; un test d'un comportement supprimé est supprimé avec lui, et le message de commit le dit.
- Tests de base : `createTestDatabase()` (SQLite et Postgres). Tests HTTP : `request(await serve(app))`. Les deux suites tournent à chaque tâche : `npm test` et `npm run test:pg` (Postgres natif : `TEST_DATABASE_URL=postgres://francoisgreze@localhost:5432/postgres` si Docker ne répond pas).
- Aucun effet de bord (session, écriture en base, appel LLM, envoi) avant l'authentification du webhook. Aucun repli sur les identifiants de la plateforme : `META_VERIFY_TOKEN` global disparaît dans ce lot.
- Un compte WhatsApp appartient à une seule organisation ; toute lecture d'un compte, d'un numéro ou d'une liste par l'API admin est filtrée par l'organisation active, et un objet d'une autre organisation répond comme un objet inconnu (404).
- Rien n'est déployé : la migration de ce lot supprime les identifiants de transport par agent IA et les numéros en texte libre (spec §6, choix 7), jamais une conversation ni un lead.

## Choix du rédacteur (laissés au builder par la spec, à confirmer par François)

1. **Routage lu en base à chaque message** (une requête indexée), plus d'index des numéros en mémoire : supprime le report « sérialisation de `upsertBot` (cache des numéros) ». Le cache des contenus d'agent IA reste, rafraîchi sous un verrou par agent IA.
2. **URL de webhook par compte** : `/webhook/meta/<clé>` et `/webhook/cm-com/<clé>`, clé aléatoire de 32 octets (base64url) ; la base stocke son empreinte SHA-256 (recherche) et la clé chiffrée avec les secrets du compte (affichage à l'admin). Pour CM.com, la clé est l'authentification ; pour Meta, la signature l'est.
3. **App Meta propre à une organisation** (revue 2b-1 M-2) : en mode manuel, un `app_id` déjà utilisé par un compte `connected` d'une autre organisation est refusé avec un message neutre. À relâcher le jour de l'Embedded Signup (app WABAGENT partagée, autre mode).
4. **Signatures rejetées en série** : compteur en mémoire par compte, aucune écriture en base avant authentification (règle non négociable). Au-delà de 20 POST rejetés sans POST valide, le compte s'affiche en `error` (motif `signature_rejected`) et ses agents IA ne peuvent pas passer en `limited` ou `active` ; la première signature valide lève l'état. L'état stocké en base n'est pas touché.
5. **Bac à sable CM.com non inventorié** : numéro partagé entre clients CM.com, contraire à « 1 numéro = 1 agent IA » ; les profils `isSandbox` sont comptés et signalés, jamais inventoriés.
6. **Déconnecter** supprime les numéros du compte, ses sessions et ses secrets (empreinte de clé à null) ; le compte reste listé `disconnected`. Reraccorder crée un nouveau compte.
7. **Sessions supprimées à chaque changement** d'agent IA ou de compte détenteur d'un numéro (branchement, reprise, retrait, déconnexion) : règle M-1 de la revue 2b-1.
8. **Branchement d'un agent IA déjà `limited` ou `active`** sur un numéro dont le compte n'est pas `connected` (ou retiré) : refusé avec le motif de la machine d'états, plutôt qu'un statut incohérent.
9. **Mot-clé « reset »** : texte égal à `reset` après suppression des espaces et en minuscules, envoyé par un contact de la liste d'accès limité ; efface la session et l'historique de cet agent IA pour ce contact (pas le lead), répond « Conversation réinitialisée. », sans appel LLM.
10. **Postgres** : toutes les opérations qui changent la topologie des numéros (inventaire, branchement, activation, transition de statut, déconnexion) prennent le même verrou consultatif transactionnel `pg_advisory_xact_lock(hashtext('wab:whatsapp-topology'))`. Opérations rares, aucun interblocage possible.

## Points d'attention de la revue (non couverts par la spec, tests ajoutés aux tâches)

1. POST Meta signé sur l'URL du compte A dont une entrée porte une autre WABA, ou un `phone_number_id` d'un numéro du compte B (même organisation ou autre) : ignoré sans effet. Test ajouté à la tâche 6.
2. « Remplacer les identifiants » avec une autre WABA, un autre `accountId` CM.com ou une valeur masquée `••••abcd` : refusé, rien ne change (audit 6.4). Test ajouté à la tâche 5.
3. Rafale d'événements Meta (50 `phone_number_quality_update` en une minute) : un seul rafraîchissement d'inventaire par compte et par minute. Test ajouté à la tâche 7.
4. Contact identifié par un BSUID en accès limité : servi seulement si ce BSUID est dans la liste ; un numéro E.164 de la liste ne fait pas servir un BSUID, et inversement. Test ajouté à la tâche 6.
5. Démarrage sur une copie de base existante (fichier SQLite, et Postgres) : la migration supprime `bot_numbers`, la colonne `bots.transport` et les identifiants `transport`, repasse les agents IA en brouillon, garde conversations et leads ; un second démarrage ne change rien. Test ajouté à la tâche 8.

---

## Carte des fichiers

| Fichier | Rôle | Tâches |
|---|---|---|
| `src/core/database/whatsapp-types.ts` (nouveau) | types des comptes, numéros, inventaire, interface `WhatsAppStore` | 1, 2 |
| `src/core/database/whatsapp-sqlite.ts`, `whatsapp-postgres.ts` (nouveaux) | schéma et méthodes des comptes, numéros, liste d'accès limité | 1, 2 |
| `src/core/database/types.ts`, `sqlite.ts`, `postgres.ts` | `Database extends WhatsAppStore`, statut hors des écritures de contenu, migration destructive | 1, 8 |
| `src/whatsapp/inventory-plan.ts`, `src/core/bot-status.ts` (nouveaux) | décisions pures : inventaire et reprise, machine d'états | 2 |
| `src/whatsapp/meta-graph.ts`, `src/whatsapp/cm-channels.ts` (nouveaux) | vérification et inventaire chez le fournisseur | 3 |
| `src/whatsapp/webhook-key.ts`, `src/webhooks/meta-signature.ts`, `src/webhooks/signature-monitor.ts` (nouveaux) | clé d'URL, signature pure, compteur d'échecs en mémoire | 4, 6 |
| `src/transport/index.ts`, `meta-cloud.ts`, `cm-com.ts` | transports par compte, BSUID, clé de dédoublonnage CM.com | 4, 6 |
| `src/core/services/whatsapp-account-service.ts`, `src/api/admin/routes/whatsapp-accounts.ts` (nouveaux) | raccordement, vérification, inventaire, déconnexion | 5 |
| `packages/contracts/src/whatsapp.ts` (nouveau) | entrées et vues des comptes, numéros, activation | 5, 8 |
| `src/core/auth/permissions.ts` | action `connections.manage` | 5 |
| `src/core/router.ts`, `config-store.ts`, `bot-config.ts`, `handler.ts`, `src/webhooks/*` | route lue en base, statut étendu, webhooks par compte, reset | 6 |
| `src/whatsapp/meta-events.ts`, `src/whatsapp/refresh-scheduler.ts` (nouveaux) | statuts, événements de compte et de numéro | 7 |
| `src/core/services/bot-service.ts`, `connections-service.ts`, `dashboard-service.ts`, `src/api/admin/routes/bots.ts`, `connections.ts` | numéro, statut, liste, activation ; suppression du transport par agent IA | 8 |
| `src/__tests__/isolation/` | scénarios 2b-2 du §4.1 | 9 |
| `apps/web/src/...`, `scripts/`, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `.env.example` | adaptation minimale du web, scripts, documentation | 10 |

---

### Tâche 0 : vérifications préalables chez Meta et CM.com

Spec §11 : les pistes « à confirmer » sont vérifiées avant d'écrire le code qui en dépend. Aucune écriture chez un fournisseur dans cette tâche (aucun POST).

**Fichiers :** modifier ce plan (section « Résultats de la tâche 0 » en fin de document). Script jetable dans le dossier scratchpad de la session, jamais dans le dépôt.

- [ ] **Étape 1 : Meta, environnement de dev (portefeuille Ravivo, jamais Cyran).** App WABAGENT Dev (`APP_ID`, `APP_SECRET` dans le `.env` du dépôt) ; jeton de l'utilisateur système `wabagent-dev` ; numéro de test `+15551649072` (Phone Number ID `1444139162121271`, compte de messagerie `1122051030798254`) ; numéro réel `+33663535053` (sa WABA, à relever). Relever aussi si l'« ID du compte de messagerie » affiché par Meta est l'identifiant de WABA attendu par `/{id}/phone_numbers` et `/{id}/subscribed_apps`, et le mode de l'app (Développement ou Live) nécessaire à la réception des webhooks. Le script n'affiche jamais le jeton ni le secret. Relever, avec `config.meta.graphVersion` :
  - a. `GET /{WABA}?fields=id,name` avec `appsecret_proof` correct, puis avec un `appsecret_proof` faux : statut HTTP et `error.code` du second appel (le contrôle du secret repose dessus) ;
  - b. `GET /debug_token?input_token=<jeton>` (même jeton en Bearer, avec `appsecret_proof`) : présence de `data.app_id`, `data.expires_at` (0 = n'expire pas), `data.is_valid` ;
  - c. `GET /{WABA}/subscribed_apps` : chemin de l'identifiant de l'app dans la réponse ;
  - d. `GET /{WABA}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,status,code_verification_status,account_mode` : champ qui distingue le numéro de test (attendu : `account_mode`), valeurs observées ;
  - e. un jeton tronqué : statut HTTP et `error.code` (attendu 190) ;
  - f. documentation Meta : codes d'échec de livraison liés au paiement ou à l'éligibilité du compte (attendus 131042, 131031, 368), forme de `account_update` (`value.event`), de `phone_number_quality_update`, et champ d'envoi vers un BSUID.
- [ ] **Étape 2 : CM.com, compte Cyran en lecture.** `accountId` `6c41cd06-021a-4cc7-b789-6fca0560095b`, productToken du `.env` de `whatsapp-cyran-bot`, en-tête `X-CM-PRODUCTTOKEN`. Relever les chemins JSON exacts de `GET https://api.cm.com/channels/v1/accounts/{accountId}/channels`, des profils WhatsApp (`.../whatsapp/{channelRequestId}/profiles?includeMetaQualityRating=true`) et de `.../businessaccount` ; un productToken faux : statut HTTP. Documentation des messages entrants : sens de `reference` et de `messageContext` (revue finale 2b-1 m13), présence de `from.whatsapp.user_id`.
- [ ] **Étape 3 : consigner** les résultats dans la section finale de ce plan, une ligne par point avec la décision qui en découle. Replis prévus : (a) faux `appsecret_proof` sans erreur : la vérification ne contrôle pas le secret, le contrôle « Secret de l'app » vaut `pending` jusqu'au premier message ; (b) `debug_token` inutilisable : `token_expiry` et `meta_app_id` à null, le choix 3 n'est pas appliqué et c'est noté ; (d) aucun champ de test : marquage manuel par l'admin (étape conditionnelle de la tâche 5) ; (m13) `reference` est l'identifiant du message entrant : clé `reference` d'abord. Un résultat sans repli prévu : arrêt et rapport à François.
- [ ] **Étape 4 : commit** `docs(plan): résultats des vérifications Meta et CM.com du lot 2b-2`.

---

### Tâche 1 : schéma des comptes, numéros et liste d'accès limité (ajout, lectures)

Spec §6, §8.3. Ajout pur : l'ancien modèle reste en place jusqu'à la tâche 8. Le statut sort des écritures de contenu (revue 2b-1 I-3, audit 6.2).

**Fichiers :**
- Créer : `src/core/database/whatsapp-types.ts`, `whatsapp-sqlite.ts`, `whatsapp-postgres.ts`, `src/core/database/__tests__/whatsapp-store.test.ts`
- Modifier : `src/core/database/types.ts` (`Database extends AccountsStore, WhatsAppStore` ; `BotRecord.status_reason: string | null`), `sqlite.ts`, `postgres.ts` (appel du schéma, colonne `bots.status_reason`, `upsertBotRecord`), `src/core/phone.ts`

**Interfaces :**
- Produit (`whatsapp-types.ts`) :
  - `WhatsAppAccountMode = 'meta_manual' | 'cm_com'` ; `WhatsAppAccountState = 'connected' | 'error' | 'disconnected'` ; `WhatsAppAccountErrorReason = 'token_invalid' | 'signature_rejected' | 'other'` ; `BotStatus = 'draft' | 'limited' | 'active' | 'paused'`.
  - `WhatsAppAccountAlert { kind: 'payment' | 'account_locked' | 'policy_block' | 'account_update'; code: number | null; event: string | null; at: string }`.
  - `WhatsAppAccountRecord { id: number; client_id; name; mode; provider_account_id: string /* WABA ID ou accountId CM.com */; waba_id: string | null; meta_app_id: string | null; secret_encrypted: string; key_version: number; webhook_key_hash: string | null; state; error_reason: WhatsAppAccountErrorReason | null; error_detail: string | null; last_verified_at: string | null; token_expiry: string | null /* ISO, 'never', ou null = inconnue */; last_signature_ok_at: string | null; alerts: WhatsAppAccountAlert[]; created_at; updated_at }`.
  - `WhatsAppNumberRecord { id: number; account_id: number; client_id; phone_e164; provider_number_id: string /* phone_number_id Meta, metaId CM.com ou 'cm:<profil>' */; cm_channel_id: string | null; display_name; meta_status: string | null; quality: string | null; is_test: boolean; bot_id: string | null; provider_state: 'present' | 'removed'; removed_at: string | null; delivery_failures: number; last_delivery_error_code: number | null; last_delivery_error_at: string | null; created_at; updated_at }`.
  - `ProviderNumber { provider_number_id; phone_e164; display_name; meta_status: string | null; quality: string | null; is_test: boolean; cm_channel_id: string | null }`.
  - `NewWhatsAppAccount` = champs saisis ou calculés d'un compte neuf (`client_id, name, mode, provider_account_id, waba_id, meta_app_id, secret_encrypted, key_version, webhook_key_hash, token_expiry, last_verified_at`).
  - `WhatsAppStore`, méthodes de cette tâche : `insertWhatsAppAccount(a: NewWhatsAppAccount): Promise<WhatsAppAccountRecord>` (état `connected`) ; `getWhatsAppAccount(clientId, id): Promise<WhatsAppAccountRecord | undefined>` ; `listWhatsAppAccounts(clientId)` ; `findWhatsAppAccountByWebhookKeyHash(hash): Promise<WhatsAppAccountRecord | undefined>` (seule lecture sans organisation, pour l'entrée webhook ; jamais un compte `disconnected`) ; `renameWhatsAppAccount(clientId, id, name): Promise<boolean>` ; `replaceWhatsAppAccountSecrets(clientId, id, s: { secret_encrypted; key_version; meta_app_id; token_expiry; verified_at }): Promise<boolean>` (repasse `connected`, efface le motif) ; `markWhatsAppAccountVerified(id, { token_expiry, verified_at })` (repasse `connected`) ; `setWhatsAppAccountError(id, reason, detail)` ; `touchSignatureOk(id, at)` ; `addWhatsAppAccountAlert(id, alert)` (garde les 20 plus récentes) ; `listWhatsAppNumbers(clientId, accountId?)` ; `getWhatsAppNumber(clientId, numberId)` ; `getWhatsAppNumberForBot(clientId, botId)` ; `findPresentNumber(accountId, key: { providerNumberId: string } | { phoneE164: string }): Promise<WhatsAppNumberRecord | undefined>` ; `recordDeliveryFailure(numberId, code: number | null, at)` ; `getAllowlist(clientId, botId): Promise<string[]>` ; `replaceAllowlist(clientId, botId, entries: string[])` ; `resetContactConversation(waNumber, contactId, clientId, botId)` (supprime la session et les messages de cet agent IA pour ce contact, jamais le lead).
- Produit (`phone.ts`) : `isBsuid(id: string): boolean` (`/^[A-Z]{2}\.[A-Za-z0-9_]+$/`, repris de `whatsapp-cyran-bot/src/whatsapp-api.ts`) ; `normalizeAllowlistEntry(input: string): string | null` (BSUID inchangé après `trim`, sinon `normalizeWhatsAppNumber`) ; `contactMatchesAllowlist(contactId: string, entries: string[]): boolean` (BSUID comparé tel quel ; sinon `normalizeWhatsAppNumber(contactId)` comparé aux entrées E.164).

Schéma (SQLite ; Postgres : `SERIAL`, `TIMESTAMPTZ`, `BOOLEAN`, `JSONB`) :
- `whatsapp_accounts` : colonnes de `WhatsAppAccountRecord`, `state` avec `CHECK` sur les trois valeurs, `mode` avec `CHECK` ; index unique sur `webhook_key_hash` ; index `(client_id)`.
- `whatsapp_numbers` : colonnes de `WhatsAppNumberRecord` plus `active_e164 TEXT UNIQUE` et `active_provider_id TEXT UNIQUE`, renseignées quand la ligne est le détenteur vivant du numéro, null sinon (unicité plateforme sans course, les null étant distincts sur les deux moteurs) ; index unique `(client_id, bot_id)` (un numéro au plus par agent IA) ; index `(account_id)`.
- `bot_allowlist(client_id, bot_id, entry, created_at, PRIMARY KEY (client_id, bot_id, entry))`.
- `bots.status_reason TEXT` (motif de pause automatique, `number_removed`).

- [ ] **Étape 1 : tests du store** (`whatsapp-store.test.ts`, les deux moteurs)

```ts
it("un compte d'une autre organisation est introuvable", async () => {
  const acc = await db.insertWhatsAppAccount(newAccount('acme'));
  expect(await db.getWhatsAppAccount('beta', acc.id)).toBeUndefined();
  expect(await db.renameWhatsAppAccount('beta', acc.id, 'X')).toBe(false);
  expect((await db.getWhatsAppAccount('acme', acc.id))?.name).toBe('Compte principal');
});
it("la recherche par empreinte de clé ignore un compte déconnecté", async () => { /* état forcé en SQL de test : undefined */ });
it('liste d’accès limité remplacée, propre à l’agent IA', async () => {
  await db.replaceAllowlist('acme', 'ventes', ['+33612345678', 'FR.abc123']);
  await db.replaceAllowlist('beta', 'ventes', ['+33700000000']);
  expect(await db.getAllowlist('acme', 'ventes')).toEqual(['+33612345678', 'FR.abc123']);
});
it('les alertes gardent les 20 plus récentes', async () => { /* 25 ajouts : 20, la plus ancienne gardée est la 6e */ });
it("upsertBotRecord ne change jamais le statut d'un agent IA existant", async () => {
  // revue 2b-1 I-3, audit 6.2
  await db.upsertBotRecord(bot({ status: 'draft' }));
  await setStatusSql('acme', 'ventes', 'paused');
  await db.upsertBotRecord(bot({ status: 'active', name: 'Renommé' }));
  expect((await db.getBotRecord('acme', 'ventes'))?.status).toBe('paused');
});
it('resetContactConversation efface session et messages de cet agent IA, pas le lead ni un autre agent IA', async () => { /* ... */ });
```

Et dans `src/core/__tests__/phone.test.ts` : `isBsuid('NL.84827364598365') === true`, `isBsuid('+33612345678') === false` ; `normalizeAllowlistEntry(' FR.ab_1 ') === 'FR.ab_1'`, `normalizeAllowlistEntry('0033612345678') === '+33612345678'`, `normalizeAllowlistEntry('06') === null` ; `contactMatchesAllowlist('33612345678', ['+33612345678']) === true`, `contactMatchesAllowlist('FR.abc', ['+33612345678']) === false`, `contactMatchesAllowlist('33612345678', ['FR.abc']) === false`.

- [ ] **Étape 2 : lancer, constater l'échec** : `npx vitest run src/core/database/__tests__/whatsapp-store.test.ts src/core/__tests__/phone.test.ts` ; attendu : FAIL.
- [ ] **Étape 3 : implémenter** le schéma (idempotent, `CREATE ... IF NOT EXISTS`, `ensureColumn` pour `status_reason`), les méthodes, et `upsertBotRecord` : l'insertion écrit le statut fourni, la mise à jour sur conflit n'écrit ni `status` ni `status_reason`. Les écritures de statut passent par la tâche 2 ; en attendant, `BotService.setStatus` utilise une méthode interne `setBotStatusUnchecked(clientId, botId, status)` marquée à supprimer en tâche 8, et les tests existants qui changent un statut en réécrivant l'agent IA par `upsertBot` passent par cette méthode (leurs assertions ne changent pas).
- [ ] **Étape 4 : vérifier** : `npm test && npm run test:pg && npm run typecheck && npm run typecheck:tests` ; attendu : tout passe.
- [ ] **Étape 5 : commit** `feat(db): comptes WhatsApp, numéros inventoriés et liste d'accès limité (schéma et lectures)`.

---

### Tâche 2 : inventaire, branchement, machine d'états et déconnexion (transactions)

Spec §6 (unicité, reprise), §7.4, §7.5, §8.1, §8.2. Revue 2b-1 I-3, M-1 ; audit 3.5, 6.2, 6.3.

**Fichiers :**
- Créer : `src/whatsapp/inventory-plan.ts`, `src/core/bot-status.ts`, leurs tests dans `src/whatsapp/__tests__/` et `src/core/__tests__/`, `src/core/database/__tests__/whatsapp-topology.test.ts`
- Modifier : `whatsapp-types.ts`, `whatsapp-sqlite.ts`, `whatsapp-postgres.ts`

**Interfaces :**
- Produit (`bot-status.ts`) :
  - `TransitionFacts { from: BotStatus; number: { present: boolean; is_test: boolean; account_state: WhatsAppAccountState } | null; allowlistCount: number }`.
  - `TransitionRefusal = 'no_number' | 'number_removed' | 'account_not_connected' | 'empty_allowlist' | 'not_from_draft' | 'invalid_transition'`.
  - `decideTransition(to: BotStatus, f: TransitionFacts): { ok: true } | { ok: false; reason: TransitionRefusal }`. Règles (spec §8.1) : `draft` toujours permis ; `paused` depuis `limited` ou `active` (sinon `invalid_transition`) ; `limited` : numéro présent, compte `connected`, liste non vide ; `active` : numéro présent, compte `connected`, depuis `limited`, `paused` ou `active`, depuis `draft` seulement si `is_test` (sinon `not_from_draft`). Ordre des contrôles : numéro absent, retiré, compte, liste, origine.
  - `TRANSITION_MESSAGES: Record<TransitionRefusal, string>` : `no_number` « Branchez un numéro WhatsApp avant d'activer l'agent IA. » ; `number_removed` « Le numéro de cet agent IA a été retiré chez le fournisseur. » ; `account_not_connected` « Le compte WhatsApp de ce numéro n'est pas connecté. » ; `empty_allowlist` « Ajoutez au moins un numéro à la liste d'accès limité. » ; `not_from_draft` « Passez d'abord en accès limité : seul un numéro de test peut être ouvert à tous directement. » ; `invalid_transition` « Changement de statut impossible depuis le statut actuel. ».
- Produit (`inventory-plan.ts`) : `planInventory(input: { accountId: number; own: WhatsAppNumberRecord[]; holders: Array<WhatsAppNumberRecord & { holder_account_state: WhatsAppAccountState }>; found: ProviderNumber[] }): InventoryPlan` avec `InventoryPlan { inserts: ProviderNumber[]; updates: Array<{ id: number; values: ProviderNumber; revive: boolean }>; removals: number[]; takeovers: number[]; refused: number }`. Règles : un numéro trouvé déjà dans `own` est mis à jour (`revive` s'il était retiré) ; sinon, un détenteur vivant d'un autre compte (par `phone_e164` ou `provider_number_id`) en état `connected` le fait refuser, en état `error` ou `disconnected` le fait reprendre (`takeovers`, puis insertion) ; un numéro de `own` présent et non trouvé est retiré.
- Produit (`WhatsAppStore`, mêmes signatures sur les deux moteurs, chacune dans une seule transaction, verrou consultatif du choix 10 sur Postgres, lignes relues dans la transaction) :
  - `InventoryResult { added; updated; removed; refused; took_over: number; paused_bots: Array<{ client_id: string; bot_id: string }> }`.
  - `createWhatsAppAccountWithInventory(a: NewWhatsAppAccount, found: ProviderNumber[]): Promise<{ account: WhatsAppAccountRecord; inventory: InventoryResult }>`.
  - `applyInventory(clientId, accountId, found: ProviderNumber[]): Promise<InventoryResult>`. Effets : reprise et retrait mettent la ligne en `removed`, `active_*` à null, suppriment les sessions de ce numéro, et passent son agent IA en `paused` avec `status_reason = 'number_removed'` s'il était `limited` ou `active` ; un audit `bot.status.auto` est écrit pour l'organisation de cet agent IA (acteur null, métadonnées `{ to: 'paused', reason: 'number_removed' }`, sans rien sur le nouveau détenteur). `paused_bots` ne sort jamais du service (tâche 5).
  - `AssignResult = { ok: true; changed: boolean; previous_bot_id: string | null; previous_number_id: number | null } | { ok: false; reason: 'not_found' | 'number_removed' | TransitionRefusal }`.
  - `assignNumber(clientId, botId, numberId, opts?: { isAccountBlocked?: (accountId: number) => boolean }): Promise<AssignResult>`. Effets (spec §7.5) : l'ancien agent IA du numéro le perd et repasse `draft` s'il était `limited` ou `active` ; le numéro précédent de l'agent IA cible est libéré ; les sessions des deux numéros sont supprimées ; si l'agent IA cible est `limited` ou `active`, `decideTransition(statut actuel, faits du nouveau numéro)` doit être `ok`, sinon tout est annulé (choix 8).
  - `unassignNumber(clientId, botId): Promise<boolean>` : libère, supprime les sessions, agent IA `limited` ou `active` repassé `draft`.
  - `TransitionResult = { ok: true; from: BotStatus; to: BotStatus } | { ok: false; reason: 'not_found' | TransitionRefusal }`.
  - `transitionBotStatus(clientId, botId, to: BotStatus, opts?: { isAccountBlocked?(accountId: number): boolean }): Promise<TransitionResult>` : faits lus dans la transaction, `decideTransition`, écriture ciblée `UPDATE bots SET status = ?, status_reason = NULL` (audit 3.5, revue 2b-1 I-3). `isAccountBlocked` vrai : le compte compte comme non `connected` (choix 4).
  - `activateWithNumber(clientId, botId, numberId, to: 'limited' | 'active', allowlist: string[] | null, opts?): Promise<TransitionResult & { assign?: AssignResult }>` : branchement, remplacement de la liste si fournie, transition ; un refus annule tout (spec §8.2).
  - `disconnectWhatsAppAccount(clientId, id): Promise<{ ok: true } | { ok: false; reason: 'not_found' } | { ok: false; reason: 'number_in_use'; bot_ids: string[] }>` : refusé si un numéro présent sert un agent IA `limited` ou `active` ; sinon numéros et leurs sessions supprimés, état `disconnected`, `webhook_key_hash` à null, `secret_encrypted` remplacé par le chiffrement de `{}` (choix 6).

- [ ] **Étape 1 : tests purs**

```ts
it.each([
  ['limited', { from: 'draft', number: null, allowlistCount: 1 }, 'no_number'],
  ['limited', { from: 'draft', number: n({ present: false }), allowlistCount: 1 }, 'number_removed'],
  ['limited', { from: 'draft', number: n({ account_state: 'error' }), allowlistCount: 1 }, 'account_not_connected'],
  ['limited', { from: 'draft', number: n(), allowlistCount: 0 }, 'empty_allowlist'],
  ['active', { from: 'draft', number: n(), allowlistCount: 1 }, 'not_from_draft'],
  ['paused', { from: 'draft', number: n(), allowlistCount: 0 }, 'invalid_transition'],
])('refuse %s (%j) : %s', (to, facts, reason) => {
  expect(decideTransition(to as BotStatus, facts as TransitionFacts)).toEqual({ ok: false, reason });
});
it('active depuis draft sur un numéro de test', () => {
  expect(decideTransition('active', { from: 'draft', number: n({ is_test: true }), allowlistCount: 0 })).toEqual({ ok: true });
});
it('draft toujours permis', () => { /* depuis les quatre statuts */ });
```

`planInventory` : un numéro tenu par un compte `connected` d'un autre compte est refusé et non inséré ; tenu par un compte `error` : repris puis inséré ; un numéro de `own` absent de `found` est retiré ; un numéro retiré retrouvé est ravivé ; deux lignes `found` identiques ne produisent qu'une insertion.

- [ ] **Étape 2 : tests transactionnels** (`whatsapp-topology.test.ts`, les deux moteurs)
  - Unicité inter-organisations : acme inventorie `+33100000001` ; beta inventorie le même : `refused === 1`, aucune ligne pour beta, la ligne d'acme intacte. `// audit 1.5`
  - Reprise : le compte d'acme passe `error`, beta inventorie le numéro : `took_over === 1`, la ligne d'acme `removed`, l'agent IA `acme/ventes` (qui était `active`) en `paused` avec `status_reason = 'number_removed'`, sessions de ce numéro supprimées, conversations et lead d'acme intacts, audit `bot.status.auto` d'acme sans mention de beta.
  - Branchement : numéro de `A1` (actif) branché sur `A2` : `A1` en `draft` sans numéro, `A2` détient le numéro, aucune session ne reste sur ce numéro. `// revue 2b-1 M-1, audit 6.3`
  - Branchement refusé (choix 8) : `A2` actif branché vers un numéro dont le compte est `error` : `{ ok: false, reason: 'account_not_connected' }`, rien n'a changé.
  - Numéro d'une autre organisation : `assignNumber('beta', 'accueil', numeroAcme)` renvoie `not_found`.
  - Concurrence (Postgres surtout) : deux `assignNumber` simultanés du même numéro vers deux agents IA, `Promise.all` : à la fin un seul détenteur, au plus un numéro par agent IA, aucune exception de contrainte remontée.
  - Transition concurrente : `transitionBotStatus(..., 'paused')` et `transitionBotStatus(..., 'active')` simultanés depuis `limited` : le statut final est l'un des deux et la base est cohérente avec le dernier résultat `ok`. `// revue 2b-1 I-3`
  - `activateWithNumber` avec liste vide en `limited` : refus `empty_allowlist`, numéro non branché, liste inchangée.
  - Déconnexion refusée tant qu'un agent IA `limited` l'utilise (`bot_ids` = `['ventes']`) ; acceptée après passage en `draft` : compte `disconnected`, `findWhatsAppAccountByWebhookKeyHash` renvoie `undefined`, numéros supprimés.
- [ ] **Étape 3 : lancer, constater l'échec** : `npx vitest run src/core/__tests__/bot-status.test.ts src/whatsapp src/core/database/__tests__/whatsapp-topology.test.ts` ; attendu : FAIL.
- [ ] **Étape 4 : implémenter** les deux modules purs puis, par moteur, « lire les faits, décider, appliquer » dans une transaction (SQLite : `db.transaction` synchrone ; Postgres : `BEGIN`, verrou consultatif, `SELECT ... FOR UPDATE` sur les lignes lues, `COMMIT` ou `ROLLBACK`).
- [ ] **Étape 5 : vérifier** : `npm test && npm run test:pg && npm run typecheck && npm run typecheck:tests`.
- [ ] **Étape 6 : commit** `feat(db): inventaire, branchement et statuts des agents IA en une transaction`.

---

### Tâche 3 : clients Meta (mode manuel) et CM.com

Spec §7.1, §7.2, §7.4 ; audit 3.4. Chemins et champs selon les résultats de la tâche 0.

**Fichiers :**
- Créer : `src/whatsapp/meta-graph.ts`, `src/whatsapp/cm-channels.ts`, `src/whatsapp/__tests__/meta-graph.test.ts`, `cm-channels.test.ts`

**Interfaces :**
- Produit :
  - `VerificationCheck { key: 'token' | 'waba_access' | 'app_secret' | 'subscription' | 'token_expiry' | 'numbers' | 'cm_account' | 'cm_channels'; status: 'ok' | 'failed' | 'pending' | 'created'; detail?: string }`.
  - `ProviderVerification = { ok: true; checks: VerificationCheck[]; account_name: string; waba_id: string | null; meta_app_id: string | null; token_expiry: string | null; numbers: ProviderNumber[]; skipped: { sandbox: number; invalid_number: number } } | { ok: false; checks: VerificationCheck[]; error_reason: 'token_invalid' | 'other'; message: string }`.
  - `MetaManualCredentials { waba_id: string; access_token: string; app_secret: string }` ; `appSecretProof(accessToken: string, appSecret: string): string` (HMAC-SHA256 hexadécimal du jeton) ; `verifyMetaManual(c: MetaManualCredentials, opts?: { fetchImpl?: typeof fetch }): Promise<ProviderVerification>` ; `listMetaNumbers(c, opts?): Promise<{ numbers: ProviderNumber[]; skipped: { sandbox: number; invalid_number: number }; error?: { reason: 'token_invalid' | 'other'; message: string } }>`.
  - `CmCredentials { account_id: string; product_token: string }` ; `verifyCmAccount(c, opts?)` ; `listCmNumbers(c, opts?)` (mêmes formes).
- Ordre Meta (§7.1) : jeton et accès WABA (`GET /{WABA}?fields=id,name` avec `appsecret_proof`) ; secret de l'app (même appel, selon la tâche 0) ; `debug_token` (`meta_app_id`, `token_expiry` : `'never'` si `expires_at` vaut 0, ISO sinon, null si illisible) ; abonnement (`GET subscribed_apps`, puis `POST subscribed_apps` si l'app n'y est pas, check `created`) ; inventaire (`GET phone_numbers`, pagination `paging.next` suivie, 100 par page). Le POST n'a lieu qu'après réussite des contrôles précédents. Aucun appel ne prend plus de 10 s (`AbortSignal.timeout(10_000)`).
- Ordre CM.com (§7.2) : canaux, profils de chaque canal WhatsApp, `businessaccount` (`waba_id` = `facebookId`) ; profils `isSandbox` comptés dans `skipped.sandbox` (choix 5) ; `provider_number_id` = `metaId`, sinon `'cm:' + identifiant du profil`.
- Numéro dont l'affichage ne passe pas `normalizeWhatsAppNumber` : écarté, compté dans `skipped.invalid_number`.
- Classement : HTTP 401, ou `error.code` 190 : `token_invalid` ; le reste : `other`. Le `message` et les `detail` ne contiennent jamais le jeton, le secret ni la preuve (remplacés par `[masqué]` si le fournisseur les renvoie) et font au plus 200 caractères.

- [ ] **Étape 1 : tests** (fetch simulé par `fetchImpl`)

```ts
it('vérification Meta complète : abonnement existant, numéros inventoriés, expiration lue', async () => {
  const r = await verifyMetaManual(creds, { fetchImpl: graph({ subscribed: true, expiresAt: 0 }) });
  expect(r).toMatchObject({ ok: true, meta_app_id: 'APP-1', token_expiry: 'never' });
  expect(r.ok && r.numbers[0]).toMatchObject({ provider_number_id: '1095731283613082', phone_e164: '+15551412647', is_test: true });
  expect(checkStatus(r, 'subscription')).toBe('ok');
});
it("abonnement absent : POST subscribed_apps envoyé une fois, check 'created'", async () => { /* ... */ });
it('jeton refusé (190) : token_invalid, aucun POST, message sans le jeton', async () => {
  const r = await verifyMetaManual(creds, { fetchImpl: graph({ tokenError: 190 }) });
  expect(r).toMatchObject({ ok: false, error_reason: 'token_invalid' });
  expect(JSON.stringify(r)).not.toContain(creds.access_token);
  expect(posts()).toHaveLength(0);
});
it('appsecret_proof envoyé sur chaque appel Graph et égal au HMAC du jeton', async () => { /* ... */ });
it('délai dépassé : other, message « Meta ne répond pas »', async () => { /* AbortError simulé */ });
it('CM.com : profils sandbox comptés et non inventoriés ; WABA lue dans businessaccount', async () => { /* ... */ });
it('CM.com : productToken refusé (401) : token_invalid', async () => { /* ... */ });
```

- [ ] **Étape 2 : lancer, constater l'échec** ; **Étape 3 : implémenter** ; **Étape 4 : vérifier** : `npx vitest run src/whatsapp && npm run typecheck`.
- [ ] **Étape 5 : commit** `feat(whatsapp): vérification et inventaire des comptes Meta (mode manuel) et CM.com`.

---

### Tâche 4 : transports par compte, signature Meta pure, clé d'URL, BSUID

Spec §5.8 (cache par compte), §7.3, §6 (identifiant de contact opaque). Ajout : l'ancienne fabrique par agent IA reste jusqu'à la tâche 6.

**Fichiers :**
- Créer : `src/whatsapp/webhook-key.ts`, `src/webhooks/meta-signature.ts`, leurs tests
- Modifier : `src/transport/index.ts`, `meta-cloud.ts`, `cm-com.ts`, `src/transport/__tests__/`

**Interfaces :**
- Produit :
  - `generateWebhookKey(): string` (32 octets, base64url) ; `hashWebhookKey(key: string): string` (SHA-256 hexadécimal) ; `generateVerifyToken(): string` (24 octets, base64url).
  - `verifyMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean` : `sha256=` + HMAC des octets reçus, comparaison à temps constant, faux si l'en-tête manque ou a une autre longueur. `createMetaCloudTransport` n'a plus d'`appSecret` ni de `verifyWebhookSignature` ; l'interface `Transport` perd `verifyWebhookSignature`.
  - `AccountSecrets` : `{ mode: 'meta_manual'; access_token; app_secret; verify_token; webhook_key } | { mode: 'cm_com'; product_token; webhook_key }` ; `encryptAccountSecrets(s): { secret_encrypted; key_version }` et `decryptAccountSecrets(rec: WhatsAppAccountRecord): AccountSecrets | null` (null si le contenu est vide ou incomplet, jamais d'exception) dans `src/transport/index.ts`.
  - `getTransportForNumber(account: WhatsAppAccountRecord, number: WhatsAppNumberRecord): Transport | null` : Meta avec `phoneNumberId = number.provider_number_id` et le jeton du compte ; CM.com avec le productToken du compte et `fromNumber` = numéro E.164 en chiffres. Null si le compte est `disconnected`, si `number.account_id !== account.id`, si `number.client_id !== account.client_id`, ou si les secrets sont incomplets. Cache par compte puis par numéro, garde de génération reprise de l'existant.
  - `invalidateAccountTransports(accountId: number): void`.
- BSUID (spec §6) : `toMetaNumber` et `toCmNumber` renvoient un BSUID inchangé ; CM.com construit le destinataire `{ number: to, whatsapp: { user_id: to } }` pour un BSUID (comme `buildRecipient` du dépôt de référence) ; Meta selon le champ relevé en tâche 0 (f).

- [ ] **Étape 1 : tests**
  - `verifyMetaSignature` : bonne signature vraie ; un octet de corps changé faux ; en-tête absent faux ; en-tête `sha256=` tronqué faux sans exception.
  - `getTransportForNumber` : numéro d'un autre compte (`account_id` différent) ou d'une autre organisation (`client_id` différent) renvoie null `// audit 1.5` ; compte `disconnected` renvoie null ; `invalidateAccountTransports` force la reconstruction avec le nouveau jeton (le jeton envoyé par `fetch` change).
  - Envoi Meta : l'URL utilise `number.provider_number_id`, l'en-tête `Authorization` le jeton du compte.
  - BSUID : `cm.sendText('FR.abc123', 'x')` envoie `to: [{ number: 'FR.abc123', whatsapp: { user_id: 'FR.abc123' } }]` (chemin exact selon le corps actuel de `sendRequest`).
- [ ] **Étape 2 : lancer, constater l'échec** ; **Étape 3 : implémenter** (les appelants actuels de `verifyWebhookSignature` passent par `verifyMetaSignature` avec le secret qu'ils lisent aujourd'hui, jusqu'à la tâche 6) ; **Étape 4 : vérifier** : `npm test && npm run typecheck && npm run typecheck:tests`.
- [ ] **Étape 5 : commit** `feat(transport): transports par compte WhatsApp, signature Meta pure, destinataire BSUID`.

---

### Tâche 5 : service et API des comptes WhatsApp

Spec §6, §7.1, §7.2, §7.4, §7.7, §9.1 (contenu des vues) ; audit 1.5, 6.4 ; revue 2b-1 M-2 (choix 3).

**Fichiers :**
- Créer : `src/core/services/whatsapp-account-service.ts`, `src/api/admin/routes/whatsapp-accounts.ts`, `packages/contracts/src/whatsapp.ts`, `src/webhooks/signature-monitor.ts`, tests `src/core/services/__tests__/whatsapp-account-service.test.ts`, `src/api/admin/__tests__/whatsapp-accounts-routes.test.ts`
- Modifier : `src/core/auth/permissions.ts` (`'connections.manage'`, hors `MEMBER_ACTIONS`), `src/api/admin/router.ts`, `src/index.ts`, `packages/contracts/src/index.ts`, `src/core/config.ts` (`webhook.publicBaseUrl` lu de `PUBLIC_BASE_URL`, optionnel)

**Interfaces :**
- Consomme : store (tâches 1 et 2), clients (tâche 3), `generateWebhookKey`, `hashWebhookKey`, `generateVerifyToken`, `encryptAccountSecrets`, `decryptAccountSecrets`, `invalidateAccountTransports` (tâche 4).
- Produit (`signature-monitor.ts`) : `SIGNATURE_REJECTION_THRESHOLD = 20` ; `recordSignatureFailure(accountId: number): void` ; `recordSignatureSuccess(accountId: number): void` ; `isSignatureRejected(accountId: number): boolean` ; `resetSignatureMonitor(): void` (tests).
- Produit (contrats, Zod) :
  - `CreateWhatsAppAccountInput` : union discriminée par `mode` : `{ mode: 'meta_manual'; name: string (1 à 80, trim); waba_id: /^\d{5,25}$/; access_token: string (20 à 1000); app_secret: string (16 à 128) }` ou `{ mode: 'cm_com'; name; account_id: uuid; product_token: string (10 à 200) }`.
  - `ReplaceWhatsAppCredentialsInput` : la même union sans `name`. `RenameWhatsAppAccountInput { name }`.
  - Vues : `WhatsAppNumberView { id; phone_e164; display_name; meta_status; quality; is_test; provider_state; removed_at; delivery_failures; last_delivery_error_code; bot: { bot_id; name; status } | null }` ; `WhatsAppAccountView { id; name; mode; provider_account_id; waba_id; state; error_reason; last_verified_at; token_expiry; secret_checked_at: string | null; is_test: boolean; alerts: Array<WhatsAppAccountAlert | { kind: 'token_expiring'; at: string } | { kind: 'quality_degraded'; number_id: number }>; webhook: { path: string; url: string | null; verify_token: string | null }; numbers: WhatsAppNumberView[] }` ; `WhatsAppAccountCreated = WhatsAppAccountView & { checks: VerificationCheck[]; inventory: { added: number; refused: number; skipped_sandbox: number; skipped_invalid: number } }`.
- Produit (`WhatsAppAccountService`, constructeur `{ db: Database; providers?: { verifyMeta; listMeta; verifyCm; listCm } }` pour l'injection en test) : `create(clientId, actorUserId, input): Promise<WhatsAppAccountCreated>` ; `list(clientId): Promise<WhatsAppAccountView[]>` ; `get(clientId, id): Promise<WhatsAppAccountView>` ; `rename(clientId, id, actorUserId, name)` ; `replaceCredentials(clientId, id, actorUserId, input): Promise<WhatsAppAccountCreated>` ; `verify(clientId, id, actorUserId): Promise<WhatsAppAccountView & { checks: VerificationCheck[] }>` ; `refreshNumbers(clientId, id, actorUserId: number | null): Promise<WhatsAppAccountView & { inventory }>` ; `disconnect(clientId, id, actorUserId): Promise<void>`.
- Règles :
  - Création : contrôles de forme, puis refus d'une valeur qui commence par `••••` (« Saisissez la valeur complète : une valeur masquée n'est pas acceptée. », audit 6.4) ; même `provider_account_id` déjà raccordé par un compte non `disconnected` de l'organisation : 409 « Ce compte WhatsApp est déjà raccordé. » ; vérification fournisseur ; échec : `AppError('WA_VALIDATION_FAILED', message, details)` avec un détail par check en échec (`path` = clé du check), **rien n'est écrit** ; choix 3 : `meta_app_id` porté par un compte `connected` d'une autre organisation : 409 neutre « Ce compte ne peut pas être raccordé. Contactez le support. » ; sinon `createWhatsAppAccountWithInventory`. Un numéro refusé ne révèle rien : la vue n'expose que le nombre `refused`, et le message de l'interface (2b-3) dira « déjà raccordé ailleurs ». Les `paused_bots` d'une autre organisation ne sortent jamais du service.
  - Remplacement des identifiants : même mode et même `provider_account_id` exigés (409 « Pour une autre WABA ou un autre compte CM.com, raccordez un nouveau compte. ») ; la clé d'URL et le jeton de vérification sont conservés ; vérification puis `replaceWhatsAppAccountSecrets`, `invalidateAccountTransports`, inventaire.
  - « Vérifier maintenant » : succès `markWhatsAppAccountVerified` ; échec `setWhatsAppAccountError(id, error_reason, message)` (§7.7).
  - État affiché : `error` avec motif `signature_rejected` si `isSignatureRejected(id)` et l'état stocké vaut `connected` (choix 4). `token_expiring` si `token_expiry` est une date à moins de 7 jours ; `quality_degraded` pour un numéro de qualité `RED` ; `is_test` vrai si le compte a au moins un numéro et que tous sont de test.
  - `webhook.path` : `/webhook/meta/<clé>` ou `/webhook/cm-com/<clé>` ; `url` préfixée par `config.webhook.publicBaseUrl` s'il est défini, sinon null ; `verify_token` pour Meta, null pour CM.com. Compte `disconnected` : `webhook` vaut `{ path: '', url: null, verify_token: null }`.
  - Audits : `whatsapp_account.create` `{ mode, numbers: added, refused }`, `.rename`, `.credentials`, `.verify` `{ ok }`, `.refresh` `{ added, removed, refused }`, `.disconnect`. Aucune valeur secrète ni identifiant de l'autre organisation.
- Routes (montées sur `/whatsapp-accounts`, derrière `requireAuth` et la résolution d'organisation, action `connections.manage` partout) : `GET /`, `POST /` (201), `GET /:accountId`, `PATCH /:accountId`, `PUT /:accountId/credentials`, `POST /:accountId/verify`, `POST /:accountId/refresh-numbers`, `POST /:accountId/disconnect` (409 avec le message « Mettez d'abord en brouillon les agents IA qui utilisent ce compte. » et `details` = agents IA concernés). `:accountId` non entier : 404.
- Étape conditionnelle (tâche 0, d sans champ de test) : `PATCH /:accountId/numbers/:numberId` `{ is_test: boolean }`, audit `whatsapp_number.test_flag`.

- [ ] **Étape 1 : tests du service** (clients simulés, les deux moteurs)
  - Création Meta réussie : vue sans aucun secret (`JSON.stringify(vue)` ne contient ni le jeton, ni le secret, ni l'empreinte), `webhook.path` commence par `/webhook/meta/`, `verify_token` non vide, numéros inventoriés.
  - Échec de vérification : 422 `WA_VALIDATION_FAILED`, `listWhatsAppAccounts` vide.
  - Valeur masquée refusée avant tout appel fournisseur. `// audit 6.4`
  - Remplacement vers une autre WABA : 409, secrets inchangés (déchiffrement identique). Remplacement réussi : jeton envoyé ensuite = nouveau jeton, clé d'URL inchangée.
  - Inventaire refusé entre organisations : la réponse de beta contient `refused: 1` et `JSON.stringify` ne contient ni `acme` ni le nom de son compte. `// audit 1.5`
  - App Meta déjà utilisée par une autre organisation : 409 neutre. `// revue 2b-1 M-2`
  - « Vérifier maintenant » sur jeton révoqué : état `error`, motif `token_invalid`. `// spec §7.7`
  - 21 `recordSignatureFailure` : la vue dit `error` / `signature_rejected` ; un `recordSignatureSuccess` : `connected`.
- [ ] **Étape 2 : tests des routes** : un membre non admin reçoit 403 sur chaque route ; un compte de beta demandé avec l'organisation acme active : 404 identique à un identifiant inconnu ; corps invalide : 400.
- [ ] **Étape 3 : lancer, constater l'échec** ; **Étape 4 : implémenter** ; **Étape 5 : vérifier** : `npm test && npm run test:pg && npm run typecheck && npm run typecheck:tests && npm run check:tests`.
- [ ] **Étape 6 : commit** `feat(api): comptes WhatsApp d'organisation (raccordement, vérification, inventaire, déconnexion)`.

---

### Tâche 6 : chemin des messages par compte

Spec §7.3, §8.1, §8.3, §8.4, §5.6 (reset) ; revue 2b-1 M-3, M-5 ; revue finale 2b-1 m7, m8, m13. Remplace le routage par numéro en mémoire, les webhooks `/webhook/meta` et `/webhook/cm-com/:clientId/:botId/:secret`, la fabrique de transport par agent IA et `getCmWebhookSecret`.

**Fichiers :**
- Modifier : `src/core/router.ts`, `config-store.ts`, `bot-config.ts`, `handler.ts`, `conversation-lock.ts` (fabrique `createKeyedLock()`), `src/webhooks/meta.ts`, `cm-com.ts`, `pipeline.ts`, `src/transport/index.ts`, `cm-com.ts` (parseur), `src/app.ts`, `src/index.ts`, `src/test-support/whatsapp.ts`, `src/webhooks/__tests__/*`, `src/__tests__/isolation/harness.ts` (monde construit avec des comptes et des numéros branchés)

**Interfaces :**
- Consomme : store (`findWhatsAppAccountByWebhookKeyHash`, `findPresentNumber`, `getWhatsAppNumber`, `getAllowlist`, `touchSignatureOk`, `setWhatsAppAccountError`, `resetContactConversation`), `verifyMetaSignature`, `hashWebhookKey`, `getTransportForNumber`, `signature-monitor`.
- Produit :
  - `Route { account: WhatsAppAccountRecord; number: WhatsAppNumberRecord; bot: BotConfig }`.
  - `Servable = 'ok' | 'bot_inactive' | 'org_inactive' | 'account_error' | 'not_allowed' | 'number_removed' | 'route_changed'`.
  - `resolveServable(route: Route, contactId: string): Promise<Servable>` : relit en base le numéro (toujours présent, même agent IA, sinon `route_changed` ou `number_removed`), le compte (`connected`, sinon `account_error`), l'organisation, le statut de l'agent IA (`draft` ou `paused` : `bot_inactive`) et, en `limited`, la liste (`contactMatchesAllowlist`, sinon `not_allowed`). Tous les refus sauf `route_changed` incrémentent le compteur de l'agent IA (§8.4).
  - `ServeInput { route: Route; transport: Transport; message: IncomingMessage }` ; `serveMessage(input, tracker)`.
  - `ConversationContext` gagne `accountId: number` ; un envoi refusé pour jeton (`TransportSendError` `auth`) appelle `setWhatsAppAccountError(accountId, 'token_invalid', 'Jeton refusé par le fournisseur WhatsApp.')` au lieu de l'état d'exécution de l'agent IA.
  - `BotConfig` perd `whatsapp_numbers` ; `findRoute`, `findBotConfigByNumber` et l'index des numéros disparaissent ; `upsertBot(rec)` écrit puis relit l'enregistrement en base et le met en cache, sous le verrou `createKeyedLock()` clé `<organisation>/<agent IA>`.
- Pipeline (ordre, revue 2b-1 M-5) : âge ; type sans réponse ; réservation `<numéro E.164>:<identifiant>` (doublon : fin, rien compté) ; `resolveServable` (refus : compteur, marquage traité, fin) ; sous le verrou (numéro, contact) : `resolveServable` relu ; mot-clé « reset » d'un contact de la liste (choix 9) ; session ; accueil ; réponse ; marquage traité dans tous les cas.
- Webhook Meta :
  - `GET /webhook/meta/:key` : compte trouvé par empreinte, mode `meta_manual`, `hub.mode === 'subscribe'`, jeton comparé à temps constant au `verify_token` du compte (une clé inconnue compare contre une valeur fixe) ; sinon 403 ; succès 200 `text/plain` avec le challenge.
  - `POST /webhook/meta/:key` : en-tête `x-hub-signature-256` absent ou vide : 401 avant toute lecture du corps (m7) ; compte inconnu, `disconnected` ou d'un autre mode : 404 avant lecture du corps ; corps brut lu ; signature vérifiée **une fois** avec le secret du compte (M-3) ; fausse : `recordSignatureFailure`, 200, rien d'autre ; bonne : `recordSignatureSuccess`, `touchSignatureOk` si `last_signature_ok_at` est null ou date de plus de 10 minutes, puis traitement suivi par `tracker` et 200.
  - Traitement : une entrée dont `entry.id` n'est pas `account.waba_id` est ignorée en entier (journal du nombre) ; chaque message (50 au plus) est routé par `findPresentNumber(account.id, { providerNumberId: message.recipientId })`, numéro libre ou absent : ignoré ; `number.client_id !== account.client_id` : ignoré et journalisé comme anomalie. Les statuts et événements sont transmis à la tâche 7 (ici : journal du nombre seulement).
  - `parseMetaWebhook` renseigne `IncomingMessage.providerAccountId` (= `entry.id`) et l'ajoute aux statuts.
- Webhook CM.com : `POST /webhook/cm-com/:key` : compte trouvé par empreinte et mode `cm_com`, sinon 404 avant lecture du corps ; numéro routé par `findPresentNumber(account.id, { phoneE164 })` du destinataire normalisé. Parseur : identifiant du contact = `from.number` (via `fromCmNumber`), sinon `from.whatsapp.user_id` ; identifiant du message selon la tâche 0 (m13).

- [ ] **Étape 1 : tests du pipeline et des webhooks** (réécriture de `meta-webhook.test.ts`, `cm-webhook.test.ts`, `pipeline.test.ts` sur le monde par compte ; les tests des anciennes routes sont supprimés avec elles)
  - `POST /webhook/meta/<clé>` sans en-tête de signature et JSON invalide : 401 (et non 400). `// revue finale 2b-1 m7`
  - Clé inconnue : 404, aucune requête de lecture des secrets (espion sur `decryptAccountSecrets`).
  - Signature fausse : 200, aucun appel LLM, aucune session, aucune écriture (compteur non servi inchangé, `processed_messages` vide). `// audit 4.2`
  - POST de 50 messages vers 50 numéros du compte avec une signature fausse : un seul calcul de HMAC (espion sur `verifyMetaSignature`), aucune lecture de numéro. `// revue 2b-1 M-3`
  - Point d'attention 1 : entrée d'une autre WABA, ou `phone_number_id` d'un numéro du compte B, signée avec le secret du compte A sur l'URL de A : ignorés, aucun effet.
  - Agent IA `limited` : contact de la liste servi ; contact hors liste : aucun appel LLM, aucune session, compteur à 1. `// spec §8.4`
  - Point d'attention 4 : liste `['+33612345678']`, contact `FR.abc123` : non servi ; liste `['FR.abc123']`, contact `33612345678` : non servi ; liste `['FR.abc123']`, contact `FR.abc123` : servi, réponse envoyée à `FR.abc123`.
  - Relivraison trois fois d'un message pour un agent IA en pause : compteur à 1. `// revue 2b-1 M-5`
  - Compte en `error` (jeton) : aucun appel LLM pour les messages suivants. `// revue finale 2b-1 m8`
  - Envoi refusé (401 Meta) : le compte passe `error` / `token_invalid`.
  - « reset » par un contact de la liste : session et historique de cet agent IA effacés, lead conservé, réponse « Conversation réinitialisée. », aucun appel LLM ; « reset » par un contact hors liste d'un agent IA `active` : transmis au LLM comme texte.
  - Branchement pendant l'attente derrière le verrou : le message en file n'est pas servi par l'ancien agent IA (`route_changed`).
  - CM.com : contact BSUID (`from.whatsapp.user_id` seul) servi avec un identifiant opaque ; clé d'URL d'un compte Meta sur la route CM.com : 404.
  - GET de vérification : bon jeton 200 `text/plain` ; jeton d'un autre compte : 403.
- [ ] **Étape 2 : lancer, constater l'échec** ; **Étape 3 : implémenter**, puis supprimer `findBotByNumber`, l'index des numéros, `getTransportForBot`, `getCmWebhookSecret`, les anciennes routes de webhook, `config.meta.verifyToken` et leurs tests (le message de commit les liste).
- [ ] **Étape 4 : vérifier** : `npm test && npm run test:pg && npm run typecheck && npm run typecheck:tests && npm run check:tests` ; la suite d'isolation existante passe sur le monde par compte sans assertion affaiblie.
- [ ] **Étape 5 : commit** `feat(webhooks): webhooks par compte WhatsApp et route lue en base (accès limité, reset, compte en erreur)`.

---

### Tâche 7 : événements Meta (statuts, compte, numéros)

Spec §7.4, §7.6.

**Fichiers :**
- Créer : `src/whatsapp/meta-events.ts`, `src/whatsapp/refresh-scheduler.ts`, leurs tests
- Modifier : `src/webhooks/meta.ts`, `src/transport/meta-cloud.ts` (`accountEvents` avec `event` et `displayPhoneNumber` filtrés), `src/app.ts` (`AppDeps.refreshScheduler?`), `src/index.ts` (planificateur arrêté à l'arrêt propre)

**Interfaces :**
- Produit :
  - `ACCOUNT_ALERT_CODES: Record<number, WhatsAppAccountAlert['kind']>` (valeurs de la tâche 0, f ; attendu `131042: 'payment'`, `131031: 'account_locked'`, `368: 'policy_block'`).
  - `handleMetaEvents(account: WhatsAppAccountRecord, batch: Pick<MetaWebhookBatch, 'statuses' | 'accountEvents'>, deps: { db: Database; scheduler: RefreshScheduler }): Promise<void>` : statut `failed` d'un numéro présent du compte : `recordDeliveryFailure(numéro, premier code)` ; code dans `ACCOUNT_ALERT_CODES` : `addWhatsAppAccountAlert` ; `account_update` : alerte `account_update` avec `event` filtré `[A-Z_]{1,64}` ; tout champ `account_update` ou commençant par `phone_number_` : `scheduler.schedule(account.client_id, account.id)`. Entrées d'une autre WABA ignorées (comme en tâche 6).
  - `RefreshScheduler { schedule(clientId: string, accountId: number): void; stop(): void }` ; `createRefreshScheduler(refresh: (clientId: string, accountId: number) => Promise<void>, minIntervalMs = 60_000): RefreshScheduler` : au plus un rafraîchissement par compte et par intervalle ; une demande pendant l'intervalle est reportée à sa fin, une seule fois ; une erreur de `refresh` est journalisée sans le détail du fournisseur au-delà de 200 caractères. Le rafraîchissement appelle `WhatsAppAccountService.refreshNumbers(clientId, accountId, null)`.

- [ ] **Étape 1 : tests**
  - Statut `failed` avec le code 131042 : `delivery_failures` à 1, alerte `payment` sur le compte.
  - Statut d'un `phone_number_id` d'un autre compte : rien n'est écrit.
  - Point d'attention 3 : 50 événements `phone_number_quality_update` en une minute (horloge simulée) : `refresh` appelé 2 fois au plus (immédiat puis reporté), jamais en parallèle pour un même compte.
  - Rafraîchissement qui retire un numéro : son agent IA `active` passe `paused` avec `status_reason = 'number_removed'` (spec §7.4).
  - `stop()` annule les reports.
- [ ] **Étape 2 : lancer, constater l'échec** ; **Étape 3 : implémenter** ; **Étape 4 : vérifier** : `npm test && npm run test:pg && npm run typecheck`.
- [ ] **Étape 5 : commit** `feat(webhooks): statuts de livraison, événements de compte et rafraîchissement d'inventaire Meta`.

---

### Tâche 8 : agents IA : numéro, statut, liste d'accès limité, activation ; fin du modèle par agent IA

Spec §6 (migration), §7.5, §8.1 à §8.4 ; revue 2b-1 I-3 ; audit 3.2, 3.3, 3.5, 6.2, 6.3.

**Fichiers :**
- Modifier : `src/core/services/bot-service.ts`, `connections-service.ts` (méthodes transport supprimées), `dashboard-service.ts`, `src/api/admin/routes/bots.ts`, `connections.ts`, `src/core/providers.ts` (section `transport` supprimée), `packages/contracts/src/bots.ts`, `whatsapp.ts`, `src/core/database/sqlite.ts`, `postgres.ts`, `types.ts` (migration, suppressions), tests associés ; supprimer `src/core/database/__tests__/bot-numbers-e164-migration.test.ts` et `src/core/__tests__/legacy-invalid-number.test.ts` (comportements supprimés, revue finale 2b-1 m6 devenue sans objet)

**Interfaces :**
- Consomme : `assignNumber`, `unassignNumber`, `transitionBotStatus`, `activateWithNumber`, `replaceAllowlist`, `getAllowlist`, `getWhatsAppNumberForBot`, `isSignatureRejected`, `TRANSITION_MESSAGES`.
- Produit :
  - Contrats : `SetBotStatusInput { status: 'draft' | 'limited' | 'active' | 'paused' }` ; `AssignNumberInput { number_id: number (entier positif) }` ; `SetAllowlistInput { entries: string[] (20 au plus) }` ; `ActivateBotInput { number_id; status: 'limited' | 'active'; allowlist: string[] (20 au plus) }` ; `CreateBotInput` sans `transport` ; `SetNumbersInput` supprimé.
  - `BotNumberSummary { id; phone_e164; display_name; is_test; provider_state; quality; account: { id; name; mode; state; error_reason } }`.
  - `BotDetail = BotRecord & { whatsapp_number: BotNumberSummary | null; allowlist: string[]; unserved: { count: number; last_at: string | null } }` (plus de `numbers`, plus de `transport`).
  - `BotService` : `assignNumber(clientId, botId, actorUserId, numberId): Promise<BotDetail>` ; `unassignNumber(clientId, botId, actorUserId): Promise<BotDetail>` ; `setStatus(clientId, botId, actorUserId, status: BotStatus): Promise<BotDetail>` ; `setAllowlist(clientId, botId, actorUserId, entries: string[]): Promise<BotDetail>` (chaque entrée par `normalizeAllowlistEntry`, une erreur par indice « Numéro au format international (ex. +33612345678) ou identifiant WhatsApp attendu. », doublons fusionnés, plus de 20 : erreur sur `entries`) ; `activate(clientId, botId, actorUserId, input: ActivateBotInput): Promise<BotDetail>`. Refus de la machine : 409 avec `TRANSITION_MESSAGES[reason]` ; `not_found` : 404. Les opérations passent `isAccountBlocked: isSignatureRejected`.
  - Routes (action `bots.configure`) : `PUT /bots/:botId/number`, `DELETE /bots/:botId/number`, `PUT /bots/:botId/status`, `PUT /bots/:botId/allowlist`, `POST /bots/:botId/activate`. Supprimées : `PUT /bots/:botId/numbers`, `GET` et `PUT /bots/:botId/transport`, `POST /bots/:botId/transport/validate`.
  - `BotHealth` : `numbers` et `whatsapp.validated*` remplacés par `whatsapp: { number: BotNumberSummary | null }` ; `status_reason` ajouté.
  - Audits : `bot.number` `{ from_number_id, to_number_id, previous_bot_id }`, `bot.status` `{ from, to }`, `bot.allowlist` `{ count }`, `bot.activate` `{ status, number_id, count }`.
- Migration (les deux moteurs, idempotente, chaque suppression journalisée avec son nombre) : table `bot_numbers` supprimée ; identifiants `tenant_credentials` de service `transport` supprimés ; agents IA `limited`, `active` ou `paused` repassés `draft` ; colonne `bots.transport` supprimée (SQLite : `ALTER TABLE ... DROP COLUMN`) ; colonnes `transport_validated_at` et `transport_error` de `bot_runtime_state` supprimées ; `BotRecord.transport`, `BotConfig.transport`, `BotNumberRecord`, `listBotNumbers`, `setBotNumbers`, `setTransportValidation`, `setBotStatusUnchecked` retirés de l'interface.

- [ ] **Étape 1 : tests**
  - Machine d'états par l'API : `limited` sans numéro : 409 « Branchez un numéro WhatsApp avant d'activer l'agent IA. » ; `active` depuis `draft` sur un numéro non test : 409 ; sur un numéro de test : 200. `// audit 3.5`
  - Édition concurrente d'une pause : `PATCH` (nom) et `PUT status paused` simultanés : statut final `paused`. `// revue 2b-1 I-3`
  - `activate` : un seul appel branche, enregistre la liste et passe `limited` ; liste vide : 409, rien de changé (numéro non branché). `// spec §8.2`
  - Liste : 21 entrées : 400 ; `['06 12']` : 400 sur `entries.0` ; doublons `+33 6 12 34 56 78` et `0033612345678` : une seule entrée.
  - Détail : `whatsapp_number.account.state` reflète l'état affiché (`signature_rejected` compris) ; `unserved.count` lu de l'état d'exécution.
  - Point d'attention 5 (fichier SQLite temporaire, et Postgres sur une base créée avec l'ancien schéma par SQL brut) : avant migration un agent IA `active` avec deux lignes `bot_numbers`, des identifiants `transport` et `crm`, deux conversations et un lead ; après ouverture du pilote : agent IA `draft`, plus de `bot_numbers` ni de colonne `transport`, identifiants `crm` intacts, conversations et lead intacts ; seconde ouverture : aucun changement et aucun journal de suppression.
  - Les routes supprimées répondent 404.
- [ ] **Étape 2 : lancer, constater l'échec** ; **Étape 3 : implémenter** ; **Étape 4 : vérifier** : `npm test && npm run test:pg && npm run typecheck && npm run typecheck:tests && npm run check:tests`.
- [ ] **Étape 5 : commit** `feat(bots): numéro, statuts et accès limité des agents IA ; suppression du transport par agent IA`.

---

### Tâche 9 : suite d'isolation, scénarios du lot 2b-2

Spec §4.1 (puce 2b-2), §10.

**Fichiers :**
- Modifier : `src/__tests__/isolation/harness.ts`, `two-orgs.test.ts` ; créer `src/__tests__/isolation/accounts.test.ts`

- [ ] **Étape 1 : écrire les scénarios** (chemin HTTP réel, signatures réelles, `fetch` et LLM simulés, les deux moteurs)
  - Numéro rebranché de `acme/ventes` vers `acme/relance` par `PUT /bots/relance/number` : le message suivant est servi par `relance` avec le jeton du compte d'acme, aucune session ne reste sur `ventes`, l'historique de `ventes` reste attaché à `ventes`. `// audit 6.3, revue 2b-1 M-1`
  - Reprise : le compte d'acme passe `error`, beta raccorde un compte dont l'inventaire contient le même numéro : un message vers ce numéro est servi par l'agent IA de beta avec le jeton de beta ; le prompt de beta ne contient aucun contenu d'acme ; les réponses de l'API de beta (compte, numéros, agent IA) ne contiennent ni `acme`, ni le nom de son compte, ni son agent IA ; l'agent IA d'acme est `paused`. `// spec §6, audit 1.5`
  - Accès limité : contact hors liste : rien (ni LLM, ni envoi, ni session) ; compteur à 1.
  - URL du compte d'acme avec un message signé par le secret de beta : ignoré ; URL de beta avec un `phone_number_id` d'acme signé par beta : ignoré. `// revue 2b-1 M-2`
  - Organisation suspendue : ses numéros ne servent rien, même en `active`.
  - Compte `disconnected` : son URL répond 404, aucun effet.
- [ ] **Étape 2 : vérifier** : `npx vitest run src/__tests__/isolation && npm run test:pg -- src/__tests__/isolation` ; tout passe ; puis, pour chaque scénario, une mutation temporaire (par exemple retirer le contrôle `account_id` de `getTransportForNumber`, ou le filtre `entry.id`) fait échouer au moins un test ; mutations annulées, résultat noté dans le rapport de tâche.
- [ ] **Étape 3 : commit** `test(isolation): scénarios des comptes WhatsApp (rebranchement, reprise, accès limité, déconnexion)`.

---

### Tâche 10 : web minimal, scripts et documentation

Le back-office web garde ses écrans actuels jusqu'au lot 2b-3, sans régression.

**Fichiers :**
- Modifier : `apps/web/src/lib/bot-draft.ts` (plus de `transport`), `apps/web/src/lib/agent-types.ts`, `onboarding.ts`, `apps/web/src/app/api/bots/summary/route.ts`, `apps/web/src/components/agents/agents-table.tsx`, `apps/web/src/components/agent/overview.tsx` et leurs tests ; `scripts/seed-credentials.ts` (partie transport retirée), `scripts/import-config-to-db.ts` (numéros et transport retirés) ; `CLAUDE.md` (routes de webhook, `META_VERIFY_TOKEN` global supprimé, état du projet), `docs/ARCHITECTURE.md`, `.env.example` (`META_VERIFY_TOKEN` retiré, `PUBLIC_BASE_URL` ajouté)

**Interfaces :**
- Consomme : `BotDetail.whatsapp_number`, `BotHealth.whatsapp.number` (tâche 8).
- Le résumé web expose `number: string | null` (E.164 du numéro branché) au lieu de `numbers`.
- `maskNumber` : `maskNumber('+33612345678') === '+33612 •• •• 78'`, `maskNumber('+15551412647') === '+15551 •• •• 47'`, `maskNumber('') === ''` (les cinq premiers chiffres après `+`, puis les deux derniers).

- [ ] **Étape 1 : tests web** : tableau des agents IA et vue d'ensemble affichent le numéro masqué depuis le nouveau champ ; sans numéro, le libellé « non connecté » existant ; le brouillon de l'assistant n'envoie plus `transport`.
- [ ] **Étape 2 : lancer, constater l'échec** ; **Étape 3 : implémenter** ; **Étape 4 : vérifier** : `npm test -w @wabagent/web && npm run typecheck -w @wabagent/web && npm test && npm run typecheck`.
- [ ] **Étape 5 : documentation** : `CLAUDE.md` (section Routes de webhook : `GET` et `POST /webhook/meta/<clé>`, `POST /webhook/cm-com/<clé>` ; plus de jeton de vérification global ; état : 2b-2 livré), `docs/ARCHITECTURE.md` (comptes WhatsApp, route lue en base, transports par compte). Aucun tiret cadratin ajouté.
- [ ] **Étape 6 : commits** (un par sujet) : `fix(web): numéro de l'agent IA lu depuis le compte WhatsApp, masquage au format E.164`, `chore(scripts): semis et import sans transport par agent IA`, `docs: comptes WhatsApp d'organisation (CLAUDE.md, architecture, .env.example)`.

---

### Tâche 11 : revue d'isolation dédiée

Spec §4.5. Revue, pas d'implémentation.

- [ ] **Étape 1 : confier la revue à un relecteur neuf** (sous-agent sur le modèle le plus capable) qui reçoit seulement : la spec 2b (§2, §6, §7, §8, §10), l'audit, la liste des fichiers modifiés (`git diff --stat main...HEAD`) et la consigne : pour chaque fichier modifié, lire aussi le code qu'il appelle et qui l'appelle ; chercher ce qui pourrait faire fuir une donnée entre organisations (y compris par les réponses d'erreur, les audits, les journaux et la reprise d'un numéro), faire répondre un agent IA qui ne devrait pas, utiliser des identifiants qui ne sont pas ceux du compte du numéro, ou produire un effet de bord avant authentification ; relever aussi les défauts hérités. Il ne reçoit ni les rapports de tâches ni les conclusions de l'implémenteur.
- [ ] **Étape 2 : trier** chaque constat (corrigé dans ce lot, reporté en 2b-3, ou audit complet) ; chaque correction suit le cycle test qui échoue, correction, test qui passe, commit `fix(isolation): …`.
- [ ] **Étape 3 : consigner** `docs/superpowers/research/2026-11-XX-revue-isolation-2b-2.md` (constats, décisions, commits) ; commit `docs(isolation): revue d'isolation du lot 2b-2`.

---

### Tâche 12 : test en live

Spec §11 ; règle de François : tester l'application en réel à chaque livraison.

- [ ] **Étape 1 : préparer** un worktree jetable de la branche, une copie de `store/demo.db`, moteur et web lancés ; deux organisations (une de la copie, une créée par `scripts/create-organization.ts`), un admin chacune (`scripts/seed-admin.ts`).
- [ ] **Étape 2 : migration** : comptes avant et après (conversations, leads, identifiants CRM), agents IA en brouillon, journaux de suppression ; second démarrage sans effet.
- [ ] **Étape 3 : raccordement réel en lecture** par l'API admin : compte Meta manuel avec la sandbox de François (vérification, abonnement constaté existant, inventaire du numéro de test `+15551412647` avec son repère de test, expiration du jeton) ; compte CM.com Cyran (vérification et inventaire, sandbox écartée). Si l'abonnement de l'app manque, le POST `subscribed_apps` sur la sandbox n'est fait qu'avec l'accord de François au moment du test.
- [ ] **Étape 4 : parcours moteur** : branchement du numéro de test sur un agent IA, activation directe (numéro de test), passage en `limited` avec le numéro de François en liste ; webhooks rejoués avec `curl` sur `/webhook/meta/<clé>` signés avec `openssl dgst -sha256 -hmac` et le vrai secret de la sandbox : contact de la liste servi (appel LLM réel), contact hors liste non servi et compté, signature fausse, clé inconnue, « reset », relivraison ; reprise d'un numéro entre les deux organisations avec un inventaire simulé ; déconnexion refusée puis acceptée.
- [ ] **Étape 5 : envoi et réception réels** (avec l'accord de François au moment du test) : moteur local exposé par le tunnel Cloudflare `whatsapp-demo-bots` (`whatsapp-demo.digitalconsult.me` vers `localhost:3800`), URL de rappel de l'app Meta changée temporairement vers `https://whatsapp-demo.digitalconsult.me/webhook/meta/<clé>` puis remise à `https://demo-wa.cyran.ai/webhook` après le test ; aucun VPS n'est touché. Un message de François vers le numéro de test reçoit la réponse de l'agent IA en accès limité. Sans accord : étape notée « non faite ».
- [ ] **Étape 6 : back-office web** : pages des agents IA et vue d'ensemble sans régression, numéro masqué `+…`.
- [ ] **Étape 7 : rapport** à François (vérifié, non vérifié, écarts). Aucun envoi depuis le compte CM.com de production.

Puis revue finale de branche (subagent-driven-development), merge local avec l'accord de François, push seulement avec son accord explicite.

---

## Hors lot 2b-2 (rappel)

- Écrans Organisation › Connexions, raccordement guidé, assistant Numéro et Activer, encarts de la page de l'agent IA : lot 2b-3 (spec §9), sur les routes de ce lot.
- Embedded Signup, coexistence, compte partagé entre organisations : plus tard (spec §2).
- File d'entrée persistante, verrou partagé entre instances, compteur de signatures partagé : chantier multi-instance.
- Revue 2b-1 M-4 (réservation reprise après 300 s) et masquage des journaux des transports et du handler (M-6) : audit complet de fin de 2b.
- CRM au niveau de l'organisation : plan suivant.

## Résultats de la tâche 0

Relevé le 8 novembre 2026, uniquement en GET. Meta : Graph `v26.0`, app WABAGENT Dev (`1424483510748297`, portefeuille Ravivo), jeton d'utilisateur système. CM.com : compte Cyran, lectures seules. Aucun secret, jeton ni `appsecret_proof` n'apparaît ici. Les pages de documentation ont été lues par l'outil de récupération web (résumé automatique de la page) : les citations sont celles qu'il a restituées.

**Meta, requêtes (WABA de test `1122051030798254`, numéro de test `1444139162121271`)**

| Point | Constat | Source | Décision |
|---|---|---|---|
| a. `appsecret_proof` | Bon proof : 200 `{id, name: "Test Messaging Account"}`. Proof faux : HTTP 400, `error.code` 100, `type` `GraphMethodException`, message « Invalid appsecret_proof provided in the API argument », pas de `error_subcode`. Même erreur sur `debug_token`. Sans aucun proof : 200 (le réglage « exiger le secret de l'app » n'est pas actif sur cette app). | `GET /{WABA}?fields=id,name` trois fois | Pas de repli (a) : le contrôle du secret fonctionne. Tâche 3 : le proof est toujours envoyé ; HTTP 400 avec `code` 100 et message contenant `appsecret_proof` : check `app_secret` en `failed` (« Secret de l'app refusé »), distinct de `token_invalid`. Un `code` 100 sans ce message (par exemple `error_subcode` 33) n'est pas une erreur de secret. Le contrôle ne vaut que parce que le proof est envoyé : un test unitaire vérifie sa présence sur chaque appel (déjà prévu). |
| b. `debug_token` | 200, `data` contient `app_id`, `type` `SYSTEM_USER`, `application`, `is_valid` true, `expires_at` 0, `data_access_expires_at` 0, `issued_at`, `scopes`, `granular_scopes`, `user_id`. `app_id` égal à l'app attendue. Aucun `target_ids` dans `granular_scopes`. | `GET /debug_token?input_token=<jeton>` avec Bearer et proof | Pas de repli (b) : `meta_app_id = data.app_id`, `token_expiry = 'never'` si `expires_at` vaut 0, sinon ISO. `granular_scopes` ne permet pas de retrouver les WABA (pas de `target_ids` ici) : ne pas s'en servir pour l'inventaire. |
| c. `subscribed_apps` | 200 `{"data":[{"whatsapp_business_api_data":{"id","name","link","category"}}]}`. Chemin de l'app : `data[].whatsapp_business_api_data.id`. Sur cette WABA, la seule app abonnée est « WA DevX Webhook Events 1P App » (`2202427980234937`), pas WABAGENT Dev : le `health_status` du numéro dit d'ailleurs « Your app is not subscribed to the message webhook ». La doc ajoute un `override_callback_uri` optionnel par entrée. | requête ci-dessus ; https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/subscribed-apps-api | Tâche 3 : comparer `data[].whatsapp_business_api_data.id` à `meta_app_id` (de `debug_token`) ; absent : `POST subscribed_apps` et check `created`. Cas réel rencontré ici : la tâche 12 devra passer par ce POST pour recevoir les messages du numéro de test (écriture chez Meta, avec l'accord de François). Ne pas fixer `override_callback_uri` : l'URL de rappel reste celle de l'app (plan, tâche 12 étape 5). |
| d. `account_mode` | Le numéro de test renvoie `account_mode: "LIVE"` (en liste `phone_numbers` et en lecture directe), avec `verified_name` « Test Number », `status` CONNECTED, `quality_rating` GREEN, `code_verification_status` VERIFIED, `messaging_limit_tier` TIER_250. La doc (via recherche, sources tierces pour l'exemple) décrit SANDBOX comme compte non vérifié : valeur non observée ici. Comparaison avec le numéro réel impossible (WABA introuvable, voir plus bas). Aucun autre champ lu (`name_status`, `platform_type`, `is_official_business_account`, `search_visibility`, `throughput`, `host_platform`…) ne distingue un numéro de test. | `GET /{WABA}/phone_numbers?fields=…,account_mode` ; `GET /{phone_number_id}?fields=account_mode` | **Repli (d) appliqué : `account_mode` ne peut pas désigner le numéro de test.** Tâche 3 : `is_test` n'est pas déduit de `account_mode` (il reste lu et conservé en `provider_state` si le schéma le prévoit). Tâche 5 : l'étape conditionnelle « marquage manuel par l'admin » devient obligatoire pour un numéro Meta. Les profils CM.com `isSandbox` restent un signal distinct (voir plus bas). |
| e. jeton tronqué | HTTP 401, `error.code` 190, `type` `OAuthException`, message « Authentication Error ». Identique avec le proof du jeton réel, le proof du jeton tronqué, sans proof, et sans jeton du tout. | requêtes GET avec jeton tronqué à 20 caractères | Attendu confirmé : 401 ou `code` 190 : `token_invalid`. Un proof faux (400, code 100) n'est pas un `token_invalid`. |
| WABA inexistante ou inaccessible | HTTP 400, `code` 100, `error_subcode` 33, `type` `GraphMethodException`. | `GET /1122051030798255?fields=id,name` | Tâche 3 : `code` 100 avec `error_subcode` 33 : check `waba_access` en `failed` (« Identifiant de compte introuvable ou non partagé avec le jeton »), classé `other`. |
| WABA et phone_number_id | `GET /{phone_number_id}/phone_numbers` et `/{phone_number_id}/subscribed_apps` : 400 « nonexisting field ». Seul un identifiant de WABA convient. | requêtes | Tâche 3 : l'utilisateur saisit un WABA ID ; un identifiant de numéro collé par erreur donne `other` avec ce message. |
| Compte de messagerie = WABA ? | Oui. `1122051030798254` répond à `/{id}/phone_numbers` (1 numéro) et `/{id}/subscribed_apps`, avec `owner_business_info` Ravivo (`1270659448489249`), `ownership_type` SELF, `account_review_status` APPROVED. | requêtes | L'« ID du compte de messagerie » affiché par Meta est l'identifiant de WABA à demander. |
| Format du numéro | `display_phone_number` vaut `"+1 555-164-9072"` (espaces, tiret). Pagination : réponse avec `paging.cursors` et sans `paging.next` quand tout tient dans la page. | `phone_numbers` (limit=100 et limit=1) | Tâche 3 : `normalizeWhatsAppNumber` doit accepter cet affichage (test avec espaces et tirets). La pagination se fait par `paging.next` seulement s'il est présent. |
| WABA du numéro réel `+33663535053` | **Non trouvée avec ce jeton.** `granular_scopes` sans `target_ids` ; `/me/assigned_whatsapp_business_accounts` et `/{user_id}/assigned_whatsapp_business_accounts` : `data: []` ; `/me/accounts`, `/me/assigned_business_asset_groups` : vides ; `/{business}/owned_whatsapp_business_accounts`, `client_whatsapp_business_accounts` : 403 code 200 « Requires business_management permission ». Le jeton n'a que les permissions `whatsapp_business_management`, `whatsapp_business_messaging`, `manage_app_solution`, `whatsapp_business_manage_events`, `public_profile`. | requêtes | À relever par François dans le gestionnaire WhatsApp (ID du compte de messagerie du numéro réel). Aucune tâche du code n'en dépend ; la tâche 12 en aura besoin si le numéro réel est utilisé. |
| Mode de l'app | **Non lisible.** Avec le jeton d'app (`<app_id>\|<secret>`) : `id`, `name`, `link`, `app_type` 0, `contact_email`, `roles` sont lisibles ; `is_live`, `live`, `status`, `mode` n'existent pas (« nonexisting field »). `GET /{app_id}/subscriptions` : `data: []` (aucun abonnement webhook déclaré par l'API). La doc `subscribed_apps` ne parle pas du mode de l'app. | requêtes ; doc ci-dessus | Le mode ne se lit pas en GET : la tâche 12 le fait constater à François dans le tableau de bord (réception du webhook d'un numéro de test). Aucune tâche de code ne dépend de cette valeur. |
| Santé du compte (hors brief) | `health_status` du numéro est lisible (`can_send_message`, `entities[]` avec `error_code` et `possible_solution`) : sur ce compte, WABA `BLOCKED` pour 141006 (moyen de paiement), business `LIMITED` pour 141010 (vérification d'entreprise). | `GET /{phone_number_id}?fields=health_status` | Information : source possible, plus tard, d'un check de santé (non prévue au lot). Ne change aucune tâche. |

**Meta, documentation (point f)**

| Point | Constat | Source | Décision |
|---|---|---|---|
| f1. codes d'échec | 131042 : « There was an error related to your payment method. » 131031 : « The WhatsApp Business Account associated with the app has been restricted or disabled for violating a platform policy, or we were unable to verify data included in the request against data set on the WhatsApp Business Account (e.g, the two-step pin included in the request is incorrect). » 368 : « The WhatsApp Business Account associated with the app has been restricted or disabled for violating a platform policy. » | https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes | Pas de repli : `ACCOUNT_ALERT_CODES = { 131042: 'payment', 131031: 'account_locked', 368: 'policy_block' }` comme prévu. Nuance pour la tâche 7 : 131031 couvre aussi un PIN de vérification en deux étapes incorrect (pas un état du compte) ; le libellé de l'alerte `account_locked` est donc « Compte restreint ou vérification des données refusée par Meta », sans affirmer que le compte est bloqué. |
| f2. `account_update` | Forme : `entry[].id` (identifiant de WABA), `entry[].time`, `entry[].changes[].field = "account_update"`, `entry[].changes[].value.event`. Valeurs d'`event` listées (16) : ACCOUNT_DELETED, ACCOUNT_RESTRICTION, ACCOUNT_VIOLATION, AD_ACCOUNT_LINKED, AUTH_INTL_PRICE_ELIGIBILITY_UPDATE, BUSINESS_PRIMARY_LOCATION_COUNTRY_UPDATE, DISABLED_UPDATE, MM_LITE_TERMS_SIGNED, PARTNER_ADDED, PARTNER_APP_INSTALLED, PARTNER_APP_UNINSTALLED, PARTNER_CLIENT_CERTIFICATION_STATUS_UPDATE, PARTNER_REMOVED, VOLUME_BASED_PRICING_TIER_UPDATE, ACCOUNT_OFFBOARDED, ACCOUNT_RECONNECTED. Le numéro, quand l'événement en porte un, est dans **`value.phone_number`**. | https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/reference/account_update | Tâche 7 : `event` filtré par `[A-Z_]{1,64}` convient. Pour `account_update`, `accountEvents[].displayPhoneNumber` se lit dans `value.phone_number`, pas `display_phone_number`. |
| f3. `phone_number_quality_update` | `value.display_phone_number` (chiffres sans `+`, exemple `"15550783881"`), `value.event` (valeurs documentées : ONBOARDING, THROUGHPUT_UPGRADE), `value.current_limit`, `old_limit` (retirés en février 2026), `max_daily_conversations_per_business`. | https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/reference/phone_number_quality_update | Tâche 7 : pour ce champ, le numéro se lit dans `value.display_phone_number` (différent d'`account_update`) ; le parseur lit les deux clés. Les valeurs d'`event` documentées sont peu nombreuses : le code ne fait pas de liste fermée, tout champ `phone_number_*` déclenche le rafraîchissement (déjà prévu). `entry.id` identifie la WABA : une entrée d'une autre WABA est ignorée. |
| f4. envoi vers un BSUID (Meta) | Cloud API : « set `recipient` to the user's BSUID » et omettre `to` (corps : `messaging_product`, `recipient_type`, `recipient`, `type`, `text`). Webhooks : `contacts[].user_id`, `messages[].from_user_id`, `statuses[].recipient_user_id` ; `contacts` absent des statuts `failed`. BSUID inutilisable pour les modèles d'authentification à un toucher, zéro toucher ou copie de code. La doc indique un démarrage par les API en juillet 2026. | https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids (lu sur les 100 000 premiers caractères d'une page de 190 000) | Tâche 4 : le transport Meta envoie `recipient` à la place de `to` quand le destinataire est un BSUID (`buildBase` met aujourd'hui toujours `to`). Test : corps avec `recipient` et sans `to`. Tâche 6 : le parseur Meta lit `messages[].from` d'abord, `from_user_id` sinon (non vérifié : présence de `from` quand le numéro est masqué). |

**CM.com (compte Cyran, `accountId` `6c41cd06-021a-4cc7-b789-6fca0560095b`, en-tête `X-CM-PRODUCTTOKEN`, lectures seules)**

| Point | Constat | Source | Décision |
|---|---|---|---|
| Canaux | `GET /channels/v1/accounts/{accountId}/channels` : 200. Profils WhatsApp à `available.whatsApp.profiles[]` avec `id`, `channelRequestId`, `channelTypeId`, `channelID`, `isPending`, `requestState.progression.current` (ici `…stages.active`). `sandbox.whatsApp` vaut `null` sur ce compte (la forme d'un profil sandbox à cet endroit n'a pas été vue), `sandboxAvailable: ["whatsApp"]`. | requête | Tâche 3 : lire `available.whatsApp.profiles[].channelRequestId` (plusieurs canaux possibles) ; `available.whatsApp` ou `profiles` absent ou `null` : liste vide, pas d'erreur. Les profils de `sandbox.whatsApp` ne sont lus que par `isSandbox` de l'étape suivante. |
| Profils | `GET /channels/v1/accounts/{accountId}/whatsapp/{channelRequestId}/profiles?includeMetaQualityRating=true` : 200, tableau d'objets `{id, accountId, isFacebookEmbeddedSignUpImport, metaId, phoneNumber, name, isActive, isOtpProcessed, isOtpSent, isPending, isSandbox, metaQualityRating:{rating, currentLimit, dailyConversationLimit, restrictionHistory}, metaBusinessUsername:{status, username}, fulfilledOnUtc, createdOnUtc, rejectedOnUtc, cancelledOnUtc, deletedOnUtc, entityStatus}`. Ici `phoneNumber` vaut `"0033…"` (préfixe `00`, sans `+`), `metaId` est l'identifiant du numéro chez Meta, `isSandbox` false, `entityStatus` ACTIVE. La doc ajoute les paramètres `q`, `status`, `skip`, `take` (leur sens n'est pas décrit). | requête ; https://developers.cm.com/messaging/reference/whatsapp_getprofilesasync | Tâche 3 : `provider_number_id = metaId`, sinon `'cm:' + id` ; numéro via `fromCmNumber` (préfixe `00`) puis `normalizeWhatsAppNumber` ; `isSandbox` compté dans `skipped.sandbox` ; ne retenir que `entityStatus` ACTIVE (les autres profils, en attente ou supprimés, sont écartés sans erreur). Pagination `skip`/`take` non documentée : un seul appel, limite connue notée. |
| `businessaccount` | **Le chemin du plan est faux (404).** `GET /accounts/{accountId}/businessaccount` : 404 `{"Message":"Requested url could not be found."}`. Le bon chemin est `GET /channels/v1/accounts/{accountId}/whatsapp/{channelRequestId}/businessaccount` : 200 `{id, accountId, channelRequestId, isPending, isFacebookEmbeddedSignUp, facebookId, metaName, cancelledOnUtc, fulfilledOnUtc, createdOnUtc, entityStatus}`. Les autres chemins essayés (`/whatsapp/businessaccount`, `/businessaccounts`, sous le profil, `/business-account`) : 404. `facebookId` vaut ici `1492111938931225`, différent du `metaId` du profil. Non vérifié : `facebookId` est-il l'identifiant de WABA ou celui du portefeuille (Business Manager) ? La base de connaissances CM.com parle de « Business Manager ID » sans le dire ; une vérification chez Meta toucherait le portefeuille Cyran, interdit ici. | requêtes ; https://knowledgecenter.cm.com/kc/where-is-my-facebook-business-manager-id | **Contradiction avec la tâche 3** (voir le rapport) : la tâche 3 appelle `businessaccount` par compte, et il se lit par `channelRequestId`. Tâche 3 : appel par canal, `waba_id = facebookId` conservé mais **à titre indicatif seulement** (affichage), jamais utilisé pour filtrer ou autoriser un événement CM.com ; un échec ou un 404 de cet appel ne rend pas la vérification `failed` (check `cm_account` en `ok` sans `waba_id`, `waba_id` null). |
| productToken faux | HTTP 401, corps `{"status":9,"message":"Authorization failed"}`. Identique avec un jeton vide ou sans l'en-tête. | requêtes | Pas de repli : 401 : `token_invalid` (déjà prévu). Les autres chemins inconnus répondent 404 avec un corps `{"Message":…}` (autre forme que le 401). |

**CM.com, documentation (m13 et BSUID)**

| Point | Constat | Source | Décision |
|---|---|---|---|
| m13. `reference` / `messageContext` (WhatsApp) | Page WhatsApp entrant : `reference` = « Unique identifier of the inbound message », qui est l'identifiant de message attribué par Meta pour WhatsApp (`wamid.…`) ; `messageContext` = « Reference of the message the user replied to », vide si le message n'est pas une réponse. (La page générique des messages entrants décrit `reference` comme la référence du message sortant auquel on répond et dit qu'il n'est géré que pour le SMS : elle ne vaut pas pour WhatsApp.) | https://developers.cm.com/messaging/docs/whatsapp-inbound ; https://developers.cm.com/messaging/docs/incoming-messages | **Repli (m13) appliqué, et plus strict que prévu** : identifiant du message = `reference`, sinon identifiant de repli généré. `messageContext` n'entre plus dans la chaîne : c'est l'identifiant du message cité, partagé par toutes les réponses à ce message, il ferait dédoublonner à tort des messages distincts (aujourd'hui `payload.messageContext \|\| payload.reference` dans `src/transport/cm-com.ts`, à inverser et réduire en tâche 6). Test : deux réponses au même message cité avec deux `reference` : deux messages traités. |
| BSUID entrant | `from.whatsapp.user_id` : « always populated » ; `from.number` contient le BSUID quand le numéro n'est pas partagé ; `from.whatsapp.parent_user_id` et `from.whatsapp.username` en option. Statuts : `recipient.whatsapp.user_id`, `recipient.number` (BSUID si numéro masqué). | https://developers.cm.com/messaging/docs/whatsapp-business-scoped-user-ids | Conforme au parseur prévu en tâche 6 (`from.number`, sinon `from.whatsapp.user_id`). Un numéro masqué arrive donc dans `from.number` sous forme de BSUID (`XX.chiffres`) : le test de forme BSUID passe avant `fromCmNumber`. |
| BSUID sortant | La doc place le BSUID dans le champ existant : « Place the BSUID in the existing `to.number` field », « Each `to` entry must contain either a phone number or a BSUID, not both », exemple `"to": [ { "number": "NL.84827364598365" } ]`. Aucun `to[].whatsapp.user_id` documenté. | https://developers.cm.com/messaging/docs/whatsapp-business-scoped-user-ids (deux lectures concordantes) | **Contradiction avec la tâche 4** (voir le rapport) : la tâche 4 prévoit `{ number: to, whatsapp: { user_id: to } }` d'après `buildRecipient` du dépôt de référence, forme que la doc ne décrit pas. Décision proposée : suivre la doc, `{ number: to }` ; le test de la tâche 4 attend ce corps. Non vérifiable sans envoi. |

Pas de repli déclenché pour (a), (b), (c), (e), (f1) à (f3). Replis appliqués : (d) et (m13). Non vérifié, nécessite une écriture ou un accès refusé : `POST subscribed_apps` (création d'abonnement), envoi réel vers un BSUID (Meta et CM.com), mode de l'app, WABA du numéro réel, nature de `facebookId` CM.com, forme du statut `failed` (`statuses[].errors[]`) au webhook.
