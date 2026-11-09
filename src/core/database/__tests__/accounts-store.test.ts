import fs from 'fs';
import os from 'os';
import path from 'path';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../sqlite.js';
import { createTestDatabase } from '../../../test-support/test-database.js';
import type { BotRecord, Database } from '../types.js';

function baseBot(over: Partial<BotRecord> = {}): BotRecord {
  return {
    client_id: 'acme', bot_id: 'b1', name: 'Agent', status: 'draft',
    status_reason: null,
    default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'Agent.' },
    lead_fields: '', welcome: { enabled: false, message: {} }, error_messages: {},
    catalog: null, llm: null, crm: null, personality: null, entity_id: null, ...over,
  };
}

async function seedUser(db: Database, email: string): Promise<number> {
  const u = await db.createUser({ email, password_hash: 'h', role: 'member', client_id: null, status: 'active' });
  return u.id;
}

describe('accounts store', () => {
  let db: Database;
  beforeEach(async () => {
    db = await createTestDatabase();
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.upsertClient({ client_id: 'other', name: 'Other', status: 'active' });
  });
  afterEach(async () => { await db.close(); });

  describe('entités', () => {
    it('createEntity puis listEntities renvoie l\'entité', async () => {
      const e = await db.createEntity('acme', 'Siège');
      expect(e.id).toBeGreaterThan(0);
      expect(e).toMatchObject({ client_id: 'acme', name: 'Siège', status: 'active' });
      expect(typeof e.created_at).toBe('string');
      expect(typeof e.updated_at).toBe('string');
      const list = await db.listEntities('acme');
      expect(list.map((x) => x.id)).toEqual([e.id]);
      expect(await db.listEntities('other')).toEqual([]);
    });

    it('includeArchived false masque une entité archivée, true la montre', async () => {
      const a = await db.createEntity('acme', 'Nord');
      const b = await db.createEntity('acme', 'Sud');
      await db.updateEntity('acme', b.id, { status: 'archived' });
      expect((await db.listEntities('acme')).map((x) => x.id)).toEqual([a.id]);
      expect((await db.listEntities('acme', { includeArchived: false })).map((x) => x.id)).toEqual([a.id]);
      expect((await db.listEntities('acme', { includeArchived: true })).map((x) => x.id)).toEqual([a.id, b.id]);
    });

    it('getEntity est borné à l\'organisation ; updateEntity renomme', async () => {
      const e = await db.createEntity('acme', 'Nord');
      expect((await db.getEntity('acme', e.id))?.name).toBe('Nord');
      expect(await db.getEntity('other', e.id)).toBeUndefined();
      await db.updateEntity('other', e.id, { name: 'Pirate' });
      expect((await db.getEntity('acme', e.id))?.name).toBe('Nord');
      await db.updateEntity('acme', e.id, { name: 'Nord-Est' });
      expect((await db.getEntity('acme', e.id))?.name).toBe('Nord-Est');
    });

    it('countEntityUsage compte les agents IA rattachés et les appartenances actives seulement', async () => {
      const e1 = await db.createEntity('acme', 'Nord');
      const e2 = await db.createEntity('acme', 'Sud');
      await db.upsertBotRecord(baseBot({ bot_id: 'b1', entity_id: e1.id }));
      await db.upsertBotRecord(baseBot({ bot_id: 'b2' }));
      await db.setBotEntity('acme', 'b2', e1.id);
      await db.upsertBotRecord(baseBot({ bot_id: 'b3', entity_id: e2.id }));
      const u1 = await seedUser(db, 'u1@acme.test');
      const u2 = await seedUser(db, 'u2@acme.test');
      const u3 = await seedUser(db, 'u3@acme.test');
      await db.replaceMemberships(u1, 'acme', [{ entity_id: e1.id, role: 'advisor' }]);
      await db.replaceMemberships(u2, 'acme', [{ entity_id: e1.id, role: 'manager' }, { entity_id: e2.id, role: 'advisor' }]);
      await db.replaceMemberships(u3, 'acme', [{ entity_id: e1.id, role: 'advisor' }]);
      await db.setMembershipsStatus(u3, 'acme', 'suspended');
      expect(await db.countEntityUsage('acme', e1.id)).toEqual({ bots: 2, activeMembers: 2 });
      expect(await db.countEntityUsage('acme', e2.id)).toEqual({ bots: 1, activeMembers: 1 });
      expect(await db.countEntityUsage('other', e1.id)).toEqual({ bots: 0, activeMembers: 0 });
    });
  });

  describe('appartenances', () => {
    it('replaceMemberships remplace l\'ensemble des appartenances de l\'organisation', async () => {
      const u = await seedUser(db, 'u@acme.test');
      const e1 = await db.createEntity('acme', 'Nord');
      await db.replaceMemberships(u, 'acme', [{ entity_id: e1.id, role: 'manager' }]);
      const first = await db.listUserMemberships(u, 'acme');
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({ user_id: u, client_id: 'acme', entity_id: e1.id, role: 'manager', read_only: false, status: 'active' });

      await db.replaceMemberships(u, 'acme', [{ entity_id: null, role: 'admin' }]);
      const after = await db.listUserMemberships(u, 'acme');
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({ entity_id: null, role: 'admin', read_only: false, status: 'active' });
    });

    it('replaceMemberships avec un statut explicite insère les lignes dans ce statut', async () => {
      const u = await seedUser(db, 'u@acme.test');
      const e1 = await db.createEntity('acme', 'Nord');
      await db.replaceMemberships(u, 'acme', [{ entity_id: e1.id, role: 'advisor' }], 'suspended');
      expect((await db.listUserMemberships(u, 'acme')).map((m) => m.status)).toEqual(['suspended']);
    });

    it('replaceMemberships sur acme ne touche pas les appartenances de other', async () => {
      const u = await seedUser(db, 'u@acme.test');
      await db.replaceMemberships(u, 'other', [{ entity_id: null, role: 'super_manager', read_only: true }]);
      await db.replaceMemberships(u, 'acme', [{ entity_id: null, role: 'admin' }]);
      await db.replaceMemberships(u, 'acme', [{ entity_id: null, role: 'super_manager' }]);
      const other = await db.listUserMemberships(u, 'other');
      expect(other).toHaveLength(1);
      expect(other[0]).toMatchObject({ client_id: 'other', role: 'super_manager', read_only: true });
      const all = await db.listUserMemberships(u);
      expect(all.map((m) => m.client_id).sort()).toEqual(['acme', 'other']);
    });

    it('listOrgMemberships renvoie les appartenances de l\'organisation seulement', async () => {
      const u1 = await seedUser(db, 'u1@acme.test');
      const u2 = await seedUser(db, 'u2@acme.test');
      await db.replaceMemberships(u1, 'acme', [{ entity_id: null, role: 'admin' }]);
      await db.replaceMemberships(u2, 'other', [{ entity_id: null, role: 'admin' }]);
      const list = await db.listOrgMemberships('acme');
      expect(list.map((m) => m.user_id)).toEqual([u1]);
    });

    it('setMembershipsStatus suspended retire l\'organisation de listUserOrganizations', async () => {
      const u = await seedUser(db, 'u@acme.test');
      await db.replaceMemberships(u, 'acme', [{ entity_id: null, role: 'admin' }]);
      await db.replaceMemberships(u, 'other', [{ entity_id: null, role: 'admin' }]);
      expect(await db.listUserOrganizations(u)).toEqual([
        { client_id: 'acme', name: 'Acme' },
        { client_id: 'other', name: 'Other' },
      ]);
      await db.setMembershipsStatus(u, 'acme', 'suspended');
      expect((await db.listUserMemberships(u, 'acme'))[0]?.status).toBe('suspended');
      expect(await db.listUserOrganizations(u)).toEqual([{ client_id: 'other', name: 'Other' }]);
      await db.setMembershipsStatus(u, 'acme', 'active');
      expect((await db.listUserOrganizations(u)).map((o) => o.client_id)).toEqual(['acme', 'other']);
    });

    it('une organisation avec plusieurs appartenances d\'entité n\'apparaît qu\'une fois', async () => {
      const u = await seedUser(db, 'u@acme.test');
      const e1 = await db.createEntity('acme', 'Nord');
      const e2 = await db.createEntity('acme', 'Sud');
      await db.replaceMemberships(u, 'acme', [{ entity_id: e1.id, role: 'advisor' }, { entity_id: e2.id, role: 'manager' }]);
      expect(await db.listUserOrganizations(u)).toEqual([{ client_id: 'acme', name: 'Acme' }]);
    });
  });

  describe('réglages d\'organisation', () => {
    it('getClientSettings d\'un client neuf vaut {} ; aller-retour setClientSettings', async () => {
      expect(await db.getClientSettings('acme')).toEqual({});
      expect(await db.getClientSettings('absent')).toEqual({});
      await db.setClientSettings('acme', { visibility: 'all', pool_self_claim: false });
      expect(await db.getClientSettings('acme')).toEqual({ visibility: 'all', pool_self_claim: false });
      expect(await db.getClientSettings('other')).toEqual({});
    });

    it('upsertClient conserve les réglages', async () => {
      await db.setClientSettings('acme', { takeover: 'owner' });
      await db.upsertClient({ client_id: 'acme', name: 'Acme SA', status: 'active' });
      expect(await db.getClientSettings('acme')).toEqual({ takeover: 'owner' });
    });
  });

  describe('agents IA', () => {
    it('un bot inséré avec entity_id 7 est relu avec entity_id 7', async () => {
      await db.upsertBotRecord(baseBot({ entity_id: 7 }));
      expect((await db.getBotRecord('acme', 'b1'))?.entity_id).toBe(7);
      expect((await db.listBotRecords())[0]?.entity_id).toBe(7);
    });

    it('entity_id null par défaut ; setBotEntity rattache, borné à l\'organisation', async () => {
      await db.upsertBotRecord(baseBot());
      expect((await db.getBotRecord('acme', 'b1'))?.entity_id).toBeNull();
      await db.setBotEntity('other', 'b1', 3);
      expect((await db.getBotRecord('acme', 'b1'))?.entity_id).toBeNull();
      await db.setBotEntity('acme', 'b1', 3);
      expect((await db.getBotRecord('acme', 'b1'))?.entity_id).toBe(3);
    });
  });

  describe('utilisateurs', () => {
    it('setUserRole et listUsersByRole', async () => {
      const a = await db.createUser({ email: 'a@acme.test', password_hash: null, role: 'client_admin', client_id: 'acme', status: 'active' });
      const b = await db.createUser({ email: 'b@acme.test', password_hash: null, role: 'client_admin', client_id: 'acme', status: 'invited' });
      await db.createUser({ email: 's@x.test', password_hash: null, role: 'super_admin', client_id: null, status: 'active' });
      expect((await db.listUsersByRole('client_admin')).map((u) => u.id)).toEqual([a.id, b.id]);
      await db.setUserRole(a.id, 'member');
      expect((await db.getUserById(a.id))?.role).toBe('member');
      expect((await db.listUsersByRole('client_admin')).map((u) => u.id)).toEqual([b.id]);
      expect((await db.listUsersByRole('member'))[0]).toMatchObject({ id: a.id, email: 'a@acme.test', client_id: 'acme' });
    });
  });

  describe('invitations', () => {
    it('une invitation avec grants est relue avec grants parsé ; sans grants vaut null', async () => {
      const withGrants = await db.createInvitation({
        email: 'g@acme.test', client_id: 'acme', role: 'member', token_hash: 'tg',
        expires_at: '2099-01-01T00:00:00.000Z', grants: [{ entity_id: 12, role: 'advisor' }],
      });
      expect(withGrants.grants).toEqual([{ entity_id: 12, role: 'advisor' }]);
      expect((await db.getInvitationByTokenHash('tg'))?.grants).toEqual([{ entity_id: 12, role: 'advisor' }]);
      const legacy = await db.createInvitation({
        email: 'l@acme.test', client_id: 'acme', role: 'client_admin', token_hash: 'tl', expires_at: '2099-01-01T00:00:00.000Z',
      });
      expect(legacy.grants).toBeNull();
      const list = await db.listInvitations('acme');
      expect(list.find((i) => i.id === withGrants.id)?.grants).toEqual([{ entity_id: 12, role: 'advisor' }]);
      expect(list.find((i) => i.id === legacy.id)?.grants).toBeNull();
    });

    it('listUnmigratedInvitations puis setInvitationGrants', async () => {
      const legacy = await db.createInvitation({
        email: 'l@acme.test', client_id: 'acme', role: 'client_admin', token_hash: 'tl', expires_at: '2099-01-01T00:00:00.000Z',
      });
      await db.createInvitation({
        email: 'g@acme.test', client_id: 'acme', role: 'member', token_hash: 'tg',
        expires_at: '2099-01-01T00:00:00.000Z', grants: [{ entity_id: null, role: 'admin' }],
      });
      expect((await db.listUnmigratedInvitations()).map((i) => i.id)).toEqual([legacy.id]);
      await db.setInvitationGrants(legacy.id, [{ entity_id: null, role: 'admin' }]);
      expect(await db.listUnmigratedInvitations()).toEqual([]);
      expect((await db.getInvitationByTokenHash('tl'))?.grants).toEqual([{ entity_id: null, role: 'admin' }]);
    });

    it('listPendingInvitationsByEmail : non acceptées, non expirées, tri par création croissante', async () => {
      const first = await db.createInvitation({
        email: 'p@x.test', client_id: 'acme', role: 'member', token_hash: 't1', expires_at: '2099-01-01T00:00:00.000Z', grants: [{ entity_id: null, role: 'admin' }],
      });
      const expired = await db.createInvitation({
        email: 'p@x.test', client_id: 'acme', role: 'member', token_hash: 't2', expires_at: '2000-01-01T00:00:00.000Z', grants: [{ entity_id: null, role: 'admin' }],
      });
      const accepted = await db.createInvitation({
        email: 'p@x.test', client_id: 'other', role: 'member', token_hash: 't3', expires_at: '2099-01-01T00:00:00.000Z', grants: [{ entity_id: null, role: 'admin' }],
      });
      await db.markInvitationAccepted(accepted.id);
      const second = await db.createInvitation({
        email: 'p@x.test', client_id: 'other', role: 'member', token_hash: 't4', expires_at: '2099-01-01T00:00:00.000Z', grants: [{ entity_id: null, role: 'super_manager' }],
      });
      await db.createInvitation({
        email: 'autre@x.test', client_id: 'acme', role: 'member', token_hash: 't5', expires_at: '2099-01-01T00:00:00.000Z', grants: [{ entity_id: null, role: 'admin' }],
      });
      const pending = await db.listPendingInvitationsByEmail('p@x.test');
      expect(pending.map((i) => i.id)).toEqual([first.id, second.id]);
      expect(pending.map((i) => i.id)).not.toContain(expired.id);
      expect(pending[1]?.grants).toEqual([{ entity_id: null, role: 'super_manager' }]);
    });

    it('refreshInvitationToken remplace le jeton et l\'expiration', async () => {
      const inv = await db.createInvitation({
        email: 'r@x.test', client_id: 'acme', role: 'member', token_hash: 'old', expires_at: '2000-01-01T00:00:00.000Z', grants: [{ entity_id: null, role: 'admin' }],
      });
      await db.refreshInvitationToken(inv.id, 'new', '2099-06-01T00:00:00.000Z');
      expect(await db.getInvitationByTokenHash('old')).toBeUndefined();
      const back = await db.getInvitationByTokenHash('new');
      expect(back?.id).toBe(inv.id);
      expect(back?.expires_at).toBe('2099-06-01T00:00:00.000Z');
      expect((await db.listPendingInvitationsByEmail('r@x.test')).map((i) => i.id)).toEqual([inv.id]);
    });
  });
});

