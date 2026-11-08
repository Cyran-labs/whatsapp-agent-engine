import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../../test-support/test-database.js';
import { ensureDefaultEntity, migrateAccounts } from '../migrate-accounts.js';
import type { BotRecord, Database } from '../types.js';
import { AuthService } from '../../auth/auth-service.js';
import type { Mailer } from '../../auth/mailer.js';
import { generateRefreshToken, hashRefreshToken } from '../../auth/tokens.js';

const noMailer: Mailer = { async sendInvitation() {}, async sendPasswordReset() {} };

function baseBot(over: Partial<BotRecord> = {}): BotRecord {
  return {
    client_id: 'acme', bot_id: 'b1', name: 'Agent', transport: 'meta-cloud', status: 'draft',
    status_reason: null, default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'Agent.' },
    lead_fields: '', welcome: { enabled: false, message: {} }, error_messages: {},
    catalog: null, llm: null, crm: null, personality: null, entity_id: null, ...over,
  };
}

describe('migrateAccounts', () => {
  let db: Database;
  beforeEach(async () => {
    db = await createTestDatabase();
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.upsertClient({ client_id: 'other', name: 'Other', status: 'active' });
    await db.upsertBotRecord(baseBot({ bot_id: 'b1' }));
    await db.upsertBotRecord(baseBot({ bot_id: 'b2' }));
  });
  afterEach(async () => { await db.close(); });

  it('crée l\'entité par défaut, rattache les agents, migre admins et invitations', async () => {
    const admin = await db.createUser({ email: 'a@acme.test', password_hash: 'h', role: 'client_admin', client_id: 'acme', status: 'active' });
    await db.createInvitation({ email: 'i@other.test', client_id: 'other', role: 'client_admin', token_hash: 'th1', expires_at: '2099-01-01T00:00:00.000Z' });

    const res = await migrateAccounts(db);
    expect(res).toEqual({ entitiesCreated: 2, botsAttached: 2, adminsMigrated: 1, invitationsMigrated: 1 });

    const entities = await db.listEntities('acme');
    expect(entities.map((e) => e.name)).toEqual(['Acme']);
    const bots = (await db.listBotRecords()).filter((b) => b.client_id === 'acme');
    expect(bots).toHaveLength(2);
    expect(bots.every((b) => b.entity_id === entities[0]?.id)).toBe(true);

    const users = await db.listUsersByRole('member');
    expect(users.map((u) => u.id)).toContain(admin.id);
    expect(await db.listUsersByRole('client_admin')).toEqual([]);
    const ms = await db.listUserMemberships(admin.id, 'acme');
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ entity_id: null, role: 'admin', client_id: 'acme' });

    const inv = (await db.listPendingInvitationsByEmail('i@other.test'))[0];
    expect(inv?.grants).toEqual([{ entity_id: null, role: 'admin' }]);
  });

  it('est idempotente : second appel sans effet ni doublon', async () => {
    const admin = await db.createUser({ email: 'a@acme.test', password_hash: 'h', role: 'client_admin', client_id: 'acme', status: 'active' });
    await db.createInvitation({ email: 'i@other.test', client_id: 'other', role: 'client_admin', token_hash: 'th1', expires_at: '2099-01-01T00:00:00.000Z' });
    await migrateAccounts(db);
    const second = await migrateAccounts(db);
    expect(second).toEqual({ entitiesCreated: 0, botsAttached: 0, adminsMigrated: 0, invitationsMigrated: 0 });
    expect(await db.listEntities('acme')).toHaveLength(1);
    expect(await db.listEntities('other')).toHaveLength(1);
    expect(await db.listUserMemberships(admin.id, 'acme')).toHaveLength(1);
  });

  it('ne compte pas un admin déjà doté d\'une appartenance et ne la duplique pas', async () => {
    const admin = await db.createUser({ email: 'a@acme.test', password_hash: 'h', role: 'client_admin', client_id: 'acme', status: 'active' });
    await db.replaceMemberships(admin.id, 'acme', [{ entity_id: null, role: 'admin' }]);
    const res = await migrateAccounts(db);
    expect(res.adminsMigrated).toBe(0);
    expect(await db.listUserMemberships(admin.id, 'acme')).toHaveLength(1);
    expect((await db.listUsersByRole('client_admin'))).toEqual([]);
  });

  it('ne touche pas un super_admin ni une invitation super_admin', async () => {
    const sa = await db.createUser({ email: 's@x.test', password_hash: 'h', role: 'super_admin', client_id: null, status: 'active' });
    await db.createInvitation({ email: 'sa@x.test', client_id: null, role: 'super_admin', token_hash: 'th2', expires_at: '2099-01-01T00:00:00.000Z' });
    const res = await migrateAccounts(db);
    expect(res.adminsMigrated).toBe(0);
    expect(res.invitationsMigrated).toBe(0);
    expect((await db.listUsersByRole('super_admin')).map((u) => u.id)).toEqual([sa.id]);
    expect(await db.listUserMemberships(sa.id)).toEqual([]);
    expect((await db.listPendingInvitationsByEmail('sa@x.test'))[0]?.grants).toBeNull();
  });

  it('ignore un client_admin sans client_id sans planter', async () => {
    const orphan = await db.createUser({ email: 'o@x.test', password_hash: 'h', role: 'client_admin', client_id: null, status: 'active' });
    const res = await migrateAccounts(db);
    expect(res.adminsMigrated).toBe(0);
    expect(await db.listUserMemberships(orphan.id)).toEqual([]);
  });

  describe('client_admin encore invité', () => {
    beforeEach(() => {
      process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!';
      process.env['ADMIN_BCRYPT_ROUNDS'] = '4';
    });

    async function invitation(email: string, clientId: string, role: string, grants?: { entity_id: number | null; role: 'admin' | 'advisor' }[]): Promise<string> {
      const raw = generateRefreshToken();
      await db.createInvitation({ email, client_id: clientId, role, token_hash: hashRefreshToken(raw), expires_at: '2099-01-01T00:00:00.000Z', ...(grants ? { grants } : {}) });
      return raw;
    }

    it('sans invitation en attente : aucune appartenance, rôle member, et accepter une autre organisation ne donne aucun accès à la première', async () => {
      const u = await db.createUser({ email: 'pending@acme.test', password_hash: null, role: 'client_admin', client_id: 'acme', status: 'invited' });
      const res = await migrateAccounts(db);
      expect(res.adminsMigrated).toBe(0);
      expect(await db.listUserMemberships(u.id)).toEqual([]);
      expect((await db.getUserById(u.id))?.role).toBe('member');

      const otherEntity = (await db.listEntities('other'))[0]!;
      const token = await invitation('pending@acme.test', 'other', 'member', [{ entity_id: otherEntity.id, role: 'advisor' }]);
      const auth = new AuthService({ db, mailer: noMailer });
      await auth.acceptInvite(token, 'longenough1');
      expect(await db.listUserMemberships(u.id, 'acme')).toEqual([]);
      expect((await auth.me(u.id)).organizations.map((o) => o.client_id)).toEqual(['other']);
    });

    it('avec invitation client_admin en attente pour l\'organisation : admin de celle-ci après acceptation', async () => {
      const u = await db.createUser({ email: 'pending@acme.test', password_hash: null, role: 'client_admin', client_id: 'acme', status: 'invited' });
      const token = await invitation('pending@acme.test', 'acme', 'client_admin');
      const res = await migrateAccounts(db);
      expect(res).toMatchObject({ adminsMigrated: 0, invitationsMigrated: 1 });
      expect(await db.listUserMemberships(u.id)).toEqual([]);
      await new AuthService({ db, mailer: noMailer }).acceptInvite(token, 'longenough1');
      expect(await db.listUserMemberships(u.id, 'acme')).toEqual([
        expect.objectContaining({ entity_id: null, role: 'admin', status: 'active' }),
      ]);
    });
  });

  it('remplace les appartenances existantes d\'un client_admin actif par une seule appartenance admin', async () => {
    const entity = await db.createEntity('acme', 'Siège');
    const withEntity = await db.createUser({ email: 'e@acme.test', password_hash: 'h', role: 'client_admin', client_id: 'acme', status: 'active' });
    await db.replaceMemberships(withEntity.id, 'acme', [{ entity_id: entity.id, role: 'advisor' }]);
    const withSuper = await db.createUser({ email: 's@acme.test', password_hash: 'h', role: 'client_admin', client_id: 'acme', status: 'active' });
    await db.replaceMemberships(withSuper.id, 'acme', [{ entity_id: null, role: 'super_manager' }]);

    const res = await migrateAccounts(db);
    expect(res.adminsMigrated).toBe(2);
    for (const id of [withEntity.id, withSuper.id]) {
      const ms = await db.listUserMemberships(id, 'acme');
      expect(ms).toHaveLength(1);
      expect(ms[0]).toMatchObject({ entity_id: null, role: 'admin', read_only: false, status: 'active' });
    }
  });

  it('garde la suspension d\'un client_admin suspendu dans son organisation', async () => {
    const entity = await db.createEntity('acme', 'Siège');
    const u = await db.createUser({ email: 'off@acme.test', password_hash: 'h', role: 'client_admin', client_id: 'acme', status: 'active' });
    await db.replaceMemberships(u.id, 'acme', [{ entity_id: entity.id, role: 'advisor' }], 'suspended');
    await migrateAccounts(db);
    expect(await db.listUserMemberships(u.id, 'acme')).toEqual([
      expect.objectContaining({ entity_id: null, role: 'admin', status: 'suspended' }),
    ]);
  });

  it('ensureDefaultEntity renvoie l\'entité active existante sans en créer', async () => {
    const e = await db.createEntity('acme', 'Siège');
    const got = await ensureDefaultEntity(db, 'acme');
    expect(got.id).toBe(e.id);
    expect(await db.listEntities('acme')).toHaveLength(1);
  });
});
