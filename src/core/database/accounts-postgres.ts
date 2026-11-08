// Module « comptes » du driver PostgreSQL : schéma (tables + ensure-column) et méthodes AccountsStore.
// Symétrique de accounts-sqlite.ts : grants et settings en JSONB, read_only en BOOLEAN.

import type pg from 'pg';
import type { AccountsStore, EntityRecord, EntityStatus, MembershipGrantRecord, MembershipRecord, MembershipStatus } from './accounts-types.js';
import type { InvitationRecord, UserRecord } from './types.js';

const ACCOUNTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS agencies (
    agency_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS entities (
    id SERIAL PRIMARY KEY,
    client_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_entities_client ON entities(client_id);
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_entities_active_name ON entities(client_id, name) WHERE status = 'active';

  CREATE TABLE IF NOT EXISTS memberships (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    client_id TEXT NOT NULL,
    entity_id INTEGER,
    role TEXT NOT NULL CHECK (role IN ('admin', 'super_manager', 'manager', 'advisor')),
    read_only BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK ((entity_id IS NULL) = (role IN ('admin', 'super_manager'))),
    CHECK (NOT read_only OR role = 'super_manager')
  );
  CREATE INDEX IF NOT EXISTS idx_memberships_user_client ON memberships(user_id, client_id);
  CREATE INDEX IF NOT EXISTS idx_memberships_client ON memberships(client_id);
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_memberships_scope ON memberships(user_id, client_id, COALESCE(entity_id, 0));
`;

/** Crée les tables du module comptes et ajoute les colonnes aux tables existantes (idempotent). */
export async function ensurePostgresAccountsSchema(pool: pg.Pool): Promise<void> {
  await pool.query(ACCOUNTS_SCHEMA);
  await pool.query('ALTER TABLE bots ADD COLUMN IF NOT EXISTS entity_id INTEGER');
  await pool.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS agency_id TEXT');
  await pool.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS settings JSONB');
  await pool.query('ALTER TABLE invitations ADD COLUMN IF NOT EXISTS grants JSONB');
}

/**
 * Lit une colonne TIMESTAMPTZ en ISO 8601 UTC (`2099-06-01T00:00:00.000Z`), comme SQLite
 * qui rend telle quelle la chaîne ISO écrite. `::text` suivrait le fuseau de la session.
 */
export function pgIso(column: string): string {
  return `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ${column}`;
}

/** Colonnes lues pour un InvitationRecord (partagées avec postgres.ts). */
export const PG_INVITATION_COLUMNS =
  `id, email, client_id, role, token_hash, ${pgIso('expires_at')}, ${pgIso('accepted_at')}, created_at::text, grants`;

const MEMBERSHIP_COLUMNS = 'id, user_id, client_id, entity_id, role, read_only, status';
const ENTITY_COLUMNS = 'id, client_id, name, status, created_at::text, updated_at::text';
const USER_COLUMNS = 'id, email, password_hash, role, client_id, status, created_at::text, updated_at::text';

function asSettings(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

export function createPostgresAccountsStore(pool: pg.Pool): AccountsStore {
  return {
    async listEntities(clientId: string, opts?: { includeArchived?: boolean }): Promise<EntityRecord[]> {
      const statusSql = opts?.includeArchived ? '' : ` AND status = 'active'`;
      const r = await pool.query(
        `SELECT ${ENTITY_COLUMNS} FROM entities WHERE client_id = $1${statusSql} ORDER BY id`,
        [clientId]
      );
      return r.rows as EntityRecord[];
    },

    async getEntity(clientId: string, id: number): Promise<EntityRecord | undefined> {
      const r = await pool.query(
        `SELECT ${ENTITY_COLUMNS} FROM entities WHERE client_id = $1 AND id = $2`,
        [clientId, id]
      );
      return r.rows[0] as EntityRecord | undefined;
    },

    async createEntity(clientId: string, name: string): Promise<EntityRecord> {
      const r = await pool.query(
        `INSERT INTO entities (client_id, name) VALUES ($1, $2) RETURNING ${ENTITY_COLUMNS}`,
        [clientId, name]
      );
      return r.rows[0] as EntityRecord;
    },

    async updateEntity(clientId: string, id: number, patch: { name?: string; status?: EntityStatus }): Promise<void> {
      const sets: string[] = [];
      const params: (string | number)[] = [];
      if (patch.name !== undefined) { params.push(patch.name); sets.push(`name = $${params.length}`); }
      if (patch.status !== undefined) { params.push(patch.status); sets.push(`status = $${params.length}`); }
      if (sets.length === 0) return;
      params.push(clientId, id);
      await pool.query(
        `UPDATE entities SET ${sets.join(', ')}, updated_at = NOW()
         WHERE client_id = $${params.length - 1} AND id = $${params.length}`,
        params
      );
    },

    async countEntityUsage(clientId: string, entityId: number): Promise<{ bots: number; activeMembers: number }> {
      const bots = await pool.query(
        'SELECT COUNT(*)::int AS n FROM bots WHERE client_id = $1 AND entity_id = $2',
        [clientId, entityId]
      );
      const members = await pool.query(
        `SELECT COUNT(*)::int AS n FROM memberships WHERE client_id = $1 AND entity_id = $2 AND status = 'active'`,
        [clientId, entityId]
      );
      return {
        bots: (bots.rows[0] as { n: number }).n,
        activeMembers: (members.rows[0] as { n: number }).n,
      };
    },

    async listUserMemberships(userId: number, clientId?: string): Promise<MembershipRecord[]> {
      const r = clientId === undefined
        ? await pool.query(`SELECT ${MEMBERSHIP_COLUMNS} FROM memberships WHERE user_id = $1 ORDER BY id`, [userId])
        : await pool.query(
          `SELECT ${MEMBERSHIP_COLUMNS} FROM memberships WHERE user_id = $1 AND client_id = $2 ORDER BY id`,
          [userId, clientId]
        );
      return r.rows as MembershipRecord[];
    },

    async listOrgMemberships(clientId: string): Promise<MembershipRecord[]> {
      const r = await pool.query(
        `SELECT ${MEMBERSHIP_COLUMNS} FROM memberships WHERE client_id = $1 ORDER BY user_id, id`,
        [clientId]
      );
      return r.rows as MembershipRecord[];
    },

    async replaceMemberships(userId: number, clientId: string, grants: MembershipGrantRecord[], status: MembershipStatus = 'active'): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Verrou transactionnel sur (organisation, utilisateur) : deux remplacements concurrents
        // s'exécutent l'un après l'autre (sinon DELETE puis INSERT entrelacés : doublons ou
        // violation d'unicité). Libéré au COMMIT ou au ROLLBACK.
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtext($1::text || ':' || $2::text))`,
          [clientId, String(userId)]
        );
        await client.query('DELETE FROM memberships WHERE user_id = $1 AND client_id = $2', [userId, clientId]);
        for (const g of grants) {
          await client.query(
            `INSERT INTO memberships (user_id, client_id, entity_id, role, read_only, status)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [userId, clientId, g.entity_id, g.role, g.read_only === true, status]
          );
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },

    async setMembershipsStatus(userId: number, clientId: string, status: MembershipStatus): Promise<void> {
      await pool.query(
        'UPDATE memberships SET status = $1, updated_at = NOW() WHERE user_id = $2 AND client_id = $3',
        [status, userId, clientId]
      );
    },

    async listUserOrganizations(userId: number): Promise<{ client_id: string; name: string }[]> {
      const r = await pool.query(
        `SELECT c.client_id, c.name FROM clients c
         WHERE EXISTS (
           SELECT 1 FROM memberships m WHERE m.client_id = c.client_id AND m.user_id = $1 AND m.status = 'active'
         )
         ORDER BY c.name, c.client_id`,
        [userId]
      );
      return r.rows as { client_id: string; name: string }[];
    },

    async getClientSettings(clientId: string): Promise<Record<string, unknown>> {
      const r = await pool.query('SELECT settings FROM clients WHERE client_id = $1', [clientId]);
      const row = r.rows[0] as { settings: unknown } | undefined;
      return asSettings(row?.settings);
    },

    async setClientSettings(clientId: string, settings: Record<string, unknown>): Promise<void> {
      await pool.query(
        'UPDATE clients SET settings = $1::jsonb, updated_at = NOW() WHERE client_id = $2',
        [JSON.stringify(settings), clientId]
      );
    },

    async setBotEntity(clientId: string, botId: string, entityId: number): Promise<void> {
      await pool.query(
        'UPDATE bots SET entity_id = $1, updated_at = NOW() WHERE client_id = $2 AND bot_id = $3',
        [entityId, clientId, botId]
      );
    },

    async setUserRole(userId: number, role: string): Promise<void> {
      await pool.query('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2', [role, userId]);
    },

    async listUsersByRole(role: string): Promise<UserRecord[]> {
      const r = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE role = $1 ORDER BY id`, [role]);
      return r.rows as UserRecord[];
    },

    async listPendingInvitationsByEmail(email: string): Promise<InvitationRecord[]> {
      const r = await pool.query(
        `SELECT ${PG_INVITATION_COLUMNS} FROM invitations
         WHERE email = $1 AND accepted_at IS NULL AND expires_at > NOW()
         ORDER BY created_at ASC, id ASC`,
        [email]
      );
      return r.rows as InvitationRecord[];
    },

    async refreshInvitationToken(id: number, tokenHash: string, expiresAt: string): Promise<void> {
      await pool.query(
        'UPDATE invitations SET token_hash = $1, expires_at = $2 WHERE id = $3',
        [tokenHash, expiresAt, id]
      );
    },

    async listUnmigratedInvitations(): Promise<InvitationRecord[]> {
      const r = await pool.query(`SELECT ${PG_INVITATION_COLUMNS} FROM invitations WHERE grants IS NULL ORDER BY id`);
      return r.rows as InvitationRecord[];
    },

    async setInvitationGrants(id: number, grants: MembershipGrantRecord[]): Promise<void> {
      await pool.query('UPDATE invitations SET grants = $1::jsonb WHERE id = $2', [JSON.stringify(grants), id]);
    },
  };
}