// Reste SQLite par construction : inspecte un fichier de base et ses PRAGMA.
describe('accounts store : base existante sans les nouvelles colonnes (sqlite)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wab-accounts-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('ensure-column ajoute bots.entity_id, clients.settings, clients.agency_id, invitations.grants et crée les tables', async () => {
    const file = path.join(dir, 'legacy.db');
    const raw = new BetterSqlite3(file);
    raw.exec(`
      CREATE TABLE clients (
        client_id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE bots (
        client_id TEXT NOT NULL, bot_id TEXT NOT NULL, name TEXT NOT NULL, transport TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft', default_language TEXT NOT NULL DEFAULT 'fr',
        languages TEXT NOT NULL DEFAULT '["fr"]', system_prompt TEXT NOT NULL DEFAULT '{}',
        lead_fields TEXT NOT NULL DEFAULT '', welcome TEXT NOT NULL DEFAULT '{"enabled":false,"message":{}}',
        error_messages TEXT NOT NULL DEFAULT '{}', catalog TEXT, llm TEXT, crm TEXT,
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (client_id, bot_id)
      );
      CREATE TABLE invitations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, client_id TEXT, role TEXT NOT NULL,
        token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, accepted_at TEXT, created_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO clients (client_id, name) VALUES ('acme', 'Acme');
      INSERT INTO bots (client_id, bot_id, name, transport) VALUES ('acme', 'b1', 'Agent', 'meta-cloud');
      INSERT INTO invitations (email, client_id, role, token_hash, expires_at)
        VALUES ('l@acme.test', 'acme', 'client_admin', 'tl', '2099-01-01T00:00:00.000Z');
    `);
    raw.close();

    const db = createSqliteDriver(file);
    await db.close();
    // Seconde ouverture : l'ensure-column doit être idempotent.
    const db2 = createSqliteDriver(file);

    const check = new BetterSqlite3(file, { readonly: true });
    const cols = (table: string): string[] =>
      (check.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    expect(cols('bots')).toContain('entity_id');
    expect(cols('clients')).toEqual(expect.arrayContaining(['settings', 'agency_id']));
    expect(cols('invitations')).toContain('grants');
    const tables = (check.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(['entities', 'memberships', 'agencies']));
    check.close();

    expect((await db2.getBotRecord('acme', 'b1'))?.entity_id).toBeNull();
    expect(await db2.getClientSettings('acme')).toEqual({});
    expect((await db2.getInvitationByTokenHash('tl'))?.grants).toBeNull();
    expect((await db2.listUnmigratedInvitations()).map((i) => i.email)).toEqual(['l@acme.test']);
    await db2.close();
  });
});
