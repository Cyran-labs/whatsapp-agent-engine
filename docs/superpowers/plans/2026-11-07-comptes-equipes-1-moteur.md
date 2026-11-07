# Comptes et équipes, plan 1 (moteur) : implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** donner au moteur le modèle Organisation > Entité > Agent IA, les rôles par périmètre, l'organisation active par en-tête et la gestion d'équipe par l'admin d'organisation, sans régression pour les `client_admin` existants.

**Architecture :** nouvelles tables `entities`, `memberships`, `agencies` et colonnes `clients.settings`, `clients.agency_id`, `bots.entity_id`, `invitations.grants`, portées par un module « accounts » séparé des gros drivers. Une migration de données unique, écrite contre l'interface `Database`, tourne au démarrage. Les droits sont résolus en base à chaque requête par un middleware unique et vérifiés par une politique centralisée `can()`.

**Tech stack :** Node 20, TypeScript strict, Express, better-sqlite3 / pg, Zod (`@wabagent/contracts`), jose, Vitest + supertest.

**Spec :** `docs/superpowers/specs/2026-11-07-comptes-et-equipes-design.md` (à lire en entier avant toute tâche).

**Plan 2 (app web) :** sélecteur d'organisation, espace Organisation (Entités, Utilisateurs, Réglages), entité dans l'assistant et le tableau des agents IA. Rédigé après validation des maquettes. Grâce au repli mono-organisation (tâche 5), l'app web actuelle continue de fonctionner sans modification après ce plan 1.

## Global Constraints

- TypeScript strict, pas de `any`, `const` par défaut ; logs au format `[Service] message`, sans emoji.
- Aucun tiret cadratin ni demi-cadratin dans le code, les messages d'erreur, les commits ; accents français dans les messages d'erreur.
- Aucune référence aux thématiques de démo Cyran (golf, immo, voyage, auto, acquisition), y compris dans les fixtures.
- Identifiants de code inchangés : `client_id`, `clients`, `bot` (vocabulaire produit « organisation », « agent IA » seulement dans les textes).
- **Aucun état en mémoire** ajouté : appartenances, rôles, entités, réglages lus en base à chaque requête.
- SQLite et Postgres implémentés à l'identique ; upsert Postgres en UPDATE puis INSERT, jamais `ON CONFLICT` sur index d'expression ; colonnes ajoutées par ensure-column idempotent.
- Rôles : `admin`, `super_manager` (périmètre organisation, `entity_id` null) ; `manager`, `advisor` (périmètre entité). Rôle plateforme `users.role` : `super_admin` ou `member`.
- Réglages par défaut : `visibility: 'all'`, `pool_self_claim: true`, `reassign: 'managers'`, `transfer: 'managers'`, `takeover: 'owner'`.
- Invitation : lien à usage unique, `ADMIN_INVITE_TTL_DAYS` (défaut 7), jeton stocké haché ; jamais d'identifiants envoyés ; le lien n'apparaît jamais dans une réponse d'API.
- En-tête d'organisation : `X-Organization-Id`.
- Toute écriture admin appelle `recordAudit` (best-effort).
- Pas de commit sans les tests verts de la tâche ; auteur `Francois Greze <francois@cyran.fr>`, aucune ligne de co-signature.

## Review Focus

