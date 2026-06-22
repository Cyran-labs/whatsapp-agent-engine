# Flow Labs — Plan 3 : Auth & API core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Doter l'engine d'une API admin REST versionnée (`/api/admin/v1/*`) avec authentification multi-tenant sur invitation (JWT + refresh révocable), schémas Zod partagés, et les endpoints d'auth + gestion des clients + invitations.

**Architecture:** L'engine reste seule source de vérité. On ajoute une couche `src/api/` (router Express monté séparément du webhook runtime) qui consomme des services métier (`src/core/auth/`) eux-mêmes appuyés sur le `Database` existant (sqlite/postgres). La validation d'entrée et les types sont définis une seule fois dans `src/contracts/` (Zod), destinés à être partagés avec le Next.js du Plan 5. Aucune modification du pipeline webhook runtime.

**Tech Stack:** TypeScript strict ESM, Express 5, better-sqlite3 + pg, Vitest. Nouvelles deps : `zod` (validation/contracts), `jose` (JWT HS256), `bcrypt` (hash mot de passe) ; devDeps : `supertest` (tests d'intégration HTTP).

## Global Constraints

Copiées du spec `docs/superpowers/specs/2026-06-22-flow-labs-backoffice-design.md` et des conventions repo (`CLAUDE.md`). Tout task hérite implicitement de cette section.

- **Nom produit = Flow Labs** (jamais « Cyran » dans le code, les logs, les messages, les emails).
- **TypeScript strict** : pas de `any`, `const` par défaut, `noUnusedLocals`/`noUnusedParameters` actifs.
- **Logs** : format `[Service] message` sans emoji.
- **ESM** : tous les imports relatifs internes se terminent par `.js`.
- **Database** : toutes les méthodes sont `async`. SQLite est le backend testé en CI ; Postgres est un miroir mécanique (SERIAL, TIMESTAMPTZ, `::text` casts, `$1` placeholders, `JSONB` pour les colonnes JSON). Pour les **upserts sur tables neuves** : pattern **UPDATE-then-INSERT** (PAS `ON CONFLICT`). Égalité NULL : SQLite `col IS ?`, Postgres `col IS NOT DISTINCT FROM $n`.
- **Sécurité** : secrets jamais renvoyés en clair (masqués `••••1234`) ; comparaisons de secrets en temps constant ; refresh tokens **stockés hachés** (jamais en clair) ; rotation du refresh à chaque usage ; mots de passe hachés (bcrypt).
- **Forme d'erreur API unique** (toutes les réponses d'erreur) :
  ```json
  { "error": { "code": "VALIDATION_ERROR", "message": "...",
      "details": [{ "path": "email", "message": "..." }], "request_id": "..." } }
  ```
  Codes machine stables (l'UI traduit par code, `message` = fallback). Statuts HTTP standard ; conflits → 409.
- **Auth** : access token = JWT court HS256 (`ADMIN_JWT_SECRET`, claims `sub`/`role`/`client_id`) ; refresh opaque haché en base, rotation + révocable. Rôles : `super_admin` (transverse, `client_id` null) / `client_admin` (scopé à son `client_id`).
- **Frontière** : l'API admin est montée séparément du webhook runtime ; le pipeline runtime existant ne bouge pas.
- Author git : `Francois Greze <francois@cyran.fr>`. Pas de signature Claude. Pas de commit hors du workflow subagent.

---

## File Structure

**Nouveaux fichiers**
- `src/contracts/index.ts` — ré-exporte tous les schémas/types.
- `src/contracts/errors.ts` — `ErrorCode` (union stable), type `ApiErrorBody`.
- `src/contracts/auth.ts` — schémas Zod : login, refresh, logout, accept-invite, forgot/reset-password.
- `src/contracts/clients.ts` — schémas Zod : create/update client.
- `src/contracts/invitations.ts` — schémas Zod : create invitation.
- `src/contracts/__tests__/contracts.test.ts` — tests des schémas.
- `src/api/errors.ts` — `AppError` (classe), `toErrorBody()`, helpers de fabrication (`unauthorized()`, `forbidden()`, `conflict()`, `notFound()`, `validationError()`, `rateLimited()`).
- `src/api/__tests__/errors.test.ts`
- `src/core/auth/passwords.ts` — `hashPassword`, `verifyPassword` (bcrypt).
- `src/core/auth/__tests__/passwords.test.ts`
- `src/core/auth/tokens.ts` — `signAccessToken`, `verifyAccessToken`, `generateRefreshToken`, `hashRefreshToken`.
- `src/core/auth/__tests__/tokens.test.ts`
- `src/core/auth/mailer.ts` — interface `Mailer`, `ConsoleMailer`, `createMailer()`.
- `src/core/auth/__tests__/mailer.test.ts`
- `src/core/auth/auth-service.ts` — `AuthService` (login/refresh/logout/me/accept-invite/forgot/reset).
- `src/core/auth/__tests__/auth-service.test.ts`
- `src/core/auth/admin-service.ts` — `AdminService` (clients CRUD + invitations).
- `src/core/auth/__tests__/admin-service.test.ts`
- `src/api/middleware/context.ts` — `requestId` + `cors` + augmentation `Request`.
- `src/api/middleware/auth.ts` — `requireAuth`, `requireRole`, `scopeToClient`.
- `src/api/middleware/rate-limit.ts` — limiteur in-memory fixed-window.
- `src/api/middleware/error-handler.ts` — middleware d'erreur + 404.
- `src/api/middleware/__tests__/auth.test.ts`
- `src/api/middleware/__tests__/rate-limit.test.ts`
- `src/api/admin/router.ts` — `createAdminRouter(deps)` assemble tout.
- `src/api/admin/routes/auth.ts` — routes `auth/*`.
- `src/api/admin/routes/clients.ts` — routes `clients/*` (super-admin).
- `src/api/admin/__tests__/auth-routes.test.ts`
- `src/api/admin/__tests__/clients-routes.test.ts`
- `scripts/seed-admin.ts` — bootstrap du premier `super_admin`.

**Fichiers modifiés**
- `src/core/database/types.ts` — nouveaux records/inputs + méthodes `Database`.
- `src/core/database/sqlite.ts` — tables `users`/`invitations`/`auth_sessions`/`password_resets` + méthodes ; ajout `getClient`.
- `src/core/database/postgres.ts` — miroir.
- `src/core/config.ts` — getters `adminJwt`, `auth` (TTL, bcrypt rounds, web origin, invite TTL).
- `src/index.ts` — montage de `createAdminRouter` sous `/api/admin/v1`.
- `package.json` — deps + devDeps.

**Décisions d'implémentation actées (hors spec, validées)**
- `contracts` vit dans `src/contracts/` (pas de monorepo au Plan 3 ; partage avec Next.js décidé au Plan 5).
- Hash mot de passe = **bcrypt** ; JWT = **jose**.
- Reset de mot de passe → table **`password_resets`** (le spec ne liste pas de table de reset ; nécessité d'ingénierie, token haché + expiration + `used_at`).
- Bootstrap du premier `super_admin` via `scripts/seed-admin.ts` (l'onboarding étant sur invitation, il faut un compte racine).

---

## Task 1: Tables auth + méthodes Database

**Files:**
- Modify: `src/core/database/types.ts`
- Modify: `src/core/database/sqlite.ts`
- Modify: `src/core/database/postgres.ts`
- Test: `src/core/database/__tests__/auth-tables.test.ts`

**Interfaces:**
- Consumes: le `Database` existant, le pattern `createSqliteDriver(':memory:')` des tests.
- Produces (types + méthodes consommés par les Tasks 4-5) :
  - Types : `UserRecord`, `UserInput`, `InvitationRecord`, `InvitationInput`, `AuthSessionRecord`, `AuthSessionInput`, `PasswordResetRecord`, `PasswordResetInput`.
  - Méthodes `Database` :
    - `createUser(input: UserInput): Promise<UserRecord>`
    - `getUserByEmail(email: string): Promise<UserRecord | undefined>`
    - `getUserById(id: number): Promise<UserRecord | undefined>`
    - `updateUserPassword(id: number, passwordHash: string): Promise<void>`
    - `setUserStatus(id: number, status: string): Promise<void>`
    - `getClient(clientId: string): Promise<ClientRecord | undefined>`
    - `createInvitation(input: InvitationInput): Promise<InvitationRecord>`
    - `getInvitationByTokenHash(tokenHash: string): Promise<InvitationRecord | undefined>`
    - `markInvitationAccepted(id: number): Promise<void>`
    - `listInvitations(clientId: string): Promise<InvitationRecord[]>`
    - `deleteInvitation(id: number): Promise<void>`
    - `createAuthSession(input: AuthSessionInput): Promise<AuthSessionRecord>`
    - `getAuthSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | undefined>`
    - `revokeAuthSession(id: number): Promise<void>`
    - `revokeAllUserSessions(userId: number): Promise<void>`
    - `createPasswordReset(input: PasswordResetInput): Promise<PasswordResetRecord>`
    - `getPasswordResetByTokenHash(tokenHash: string): Promise<PasswordResetRecord | undefined>`
    - `markPasswordResetUsed(id: number): Promise<void>`

> NOTE implémenteur : ajouter une méthode à l'interface `Database` casse `tsc` pour les DEUX drivers tant qu'ils ne l'implémentent pas. Ce task ajoute les types, l'interface, ET les deux implémentations (sqlite + postgres) dans le même commit. Suivre exactement le pattern existant : SQLite `INSERT ... RETURNING`-via-`lastInsertRowid` puis relecture par id ; Postgres `RETURNING *` + `::text` sur les timestamps. `getInvitationByTokenHash`/`getAuthSessionByTokenHash`/`getPasswordResetByTokenHash` retournent l'enregistrement **sans filtrer expiration/révocation** (le service décide). `email` est stocké en minuscules par l'appelant (service) — la table garde un index unique sur `email`.

- [ ] **Step 1: Écrire le test d'intégration (échec attendu)**

Créer `src/core/database/__tests__/auth-tables.test.ts` :

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../sqlite.js';
import type { Database } from '../types.js';

describe('auth tables (sqlite)', () => {
  let db: Database;
  beforeEach(() => { db = createSqliteDriver(':memory:'); });
  afterEach(async () => { await db.close(); });

  it('createUser renvoie un record avec id, getUserByEmail/ById le retrouvent', async () => {
    const u = await db.createUser({
      email: 'admin@flowlabs.test', password_hash: 'h', role: 'super_admin',
      client_id: null, status: 'active',
    });
    expect(u.id).toBeGreaterThan(0);
    expect(u.email).toBe('admin@flowlabs.test');
    expect(u.client_id).toBeNull();
    expect((await db.getUserByEmail('admin@flowlabs.test'))!.id).toBe(u.id);
    expect((await db.getUserById(u.id))!.email).toBe('admin@flowlabs.test');
    expect(await db.getUserByEmail('absent@x.test')).toBeUndefined();
  });

  it('updateUserPassword + setUserStatus mutent la ligne', async () => {
    const u = await db.createUser({ email: 'a@b.test', password_hash: null, role: 'client_admin', client_id: 'acme', status: 'invited' });
    await db.updateUserPassword(u.id, 'newhash');
    await db.setUserStatus(u.id, 'active');
    const after = (await db.getUserById(u.id))!;
    expect(after.password_hash).toBe('newhash');
    expect(after.status).toBe('active');
  });

  it('email unique : créer deux fois la même adresse échoue', async () => {
    await db.createUser({ email: 'dup@x.test', password_hash: null, role: 'client_admin', client_id: 'acme', status: 'invited' });
    await expect(db.createUser({ email: 'dup@x.test', password_hash: null, role: 'client_admin', client_id: 'acme', status: 'invited' }))
      .rejects.toThrow();
  });

  it('invitations : create / getByTokenHash / list / markAccepted / delete', async () => {
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    const inv = await db.createInvitation({
      email: 'invitee@acme.test', client_id: 'acme', role: 'client_admin',
      token_hash: 'th1', expires_at: '2099-01-01T00:00:00.000Z',
    });
    expect(inv.id).toBeGreaterThan(0);
    expect(inv.accepted_at).toBeNull();
    expect((await db.getInvitationByTokenHash('th1'))!.email).toBe('invitee@acme.test');
    expect(await db.listInvitations('acme')).toHaveLength(1);
    await db.markInvitationAccepted(inv.id);
    expect((await db.getInvitationByTokenHash('th1'))!.accepted_at).not.toBeNull();
    await db.deleteInvitation(inv.id);
    expect(await db.getInvitationByTokenHash('th1')).toBeUndefined();
  });

  it('auth_sessions : create / getByTokenHash / revoke / revokeAll', async () => {
    const u = await db.createUser({ email: 's@x.test', password_hash: 'h', role: 'super_admin', client_id: null, status: 'active' });
    const s1 = await db.createAuthSession({ user_id: u.id, token_hash: 'rt1', expires_at: '2099-01-01T00:00:00.000Z' });
    await db.createAuthSession({ user_id: u.id, token_hash: 'rt2', expires_at: '2099-01-01T00:00:00.000Z' });
    expect((await db.getAuthSessionByTokenHash('rt1'))!.id).toBe(s1.id);
    await db.revokeAuthSession(s1.id);
    expect((await db.getAuthSessionByTokenHash('rt1'))!.revoked_at).not.toBeNull();
    await db.revokeAllUserSessions(u.id);
    expect((await db.getAuthSessionByTokenHash('rt2'))!.revoked_at).not.toBeNull();
  });

  it('password_resets : create / getByTokenHash / markUsed', async () => {
    const u = await db.createUser({ email: 'r@x.test', password_hash: 'h', role: 'super_admin', client_id: null, status: 'active' });
    const pr = await db.createPasswordReset({ user_id: u.id, token_hash: 'prt1', expires_at: '2099-01-01T00:00:00.000Z' });
    expect(pr.used_at).toBeNull();
    expect((await db.getPasswordResetByTokenHash('prt1'))!.user_id).toBe(u.id);
    await db.markPasswordResetUsed(pr.id);
    expect((await db.getPasswordResetByTokenHash('prt1'))!.used_at).not.toBeNull();
  });

  it('getClient renvoie le client ou undefined', async () => {
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    expect((await db.getClient('acme'))!.name).toBe('Acme');
    expect(await db.getClient('nope')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `npx vitest run src/core/database/__tests__/auth-tables.test.ts`
Expected: FAIL (méthodes/types absents, `tsc` rouge).

- [ ] **Step 3: Ajouter les types dans `src/core/database/types.ts`**

Ajouter après `LlmUsageRow` (avant `export interface Database`) :

```typescript
export interface UserRecord {
  id: number;
  email: string;
  password_hash: string | null;
  role: string;
  client_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface UserInput {
  email: string;
  password_hash: string | null;
  role: string;
  client_id: string | null;
  status: string;
}

export interface InvitationRecord {
  id: number;
  email: string;
  client_id: string | null;
  role: string;
  token_hash: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface InvitationInput {
  email: string;
  client_id: string | null;
  role: string;
  token_hash: string;
  expires_at: string;
}

export interface AuthSessionRecord {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export interface AuthSessionInput {
  user_id: number;
  token_hash: string;
  expires_at: string;
}

export interface PasswordResetRecord {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export interface PasswordResetInput {
  user_id: number;
  token_hash: string;
  expires_at: string;
}
```

Puis ajouter dans l'interface `Database`, après le bloc `// Metering LLM` (avant `// Lifecycle`) :

```typescript
  // Auth — users / invitations / sessions / password resets
  createUser(input: UserInput): Promise<UserRecord>;
  getUserByEmail(email: string): Promise<UserRecord | undefined>;
  getUserById(id: number): Promise<UserRecord | undefined>;
  updateUserPassword(id: number, passwordHash: string): Promise<void>;
  setUserStatus(id: number, status: string): Promise<void>;
  getClient(clientId: string): Promise<ClientRecord | undefined>;
  createInvitation(input: InvitationInput): Promise<InvitationRecord>;
  getInvitationByTokenHash(tokenHash: string): Promise<InvitationRecord | undefined>;
  markInvitationAccepted(id: number): Promise<void>;
  listInvitations(clientId: string): Promise<InvitationRecord[]>;
  deleteInvitation(id: number): Promise<void>;
  createAuthSession(input: AuthSessionInput): Promise<AuthSessionRecord>;
  getAuthSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | undefined>;
  revokeAuthSession(id: number): Promise<void>;
  revokeAllUserSessions(userId: number): Promise<void>;
  createPasswordReset(input: PasswordResetInput): Promise<PasswordResetRecord>;
  getPasswordResetByTokenHash(tokenHash: string): Promise<PasswordResetRecord | undefined>;
  markPasswordResetUsed(id: number): Promise<void>;
```

- [ ] **Step 4: Implémenter les tables + méthodes SQLite**

Dans `src/core/database/sqlite.ts`, mettre à jour l'import de types (ajouter `UserRecord, UserInput, InvitationRecord, InvitationInput, AuthSessionRecord, AuthSessionInput, PasswordResetRecord, PasswordResetInput`).

Ajouter à la constante `SCHEMA` (avant la fermeture backtick) :

```sql
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      password_hash TEXT,
      role TEXT NOT NULL,
      client_id TEXT,
      status TEXT NOT NULL DEFAULT 'invited',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_email ON users(email);

    CREATE TABLE IF NOT EXISTS invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      client_id TEXT,
      role TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_invitations_token ON invitations(token_hash);
    CREATE INDEX IF NOT EXISTS idx_invitations_client ON invitations(client_id);

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_auth_sessions_token ON auth_sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_password_resets_token ON password_resets(token_hash);
```

Ajouter les méthodes dans l'objet `driver` (avant `async close()`) :

```typescript
    async createUser(input: UserInput): Promise<UserRecord> {
      const info = db.prepare(
        `INSERT INTO users (email, password_hash, role, client_id, status)
         VALUES (?, ?, ?, ?, ?)`
      ).run(input.email, input.password_hash, input.role, input.client_id, input.status);
      return (await this.getUserById(Number(info.lastInsertRowid)))!;
    },

    async getUserByEmail(email: string): Promise<UserRecord | undefined> {
      return db.prepare(
        `SELECT id, email, password_hash, role, client_id, status, created_at, updated_at
         FROM users WHERE email = ?`
      ).get(email) as UserRecord | undefined;
    },

    async getUserById(id: number): Promise<UserRecord | undefined> {
      return db.prepare(
        `SELECT id, email, password_hash, role, client_id, status, created_at, updated_at
         FROM users WHERE id = ?`
      ).get(id) as UserRecord | undefined;
    },

    async updateUserPassword(id: number, passwordHash: string): Promise<void> {
      db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(passwordHash, id);
    },

    async setUserStatus(id: number, status: string): Promise<void> {
      db.prepare(`UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
    },

    async getClient(clientId: string): Promise<ClientRecord | undefined> {
      return db.prepare('SELECT client_id, name, status FROM clients WHERE client_id = ?').get(clientId) as ClientRecord | undefined;
    },

    async createInvitation(input: InvitationInput): Promise<InvitationRecord> {
      const info = db.prepare(
        `INSERT INTO invitations (email, client_id, role, token_hash, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(input.email, input.client_id, input.role, input.token_hash, input.expires_at);
      return db.prepare(
        `SELECT id, email, client_id, role, token_hash, expires_at, accepted_at, created_at
         FROM invitations WHERE id = ?`
      ).get(Number(info.lastInsertRowid)) as InvitationRecord;
    },

    async getInvitationByTokenHash(tokenHash: string): Promise<InvitationRecord | undefined> {
      return db.prepare(
        `SELECT id, email, client_id, role, token_hash, expires_at, accepted_at, created_at
         FROM invitations WHERE token_hash = ?`
      ).get(tokenHash) as InvitationRecord | undefined;
    },

    async markInvitationAccepted(id: number): Promise<void> {
      db.prepare(`UPDATE invitations SET accepted_at = datetime('now') WHERE id = ?`).run(id);
    },

    async listInvitations(clientId: string): Promise<InvitationRecord[]> {
      return db.prepare(
        `SELECT id, email, client_id, role, token_hash, expires_at, accepted_at, created_at
         FROM invitations WHERE client_id = ? ORDER BY id DESC`
      ).all(clientId) as InvitationRecord[];
    },

    async deleteInvitation(id: number): Promise<void> {
      db.prepare('DELETE FROM invitations WHERE id = ?').run(id);
    },

    async createAuthSession(input: AuthSessionInput): Promise<AuthSessionRecord> {
      const info = db.prepare(
        `INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)`
      ).run(input.user_id, input.token_hash, input.expires_at);
      return db.prepare(
        `SELECT id, user_id, token_hash, expires_at, revoked_at, created_at
         FROM auth_sessions WHERE id = ?`
      ).get(Number(info.lastInsertRowid)) as AuthSessionRecord;
    },

    async getAuthSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | undefined> {
      return db.prepare(
        `SELECT id, user_id, token_hash, expires_at, revoked_at, created_at
         FROM auth_sessions WHERE token_hash = ?`
      ).get(tokenHash) as AuthSessionRecord | undefined;
    },

    async revokeAuthSession(id: number): Promise<void> {
      db.prepare(`UPDATE auth_sessions SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL`).run(id);
    },

    async revokeAllUserSessions(userId: number): Promise<void> {
      db.prepare(`UPDATE auth_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`).run(userId);
    },

    async createPasswordReset(input: PasswordResetInput): Promise<PasswordResetRecord> {
      const info = db.prepare(
        `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)`
      ).run(input.user_id, input.token_hash, input.expires_at);
      return db.prepare(
        `SELECT id, user_id, token_hash, expires_at, used_at, created_at
         FROM password_resets WHERE id = ?`
      ).get(Number(info.lastInsertRowid)) as PasswordResetRecord;
    },

    async getPasswordResetByTokenHash(tokenHash: string): Promise<PasswordResetRecord | undefined> {
      return db.prepare(
        `SELECT id, user_id, token_hash, expires_at, used_at, created_at
         FROM password_resets WHERE token_hash = ?`
      ).get(tokenHash) as PasswordResetRecord | undefined;
    },

    async markPasswordResetUsed(id: number): Promise<void> {
      db.prepare(`UPDATE password_resets SET used_at = datetime('now') WHERE id = ?`).run(id);
    },
```

- [ ] **Step 5: Lancer le test SQLite pour vérifier le succès**

Run: `npx vitest run src/core/database/__tests__/auth-tables.test.ts`
Expected: PASS (7/7).

- [ ] **Step 6: Implémenter le miroir Postgres**

Dans `src/core/database/postgres.ts`, mettre à jour l'import de types (mêmes ajouts qu'en SQLite). Ajouter au `SCHEMA` (avant la fermeture backtick) :

```sql
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      password_hash TEXT,
      role TEXT NOT NULL,
      client_id TEXT,
      status TEXT NOT NULL DEFAULT 'invited',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_email ON users(email);

    CREATE TABLE IF NOT EXISTS invitations (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      client_id TEXT,
      role TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_invitations_token ON invitations(token_hash);
    CREATE INDEX IF NOT EXISTS idx_invitations_client ON invitations(client_id);

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_auth_sessions_token ON auth_sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

    CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_password_resets_token ON password_resets(token_hash);
```

Ajouter les méthodes dans l'objet `driver` (avant `async close()`). Noter les `::text` sur tous les timestamps retournés :

```typescript
    async createUser(input: UserInput): Promise<UserRecord> {
      const r = await pool.query(
        `INSERT INTO users (email, password_hash, role, client_id, status)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, password_hash, role, client_id, status, created_at::text, updated_at::text`,
        [input.email, input.password_hash, input.role, input.client_id, input.status]
      );
      return r.rows[0] as UserRecord;
    },

    async getUserByEmail(email: string): Promise<UserRecord | undefined> {
      const r = await pool.query(
        `SELECT id, email, password_hash, role, client_id, status, created_at::text, updated_at::text
         FROM users WHERE email = $1`, [email]);
      return r.rows[0] as UserRecord | undefined;
    },

    async getUserById(id: number): Promise<UserRecord | undefined> {
      const r = await pool.query(
        `SELECT id, email, password_hash, role, client_id, status, created_at::text, updated_at::text
         FROM users WHERE id = $1`, [id]);
      return r.rows[0] as UserRecord | undefined;
    },

    async updateUserPassword(id: number, passwordHash: string): Promise<void> {
      await pool.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [passwordHash, id]);
    },

    async setUserStatus(id: number, status: string): Promise<void> {
      await pool.query(`UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2`, [status, id]);
    },

    async getClient(clientId: string): Promise<ClientRecord | undefined> {
      const r = await pool.query('SELECT client_id, name, status FROM clients WHERE client_id = $1', [clientId]);
      return r.rows[0] as ClientRecord | undefined;
    },

    async createInvitation(input: InvitationInput): Promise<InvitationRecord> {
      const r = await pool.query(
        `INSERT INTO invitations (email, client_id, role, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, client_id, role, token_hash, expires_at::text, accepted_at::text, created_at::text`,
        [input.email, input.client_id, input.role, input.token_hash, input.expires_at]
      );
      return r.rows[0] as InvitationRecord;
    },

    async getInvitationByTokenHash(tokenHash: string): Promise<InvitationRecord | undefined> {
      const r = await pool.query(
        `SELECT id, email, client_id, role, token_hash, expires_at::text, accepted_at::text, created_at::text
         FROM invitations WHERE token_hash = $1`, [tokenHash]);
      return r.rows[0] as InvitationRecord | undefined;
    },

    async markInvitationAccepted(id: number): Promise<void> {
      await pool.query(`UPDATE invitations SET accepted_at = NOW() WHERE id = $1`, [id]);
    },

    async listInvitations(clientId: string): Promise<InvitationRecord[]> {
      const r = await pool.query(
        `SELECT id, email, client_id, role, token_hash, expires_at::text, accepted_at::text, created_at::text
         FROM invitations WHERE client_id = $1 ORDER BY id DESC`, [clientId]);
      return r.rows as InvitationRecord[];
    },

    async deleteInvitation(id: number): Promise<void> {
      await pool.query('DELETE FROM invitations WHERE id = $1', [id]);
    },

    async createAuthSession(input: AuthSessionInput): Promise<AuthSessionRecord> {
      const r = await pool.query(
        `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)
         RETURNING id, user_id, token_hash, expires_at::text, revoked_at::text, created_at::text`,
        [input.user_id, input.token_hash, input.expires_at]
      );
      return r.rows[0] as AuthSessionRecord;
    },

    async getAuthSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | undefined> {
      const r = await pool.query(
        `SELECT id, user_id, token_hash, expires_at::text, revoked_at::text, created_at::text
         FROM auth_sessions WHERE token_hash = $1`, [tokenHash]);
      return r.rows[0] as AuthSessionRecord | undefined;
    },

    async revokeAuthSession(id: number): Promise<void> {
      await pool.query(`UPDATE auth_sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`, [id]);
    },

    async revokeAllUserSessions(userId: number): Promise<void> {
      await pool.query(`UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
    },

    async createPasswordReset(input: PasswordResetInput): Promise<PasswordResetRecord> {
      const r = await pool.query(
        `INSERT INTO password_resets (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)
         RETURNING id, user_id, token_hash, expires_at::text, used_at::text, created_at::text`,
        [input.user_id, input.token_hash, input.expires_at]
      );
      return r.rows[0] as PasswordResetRecord;
    },

    async getPasswordResetByTokenHash(tokenHash: string): Promise<PasswordResetRecord | undefined> {
      const r = await pool.query(
        `SELECT id, user_id, token_hash, expires_at::text, used_at::text, created_at::text
         FROM password_resets WHERE token_hash = $1`, [tokenHash]);
      return r.rows[0] as PasswordResetRecord | undefined;
    },

    async markPasswordResetUsed(id: number): Promise<void> {
      await pool.query(`UPDATE password_resets SET used_at = NOW() WHERE id = $1`, [id]);
    },
```

- [ ] **Step 7: Vérifier `tsc` + suite complète**

Run: `npm run typecheck && npx vitest run src/core/database/`
Expected: `tsc` propre, tous les tests DB verts.

- [ ] **Step 8: Commit**

```bash
git add src/core/database/types.ts src/core/database/sqlite.ts src/core/database/postgres.ts src/core/database/__tests__/auth-tables.test.ts
git commit -m "feat(db): tables users/invitations/auth_sessions/password_resets + accès"
```

---

## Task 2: contracts (Zod) + modèle d'erreur API

**Files:**
- Modify: `package.json` (ajouter `zod`)
- Create: `src/contracts/errors.ts`, `src/contracts/auth.ts`, `src/contracts/clients.ts`, `src/contracts/invitations.ts`, `src/contracts/index.ts`
- Create: `src/api/errors.ts`
- Test: `src/contracts/__tests__/contracts.test.ts`, `src/api/__tests__/errors.test.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces (consommés par Tasks 4-7) :
  - `ErrorCode` (union de chaînes), `ApiErrorBody`.
  - Schémas Zod + types inférés : `LoginInput`, `RefreshInput`, `LogoutInput`, `AcceptInviteInput`, `ForgotPasswordInput`, `ResetPasswordInput`, `CreateClientInput`, `UpdateClientInput`, `CreateInvitationInput`.
  - `AppError` (classe, champs `status`, `code`, `message`, `details?`), `toErrorBody(err, requestId)`, fabriques `unauthorized/forbidden/conflict/notFound/validationError/rateLimited/internal`.

> NOTE implémenteur : `password` minimum 10 caractères. `email` validé via `z.string().email()` puis `.toLowerCase().trim()` (transform) — l'email normalisé sort des schémas, plus besoin de re-normaliser dans les services. `role` accepté à la création d'invitation : `z.enum(['super_admin','client_admin'])`. Les schémas n'utilisent QUE des features Zod standard. Le mapping `ZodError → AppError(validationError)` se fait dans le error-handler (Task 6), mais `validationError(details)` est défini ici.

- [ ] **Step 1: Ajouter la dépendance zod**

Run: `npm install zod@^3.24.0`
Expected: `zod` ajouté à `dependencies` dans `package.json`.

- [ ] **Step 2: Écrire les tests (échec attendu)**

Créer `src/contracts/__tests__/contracts.test.ts` :

```typescript
import { describe, expect, it } from 'vitest';
import {
  LoginInput, AcceptInviteInput, ResetPasswordInput,
  CreateClientInput, CreateInvitationInput,
} from '../index.js';

describe('contracts: auth', () => {
  it('LoginInput valide + normalise l\'email', () => {
    const r = LoginInput.parse({ email: '  Admin@Flow.TEST ', password: 'longenough1' });
    expect(r.email).toBe('admin@flow.test');
  });

  it('LoginInput rejette un email invalide', () => {
    expect(() => LoginInput.parse({ email: 'nope', password: 'longenough1' })).toThrow();
  });

  it('AcceptInviteInput exige un mot de passe >= 10', () => {
    expect(() => AcceptInviteInput.parse({ token: 't', password: 'short' })).toThrow();
    expect(AcceptInviteInput.parse({ token: 't', password: 'longenough1' }).token).toBe('t');
  });

  it('ResetPasswordInput exige token + password', () => {
    expect(ResetPasswordInput.parse({ token: 't', password: 'longenough1' }).password).toBe('longenough1');
  });
});

describe('contracts: clients & invitations', () => {
  it('CreateClientInput exige client_id + name', () => {
    const r = CreateClientInput.parse({ client_id: 'acme', name: 'Acme' });
    expect(r.status).toBe('active'); // défaut
  });

  it('CreateInvitationInput valide role enum', () => {
    expect(() => CreateInvitationInput.parse({ email: 'x@y.test', role: 'root' })).toThrow();
    const r = CreateInvitationInput.parse({ email: '  X@Y.test ', role: 'client_admin' });
    expect(r.email).toBe('x@y.test');
  });
});
```

Créer `src/api/__tests__/errors.test.ts` :

```typescript
import { describe, expect, it } from 'vitest';
import { AppError, toErrorBody, unauthorized, conflict, validationError } from '../errors.js';

describe('AppError / toErrorBody', () => {
  it('unauthorized → 401 code UNAUTHORIZED', () => {
    const e = unauthorized('nope');
    expect(e).toBeInstanceOf(AppError);
    expect(e.status).toBe(401);
    expect(e.code).toBe('UNAUTHORIZED');
  });

  it('conflict → 409 CONFLICT', () => {
    expect(conflict('taken').status).toBe(409);
    expect(conflict('taken').code).toBe('CONFLICT');
  });

  it('toErrorBody enveloppe code/message/details/request_id', () => {
    const body = toErrorBody(validationError([{ path: 'email', message: 'invalid' }]), 'req-1');
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual([{ path: 'email', message: 'invalid' }]);
    expect(body.error.request_id).toBe('req-1');
  });
});
```

- [ ] **Step 3: Vérifier l'échec**

Run: `npx vitest run src/contracts/ src/api/__tests__/errors.test.ts`
Expected: FAIL (modules absents).

- [ ] **Step 4: Écrire `src/contracts/errors.ts`**

```typescript
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL'
  | 'WA_VALIDATION_FAILED'
  | 'CRM_VALIDATION_FAILED';

export interface ApiErrorDetail {
  path: string;
  message: string;
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: ApiErrorDetail[];
    request_id: string;
  };
}
```

- [ ] **Step 5: Écrire `src/contracts/auth.ts`**

```typescript
import { z } from 'zod';

const email = z.string().email().transform((s) => s.trim().toLowerCase());
const password = z.string().min(10, 'Le mot de passe doit faire au moins 10 caractères.');

export const LoginInput = z.object({ email, password: z.string().min(1) });
export type LoginInput = z.infer<typeof LoginInput>;

export const RefreshInput = z.object({ refresh_token: z.string().min(1) });
export type RefreshInput = z.infer<typeof RefreshInput>;

export const LogoutInput = z.object({ refresh_token: z.string().min(1) });
export type LogoutInput = z.infer<typeof LogoutInput>;

export const AcceptInviteInput = z.object({ token: z.string().min(1), password });
export type AcceptInviteInput = z.infer<typeof AcceptInviteInput>;

export const ForgotPasswordInput = z.object({ email });
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordInput>;

export const ResetPasswordInput = z.object({ token: z.string().min(1), password });
export type ResetPasswordInput = z.infer<typeof ResetPasswordInput>;
```

- [ ] **Step 6: Écrire `src/contracts/clients.ts`**

```typescript
import { z } from 'zod';

const clientId = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, 'client_id: minuscules, chiffres, tirets.');

export const CreateClientInput = z.object({
  client_id: clientId,
  name: z.string().min(1),
  status: z.enum(['active', 'suspended']).default('active'),
});
export type CreateClientInput = z.infer<typeof CreateClientInput>;

export const UpdateClientInput = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(['active', 'suspended']).optional(),
});
export type UpdateClientInput = z.infer<typeof UpdateClientInput>;
```

- [ ] **Step 7: Écrire `src/contracts/invitations.ts`**

```typescript
import { z } from 'zod';

const email = z.string().email().transform((s) => s.trim().toLowerCase());

export const CreateInvitationInput = z.object({
  email,
  role: z.enum(['super_admin', 'client_admin']),
});
export type CreateInvitationInput = z.infer<typeof CreateInvitationInput>;
```

- [ ] **Step 8: Écrire `src/contracts/index.ts`**

```typescript
export * from './errors.js';
export * from './auth.js';
export * from './clients.js';
export * from './invitations.js';
```

- [ ] **Step 9: Écrire `src/api/errors.ts`**

```typescript
import type { ApiErrorBody, ApiErrorDetail, ErrorCode } from '../contracts/errors.js';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  WA_VALIDATION_FAILED: 422,
  CRM_VALIDATION_FAILED: 422,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: ApiErrorDetail[];

  constructor(code: ErrorCode, message: string, details?: ApiErrorDetail[]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    if (details) this.details = details;
  }
}

export function toErrorBody(err: AppError, requestId: string): ApiErrorBody {
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
      request_id: requestId,
    },
  };
}

export const unauthorized = (m = 'Non authentifié.') => new AppError('UNAUTHORIZED', m);
export const forbidden = (m = 'Accès refusé.') => new AppError('FORBIDDEN', m);
export const notFound = (m = 'Ressource introuvable.') => new AppError('NOT_FOUND', m);
export const conflict = (m = 'Conflit.') => new AppError('CONFLICT', m);
export const rateLimited = (m = 'Trop de requêtes.') => new AppError('RATE_LIMITED', m);
export const internal = (m = 'Erreur interne.') => new AppError('INTERNAL', m);
export const validationError = (details: ApiErrorDetail[], m = 'Données invalides.') =>
  new AppError('VALIDATION_ERROR', m, details);
```

- [ ] **Step 10: Vérifier le succès + tsc**

Run: `npm run typecheck && npx vitest run src/contracts/ src/api/__tests__/errors.test.ts`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json src/contracts/ src/api/errors.ts src/api/__tests__/errors.test.ts
git commit -m "feat(contracts): schémas Zod auth/clients/invitations + modèle d'erreur API"
```

---

## Task 3: Primitives d'auth — mots de passe + tokens

**Files:**
- Modify: `package.json` (ajouter `jose`, `bcrypt`, `@types/bcrypt`)
- Modify: `src/core/config.ts`
- Create: `src/core/auth/passwords.ts`, `src/core/auth/tokens.ts`
- Test: `src/core/auth/__tests__/passwords.test.ts`, `src/core/auth/__tests__/tokens.test.ts`

**Interfaces:**
- Consumes: `config` (nouveaux getters), `bcrypt`, `jose`, `crypto`.
- Produces (consommés par Tasks 4-7) :
  - `config.adminJwt.secret`, `config.auth.{accessTtlSeconds, refreshTtlDays, bcryptRounds, inviteTtlDays, resetTtlHours, webOrigin}`.
  - `hashPassword(plain: string): Promise<string>`, `verifyPassword(plain: string, hash: string): Promise<boolean>`.
  - `AccessClaims = { sub: string; role: string; client_id: string | null }`.
  - `signAccessToken(claims: AccessClaims): Promise<string>`.
  - `verifyAccessToken(token: string): Promise<AccessClaims | null>` (null si invalide/expiré).
  - `generateRefreshToken(): string` (opaque, base64url) ; `hashRefreshToken(token: string): string` (sha256 hex).

> NOTE implémenteur : `verifyAccessToken` ne throw jamais — retourne `null` sur toute erreur jose (signature, expiration, claims manquants). `client_id` dans le JWT : encoder `null` comme claim absent ; au décodage, `client_id` absent → `null`. `signAccessToken` met `exp = now + accessTtlSeconds`, `iat`, `sub`. `config.adminJwt.secret` : getter qui lit `ADMIN_JWT_SECRET` (chaîne vide si absent — la validation fail-closed est dans `verifyAccessToken`/`signAccessToken` : si secret vide, throw au sign, null au verify).

- [ ] **Step 1: Ajouter les dépendances**

Run: `npm install jose@^5.9.0 bcrypt@^5.1.1 && npm install -D @types/bcrypt@^5.0.2`

- [ ] **Step 2: Ajouter les getters config**

Dans `src/core/config.ts`, ajouter dans l'objet `config` (avant `port`) :

```typescript
  adminJwt: {
    get secret(): string { return process.env['ADMIN_JWT_SECRET'] || ''; },
  },
  auth: {
    get accessTtlSeconds(): number { return parseInt(process.env['ADMIN_JWT_ACCESS_TTL'] || '900', 10); },
    get refreshTtlDays(): number { return parseInt(process.env['ADMIN_REFRESH_TTL_DAYS'] || '30', 10); },
    get inviteTtlDays(): number { return parseInt(process.env['ADMIN_INVITE_TTL_DAYS'] || '7', 10); },
    get resetTtlHours(): number { return parseInt(process.env['ADMIN_RESET_TTL_HOURS'] || '2', 10); },
    get bcryptRounds(): number { return parseInt(process.env['ADMIN_BCRYPT_ROUNDS'] || '12', 10); },
    get webOrigin(): string { return process.env['ADMIN_WEB_ORIGIN'] || 'http://localhost:3000'; },
  },
```

- [ ] **Step 3: Écrire les tests (échec attendu)**

Créer `src/core/auth/__tests__/passwords.test.ts` :

```typescript
import { describe, expect, it, beforeAll } from 'vitest';
import { hashPassword, verifyPassword } from '../passwords.js';

describe('passwords', () => {
  beforeAll(() => { process.env['ADMIN_BCRYPT_ROUNDS'] = '4'; }); // rapide en test

  it('hash != plain et verify OK', async () => {
    const h = await hashPassword('longenough1');
    expect(h).not.toBe('longenough1');
    expect(await verifyPassword('longenough1', h)).toBe(true);
  });

  it('verify échoue sur mauvais mot de passe', async () => {
    const h = await hashPassword('longenough1');
    expect(await verifyPassword('wrong-password', h)).toBe(false);
  });
});
```

Créer `src/core/auth/__tests__/tokens.test.ts` :

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { signAccessToken, verifyAccessToken, generateRefreshToken, hashRefreshToken } from '../tokens.js';

describe('access tokens', () => {
  beforeEach(() => { process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!'; });

  it('sign → verify roundtrip restitue les claims', async () => {
    const t = await signAccessToken({ sub: '7', role: 'client_admin', client_id: 'acme' });
    const c = await verifyAccessToken(t);
    expect(c).toEqual({ sub: '7', role: 'client_admin', client_id: 'acme' });
  });

  it('super_admin : client_id null préservé', async () => {
    const t = await signAccessToken({ sub: '1', role: 'super_admin', client_id: null });
    expect((await verifyAccessToken(t))!.client_id).toBeNull();
  });

  it('token falsifié → null', async () => {
    const t = await signAccessToken({ sub: '1', role: 'super_admin', client_id: null });
    expect(await verifyAccessToken(t + 'x')).toBeNull();
  });

  it('token signé avec un autre secret → null', async () => {
    const t = await signAccessToken({ sub: '1', role: 'super_admin', client_id: null });
    process.env['ADMIN_JWT_SECRET'] = 'another-secret-at-least-32-bytes-long!';
    expect(await verifyAccessToken(t)).toBeNull();
  });
});

describe('refresh tokens', () => {
  it('generate produit des valeurs uniques, hash déterministe', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
    expect(hashRefreshToken(a)).toBe(hashRefreshToken(a));
    expect(hashRefreshToken(a)).not.toBe(hashRefreshToken(b));
    expect(hashRefreshToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 4: Vérifier l'échec**

Run: `npx vitest run src/core/auth/__tests__/passwords.test.ts src/core/auth/__tests__/tokens.test.ts`
Expected: FAIL.

- [ ] **Step 5: Écrire `src/core/auth/passwords.ts`**

```typescript
import bcrypt from 'bcrypt';
import { config } from '../config.js';

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, config.auth.bcryptRounds);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

- [ ] **Step 6: Écrire `src/core/auth/tokens.ts`**

```typescript
import crypto from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';

export interface AccessClaims {
  sub: string;
  role: string;
  client_id: string | null;
}

function secretKey(): Uint8Array {
  const raw = config.adminJwt.secret;
  if (!raw) throw new Error('[Auth] ADMIN_JWT_SECRET is required');
  return new TextEncoder().encode(raw);
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: claims.role, client_id: claims.client_id })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + config.auth.accessTtlSeconds)
    .sign(secretKey());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  if (!config.adminJwt.secret) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof payload.role !== 'string') return null;
    const clientId = payload.client_id;
    return {
      sub: payload.sub,
      role: payload.role,
      client_id: typeof clientId === 'string' ? clientId : null,
    };
  } catch {
    return null;
  }
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
```

- [ ] **Step 7: Vérifier le succès + tsc**

Run: `npm run typecheck && npx vitest run src/core/auth/`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/core/config.ts src/core/auth/passwords.ts src/core/auth/tokens.ts src/core/auth/__tests__/passwords.test.ts src/core/auth/__tests__/tokens.test.ts
git commit -m "feat(auth): primitives mots de passe (bcrypt) + tokens JWT/refresh (jose)"
```

---

## Task 4: Mailer + AuthService

**Files:**
- Create: `src/core/auth/mailer.ts`, `src/core/auth/auth-service.ts`
- Test: `src/core/auth/__tests__/mailer.test.ts`, `src/core/auth/__tests__/auth-service.test.ts`

**Interfaces:**
- Consumes: `Database`, `passwords`, `tokens`, `config`, `AppError`/fabriques.
- Produces (consommés par Tasks 5-7) :
  - `Mailer` interface : `sendInvitation(to: string, link: string): Promise<void>`, `sendPasswordReset(to: string, link: string): Promise<void>`.
  - `ConsoleMailer` (impl loggant le lien), `createMailer(): Mailer`.
  - `AuthService` (classe), construite avec `{ db: Database; mailer: Mailer }`, méthodes :
    - `login(email: string, password: string): Promise<AuthResult>`
    - `refresh(refreshToken: string): Promise<AuthResult>`
    - `logout(refreshToken: string): Promise<void>`
    - `me(userId: number): Promise<PublicUser>`
    - `acceptInvite(token: string, password: string): Promise<AuthResult>`
    - `forgotPassword(email: string): Promise<void>`
    - `resetPassword(token: string, password: string): Promise<void>`
  - Types : `PublicUser = { id: number; email: string; role: string; client_id: string | null; status: string }`, `AuthResult = { access_token: string; refresh_token: string; user: PublicUser }`.

> NOTE implémenteur (sécurité) :
> - `login` : user absent OU `password_hash` null (invité non activé) OU mauvais mdp → `unauthorized('Identifiants invalides.')` (message identique pour ne pas révéler l'existence du compte). `status !== 'active'` → `unauthorized`.
> - `refresh` : session introuvable → `unauthorized`. Si `revoked_at` non null → **détection de réutilisation** : révoquer TOUTES les sessions de l'utilisateur (`revokeAllUserSessions`) puis `unauthorized`. Si `expires_at` dépassé → révoquer cette session + `unauthorized`. Sinon : révoquer l'ancienne session, en créer une nouvelle (rotation), émettre nouveaux tokens.
> - `acceptInvite` : invitation introuvable/expirée/déjà acceptée → `unauthorized('Invitation invalide ou expirée.')`. Trouver le user par email (créé `invited` à l'envoi de l'invitation) ; set password_hash + status `active` ; marquer l'invitation acceptée ; émettre des tokens (auto-login).
> - `forgotPassword` : **ne révèle jamais** si l'email existe — si user actif trouvé, créer un password_reset + mail ; sinon no-op silencieux. Toujours résoudre sans erreur.
> - `resetPassword` : reset introuvable/expiré/déjà utilisé → `unauthorized`. Sinon set password, marquer used, **révoquer toutes les sessions** de l'utilisateur (force re-login).
> - `toPublicUser` ne renvoie jamais `password_hash`.
> - Les expirations comparées en JS : `new Date(expires_at).getTime() < Date.now()`.
> - Helper privé `issueTokens(user)` : crée refresh (generate+hash, expires = now + refreshTtlDays), `createAuthSession`, signe access token. Factorise login/refresh/acceptInvite.

- [ ] **Step 1: Écrire les tests (échec attendu)**

Créer `src/core/auth/__tests__/mailer.test.ts` :

```typescript
import { describe, expect, it, vi } from 'vitest';
import { ConsoleMailer } from '../mailer.js';

describe('ConsoleMailer', () => {
  it('logue le lien sans throw', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const m = new ConsoleMailer();
    await m.sendInvitation('x@y.test', 'https://app/invite?token=abc');
    await m.sendPasswordReset('x@y.test', 'https://app/reset?token=def');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

Créer `src/core/auth/__tests__/auth-service.test.ts` :

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import type { Database } from '../../database/types.js';
import { AuthService } from '../auth-service.js';
import type { Mailer } from '../mailer.js';
import { hashPassword } from '../passwords.js';
import { generateRefreshToken, hashRefreshToken } from '../tokens.js';

class FakeMailer implements Mailer {
  invites: Array<{ to: string; link: string }> = [];
  resets: Array<{ to: string; link: string }> = [];
  async sendInvitation(to: string, link: string) { this.invites.push({ to, link }); }
  async sendPasswordReset(to: string, link: string) { this.resets.push({ to, link }); }
}

const SECRET = 'test-secret-at-least-32-bytes-long!!';

describe('AuthService', () => {
  let db: Database;
  let mailer: FakeMailer;
  let svc: AuthService;

  beforeEach(async () => {
    process.env['ADMIN_JWT_SECRET'] = SECRET;
    process.env['ADMIN_BCRYPT_ROUNDS'] = '4';
    db = createSqliteDriver(':memory:');
    mailer = new FakeMailer();
    svc = new AuthService({ db, mailer });
  });

  async function makeActiveUser(email = 'a@x.test', pwd = 'longenough1') {
    return db.createUser({ email, password_hash: await hashPassword(pwd), role: 'super_admin', client_id: null, status: 'active' });
  }

  it('login OK renvoie tokens + public user (sans hash)', async () => {
    await makeActiveUser();
    const r = await svc.login('a@x.test', 'longenough1');
    expect(r.access_token).toBeTruthy();
    expect(r.refresh_token).toBeTruthy();
    expect(r.user.email).toBe('a@x.test');
    expect((r.user as Record<string, unknown>)['password_hash']).toBeUndefined();
  });

  it('login mauvais mdp → throw UNAUTHORIZED', async () => {
    await makeActiveUser();
    await expect(svc.login('a@x.test', 'wrong-password')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('login user inexistant → throw UNAUTHORIZED (pas de fuite)', async () => {
    await expect(svc.login('ghost@x.test', 'longenough1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('login user non actif → UNAUTHORIZED', async () => {
    await db.createUser({ email: 'inv@x.test', password_hash: await hashPassword('longenough1'), role: 'client_admin', client_id: 'acme', status: 'invited' });
    await expect(svc.login('inv@x.test', 'longenough1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('refresh fait tourner le token (rotation) et invalide l\'ancien', async () => {
    await makeActiveUser();
    const r1 = await svc.login('a@x.test', 'longenough1');
    const r2 = await svc.refresh(r1.refresh_token);
    expect(r2.refresh_token).not.toBe(r1.refresh_token);
    await expect(svc.refresh(r1.refresh_token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('refresh d\'un token révoqué (réutilisation) révoque toutes les sessions', async () => {
    const u = await makeActiveUser();
    const r1 = await svc.login('a@x.test', 'longenough1');
    const r2 = await svc.refresh(r1.refresh_token); // r1 révoqué
    await svc.refresh(r1.refresh_token).catch(() => {}); // réutilisation détectée
    // r2 (valide avant) doit maintenant être révoqué aussi
    await expect(svc.refresh(r2.refresh_token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(u.id).toBeGreaterThan(0);
  });

  it('logout révoque la session', async () => {
    await makeActiveUser();
    const r1 = await svc.login('a@x.test', 'longenough1');
    await svc.logout(r1.refresh_token);
    await expect(svc.refresh(r1.refresh_token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('acceptInvite active l\'utilisateur invité et auto-login', async () => {
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.createUser({ email: 'invitee@acme.test', password_hash: null, role: 'client_admin', client_id: 'acme', status: 'invited' });
    const raw = generateRefreshToken();
    await db.createInvitation({ email: 'invitee@acme.test', client_id: 'acme', role: 'client_admin', token_hash: hashRefreshToken(raw), expires_at: '2099-01-01T00:00:00.000Z' });
    const r = await svc.acceptInvite(raw, 'longenough1');
    expect(r.user.status).toBe('active');
    expect((await db.getUserByEmail('invitee@acme.test'))!.password_hash).toBeTruthy();
    // login fonctionne ensuite
    expect((await svc.login('invitee@acme.test', 'longenough1')).access_token).toBeTruthy();
  });

  it('acceptInvite token invalide → UNAUTHORIZED', async () => {
    await expect(svc.acceptInvite('nope', 'longenough1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('forgotPassword email inconnu : silencieux (pas d\'erreur, pas de mail)', async () => {
    await svc.forgotPassword('ghost@x.test');
    expect(mailer.resets).toHaveLength(0);
  });

  it('forgotPassword + resetPassword change le mot de passe et révoque les sessions', async () => {
    await makeActiveUser();
    const r1 = await svc.login('a@x.test', 'longenough1');
    await svc.forgotPassword('a@x.test');
    expect(mailer.resets).toHaveLength(1);
    const token = new URL(mailer.resets[0]!.link).searchParams.get('token')!;
    await svc.resetPassword(token, 'brandnew-password1');
    // ancien refresh révoqué
    await expect(svc.refresh(r1.refresh_token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    // nouveau mdp fonctionne
    expect((await svc.login('a@x.test', 'brandnew-password1')).access_token).toBeTruthy();
  });

  it('me renvoie le public user', async () => {
    const u = await makeActiveUser();
    const me = await svc.me(u.id);
    expect(me.email).toBe('a@x.test');
    expect((me as Record<string, unknown>)['password_hash']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/core/auth/__tests__/mailer.test.ts src/core/auth/__tests__/auth-service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Écrire `src/core/auth/mailer.ts`**

```typescript
export interface Mailer {
  sendInvitation(to: string, link: string): Promise<void>;
  sendPasswordReset(to: string, link: string): Promise<void>;
}

/** Impl par défaut : logue le lien (dev / pas de fournisseur configuré). */
export class ConsoleMailer implements Mailer {
  async sendInvitation(to: string, link: string): Promise<void> {
    console.log(`[Mailer] Invitation Flow Labs pour ${to}: ${link}`);
  }
  async sendPasswordReset(to: string, link: string): Promise<void> {
    console.log(`[Mailer] Réinitialisation Flow Labs pour ${to}: ${link}`);
  }
}

/**
 * Sélection de l'impl. V1 : ConsoleMailer. Un impl Resend/SMTP se branchera ici
 * derrière une variable d'env (clé API) sans toucher aux appelants.
 */
export function createMailer(): Mailer {
  return new ConsoleMailer();
}
```

- [ ] **Step 4: Écrire `src/core/auth/auth-service.ts`**

```typescript
import type { Database, UserRecord } from '../database/types.js';
import type { Mailer } from './mailer.js';
import { config } from '../config.js';
import { unauthorized } from '../../api/errors.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { signAccessToken, generateRefreshToken, hashRefreshToken } from './tokens.js';

export interface PublicUser {
  id: number;
  email: string;
  role: string;
  client_id: string | null;
  status: string;
}

export interface AuthResult {
  access_token: string;
  refresh_token: string;
  user: PublicUser;
}

export interface AuthServiceDeps {
  db: Database;
  mailer: Mailer;
}

function toPublicUser(u: UserRecord): PublicUser {
  return { id: u.id, email: u.email, role: u.role, client_id: u.client_id, status: u.status };
}

function isExpired(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

export class AuthService {
  private readonly db: Database;
  private readonly mailer: Mailer;

  constructor(deps: AuthServiceDeps) {
    this.db = deps.db;
    this.mailer = deps.mailer;
  }

  private async issueTokens(user: UserRecord): Promise<AuthResult> {
    const refresh = generateRefreshToken();
    const expiresAt = new Date(Date.now() + config.auth.refreshTtlDays * 86400_000).toISOString();
    await this.db.createAuthSession({ user_id: user.id, token_hash: hashRefreshToken(refresh), expires_at: expiresAt });
    const access = await signAccessToken({ sub: String(user.id), role: user.role, client_id: user.client_id });
    return { access_token: access, refresh_token: refresh, user: toPublicUser(user) };
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const user = await this.db.getUserByEmail(email);
    if (!user || !user.password_hash || user.status !== 'active') throw unauthorized('Identifiants invalides.');
    if (!(await verifyPassword(password, user.password_hash))) throw unauthorized('Identifiants invalides.');
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    const hash = hashRefreshToken(refreshToken);
    const session = await this.db.getAuthSessionByTokenHash(hash);
    if (!session) throw unauthorized('Session invalide.');
    if (session.revoked_at) {
      // Réutilisation d'un token déjà tourné → compromission probable : on coupe tout.
      await this.db.revokeAllUserSessions(session.user_id);
      throw unauthorized('Session invalide.');
    }
    if (isExpired(session.expires_at)) {
      await this.db.revokeAuthSession(session.id);
      throw unauthorized('Session expirée.');
    }
    const user = await this.db.getUserById(session.user_id);
    if (!user || user.status !== 'active') throw unauthorized('Session invalide.');
    await this.db.revokeAuthSession(session.id); // rotation
    return this.issueTokens(user);
  }

  async logout(refreshToken: string): Promise<void> {
    const session = await this.db.getAuthSessionByTokenHash(hashRefreshToken(refreshToken));
    if (session && !session.revoked_at) await this.db.revokeAuthSession(session.id);
  }

  async me(userId: number): Promise<PublicUser> {
    const user = await this.db.getUserById(userId);
    if (!user) throw unauthorized('Session invalide.');
    return toPublicUser(user);
  }

  async acceptInvite(token: string, password: string): Promise<AuthResult> {
    const inv = await this.db.getInvitationByTokenHash(hashRefreshToken(token));
    if (!inv || inv.accepted_at || isExpired(inv.expires_at)) throw unauthorized('Invitation invalide ou expirée.');
    const user = await this.db.getUserByEmail(inv.email);
    if (!user) throw unauthorized('Invitation invalide ou expirée.');
    await this.db.updateUserPassword(user.id, await hashPassword(password));
    await this.db.setUserStatus(user.id, 'active');
    await this.db.markInvitationAccepted(inv.id);
    const fresh = (await this.db.getUserById(user.id))!;
    return this.issueTokens(fresh);
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.db.getUserByEmail(email);
    if (!user || user.status !== 'active') return; // silencieux : pas de fuite d'existence
    const token = generateRefreshToken();
    const expiresAt = new Date(Date.now() + config.auth.resetTtlHours * 3600_000).toISOString();
    await this.db.createPasswordReset({ user_id: user.id, token_hash: hashRefreshToken(token), expires_at: expiresAt });
    const link = `${config.auth.webOrigin}/reset-password?token=${token}`;
    await this.mailer.sendPasswordReset(user.email, link);
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const reset = await this.db.getPasswordResetByTokenHash(hashRefreshToken(token));
    if (!reset || reset.used_at || isExpired(reset.expires_at)) throw unauthorized('Lien de réinitialisation invalide ou expiré.');
    await this.db.updateUserPassword(reset.user_id, await hashPassword(password));
    await this.db.markPasswordResetUsed(reset.id);
    await this.db.revokeAllUserSessions(reset.user_id); // force re-login partout
  }
}
```

- [ ] **Step 5: Vérifier le succès + tsc**

Run: `npm run typecheck && npx vitest run src/core/auth/`
Expected: PASS (tous).

- [ ] **Step 6: Commit**

```bash
git add src/core/auth/mailer.ts src/core/auth/auth-service.ts src/core/auth/__tests__/mailer.test.ts src/core/auth/__tests__/auth-service.test.ts
git commit -m "feat(auth): AuthService (login/refresh/rotation/invite/reset) + Mailer"
```

---

## Task 5: AdminService (clients + invitations) + seed-admin

**Files:**
- Create: `src/core/auth/admin-service.ts`, `scripts/seed-admin.ts`
- Test: `src/core/auth/__tests__/admin-service.test.ts`

**Interfaces:**
- Consumes: `Database`, `Mailer`, `config`, `tokens` (generate/hash), `AppError` fabriques, types `contracts`.
- Produces (consommés par Task 7) :
  - `AdminService` (classe), construite avec `{ db: Database; mailer: Mailer }`, méthodes :
    - `listClients(): Promise<ClientRecord[]>`
    - `createClient(input: { client_id: string; name: string; status: string }): Promise<ClientRecord>`
    - `updateClient(clientId: string, patch: { name?: string; status?: string }): Promise<ClientRecord>`
    - `createInvitation(clientId: string | null, email: string, role: string): Promise<{ id: number; email: string; role: string }>`
    - `listInvitations(clientId: string): Promise<InvitationPublic[]>`
    - `revokeInvitation(clientId: string, invitationId: number): Promise<void>`
  - Type `InvitationPublic = { id: number; email: string; role: string; expires_at: string; accepted_at: string | null }` (jamais `token_hash`).

> NOTE implémenteur :
> - `createClient` : si `getClient(client_id)` existe déjà → `conflict('client_id déjà pris.')`. Sinon `upsertClient`, retourner `getClient`.
> - `updateClient` : `getClient` → si absent `notFound`. Merge name/status sur l'existant, `upsertClient`, retourner.
> - `createInvitation` : `getClient(clientId)` requis si `clientId` non null → sinon `notFound`. Si un user **actif** existe déjà pour cet email → `conflict('Utilisateur déjà actif.')`. Créer (ou réutiliser) un user `invited` : si user existe en `invited`, le réutiliser (mettre à jour role/client si besoin via re-création interdite — ici garder simple : si user `invited` existe pour cet email, on réémet une invitation sans recréer le user) ; sinon `createUser({email, password_hash:null, role, client_id:clientId, status:'invited'})`. Générer token (`generateRefreshToken`), stocker `hashRefreshToken(token)`, `expires_at = now + inviteTtlDays`. Envoyer le mail avec lien `${webOrigin}/accept-invite?token=${token}`. Retourner sans le token brut (présent uniquement dans le mail/log).
> - `revokeInvitation` : vérifier que l'invitation appartient à `clientId` (sinon `notFound`), puis `deleteInvitation`.
> - `listInvitations` : mapper vers `InvitationPublic` (sans `token_hash`).
> - `seed-admin.ts` : script idempotent. Lit `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD` (args ou env). Si user existe déjà → log et exit 0. Sinon crée un `super_admin` actif (hash mdp). Guard `main()`. Hors couverture `tsc` (convention `scripts/`), lancé via tsx.

- [ ] **Step 1: Écrire le test (échec attendu)**

Créer `src/core/auth/__tests__/admin-service.test.ts` :

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import type { Database } from '../../database/types.js';
import { AdminService } from '../admin-service.js';
import type { Mailer } from '../mailer.js';

class FakeMailer implements Mailer {
  invites: Array<{ to: string; link: string }> = [];
  resets: Array<{ to: string; link: string }> = [];
  async sendInvitation(to: string, link: string) { this.invites.push({ to, link }); }
  async sendPasswordReset(to: string, link: string) { this.resets.push({ to, link }); }
}

describe('AdminService', () => {
  let db: Database;
  let mailer: FakeMailer;
  let svc: AdminService;

  beforeEach(() => {
    db = createSqliteDriver(':memory:');
    mailer = new FakeMailer();
    svc = new AdminService({ db, mailer });
  });

  it('createClient crée puis refuse le doublon', async () => {
    const c = await svc.createClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    expect(c.client_id).toBe('acme');
    await expect(svc.createClient({ client_id: 'acme', name: 'Acme2', status: 'active' }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('updateClient sur client absent → NOT_FOUND', async () => {
    await expect(svc.updateClient('ghost', { name: 'X' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('updateClient merge le patch', async () => {
    await svc.createClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    const u = await svc.updateClient('acme', { status: 'suspended' });
    expect(u.status).toBe('suspended');
    expect(u.name).toBe('Acme');
  });

  it('createInvitation crée user invité + envoie le mail (sans token en retour)', async () => {
    await svc.createClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    const inv = await svc.createInvitation('acme', 'new@acme.test', 'client_admin');
    expect(inv.email).toBe('new@acme.test');
    expect((inv as Record<string, unknown>)['token_hash']).toBeUndefined();
    expect(mailer.invites).toHaveLength(1);
    expect(mailer.invites[0]!.link).toContain('accept-invite?token=');
    expect((await db.getUserByEmail('new@acme.test'))!.status).toBe('invited');
  });

  it('createInvitation sur client inexistant → NOT_FOUND', async () => {
    await expect(svc.createInvitation('ghost', 'x@y.test', 'client_admin')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('createInvitation si user déjà actif → CONFLICT', async () => {
    await svc.createClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.createUser({ email: 'active@acme.test', password_hash: 'h', role: 'client_admin', client_id: 'acme', status: 'active' });
    await expect(svc.createInvitation('acme', 'active@acme.test', 'client_admin')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('listInvitations masque le token_hash', async () => {
    await svc.createClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await svc.createInvitation('acme', 'a@acme.test', 'client_admin');
    const list = await svc.listInvitations('acme');
    expect(list).toHaveLength(1);
    expect((list[0] as Record<string, unknown>)['token_hash']).toBeUndefined();
    expect(list[0]!.email).toBe('a@acme.test');
  });

  it('revokeInvitation d\'un autre client → NOT_FOUND', async () => {
    await svc.createClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await svc.createClient({ client_id: 'other', name: 'Other', status: 'active' });
    await svc.createInvitation('acme', 'a@acme.test', 'client_admin');
    const list = await svc.listInvitations('acme');
    await expect(svc.revokeInvitation('other', list[0]!.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('revokeInvitation supprime', async () => {
    await svc.createClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await svc.createInvitation('acme', 'a@acme.test', 'client_admin');
    const list = await svc.listInvitations('acme');
    await svc.revokeInvitation('acme', list[0]!.id);
    expect(await svc.listInvitations('acme')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/core/auth/__tests__/admin-service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Écrire `src/core/auth/admin-service.ts`**

```typescript
import type { Database, ClientRecord, InvitationRecord } from '../database/types.js';
import type { Mailer } from './mailer.js';
import { config } from '../config.js';
import { conflict, notFound } from '../../api/errors.js';
import { generateRefreshToken, hashRefreshToken } from './tokens.js';

export interface InvitationPublic {
  id: number;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
}

export interface AdminServiceDeps {
  db: Database;
  mailer: Mailer;
}

function toInvitationPublic(inv: InvitationRecord): InvitationPublic {
  return { id: inv.id, email: inv.email, role: inv.role, expires_at: inv.expires_at, accepted_at: inv.accepted_at };
}

export class AdminService {
  private readonly db: Database;
  private readonly mailer: Mailer;

  constructor(deps: AdminServiceDeps) {
    this.db = deps.db;
    this.mailer = deps.mailer;
  }

  async listClients(): Promise<ClientRecord[]> {
    return this.db.listClients();
  }

  async createClient(input: { client_id: string; name: string; status: string }): Promise<ClientRecord> {
    if (await this.db.getClient(input.client_id)) throw conflict('client_id déjà pris.');
    await this.db.upsertClient({ client_id: input.client_id, name: input.name, status: input.status });
    return (await this.db.getClient(input.client_id))!;
  }

  async updateClient(clientId: string, patch: { name?: string; status?: string }): Promise<ClientRecord> {
    const existing = await this.db.getClient(clientId);
    if (!existing) throw notFound('Client introuvable.');
    await this.db.upsertClient({
      client_id: clientId,
      name: patch.name ?? existing.name,
      status: patch.status ?? existing.status,
    });
    return (await this.db.getClient(clientId))!;
  }

  async createInvitation(clientId: string | null, email: string, role: string): Promise<{ id: number; email: string; role: string }> {
    if (clientId && !(await this.db.getClient(clientId))) throw notFound('Client introuvable.');

    const existingUser = await this.db.getUserByEmail(email);
    if (existingUser && existingUser.status === 'active') throw conflict('Utilisateur déjà actif.');
    if (!existingUser) {
      await this.db.createUser({ email, password_hash: null, role, client_id: clientId, status: 'invited' });
    }

    const token = generateRefreshToken();
    const expiresAt = new Date(Date.now() + config.auth.inviteTtlDays * 86400_000).toISOString();
    const inv = await this.db.createInvitation({
      email, client_id: clientId, role, token_hash: hashRefreshToken(token), expires_at: expiresAt,
    });
    const link = `${config.auth.webOrigin}/accept-invite?token=${token}`;
    await this.mailer.sendInvitation(email, link);
    return { id: inv.id, email: inv.email, role: inv.role };
  }

  async listInvitations(clientId: string): Promise<InvitationPublic[]> {
    return (await this.db.listInvitations(clientId)).map(toInvitationPublic);
  }

  async revokeInvitation(clientId: string, invitationId: number): Promise<void> {
    const list = await this.db.listInvitations(clientId);
    if (!list.some((i) => i.id === invitationId)) throw notFound('Invitation introuvable.');
    await this.db.deleteInvitation(invitationId);
  }
}
```

- [ ] **Step 4: Vérifier le succès + tsc**

Run: `npm run typecheck && npx vitest run src/core/auth/__tests__/admin-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Écrire `scripts/seed-admin.ts`**

```typescript
import 'dotenv/config';
import { initDatabase } from '../src/core/database/index.js';
import { hashPassword } from '../src/core/auth/passwords.js';

async function main(): Promise<void> {
  const email = (process.argv[2] || process.env['SEED_ADMIN_EMAIL'] || '').trim().toLowerCase();
  const password = process.argv[3] || process.env['SEED_ADMIN_PASSWORD'] || '';
  if (!email || !password) {
    console.error('[SeedAdmin] Usage: tsx scripts/seed-admin.ts <email> <password> (ou SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD)');
    process.exit(1);
  }
  if (password.length < 10) {
    console.error('[SeedAdmin] Le mot de passe doit faire au moins 10 caractères.');
    process.exit(1);
  }

  const db = await initDatabase();
  const existing = await db.getUserByEmail(email);
  if (existing) {
    console.log(`[SeedAdmin] L'utilisateur ${email} existe déjà (id=${existing.id}), rien à faire.`);
    await db.close();
    return;
  }
  const user = await db.createUser({
    email, password_hash: await hashPassword(password), role: 'super_admin', client_id: null, status: 'active',
  });
  console.log(`[SeedAdmin] super_admin créé: ${email} (id=${user.id})`);
  await db.close();
}

main().catch((err) => {
  console.error('[SeedAdmin] Échec:', err);
  process.exit(1);
});
```

- [ ] **Step 6: Vérifier que le seed s'exécute (sqlite local)**

Run: `CREDENTIALS_ENCRYPTION_KEY=$(openssl rand -hex 32) ANTHROPIC_API_KEY=x ADMIN_BCRYPT_ROUNDS=4 npx tsx scripts/seed-admin.ts root@flowlabs.test motdepasse123`
Expected: log `[SeedAdmin] super_admin créé: root@flowlabs.test`. Relancer la même commande → log « existe déjà » (idempotent).
Nettoyage : `rm -f store/demo.db store/demo.db-wal store/demo.db-shm`

- [ ] **Step 7: Commit**

```bash
git add src/core/auth/admin-service.ts src/core/auth/__tests__/admin-service.test.ts scripts/seed-admin.ts
git commit -m "feat(auth): AdminService (clients + invitations) + seed du super_admin"
```

---

## Task 6: Middlewares Express (contexte, auth, rate-limit, erreurs)

**Files:**
- Create: `src/api/middleware/context.ts`, `src/api/middleware/auth.ts`, `src/api/middleware/rate-limit.ts`, `src/api/middleware/error-handler.ts`
- Test: `src/api/middleware/__tests__/auth.test.ts`, `src/api/middleware/__tests__/rate-limit.test.ts`

**Interfaces:**
- Consumes: `express`, `verifyAccessToken`, `AppError`/`toErrorBody`, `validationError`, `ZodError`, `crypto.randomUUID`.
- Produces (consommés par Task 7) :
  - Augmentation `express.Request` : `requestId: string`, `auth?: { userId: number; role: string; clientId: string | null }`, `scopedClientId?: string`.
  - `requestId` (middleware), `cors(origin)` (middleware), `requireAuth` (middleware), `requireRole(...roles)` (factory), `scopeToClient` (middleware), `createRateLimiter({ windowMs, max })` (factory), `errorHandler` (middleware d'erreur à 4 args), `notFoundHandler`.

> NOTE implémenteur :
> - Augmentation des types : déclarer `declare global { namespace Express { interface Request { ... } } }` dans `context.ts` (avec `export {}` pour rester un module).
> - `requireAuth` : lit `Authorization: Bearer <jwt>` ; `verifyAccessToken` → si null `next(unauthorized())` ; sinon `req.auth = { userId: Number(sub), role, clientId: client_id }`, `next()`.
> - `requireRole(...roles)` : si `!req.auth || !roles.includes(req.auth.role)` → `next(forbidden())`.
> - `scopeToClient` : pour `super_admin`, lire `?client_id` (query) → `req.scopedClientId` (peut être undefined si non fourni — l'endpoint décide). Pour `client_admin`, **forcer** `req.scopedClientId = req.auth.clientId` en ignorant toute query (anti-escalade). Si `client_admin` sans `clientId` → `forbidden()`.
> - `errorHandler` : si `err` est `ZodError` → `validationError(map des issues)` ; si `AppError` → tel quel ; sinon log `[API] Unhandled` + `internal()`. Répondre `err.status` + `toErrorBody(appErr, req.requestId)`. Toujours mettre `Content-Type: application/json`.
> - `createRateLimiter` : Map en mémoire `key → { count, resetAt }`, clé = `${req.ip}:${req.path}`. Au-delà de `max` dans la fenêtre → `next(rateLimited())`. (Limite in-memory mono-instance ; Redis = item futur, à noter en commentaire.)
> - `cors(origin)` : pose `Access-Control-Allow-Origin: origin`, `-Allow-Methods`, `-Allow-Headers: Authorization, Content-Type`, `-Allow-Credentials: true` ; répond `204` aux `OPTIONS`.

- [ ] **Step 1: Écrire les tests (échec attendu)**

Créer `src/api/middleware/__tests__/auth.test.ts` :

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requireAuth, requireRole, scopeToClient } from '../auth.js';
import { requestId } from '../context.js';
import { errorHandler } from '../error-handler.js';
import { signAccessToken } from '../../../core/auth/tokens.js';

function appWith(...mws: express.RequestHandler[]) {
  const app = express();
  app.use(requestId);
  app.get('/p', ...mws, (req, res) => { res.json({ auth: req.auth, scoped: req.scopedClientId ?? null }); });
  app.use(errorHandler);
  return app;
}

describe('requireAuth', () => {
  beforeEach(() => { process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!'; });

  it('sans header → 401 forme d\'erreur', async () => {
    const res = await request(appWith(requireAuth)).get('/p');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.error.request_id).toBeTruthy();
  });

  it('bearer valide → req.auth peuplé', async () => {
    const t = await signAccessToken({ sub: '5', role: 'client_admin', client_id: 'acme' });
    const res = await request(appWith(requireAuth)).get('/p').set('Authorization', `Bearer ${t}`);
    expect(res.status).toBe(200);
    expect(res.body.auth).toEqual({ userId: 5, role: 'client_admin', clientId: 'acme' });
  });
});

describe('requireRole', () => {
  beforeEach(() => { process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!'; });

  it('mauvais rôle → 403', async () => {
    const t = await signAccessToken({ sub: '5', role: 'client_admin', client_id: 'acme' });
    const res = await request(appWith(requireAuth, requireRole('super_admin'))).get('/p').set('Authorization', `Bearer ${t}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('scopeToClient', () => {
  beforeEach(() => { process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!'; });

  it('client_admin : scope forcé sur son client (ignore la query)', async () => {
    const t = await signAccessToken({ sub: '5', role: 'client_admin', client_id: 'acme' });
    const res = await request(appWith(requireAuth, scopeToClient)).get('/p?client_id=other').set('Authorization', `Bearer ${t}`);
    expect(res.body.scoped).toBe('acme');
  });

  it('super_admin : scope pris de la query', async () => {
    const t = await signAccessToken({ sub: '1', role: 'super_admin', client_id: null });
    const res = await request(appWith(requireAuth, scopeToClient)).get('/p?client_id=acme').set('Authorization', `Bearer ${t}`);
    expect(res.body.scoped).toBe('acme');
  });
});
```

Créer `src/api/middleware/__tests__/rate-limit.test.ts` :

```typescript
import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRateLimiter } from '../rate-limit.js';
import { requestId } from '../context.js';
import { errorHandler } from '../error-handler.js';

function app() {
  const a = express();
  a.use(requestId);
  a.get('/p', createRateLimiter({ windowMs: 60_000, max: 2 }), (_req, res) => res.json({ ok: true }));
  a.use(errorHandler);
  return a;
}

describe('rate limiter', () => {
  it('bloque au-delà du max dans la fenêtre', async () => {
    const a = app();
    expect((await request(a).get('/p')).status).toBe(200);
    expect((await request(a).get('/p')).status).toBe(200);
    const third = await request(a).get('/p');
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
  });
});
```

- [ ] **Step 2: Ajouter supertest (devDep) + vérifier l'échec**

Run: `npm install -D supertest@^7.0.0 @types/supertest@^6.0.2`
Run: `npx vitest run src/api/middleware/`
Expected: FAIL (modules absents).

- [ ] **Step 3: Écrire `src/api/middleware/context.ts`**

```typescript
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      auth?: { userId: number; role: string; clientId: string | null };
      scopedClientId?: string;
    }
  }
}

export function requestId(req: Request, _res: Response, next: NextFunction): void {
  req.requestId = crypto.randomUUID();
  next();
}

/** CORS restreint à l'origine du back-office web. */
export function cors(origin: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  };
}

export {};
```

- [ ] **Step 4: Écrire `src/api/middleware/auth.ts`**

```typescript
import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../../core/auth/tokens.js';
import { unauthorized, forbidden } from '../errors.js';

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers['authorization'];
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) { next(unauthorized()); return; }
  void verifyAccessToken(token).then((claims) => {
    if (!claims) { next(unauthorized()); return; }
    req.auth = { userId: Number(claims.sub), role: claims.role, clientId: claims.client_id };
    next();
  });
}

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth || !roles.includes(req.auth.role)) { next(forbidden()); return; }
    next();
  };
}

export function scopeToClient(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) { next(forbidden()); return; }
  if (req.auth.role === 'super_admin') {
    const q = req.query['client_id'];
    if (typeof q === 'string' && q) req.scopedClientId = q;
    next();
    return;
  }
  // client_admin : scope forcé sur son propre client (anti-escalade)
  if (!req.auth.clientId) { next(forbidden()); return; }
  req.scopedClientId = req.auth.clientId;
  next();
}
```

- [ ] **Step 5: Écrire `src/api/middleware/rate-limit.ts`**

```typescript
import type { Request, Response, NextFunction } from 'express';
import { rateLimited } from '../errors.js';

interface Bucket { count: number; resetAt: number; }

/**
 * Limiteur fixed-window en mémoire (mono-instance). Pour un déploiement
 * multi-instance, remplacer le store par Redis (item futur).
 */
export function createRateLimiter(opts: { windowMs: number; max: number }) {
  const buckets = new Map<string, Bucket>();
  return (req: Request, _res: Response, next: NextFunction): void => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || now >= b.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }
    if (b.count >= opts.max) { next(rateLimited()); return; }
    b.count += 1;
    next();
  };
}
```

- [ ] **Step 6: Écrire `src/api/middleware/error-handler.ts`**

```typescript
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError, toErrorBody, validationError, internal, notFound } from '../errors.js';

export function notFoundHandler(req: Request, res: Response): void {
  const err = notFound('Endpoint introuvable.');
  res.status(err.status).json(toErrorBody(err, req.requestId));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let appErr: AppError;
  if (err instanceof ZodError) {
    appErr = validationError(err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  } else if (err instanceof AppError) {
    appErr = err;
  } else {
    console.error('[API] Unhandled error:', err);
    appErr = internal();
  }
  res.status(appErr.status).json(toErrorBody(appErr, req.requestId));
}
```

> NOTE : `_next` est requis pour qu'Express reconnaisse le handler d'erreur (signature à 4 args). Le commentaire `eslint-disable` suffit ; côté `tsc`, `noUnusedParameters` tolère le préfixe `_`.

- [ ] **Step 7: Vérifier le succès + tsc + suite**

Run: `npm run typecheck && npx vitest run src/api/`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/api/middleware/ src/api/middleware/__tests__/
git commit -m "feat(api): middlewares Express (contexte, auth/scope, rate-limit, erreurs)"
```

---

## Task 7: Router admin (endpoints auth + clients + invitations) + montage

**Files:**
- Create: `src/api/admin/router.ts`, `src/api/admin/routes/auth.ts`, `src/api/admin/routes/clients.ts`
- Modify: `src/index.ts`
- Test: `src/api/admin/__tests__/auth-routes.test.ts`, `src/api/admin/__tests__/clients-routes.test.ts`

**Interfaces:**
- Consumes: `express.Router`, `AuthService`, `AdminService`, middlewares, schémas `contracts`, `createMailer`, `getDatabase`/`Database`, `config`.
- Produces : `createAdminRouter(deps: { db: Database; authService: AuthService; adminService: AdminService }): express.Router` ; monté sous `/api/admin/v1` dans `index.ts`.

> NOTE implémenteur :
> - `createAdminRouter` applique, dans l'ordre : `cors(config.auth.webOrigin)`, `express.json()`, `requestId`, puis les sous-routers, puis `notFoundHandler`, puis `errorHandler` (toujours en dernier).
> - **Pattern de handler async** : envelopper chaque handler async dans un helper `wrap(fn)` qui `.catch(next)` (Express 5 propage les rejets de promesse, mais on reste explicite et portable). Fournir `wrap` dans `router.ts`.
> - Validation : `const body = LoginInput.parse(req.body)` — un `ZodError` levé est capté par `errorHandler` → 400 forme standard.
> - **auth routes** (toutes publiques sauf `me`) :
>   - `POST /auth/login` (rate-limited 10/min) → `authService.login` → 200 `AuthResult`.
>   - `POST /auth/refresh` → `authService.refresh` → 200.
>   - `POST /auth/logout` → `authService.logout` → 204.
>   - `POST /auth/accept-invite` → `authService.acceptInvite` → 200.
>   - `POST /auth/forgot-password` (rate-limited 5/min) → `authService.forgotPassword` → 204 (toujours, même si email inconnu).
>   - `POST /auth/reset-password` → `authService.resetPassword` → 204.
>   - `GET /auth/me` (`requireAuth`) → `authService.me(req.auth.userId)` → 200.
> - **clients routes** (`requireAuth` + `requireRole('super_admin')`) :
>   - `GET /clients` → `adminService.listClients`.
>   - `POST /clients` → `CreateClientInput.parse` → `adminService.createClient` → 201.
>   - `PATCH /clients/:clientId` → `UpdateClientInput.parse` → `adminService.updateClient` → 200.
>   - `GET /clients/:clientId/invitations` → `adminService.listInvitations`.
>   - `POST /clients/:clientId/invitations` → `CreateInvitationInput.parse` → `adminService.createInvitation(clientId, email, role)` → 201.
>   - `DELETE /clients/:clientId/invitations/:id` → `adminService.revokeInvitation(clientId, Number(id))` → 204.
> - `index.ts` : dans `main()`, après `initCrmBridge()`, construire `const mailer = createMailer(); const db = getDatabase(); const authService = new AuthService({ db, mailer }); const adminService = new AdminService({ db, mailer });` puis `app.use('/api/admin/v1', createAdminRouter({ db, authService, adminService }));`. Ajouter un log `[Server] Admin API: /api/admin/v1`.

- [ ] **Step 1: Écrire les tests d'intégration (échec attendu)**

Créer `src/api/admin/__tests__/auth-routes.test.ts` :

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSqliteDriver } from '../../../core/database/sqlite.js';
import type { Database } from '../../../core/database/types.js';
import { AuthService } from '../../../core/auth/auth-service.js';
import { AdminService } from '../../../core/auth/admin-service.js';
import type { Mailer } from '../../../core/auth/mailer.js';
import { hashPassword } from '../../../core/auth/passwords.js';
import { createAdminRouter } from '../router.js';

class FakeMailer implements Mailer {
  invites: Array<{ to: string; link: string }> = [];
  resets: Array<{ to: string; link: string }> = [];
  async sendInvitation(to: string, link: string) { this.invites.push({ to, link }); }
  async sendPasswordReset(to: string, link: string) { this.resets.push({ to, link }); }
}

function makeApp(db: Database, mailer: Mailer) {
  const authService = new AuthService({ db, mailer });
  const adminService = new AdminService({ db, mailer });
  const app = express();
  app.use('/api/admin/v1', createAdminRouter({ db, authService, adminService }));
  return app;
}

describe('auth routes', () => {
  let db: Database;
  let mailer: FakeMailer;
  let app: express.Express;

  beforeEach(async () => {
    process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!';
    process.env['ADMIN_BCRYPT_ROUNDS'] = '4';
    db = createSqliteDriver(':memory:');
    mailer = new FakeMailer();
    app = makeApp(db, mailer);
    await db.createUser({ email: 'root@flowlabs.test', password_hash: await hashPassword('motdepasse123'), role: 'super_admin', client_id: null, status: 'active' });
  });

  it('login → 200 + tokens, puis GET /me avec le bearer', async () => {
    const login = await request(app).post('/api/admin/v1/auth/login').send({ email: 'root@flowlabs.test', password: 'motdepasse123' });
    expect(login.status).toBe(200);
    expect(login.body.access_token).toBeTruthy();
    const me = await request(app).get('/api/admin/v1/auth/me').set('Authorization', `Bearer ${login.body.access_token}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('root@flowlabs.test');
  });

  it('login payload invalide → 400 forme standard', async () => {
    const res = await request(app).post('/api/admin/v1/auth/login').send({ email: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.request_id).toBeTruthy();
  });

  it('login mauvais mdp → 401', async () => {
    const res = await request(app).post('/api/admin/v1/auth/login').send({ email: 'root@flowlabs.test', password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /me sans token → 401', async () => {
    expect((await request(app).get('/api/admin/v1/auth/me')).status).toBe(401);
  });

  it('refresh → nouveau token ; ancien invalide', async () => {
    const login = await request(app).post('/api/admin/v1/auth/login').send({ email: 'root@flowlabs.test', password: 'motdepasse123' });
    const r2 = await request(app).post('/api/admin/v1/auth/refresh').send({ refresh_token: login.body.refresh_token });
    expect(r2.status).toBe(200);
    const reuse = await request(app).post('/api/admin/v1/auth/refresh').send({ refresh_token: login.body.refresh_token });
    expect(reuse.status).toBe(401);
  });

  it('endpoint inconnu → 404 forme standard', async () => {
    const res = await request(app).get('/api/admin/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
```

Créer `src/api/admin/__tests__/clients-routes.test.ts` :

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSqliteDriver } from '../../../core/database/sqlite.js';
import type { Database } from '../../../core/database/types.js';
import { AuthService } from '../../../core/auth/auth-service.js';
import { AdminService } from '../../../core/auth/admin-service.js';
import type { Mailer } from '../../../core/auth/mailer.js';
import { hashPassword } from '../../../core/auth/passwords.js';
import { createAdminRouter } from '../router.js';

class FakeMailer implements Mailer {
  invites: Array<{ to: string; link: string }> = [];
  async sendInvitation(to: string, link: string) { this.invites.push({ to, link }); }
  async sendPasswordReset() {}
}

async function bearer(app: express.Express, email: string, password: string): Promise<string> {
  const r = await request(app).post('/api/admin/v1/auth/login').send({ email, password });
  return r.body.access_token as string;
}

describe('clients routes (super_admin)', () => {
  let db: Database;
  let mailer: FakeMailer;
  let app: express.Express;

  beforeEach(async () => {
    process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!';
    process.env['ADMIN_BCRYPT_ROUNDS'] = '4';
    db = createSqliteDriver(':memory:');
    mailer = new FakeMailer();
    const authService = new AuthService({ db, mailer });
    const adminService = new AdminService({ db, mailer });
    app = express();
    app.use('/api/admin/v1', createAdminRouter({ db, authService, adminService }));
    await db.createUser({ email: 'root@flowlabs.test', password_hash: await hashPassword('motdepasse123'), role: 'super_admin', client_id: null, status: 'active' });
    await db.createUser({ email: 'ca@acme.test', password_hash: await hashPassword('motdepasse123'), role: 'client_admin', client_id: 'acme', status: 'active' });
  });

  it('super_admin crée un client puis l\'invitation', async () => {
    const tok = await bearer(app, 'root@flowlabs.test', 'motdepasse123');
    const c = await request(app).post('/api/admin/v1/clients').set('Authorization', `Bearer ${tok}`).send({ client_id: 'acme', name: 'Acme' });
    expect(c.status).toBe(201);
    const inv = await request(app).post('/api/admin/v1/clients/acme/invitations').set('Authorization', `Bearer ${tok}`).send({ email: 'new@acme.test', role: 'client_admin' });
    expect(inv.status).toBe(201);
    expect(mailer.invites).toHaveLength(1);
    const list = await request(app).get('/api/admin/v1/clients/acme/invitations').set('Authorization', `Bearer ${tok}`);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].token_hash).toBeUndefined();
  });

  it('client_admin ne peut pas accéder aux routes clients → 403', async () => {
    const tok = await bearer(app, 'ca@acme.test', 'motdepasse123');
    expect((await request(app).get('/api/admin/v1/clients').set('Authorization', `Bearer ${tok}`)).status).toBe(403);
  });

  it('création de client en doublon → 409', async () => {
    const tok = await bearer(app, 'root@flowlabs.test', 'motdepasse123');
    await request(app).post('/api/admin/v1/clients').set('Authorization', `Bearer ${tok}`).send({ client_id: 'acme', name: 'Acme' });
    const dup = await request(app).post('/api/admin/v1/clients').set('Authorization', `Bearer ${tok}`).send({ client_id: 'acme', name: 'Acme2' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CONFLICT');
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/api/admin/`
Expected: FAIL.

- [ ] **Step 3: Écrire `src/api/admin/routes/auth.ts`**

```typescript
import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { AuthService } from '../../../core/auth/auth-service.js';
import { LoginInput, RefreshInput, LogoutInput, AcceptInviteInput, ForgotPasswordInput, ResetPasswordInput } from '../../../contracts/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { createRateLimiter } from '../../middleware/rate-limit.js';
import { unauthorized } from '../../errors.js';

export function authRoutes(authService: AuthService, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router();
  const loginLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });
  const forgotLimiter = createRateLimiter({ windowMs: 60_000, max: 5 });

  r.post('/login', loginLimiter, wrap(async (req, res) => {
    const body = LoginInput.parse(req.body);
    res.json(await authService.login(body.email, body.password));
  }));

  r.post('/refresh', wrap(async (req, res) => {
    const body = RefreshInput.parse(req.body);
    res.json(await authService.refresh(body.refresh_token));
  }));

  r.post('/logout', wrap(async (req, res) => {
    const body = LogoutInput.parse(req.body);
    await authService.logout(body.refresh_token);
    res.sendStatus(204);
  }));

  r.post('/accept-invite', wrap(async (req, res) => {
    const body = AcceptInviteInput.parse(req.body);
    res.json(await authService.acceptInvite(body.token, body.password));
  }));

  r.post('/forgot-password', forgotLimiter, wrap(async (req, res) => {
    const body = ForgotPasswordInput.parse(req.body);
    await authService.forgotPassword(body.email);
    res.sendStatus(204);
  }));

  r.post('/reset-password', wrap(async (req, res) => {
    const body = ResetPasswordInput.parse(req.body);
    await authService.resetPassword(body.token, body.password);
    res.sendStatus(204);
  }));

  r.get('/me', requireAuth, wrap(async (req, res) => {
    if (!req.auth) throw unauthorized();
    res.json(await authService.me(req.auth.userId));
  }));

  return r;
}
```

- [ ] **Step 4: Écrire `src/api/admin/routes/clients.ts`**

```typescript
import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { AdminService } from '../../../core/auth/admin-service.js';
import { CreateClientInput, UpdateClientInput, CreateInvitationInput } from '../../../contracts/index.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';

export function clientsRoutes(adminService: AdminService, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router();
  r.use(requireAuth, requireRole('super_admin'));

  r.get('/', wrap(async (_req, res) => {
    res.json(await adminService.listClients());
  }));

  r.post('/', wrap(async (req, res) => {
    const body = CreateClientInput.parse(req.body);
    res.status(201).json(await adminService.createClient(body));
  }));

  r.patch('/:clientId', wrap(async (req, res) => {
    const body = UpdateClientInput.parse(req.body);
    res.json(await adminService.updateClient(req.params.clientId!, body));
  }));

  r.get('/:clientId/invitations', wrap(async (req, res) => {
    res.json(await adminService.listInvitations(req.params.clientId!));
  }));

  r.post('/:clientId/invitations', wrap(async (req, res) => {
    const body = CreateInvitationInput.parse(req.body);
    res.status(201).json(await adminService.createInvitation(req.params.clientId!, body.email, body.role));
  }));

  r.delete('/:clientId/invitations/:id', wrap(async (req, res) => {
    await adminService.revokeInvitation(req.params.clientId!, Number(req.params.id));
    res.sendStatus(204);
  }));

  return r;
}
```

- [ ] **Step 5: Écrire `src/api/admin/router.ts`**

```typescript
import express, { Router } from 'express';
import type { RequestHandler } from 'express';
import type { Database } from '../../core/database/types.js';
import type { AuthService } from '../../core/auth/auth-service.js';
import type { AdminService } from '../../core/auth/admin-service.js';
import { config } from '../../core/config.js';
import { cors, requestId } from '../middleware/context.js';
import { errorHandler, notFoundHandler } from '../middleware/error-handler.js';
import { authRoutes } from './routes/auth.js';
import { clientsRoutes } from './routes/clients.js';

export interface AdminRouterDeps {
  db: Database;
  authService: AuthService;
  adminService: AdminService;
}

/** Enveloppe un handler async pour propager les rejets vers errorHandler. */
const wrap = (fn: RequestHandler): RequestHandler => (req, res, next) => {
  void Promise.resolve(fn(req, res, next)).catch(next);
};

export function createAdminRouter(deps: AdminRouterDeps): Router {
  const r = Router();
  r.use(cors(config.auth.webOrigin));
  r.use(express.json({ limit: '256kb' }));
  r.use(requestId);

  r.use('/auth', authRoutes(deps.authService, wrap));
  r.use('/clients', clientsRoutes(deps.adminService, wrap));

  r.use(notFoundHandler);
  r.use(errorHandler);
  return r;
}
```

- [ ] **Step 6: Lancer les tests d'intégration**

Run: `npx vitest run src/api/admin/`
Expected: PASS.

- [ ] **Step 7: Monter le router dans `src/index.ts`**

Ajouter les imports en tête :

```typescript
import { createAdminRouter } from './api/admin/router.js';
import { AuthService } from './core/auth/auth-service.js';
import { AdminService } from './core/auth/admin-service.js';
import { createMailer } from './core/auth/mailer.js';
```

Dans `main()`, après `await initCrmBridge();` et avant `app.listen(...)` :

```typescript
  const mailer = createMailer();
  const adminDb = getDatabase();
  const authService = new AuthService({ db: adminDb, mailer });
  const adminService = new AdminService({ db: adminDb, mailer });
  app.use('/api/admin/v1', createAdminRouter({ db: adminDb, authService, adminService }));
```

Ajouter dans le bloc de logs de `app.listen` :

```typescript
    console.log(`[Server] Admin API: /api/admin/v1`);
```

- [ ] **Step 8: Vérifier `tsc` + suite complète**

Run: `npm run typecheck && npm test`
Expected: `tsc` propre, toute la suite verte.

- [ ] **Step 9: Commit**

```bash
git add src/api/admin/ src/index.ts
git commit -m "feat(api): router admin /api/admin/v1 (auth + clients + invitations) monté"
```

---

## Self-Review (rempli par l'auteur du plan)

**1. Couverture du spec (section 6 + 10.3) :**
- users/invitations/auth_sessions → Task 1 (+ password_resets justifié). ✅
- JWT + middlewares (requireAuth/requireRole/scopeToClient) → Tasks 3, 6. ✅
- contracts Zod → Task 2. ✅
- Mailer → Task 4. ✅
- endpoints auth (login/refresh/logout/accept-invite/forgot/reset/me) → Task 7. ✅
- endpoints clients (CRUD) + invitations (créer/lister/révoquer) → Task 7. ✅
- forme d'erreur unique + codes stables → Task 2 + Task 6. ✅
- rate-limit login/forgot → Tasks 6-7. ✅
- secrets jamais renvoyés / refresh haché / rotation → Tasks 1, 3, 4. ✅
- CORS restreint → Task 6-7. ✅
- bootstrap super_admin → Task 5 (hors spec, nécessaire). ✅
- **Hors périmètre Plan 3 (différé Plan 4)** : bots/numbers/mappings/credentials/transport-validate/crm-validate/llm/simulate/leads/health/metrics/usage/audit_log. Codes `WA_/CRM_VALIDATION_FAILED` définis dès maintenant dans `ErrorCode` (anticipation) mais non utilisés ici.

**2. Placeholders :** aucun TODO/TBD ; tout le code est fourni.

**3. Cohérence des types :** `AccessClaims` (tokens) ↔ `req.auth` (middleware) ↔ claims JWT alignés (`sub`/`role`/`client_id`). `hashRefreshToken` réutilisé pour invitations + resets (token opaque → hash sha256, cohérent). `PublicUser`/`AuthResult`/`InvitationPublic` cohérents service↔routes. Email normalisé une seule fois (transform Zod) ; les services reçoivent déjà l'email en minuscules via les schémas, et `getUserByEmail` est appelé avec cet email normalisé.

**Note d'exécution (anticipation Plan 4) :** le router est conçu pour accueillir un sous-router `bots` (Plan 4) sous le même `createAdminRouter` ; `scopeToClient` y sera appliqué. Le `ConfigStore` (Plan 1) sera injecté dans un `BotService` au Plan 4, même patron que `AuthService`/`AdminService`.

---

## Execution Handoff

Plan complet et sauvegardé. Deux options d'exécution :
1. **Subagent-Driven (recommandé)** — un subagent frais par task, revue spec+qualité entre chaque, revue finale opus.
2. **Inline** — exécution dans cette session avec checkpoints.
