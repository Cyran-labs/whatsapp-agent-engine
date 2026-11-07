// Module « comptes » du driver SQLite : schéma (tables + ensure-column) et méthodes AccountsStore.

import type BetterSqlite3 from 'better-sqlite3';
import type { AccountsStore, EntityRecord, EntityStatus, MembershipGrantRecord, MembershipRecord, MembershipRole, MembershipStatus } from './accounts-types.js';
import type { InvitationRecord, UserRecord } from './types.js';

type SqliteDb = BetterSqlite3.Database;

const ACCOUNTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS agencies (
    agency_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_entities_client ON entities(client_id);
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_entities_active_name ON entities(client_id, name) WHERE status = 'active';

  CREATE TABLE IF NOT EXISTS memberships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    client_id TEXT NOT NULL,
    entity_id INTEGER,
    role TEXT NOT NULL CHECK (role IN ('admin', 'super_manager', 'manager', 'advisor')),
    read_only INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    CHECK ((entity_id IS NULL) = (role IN ('admin', 'super_manager'))),
    CHECK (read_only = 0 OR role = 'super_manager')
  );
  CREATE INDEX IF NOT EXISTS idx_memberships_user_client ON memberships(user_id, client_id);
  CREATE INDEX IF NOT EXISTS idx_memberships_client ON memberships(client_id);
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_memberships_scope ON memberships(user_id, client_id, COALESCE(entity_id, 0));
`;

function ensureColumn(db: SqliteDb, table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

/** Crée les tables du module comptes et ajoute les colonnes aux tables existantes (idempotent). */
export function ensureSqliteAccountsSchema(db: SqliteDb): void {
  db.exec(ACCOUNTS_SCHEMA);
  ensureColumn(db, 'bots', 'entity_id', 'INTEGER');
  ensureColumn(db, 'clients', 'agency_id', 'TEXT');
  ensureColumn(db, 'clients', 'settings', 'TEXT');
  ensureColumn(db, 'invitations', 'grants', 'TEXT');
}

/** Colonnes lues pour un InvitationRecord (partagées avec sqlite.ts). */
export const SQLITE_INVITATION_COLUMNS = 'id, email, client_id, role, token_hash, expires_at, accepted_at, created_at, grants';

export interface SqliteInvitationRow extends Omit<InvitationRecord, 'grants'> {
  grants: string | null;
}

export function rowToInvitationRecord(row: SqliteInvitationRow): InvitationRecord {
  return { ...row, grants: row.grants == null ? null : (JSON.parse(row.grants) as MembershipGrantRecord[]) };
}

interface MembershipRow {
  id: number;
  user_id: number;
  client_id: string;
  entity_id: number | null;
  role: MembershipRole;
  read_only: number;
  status: MembershipStatus;
}

const MEMBERSHIP_COLUMNS = 'id, user_id, client_id, entity_id, role, read_only, status';
const ENTITY_COLUMNS = 'id, client_id, name, status, created_at, updated_at';
const USER_COLUMNS = 'id, email, password_hash, role, client_id, status, created_at, updated_at';

function rowToMembership(row: MembershipRow): MembershipRecord {
  return { ...row, read_only: row.read_only === 1 };
}

function parseSettings(raw: string | null | undefined): Record<string, unknown> {
  if (raw == null) return {};
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

export function createSqliteAccountsStore(db: SqliteDb): AccountsStore {
  return {
    async listEntities(clientId: string, opts?: { includeArchived?: boolean }): Promise<EntityRecord[]> {
      const statusSql = opts?.includeArchived ? '' : ` AND status = 'active'`;
      return db.prepare(
        `SELECT ${ENTITY_COLUMNS} FROM entities WHERE client_id = ?${statusSql} ORDER BY id`
      ).all(clientId) as EntityRecord[];
    },

    async getEntity(clientId: string, id: number): Promise<EntityRecord | undefined> {
      return db.prepare(
        `SELECT ${ENTITY_COLUMNS} FROM entities WHERE client_id = ? AND id = ?`
      ).get(clientId, id) as EntityRecord | undefined;
    },

    async createEntity(clientId: string, name: string): Promise<EntityRecord> {
      const info = db.prepare('INSERT INTO entities (client_id, name) VALUES (?, ?)').run(clientId, name);
      return db.prepare(`SELECT ${ENTITY_COLUMNS} FROM entities WHERE id = ?`).get(Number(info.lastInsertRowid)) as EntityRecord;
    },

    async updateEntity(clientId: string, id: number, patch: { name?: string; status?: EntityStatus }): Promise<void> {
      const sets: string[] = [];
      const params: string[] = [];
      if (patch.name !== undefined) { sets.push('name = ?'); params.push(patch.name); }
      if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
      if (sets.length === 0) return;
      db.prepare(
        `UPDATE entities SET ${sets.join(', ')}, updated_at = datetime('now') WHERE client_id = ? AND id = ?`
      ).run(...params, clientId, id);
    },

    async countEntityUsage(clientId: string, entityId: number): Promise<{ bots: number; activeMembers: number }> {
      const bots = (db.prepare(
        'SELECT COUNT(*) AS n FROM bots WHERE client_id = ? AND entity_id = ?'
      ).get(clientId, entityId) as { n: number }).n;
      const activeMembers = (db.prepare(
        `SELECT COUNT(*) AS n FROM memberships WHERE client_id = ? AND entity_id = ? AND status = 'active'`
      ).get(clientId, entityId) as { n: number }).n;
      return { bots, activeMembers };
    },

    async listUserMemberships(userId: number, clientId?: string): Promise<MembershipRecord[]> {
      const rows = clientId === undefined
        ? db.prepare(`SELECT ${MEMBERSHIP_COLUMNS} FROM memberships WHERE user_id = ? ORDER BY id`).all(userId)
        : db.prepare(`SELECT ${MEMBERSHIP_COLUMNS} FROM memberships WHERE user_id = ? AND client_id = ? ORDER BY id`).all(userId, clientId);
      return (rows as MembershipRow[]).map(rowToMembership);
    },

    async listOrgMemberships(clientId: string): Promise<MembershipRecord[]> {
      const rows = db.prepare(
        `SELECT ${MEMBERSHIP_COLUMNS} FROM memberships WHERE client_id = ? ORDER BY user_id, id`
      ).all(clientId) as MembershipRow[];
      return rows.map(rowToMembership);
    },

    async replaceMemberships(userId: number, clientId: string, grants: MembershipGrantRecord[], status: MembershipStatus = 'active'): Promise<void> {
      const tx = db.transaction((items: MembershipGrantRecord[]) => {
        db.prepare('DELETE FROM memberships WHERE user_id = ? AND client_id = ?').run(userId, clientId);
        const ins = db.prepare(
          `INSERT INTO memberships (user_id, client_id, entity_id, role, read_only, status) VALUES (?, ?, ?, ?, ?, ?)`
        );
        for (const g of items) {
          ins.run(userId, clientId, g.entity_id, g.role, g.read_only === true ? 1 : 0, status);
        }
      });
      tx(grants);
    },

    async setMembershipsStatus(userId: number, clientId: string, status: MembershipStatus): Promise<void> {
      db.prepare(
        `UPDATE memberships SET status = ?, updated_at = datetime('now') WHERE user_id = ? AND client_id = ?`
      ).run(status, userId, clientId);
    },

    async listUserOrganizations(userId: number): Promise<{ client_id: string; name: string }[]> {
      return db.prepare(
        `SELECT c.client_id, c.name FROM clients c
         WHERE EXISTS (
           SELECT 1 FROM memberships m WHERE m.client_id = c.client_id AND m.user_id = ? AND m.status = 'active'
         )
         ORDER BY c.name, c.client_id`
      ).all(userId) as { client_id: string; name: string }[];
    },

    async getClientSettings(clientId: string): Promise<Record<string, unknown>> {
      const row = db.prepare('SELECT settings FROM clients WHERE client_id = ?').get(clientId) as { settings: string | null } | undefined;
      return parseSettings(row?.settings);
    },

    async setClientSettings(clientId: string, settings: Record<string, unknown>): Promise<void> {
      db.prepare(
        `UPDATE clients SET settings = ?, updated_at = datetime('now') WHERE client_id = ?`
      ).run(JSON.stringify(settings), clientId);
    },

    async setBotEntity(clientId: string, botId: string, entityId: number): Promise<void> {
      db.prepare(
        `UPDATE bots SET entity_id = ?, updated_at = datetime('now') WHERE client_id = ? AND bot_id = ?`
      ).run(entityId, clientId, botId);
    },

    async setUserRole(userId: number, role: string): Promise<void> {
      db.prepare(`UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?`).run(role, userId);
    },

    async listUsersByRole(role: string): Promise<UserRecord[]> {
      return db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE role = ? ORDER BY id`).all(role) as UserRecord[];
    },

    async listPendingInvitationsByEmail(email: string): Promise<InvitationRecord[]> {
      const rows = db.prepare(
        `SELECT ${SQLITE_INVITATION_COLUMNS} FROM invitations
         WHERE email = ? AND accepted_at IS NULL AND julianday(expires_at) > julianday('now')
         ORDER BY created_at ASC, id ASC`
      ).all(email) as SqliteInvitationRow[];
      return rows.map(rowToInvitationRecord);
    },

    async refreshInvitationToken(id: number, tokenHash: string, expiresAt: string): Promise<void> {
      db.prepare('UPDATE invitations SET token_hash = ?, expires_at = ? WHERE id = ?').run(tokenHash, expiresAt, id);
    },

    async listUnmigratedInvitations(): Promise<InvitationRecord[]> {
      const rows = db.prepare(
        `SELECT ${SQLITE_INVITATION_COLUMNS} FROM invitations WHERE grants IS NULL ORDER BY id`
      ).all() as SqliteInvitationRow[];
      return rows.map(rowToInvitationRecord);
    },

    async setInvitationGrants(id: number, grants: MembershipGrantRecord[]): Promise<void> {
      db.prepare('UPDATE invitations SET grants = ? WHERE id = ?').run(JSON.stringify(grants), id);
    },
  };
}