1. **Utilisateur migré avec un ancien jeton** (contient `client_id`, rôle `client_admin`) et l'app web actuelle qui n'envoie pas d'en-tête : il doit continuer à tout voir et tout faire. Test : tâche 5.
2. **Admin de l'organisation A qui vise l'organisation B** (en-tête `X-Organization-Id: B`, ou `botId` de B avec l'en-tête A) : 403 ou 404, jamais de donnée de B. Test : tâche 6.
3. **Suspension ou désactivation avec un jeton encore valide** : refus dès la requête suivante, sans attendre l'expiration. Test : tâche 5.
4. **Retrait du dernier admin** par lui-même ou par un autre admin (changement de rôle, suspension) : 409. Test : tâche 8.
5. **Migration rejouée** (deuxième démarrage, ou base déjà partiellement migrée) : aucune entité en double, aucune appartenance en double. Test : tâche 3.

---

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `packages/contracts/src/accounts.ts` (créer) | Schémas Zod : rôles, `MembershipGrant`, `Grants`, entités, invitations, réglages. |
| `src/core/database/accounts-types.ts` (créer) | Types `EntityRecord`, `MembershipRecord`, interface `AccountsStore`. |
| `src/core/database/accounts-sqlite.ts`, `accounts-postgres.ts` (créer) | Schéma + méthodes `AccountsStore` pour chaque driver. |
| `src/core/database/migrate-accounts.ts` (créer) | `migrateAccounts(db)`, `ensureDefaultEntity(db, clientId)`. |
| `src/core/auth/permissions.ts` (créer) | `Access`, `Action`, `can()`. |
| `src/core/auth/access-service.ts` (créer) | `resolveAccess()` : appartenances en base vers `Access`. |
| `src/core/services/entity-service.ts`, `user-admin-service.ts`, `settings-service.ts` (créer) | Règles de gestion des entités, des membres, des réglages. |
| `src/api/admin/routes/entities.ts`, `users.ts`, `settings.ts`, `platform.ts` (créer) | Routes HTTP. |
| `src/core/auth/__tests__/fixtures.ts` (créer) | `seedOrgMember()`, `seedSuperAdmin()` pour tous les tests. |
| `scripts/create-organization.ts` (créer) | Organisation + entité par défaut + invitation du premier admin. |

---

### Task 1 : Contrats Zod des comptes

**Files :**
- Create : `packages/contracts/src/accounts.ts`
- Modify : `packages/contracts/src/index.ts` (export), `packages/contracts/src/bots.ts:21` (`entity_id`), `packages/contracts/src/invitations.ts` (remplacé)
- Test : `packages/contracts/src/__tests__/accounts.test.ts`

**Interfaces :**
- Produces :
  - `OrgRole = z.enum(['admin','super_manager'])`, `EntityRole = z.enum(['manager','advisor'])`
  - `MembershipGrant` : union de `{ entity_id: null, role: OrgRole, read_only?: boolean }` et `{ entity_id: number (int > 0), role: EntityRole }` ; `read_only: true` n'est permis que pour `super_manager`.
  - `Grants = z.array(MembershipGrant).min(1)` + `superRefine` : soit exactement une grant d'organisation, soit des grants d'entité aux `entity_id` distincts, jamais un mélange.
  - `CreateInvitationInput = { email, grants: Grants }` (remplace l'ancien `{ email, role }`)
  - `SetMembershipsInput = { grants: Grants }` ; `SetMemberStatusInput = { status: z.enum(['active','suspended']) }`
  - `CreateEntityInput = { name: string trim, 1 à 80 }` ; `UpdateEntityInput = { name?, status?: enum(['active','archived']) }`
  - `OrganizationSettings` (tous champs avec `.default()` des Global Constraints) ; `UpdateOrganizationSettingsInput = OrganizationSettings.partial()` sans défauts
  - `CreateBotInput` gagne `entity_id: z.number().int().positive().optional()` (donc aussi `UpdateBotInput`)

- [ ] **Step 1 : tests en échec** dans `accounts.test.ts` :
  - `Grants` accepte `[{entity_id:null, role:'admin'}]`, `[{entity_id:null, role:'super_manager', read_only:true}]`, `[{entity_id:1, role:'manager'},{entity_id:2, role:'advisor'}]`.
  - `Grants` refuse : `[]` ; `[{entity_id:null, role:'admin'},{entity_id:1, role:'advisor'}]` (mélange) ; deux grants sur `entity_id: 1` ; `{entity_id:null, role:'manager'}` ; `{entity_id:1, role:'admin'}` ; `{entity_id:null, role:'admin', read_only:true}`.
  - `OrganizationSettings.parse({})` vaut exactement `{ visibility:'all', pool_self_claim:true, reassign:'managers', transfer:'managers', takeover:'owner' }`.
  - `UpdateOrganizationSettingsInput.parse({})` vaut `{}`.
- [ ] **Step 2 :** `npx vitest run packages/contracts` : FAIL (module absent).
- [ ] **Step 3 :** écrire `accounts.ts`, exporter depuis `index.ts`, réécrire `invitations.ts` pour réexporter `CreateInvitationInput` depuis `accounts.ts`, ajouter `entity_id` à `CreateBotInput`. Mettre à jour `contracts.test.ts` (seule référence à `client_admin`).
- [ ] **Step 4 :** `npx vitest run packages/contracts` : PASS.
- [ ] **Step 5 :** commit `feat(contracts): rôles par périmètre, grants, entités, réglages d'organisation`.

---

### Task 2 : Stockage des comptes (SQLite + Postgres)

**Files :**
- Create : `src/core/database/accounts-types.ts`, `accounts-sqlite.ts`, `accounts-postgres.ts`
- Modify : `src/core/database/types.ts` (`Database extends AccountsStore` ; `BotRecord.entity_id: number | null` ; `InvitationRecord.grants` / `InvitationInput.grants` ; `UserRecord.client_id` reste mais n'est plus lu), `sqlite.ts` et `postgres.ts` (appel du schéma accounts après le schéma existant, spread des méthodes, `entity_id` dans lecture/écriture des bots, `grants` dans les invitations)
- Test : `src/core/database/__tests__/accounts-store.test.ts`

**Interfaces :**
- Produces :
  - `EntityRecord { id: number; client_id: string; name: string; status: 'active' | 'archived'; created_at: string; updated_at: string }`
  - `MembershipRecord { id: number; user_id: number; client_id: string; entity_id: number | null; role: 'admin' | 'super_manager' | 'manager' | 'advisor'; read_only: boolean; status: 'active' | 'suspended' }`
  - `MembershipGrantRecord { entity_id: number | null; role: MembershipRecord['role']; read_only?: boolean }`
  - `AccountsStore` :
    - `listEntities(clientId: string, opts?: { includeArchived?: boolean }): Promise<EntityRecord[]>`
    - `getEntity(clientId: string, id: number): Promise<EntityRecord | undefined>`
    - `createEntity(clientId: string, name: string): Promise<EntityRecord>`
    - `updateEntity(clientId: string, id: number, patch: { name?: string; status?: 'active' | 'archived' }): Promise<void>`
    - `countEntityUsage(clientId: string, entityId: number): Promise<{ bots: number; activeMembers: number }>`
    - `listUserMemberships(userId: number, clientId?: string): Promise<MembershipRecord[]>`
    - `listOrgMemberships(clientId: string): Promise<MembershipRecord[]>`
    - `replaceMemberships(userId: number, clientId: string, grants: MembershipGrantRecord[]): Promise<void>` (transaction : supprime puis insère, statut `active`)
    - `setMembershipsStatus(userId: number, clientId: string, status: 'active' | 'suspended'): Promise<void>`
    - `listUserOrganizations(userId: number): Promise<{ client_id: string; name: string }[]>` (organisations où l'utilisateur a au moins une appartenance `active`)
    - `getClientSettings(clientId: string): Promise<Record<string, unknown>>` (`{}` si null) ; `setClientSettings(clientId: string, settings: Record<string, unknown>): Promise<void>`
    - `setBotEntity(clientId: string, botId: string, entityId: number): Promise<void>`
    - `setUserRole(userId: number, role: string): Promise<void>` ; `listUsersByRole(role: string): Promise<UserRecord[]>`
    - `listPendingInvitationsByEmail(email: string): Promise<InvitationRecord[]>` (non acceptées, non expirées, tri `created_at` croissant)
    - `refreshInvitationToken(id: number, tokenHash: string, expiresAt: string): Promise<void>`
    - `listUnmigratedInvitations(): Promise<InvitationRecord[]>` (`grants` null)

- [ ] **Step 1 : tests en échec** (`createSqliteDriver(':memory:')`) :
  - `createEntity` puis `listEntities` renvoie l'entité ; `includeArchived` false masque une entité archivée.
  - `replaceMemberships(u, 'acme', [{entity_id:e1, role:'manager'}])` puis `[{entity_id:null, role:'admin'}]` : `listUserMemberships(u,'acme')` ne contient plus que l'appartenance admin.
  - `replaceMemberships` sur `acme` ne touche pas les appartenances de `other`.
  - `setMembershipsStatus(u,'acme','suspended')` : `listUserOrganizations(u)` n'inclut plus `acme`.
  - `countEntityUsage` compte les agents IA rattachés et les appartenances actives seulement.
  - `getClientSettings` d'un client neuf vaut `{}` ; aller-retour `setClientSettings`.
  - un bot inséré avec `entity_id: 7` est relu avec `entity_id: 7` ; une invitation avec `grants` est relue avec `grants` parsé.
  - base existante sans colonnes (créer l'ancien schéma via `better-sqlite3` brut, puis ouvrir le driver) : colonnes `bots.entity_id`, `clients.settings`, `clients.agency_id`, `invitations.grants` présentes (patron de `personality-column.test.ts`).
- [ ] **Step 2 :** `npx vitest run src/core/database` : FAIL.
- [ ] **Step 3 :** implémenter. Postgres : `grants` et `settings` en JSONB, `read_only` BOOLEAN, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Index : `memberships(user_id, client_id)`, `memberships(client_id)`, `entities(client_id)`.
- [ ] **Step 4 :** `npx vitest run src/core/database` : PASS ; `npx tsc --noEmit` : propre.
- [ ] **Step 5 :** commit `feat(db): tables entities, memberships, agencies et colonnes de comptes`.

---

### Task 3 : Migration des comptes

**Files :**
- Create : `src/core/database/migrate-accounts.ts`
- Modify : `src/core/database/index.ts` (`initDatabase` appelle `migrateAccounts(_db)` après création du driver)
- Test : `src/core/database/__tests__/migrate-accounts.test.ts`

**Interfaces :**
- Consumes : `AccountsStore` (tâche 2).
- Produces :
  - `ensureDefaultEntity(db: Database, clientId: string): Promise<EntityRecord>` : renvoie la première entité active de l'organisation, sinon en crée une nommée comme l'organisation (`ClientRecord.name`).
  - `migrateAccounts(db: Database): Promise<{ entitiesCreated: number; botsAttached: number; adminsMigrated: number; invitationsMigrated: number }>` : étapes 2 à 5 du §11 du spec, log `[Accounts] migration ...`.

- [ ] **Step 1 : tests en échec** :
  - base avec organisations `acme` (2 agents IA sans entité) et `other`, utilisateur `client_admin` de `acme`, invitation `client_admin` en attente pour `other` : après `migrateAccounts`, `acme` a une entité nommée « Acme », ses 2 agents IA y sont rattachés, l'utilisateur a `role === 'member'` et une appartenance `{entity_id:null, role:'admin'}` sur `acme`, l'invitation a `grants === [{entity_id:null, role:'admin'}]`.
  - un second appel renvoie `{ entitiesCreated:0, botsAttached:0, adminsMigrated:0, invitationsMigrated:0 }` et ne crée aucun doublon (Review Focus 5).
  - un `super_admin` n'est pas modifié et ne reçoit aucune appartenance.
- [ ] **Step 2 :** `npx vitest run src/core/database/__tests__/migrate-accounts.test.ts` : FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** PASS.
- [ ] **Step 5 :** commit `feat(db): migration idempotente client_admin vers appartenances admin et entité par défaut`.

---

### Task 4 : Politique de droits

**Files :**
- Create : `src/core/auth/permissions.ts`
- Test : `src/core/auth/__tests__/permissions.test.ts`

**Interfaces :**
- Produces :
  - `interface Access { userId: number; clientId: string; platformAdmin: boolean; orgRole: 'admin' | 'super_manager' | null; entityRoles: { entityId: number; role: 'manager' | 'advisor' }[]; readOnly: boolean }`
  - `type Action = 'org.read' | 'simulate.use' | 'bots.configure' | 'entities.manage' | 'users.manage' | 'settings.write' | 'audit.read'`
  - `can(access: Access, action: Action): boolean`

Règles (§4 du spec) : `platformAdmin` ou `orgRole === 'admin'` : tout. `readOnly` : seulement `org.read`. Sinon `super_manager`, `manager`, `advisor` : `org.read` et `simulate.use`.

- [ ] **Step 1 : tests en échec** : une table de cas couvrant les 7 actions pour admin, super admin plateforme, super manager, super manager lecture seule, manager, conseiller (`it.each`), avec les valeurs exactes de la matrice §4.
- [ ] **Step 2 :** FAIL. **Step 3 :** implémenter. **Step 4 :** PASS.
- [ ] **Step 5 :** commit `feat(auth): politique de droits centralisée can()`.

---

### Task 5 : Résolution de l'organisation active et des droits

**Files :**
- Create : `src/core/auth/access-service.ts`, `src/core/auth/__tests__/fixtures.ts`
- Modify : `src/core/auth/tokens.ts` (le jeton ne porte plus que `sub` et `role` ; la vérification ignore un `client_id` hérité), `src/api/middleware/context.ts` (`req.auth: { userId: number; role: string }`, `req.access?: Access`, CORS autorise `X-Organization-Id`), `src/api/middleware/auth.ts` (supprime `scopeToClient`, ajoute `requireOrganization` et `requireAction`), `src/core/auth/auth-service.ts` (`issueTokens` sans `client_id`)
- Test : `src/api/middleware/__tests__/auth.test.ts` (réécrit), `src/core/auth/__tests__/tokens.test.ts` (adapté)

**Interfaces :**
- Consumes : `can`, `Access` (tâche 4) ; `AccountsStore` (tâche 2).
- Produces :
  - `resolveAccess(db: Database, userId: number, requestedClientId: string | null): Promise<Access>` : lève `unauthorized()` si l'utilisateur n'existe pas ou n'est pas `active` ; `super_admin` : `requestedClientId` obligatoire (sinon `validationError` chemin `X-Organization-Id`, message « Organisation à préciser. »), organisation inexistante 404, droits admin implicites ; membre : sans en-tête, repli sur l'unique organisation active, sinon même `validationError` ; aucune appartenance active dans l'organisation : `forbidden()`.
  - `createRequireOrganization(db: Database): RequestHandler` : lit `X-Organization-Id`, appelle `resolveAccess`, pose `req.access` et `req.scopedClientId`.
  - `requireAction(action: Action): RequestHandler` : `forbidden()` si `!can(req.access!, action)`.
  - fixtures : `seedOrgMember(db, { email: string; password: string; clientId: string; grants: MembershipGrantRecord[] | 'admin' }): Promise<{ userId: number; entityId: number }>` (crée l'organisation et l'entité par défaut si absentes, l'utilisateur `member` actif, les appartenances ; `'admin'` vaut `[{entity_id:null, role:'admin'}]`) ; `seedSuperAdmin(db, email, password): Promise<number>`.

- [ ] **Step 1 : tests en échec** (`auth.test.ts`, app Express minimale montant `requireAuth`, `createRequireOrganization(db)`, `requireAction('org.read')`, renvoyant `req.access`) :
  - admin mono-organisation sans en-tête : 200, `access.clientId === 'acme'`, `orgRole === 'admin'` (Review Focus 1).
  - jeton signé à l'ancienne avec `client_id:'acme'` et `role:'client_admin'`, utilisateur migré par `migrateAccounts` : 200 sans en-tête (Review Focus 1).
  - membre de deux organisations sans en-tête : 400, `details[0].path === 'X-Organization-Id'`.
  - en-tête vers une organisation dont il n'est pas membre : 403.
  - super admin sans en-tête : 400 ; avec en-tête `acme` : 200, `platformAdmin === true`.
  - appartenances suspendues dans `acme` : 403 à la requête suivante ; `users.status = 'disabled'` : 401 à la requête suivante, même jeton (Review Focus 3).
  - conseiller sur une route `requireAction('bots.configure')` : 403.
- [ ] **Step 2 :** FAIL. **Step 3 :** implémenter. **Step 4 :** `npx vitest run src/api/middleware src/core/auth` : PASS (les tests de routes cassent jusqu'à la tâche 6, c'est attendu).
- [ ] **Step 5 :** commit `feat(auth): organisation active par en-tête, droits résolus en base à chaque requête`.

---

### Task 6 : Recâblage des routes existantes

**Files :**
- Modify : `src/api/admin/router.ts`, `routes/bots.ts`, `routes/connections.ts`, `routes/dashboard.ts`, `routes/simulate.ts`, `routes/audit.ts` (suppression des `requireScopedClient` et du message `?client_id`)
- Modify (tests) : `src/api/admin/__tests__/*.test.ts`, `src/core/auth/__tests__/auth-service.test.ts`, `src/core/database/__tests__/auth-tables.test.ts` : utilisateurs créés via `seedOrgMember` / `seedSuperAdmin`, super admin via en-tête au lieu de `?client_id`.
- Test : `src/api/admin/__tests__/org-isolation.test.ts` (créer)

**Interfaces :**
- Consumes : `createRequireOrganization`, `requireAction` (tâche 5).
- Actions par route : lectures (`GET /bots`, `GET /bots/:botId`, dashboard, `GET` connexions) : `org.read` ; écritures bots (`POST`, `PATCH`, `PUT numbers`, `PUT status`) et écritures connexions : `bots.configure` ; `POST /bots/:botId/simulate` : `simulate.use` ; `/audit` : `audit.read`. `/clients` et `/connectors` inchangés.

- [ ] **Step 1 : tests en échec** (`org-isolation.test.ts`) :
  - admin de `acme` avec en-tête `other` sur `GET /bots` : 403 ; avec en-tête `acme` sur `GET /bots/<bot de other>` : 404 ; idem `GET /bots/<bot de other>/leads` : 404 (Review Focus 2).
  - conseiller de `acme` : `GET /bots` 200, `POST /bots` 403, `POST /bots/:botId/simulate` autorisé (pas 403), `GET /audit` 403.
  - super manager lecture seule : `POST /bots/:botId/simulate` 403.
- [ ] **Step 2 :** FAIL. **Step 3 :** recâbler les routes et migrer les tests existants vers les fixtures, sans changer leurs assertions métier.
- [ ] **Step 4 :** `npx vitest run` (suite moteur complète) : PASS ; `npx tsc --noEmit` : propre.
- [ ] **Step 5 :** commit `refactor(api): routes admin sous requireOrganization et requireAction`.

---

### Task 7 : Entités et rattachement des agents IA

**Files :**
- Create : `src/core/services/entity-service.ts`, `src/api/admin/routes/entities.ts`
- Modify : `src/core/services/bot-service.ts` (création, mise à jour, `BotDetail` porte `entity_id`), `src/core/config-store.ts:85` (`upsertBot` transmet `entity_id`), `scripts/import-config-to-db.ts` (rattache via `ensureDefaultEntity`), `src/core/auth/admin-service.ts` (`createClient` appelle `ensureDefaultEntity`), `src/api/admin/router.ts` (monte `/entities`)
- Test : `src/core/services/__tests__/entity-service.test.ts`, `src/api/admin/__tests__/entities-routes.test.ts`, ajout dans `bot-service.test.ts`

**Interfaces :**
- Consumes : `AccountsStore`, `ensureDefaultEntity`, `CreateEntityInput`, `UpdateEntityInput`.
- Produces :
  - `class EntityService { constructor(deps: { db: Database }); list(clientId: string): Promise<(EntityRecord & { bots: number; members: number })[]>; create(clientId: string, actorUserId: number, input: CreateEntityInput): Promise<EntityRecord>; update(clientId: string, id: number, actorUserId: number, patch: UpdateEntityInput): Promise<EntityRecord> }`
  - Routes : `GET /entities` (`org.read`), `POST /entities` et `PATCH /entities/:id` (`entities.manage`).
  - Règles : nom en double parmi les entités actives : `conflict('Une entité porte déjà ce nom.')` ; archivage avec `bots > 0` ou `activeMembers > 0` : `conflict("Déplacez d'abord les agents IA et les membres de cette entité.")` ; entité d'une autre organisation : `notFound()`. Audit `entity.create`, `entity.update`.
  - `BotService.createBot` : `entity_id` fourni, il doit être une entité active de l'organisation, sinon `validationError` chemin `entity_id` ; absent, l'unique entité active est prise, sinon `validationError` « Choisissez une entité. ». `updateBot` avec `entity_id` : même contrôle, audit `bot.entity`.

- [ ] **Step 1 : tests en échec** : création et liste avec compteurs ; nom en double 409 ; archivage refusé avec agent IA puis avec membre actif, accepté une fois vides ; `PATCH` d'une entité d'une autre organisation 404 ; `createBot` sans `entity_id` dans une organisation à une entité : rattaché ; à deux entités : 400 ; `entity_id` d'une autre organisation : 400 ; `createClient` crée l'entité par défaut ; conseiller sur `POST /entities` : 403.
- [ ] **Step 2 :** FAIL. **Step 3 :** implémenter. **Step 4 :** suite moteur : PASS.
- [ ] **Step 5 :** commit `feat(entities): entités d'organisation et rattachement des agents IA`.

---

### Task 8 : Utilisateurs, invitations, acceptation

**Files :**
- Create : `src/core/services/user-admin-service.ts`, `src/api/admin/routes/users.ts`, `src/api/admin/routes/platform.ts`
- Modify : `src/core/auth/admin-service.ts` (la logique d'invitation passe dans `UserAdminService` ; les routes `/clients/:clientId/invitations` du super admin l'appellent), `src/core/auth/auth-service.ts` (`acceptInvite`, `me`), `src/core/auth/mailer.ts` (`sendAccessGranted(to: string, organizationName: string): Promise<void>` sur l'interface et `ConsoleMailer`), `src/api/admin/routes/clients.ts`, `src/api/admin/router.ts`
- Test : `src/core/services/__tests__/user-admin-service.test.ts`, `src/api/admin/__tests__/users-routes.test.ts`, ajouts dans `auth-service.test.ts`

**Interfaces :**
- Consumes : `Grants`, `SetMembershipsInput`, `SetMemberStatusInput`, `AccountsStore`.
- Produces :
  - `class UserAdminService { constructor(deps: { db: Database; mailer: Mailer }); listMembers(clientId: string): Promise<{ user_id: number; email: string; status: string; memberships: Omit<MembershipRecord, 'id' | 'user_id' | 'client_id'>[] }[]>; listInvitations(clientId: string): Promise<InvitationPublic[]>; invite(clientId: string, actorUserId: number | null, email: string, grants: MembershipGrantRecord[]): Promise<{ email: string; outcome: 'invited' | 'added' }>; resendInvitation(clientId: string, actorUserId: number, invitationId: number): Promise<void>; revokeInvitation(clientId: string, invitationId: number): Promise<void>; setMemberships(clientId: string, actorUserId: number, userId: number, grants: MembershipGrantRecord[]): Promise<void>; setStatus(clientId: string, actorUserId: number, userId: number, status: 'active' | 'suspended'): Promise<void>; disableGlobally(actorUserId: number, userId: number): Promise<void> }`
  - `InvitationPublic` gagne `grants`, perd `role` ; aucune réponse ne contient de jeton ni de lien.
  - `AuthService.me(userId)` renvoie `PublicUser & { organizations: { client_id: string; name: string }[] }` (super admin : toutes les organisations via `listClients`).
  - Routes (`users.manage` sauf mention) : `GET /users`, `GET /invitations`, `POST /invitations`, `POST /invitations/:id/resend`, `DELETE /invitations/:id`, `PUT /users/:userId/memberships`, `PATCH /users/:userId` (`SetMemberStatusInput`). Plateforme (`requireRole('super_admin')`) : `POST /platform/users/:userId/disable`.
  - Règles :
    - grants : chaque `entity_id` doit être une entité active de l'organisation, sinon `validationError` chemin `grants`.
    - `invite` : utilisateur actif, `replaceMemberships` puis `sendAccessGranted`, `outcome:'added'` ; utilisateur `disabled` : `conflict('Ce compte est désactivé.')` ; sinon création éventuelle de l'utilisateur (`role:'member'`, `status:'invited'`, `client_id: null`), invitation avec `grants`, `sendInvitation`, `outcome:'invited'`.
    - `acceptInvite` : après activation, applique dans l'ordre de création **toutes** les invitations valides en attente pour cet e-mail (`replaceMemberships` par organisation), puis les marque acceptées.
    - dernier admin : `setMemberships` ou `setStatus('suspended')` qui laisserait l'organisation sans appartenance `admin` active : `conflict("L'organisation doit garder au moins un admin.")` (Review Focus 4).
    - `setStatus` ne touche que l'organisation courante ; `disableGlobally` met `users.status = 'disabled'` et appelle `revokeAllUserSessions`.
    - audit : `user.invite`, `user.invite.resend`, `user.memberships`, `user.status`, `user.disable`.

- [ ] **Step 1 : tests en échec** :
  - invitation d'un nouvel e-mail : `outcome:'invited'`, `sendInvitation` appelé une fois, la réponse HTTP ne contient ni `token` ni `accept-invite`.
  - invitation d'un utilisateur actif d'une autre organisation : `outcome:'added'`, appartenance créée, `sendAccessGranted` appelé.
  - personne invitée par `acme` puis par `other` avant d'accepter : `acceptInvite` avec le lien de `other` donne des appartenances actives dans les deux organisations ; les deux invitations sont marquées acceptées.
  - grant vers une entité d'une autre organisation : 400.
  - seul admin qui se passe conseiller : 409 ; qui se suspend : 409 ; avec deux admins : 204 (Review Focus 4).
  - suspension dans `acme` d'un membre aussi présent dans `other` : il accède toujours à `other`.
  - `resendInvitation` : l'ancien jeton est refusé par `acceptInvite`, le nouveau accepté.
  - `GET /auth/me` d'un membre de deux organisations : `organizations` liste les deux.
  - conseiller sur `POST /invitations` : 403 ; admin sur `POST /platform/users/:id/disable` : 403 ; super admin : 204 puis la session de la cible est révoquée (refresh 401).
- [ ] **Step 2 :** FAIL. **Step 3 :** implémenter. **Step 4 :** suite moteur : PASS.
- [ ] **Step 5 :** commit `feat(users): invitations par l'admin d'organisation, appartenances, suspension, dernier admin protégé`.

---

### Task 9 : Réglages d'organisation

**Files :**
- Create : `src/core/services/settings-service.ts`, `src/api/admin/routes/settings.ts`
- Modify : `src/api/admin/router.ts`
- Test : `src/core/services/__tests__/settings-service.test.ts`, `src/api/admin/__tests__/settings-routes.test.ts`

**Interfaces :**
- Consumes : `OrganizationSettings`, `UpdateOrganizationSettingsInput`, `getClientSettings` / `setClientSettings`.
- Produces : `class SettingsService { constructor(deps: { db: Database }); get(clientId: string): Promise<OrganizationSettings>; update(clientId: string, actorUserId: number, patch: UpdateOrganizationSettingsInput): Promise<OrganizationSettings> }`. Routes : `GET /settings` (`org.read`), `PATCH /settings` (`settings.write`). `update` fusionne sur l'existant, valide avec `OrganizationSettings`, refuse `visibility` différent de `'all'` par `validationError` chemin `visibility`, message « Ce mode de visibilité n'est pas encore disponible. » ; audit `settings.update`.

- [ ] **Step 1 : tests en échec** : `get` d'une organisation neuve vaut les défauts des Global Constraints ; `update({ transfer:'everyone' })` conserve les autres champs ; `update({ visibility:'entities' })` : 400 ; conseiller sur `PATCH /settings` : 403, sur `GET /settings` : 200.
- [ ] **Step 2 :** FAIL. **Step 3 :** implémenter. **Step 4 :** PASS.
- [ ] **Step 5 :** commit `feat(settings): réglages d'organisation avec visibilité « tout le monde voit tout »`.

---

### Task 10 : Script d'exploitation et vérification de bout en bout

**Files :**
- Create : `scripts/create-organization.ts`
- Modify : `.env.example` (rappel `ADMIN_INVITE_TTL_DAYS`), `docs/ARCHITECTURE.md` (section comptes et équipes, avec statut) et `docs/ARCHITECTURE-PARTENAIRE.md` (même contenu sans statut ni roadmap, règle des deux documents)

**Interfaces :**
- Consumes : `AdminService.createClient`, `UserAdminService.invite`.
- Produces : `npx tsx scripts/create-organization.ts <client_id> "<Nom>" <email_admin>` : crée l'organisation (et son entité par défaut), invite le premier admin, affiche `[CreateOrganization] organisation <id> créée, invitation envoyée à <email>`.

- [ ] **Step 1 :** écrire le script ; l'exécuter sur une base SQLite temporaire (`DATABASE_URL` absent, copie de `store/` dans le scratchpad) : sortie attendue ci-dessus, lien d'invitation visible dans les logs `ConsoleMailer` uniquement.
- [ ] **Step 2 : migration sur une copie de `store/demo.db`** : démarrer le moteur sur la copie, vérifier dans les logs `[Accounts] migration` avec `adminsMigrated: 1`, puis redémarrer : tous les compteurs à 0.
- [ ] **Step 3 : migration Postgres locale** : `docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=test postgres:16`, `DATABASE_URL=postgres://postgres:test@localhost:55432/postgres npx tsx src/index.ts` deux fois : démarrages sans erreur, compteurs à 0 au second.
- [ ] **Step 4 : test live avec l'app web actuelle** (`start_wabagent.sh`) : connexion `demo@wabagent.local` sur la base migrée, tableau des agents IA et Vue d'ensemble visibles, création d'un agent IA par l'assistant réussie (repli mono-organisation, sans modification du web).
- [ ] **Step 5 :** `npx vitest run` + `npx tsc --noEmit` + `npm test -w apps/web` : tout vert. Commit `chore(accounts): script create-organization et doc d'architecture`.
