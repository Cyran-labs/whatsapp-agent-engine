import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import type { Database } from '../../database/types.js';
import type { Mailer } from '../../auth/mailer.js';
import { UserAdminService } from '../user-admin-service.js';
import { seedOrgMember, seedSuperAdmin } from '../../auth/__tests__/fixtures.js';

class FakeMailer implements Mailer {
  invites: Array<{ to: string; link: string }> = [];
  async sendInvitation(to: string, link: string) { this.invites.push({ to, link }); }
  async sendPasswordReset() {}
}

const PWD = 'motdepasse123';
const LAST_ADMIN = "L'organisation doit garder au moins un admin.";
const ALREADY_MEMBER = 'Cette personne est déjà membre de l\'organisation : modifiez ses accès.';

describe('UserAdminService', () => {
  let db: Database;
  let mailer: FakeMailer;
  let svc: UserAdminService;
  let acmeAdmin: number;
  let otherAdmin: number;
  let acmeEntity: number;
  let otherEntity: number;

  beforeEach(async () => {
    process.env['ADMIN_BCRYPT_ROUNDS'] = '4';
    db = createSqliteDriver(':memory:');
    mailer = new FakeMailer();
    svc = new UserAdminService({ db, mailer });
    const a = await seedOrgMember(db, { email: 'admin@acme.test', password: PWD, clientId: 'acme', grants: 'admin' });
    const o = await seedOrgMember(db, { email: 'admin@other.test', password: PWD, clientId: 'other', grants: 'admin' });
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    acmeAdmin = a.userId; acmeEntity = a.entityId;
    otherAdmin = o.userId; otherEntity = o.entityId;
  });
  afterEach(async () => { await db.close(); });

  describe('invite', () => {
    it('nouvel e-mail : utilisateur invité créé, invitation avec grants, un seul e-mail, réponse { email }', async () => {
      const r = await svc.invite('acme', acmeAdmin, 'new@acme.test', [{ entity_id: acmeEntity, role: 'advisor' }]);
      expect(r).toEqual({ email: 'new@acme.test' });
      expect(mailer.invites).toHaveLength(1);
      expect(mailer.invites[0]!.link).toContain('accept-invite?token=');
      const user = (await db.getUserByEmail('new@acme.test'))!;
      expect(user).toMatchObject({ role: 'member', status: 'invited', client_id: null });
      const invitations = await db.listInvitations('acme');
      expect(invitations).toHaveLength(1);
      expect(invitations[0]!.grants).toEqual([{ entity_id: acmeEntity, role: 'advisor' }]);
      expect(await db.listUserMemberships(user.id)).toHaveLength(0);
      const audit = await db.listAuditLog('acme');
      expect(audit.some((e) => e.action === 'user.invite' && e.actor_user_id === acmeAdmin)).toBe(true);
    });

    it('e-mail normalisé (casse, espaces)', async () => {
      const r = await svc.invite('acme', acmeAdmin, '  New@Acme.TEST ', [{ entity_id: null, role: 'admin' }]);
      expect(r.email).toBe('new@acme.test');
      expect(await db.getUserByEmail('new@acme.test')).toBeDefined();
    });

    it('utilisateur actif d\'une autre organisation : invitation à accepter, aucune appartenance avant acceptation (R24)', async () => {
      const r = await svc.invite('acme', acmeAdmin, 'admin@other.test', [{ entity_id: acmeEntity, role: 'manager' }]);
      expect(r).toEqual({ email: 'admin@other.test' });
      expect(mailer.invites).toHaveLength(1);
      expect(mailer.invites[0]!.to).toBe('admin@other.test');
      expect(await db.listUserMemberships(otherAdmin, 'acme')).toHaveLength(0);
      const invitations = await db.listInvitations('acme');
      expect(invitations).toHaveLength(1);
      expect(invitations[0]!.grants).toEqual([{ entity_id: acmeEntity, role: 'manager' }]);
      // Le compte existant n'est ni recréé ni modifié.
      expect((await db.getUserById(otherAdmin))!.status).toBe('active');
      expect((await db.listUserMemberships(otherAdmin, 'other'))[0]).toMatchObject({ role: 'admin', status: 'active' });
    });

    it('compte désactivé : même réponse { email }, invitation créée, compte toujours désactivé (R24)', async () => {
      await db.setUserStatus(otherAdmin, 'disabled');
      const r = await svc.invite('acme', acmeAdmin, 'admin@other.test', [{ entity_id: null, role: 'admin' }]);
      expect(r).toEqual({ email: 'admin@other.test' });
      expect(mailer.invites).toHaveLength(1);
      expect((await db.getUserById(otherAdmin))!.status).toBe('disabled');
      expect(await db.listUserMemberships(otherAdmin, 'acme')).toHaveLength(0);
    });

    it('déjà membre actif de l\'organisation : 409 (Ruling R19)', async () => {
      await seedOrgMember(db, { email: 'adv@acme.test', password: PWD, clientId: 'acme', grants: [{ entity_id: acmeEntity, role: 'advisor' }] });
      await expect(svc.invite('acme', acmeAdmin, 'adv@acme.test', [{ entity_id: null, role: 'admin' }]))
        .rejects.toMatchObject({ code: 'CONFLICT', message: ALREADY_MEMBER });
    });

    it('déjà membre suspendu de l\'organisation : 409, la suspension tient (Ruling R19)', async () => {
      const { userId } = await seedOrgMember(db, { email: 'adv@acme.test', password: PWD, clientId: 'acme', grants: [{ entity_id: acmeEntity, role: 'advisor' }] });
      await db.setMembershipsStatus(userId, 'acme', 'suspended');
      await expect(svc.invite('acme', acmeAdmin, 'adv@acme.test', [{ entity_id: acmeEntity, role: 'advisor' }]))
        .rejects.toMatchObject({ code: 'CONFLICT', message: ALREADY_MEMBER });
      expect((await db.listUserMemberships(userId, 'acme'))[0]!.status).toBe('suspended');
    });

    it('inviter le dernier admin avec une grant conseiller est refusé, il reste admin (Ruling R19)', async () => {
      await expect(svc.invite('acme', acmeAdmin, 'admin@acme.test', [{ entity_id: acmeEntity, role: 'advisor' }]))
        .rejects.toMatchObject({ code: 'CONFLICT', message: ALREADY_MEMBER });
      const memberships = await db.listUserMemberships(acmeAdmin, 'acme');
      expect(memberships).toHaveLength(1);
      expect(memberships[0]).toMatchObject({ entity_id: null, role: 'admin', status: 'active' });
    });

    it('grant vers une entité d\'une autre organisation : 400 chemin grants', async () => {
      await expect(svc.invite('acme', acmeAdmin, 'new@acme.test', [{ entity_id: otherEntity, role: 'advisor' }]))
        .rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: [expect.objectContaining({ path: 'grants' })] });
      expect(await db.getUserByEmail('new@acme.test')).toBeUndefined();
      expect(mailer.invites).toHaveLength(0);
    });

    it('grant vers une entité archivée : 400 chemin grants', async () => {
      const paris = await db.createEntity('acme', 'Paris');
      await db.updateEntity('acme', paris.id, { status: 'archived' });
      await expect(svc.invite('acme', acmeAdmin, 'new@acme.test', [{ entity_id: paris.id, role: 'advisor' }]))
        .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rôle hors appartenance (super_admin) : 400, jamais attribué', async () => {
      const forged = [{ entity_id: null, role: 'super_admin' }] as unknown as Parameters<UserAdminService['invite']>[3];
      await expect(svc.invite('acme', acmeAdmin, 'new@acme.test', forged)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(svc.invite('acme', acmeAdmin, 'admin@other.test', forged)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(await db.listUserMemberships(otherAdmin, 'acme')).toHaveLength(0);
    });

    it('organisation inconnue : 404', async () => {
      await expect(svc.invite('ghost', null, 'new@ghost.test', [{ entity_id: null, role: 'admin' }]))
        .rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('compte invité dont le rôle plateforme n\'est pas member : 409, rien n\'est envoyé (R23a)', async () => {
      await db.createUser({ email: 'legacy-root@x.test', password_hash: null, role: 'super_admin', client_id: null, status: 'invited' });
      await expect(svc.invite('acme', acmeAdmin, 'legacy-root@x.test', [{ entity_id: null, role: 'admin' }]))
        .rejects.toMatchObject({ code: 'CONFLICT', message: 'Ce compte ne peut pas être invité.' });
      expect(mailer.invites).toHaveLength(0);
      expect(await db.listInvitations('acme')).toHaveLength(0);
    });

    it('invitation en attente pour la même organisation : rotation (une seule ligne, grants remplacées, nouvel e-mail) (R23b)', async () => {
      await svc.invite('acme', acmeAdmin, 'x@y.test', [{ entity_id: null, role: 'admin' }]);
      const [before] = await db.listInvitations('acme');
      const r = await svc.invite('acme', acmeAdmin, 'x@y.test', [{ entity_id: acmeEntity, role: 'advisor' }]);
      expect(r).toEqual({ email: 'x@y.test' });
      expect(mailer.invites).toHaveLength(2);
      expect(mailer.invites[1]!.link).not.toBe(mailer.invites[0]!.link);
      const after = await db.listInvitations('acme');
      expect(after).toHaveLength(1);
      expect(after[0]!.id).toBe(before!.id);
      expect(after[0]!.token_hash).not.toBe(before!.token_hash);
      expect(after[0]!.grants).toEqual([{ entity_id: acmeEntity, role: 'advisor' }]);
    });

    it('invitation expirée pour la même organisation : rotation aussi, l\'échéance repart', async () => {
      await svc.invite('acme', acmeAdmin, 'x@y.test', [{ entity_id: null, role: 'admin' }]);
      const [inv] = await db.listInvitations('acme');
      await db.refreshInvitationToken(inv!.id, 'old-hash', '2000-01-01T00:00:00.000Z');
      await svc.invite('acme', acmeAdmin, 'x@y.test', [{ entity_id: null, role: 'admin' }]);
      const after = await db.listInvitations('acme');
      expect(after.filter((i) => i.accepted_at === null && new Date(i.expires_at).getTime() > Date.now())).toHaveLength(1);
    });

    it('personne déjà invitée par une autre organisation : nouvelle invitation, pas de conflit', async () => {
      await svc.invite('other', otherAdmin, 'x@y.test', [{ entity_id: null, role: 'admin' }]);
      const r = await svc.invite('acme', acmeAdmin, 'x@y.test', [{ entity_id: acmeEntity, role: 'advisor' }]);
      expect(r).toEqual({ email: 'x@y.test' });
      expect(mailer.invites).toHaveLength(2);
      expect(await db.listPendingInvitationsByEmail('x@y.test')).toHaveLength(2);
    });
  });

  describe('listInvitations / resend / revoke', () => {
    it('listInvitations : grants exposées, ni jeton ni rôle hérité', async () => {
      await svc.invite('acme', acmeAdmin, 'new@acme.test', [{ entity_id: null, role: 'super_manager', read_only: true }]);
      const list = await svc.listInvitations('acme');
      expect(list).toHaveLength(1);
      expect(list[0]!.grants).toEqual([{ entity_id: null, role: 'super_manager', read_only: true }]);
      const json = JSON.stringify(list);
      expect(json).not.toContain('token');
      expect(json).not.toContain('accept-invite');
      expect((list[0] as unknown as Record<string, unknown>)['role']).toBeUndefined();
      expect(await svc.listInvitations('other')).toHaveLength(0);
    });

    it('resendInvitation : nouveau jeton envoyé, audit, invitation d\'une autre organisation introuvable', async () => {
      await svc.invite('acme', acmeAdmin, 'new@acme.test', [{ entity_id: null, role: 'admin' }]);
      const [inv] = await svc.listInvitations('acme');
      await svc.resendInvitation('acme', acmeAdmin, inv!.id);
      expect(mailer.invites).toHaveLength(2);
      expect(mailer.invites[1]!.link).not.toBe(mailer.invites[0]!.link);
      expect((await db.listAuditLog('acme')).some((e) => e.action === 'user.invite.resend')).toBe(true);
      await expect(svc.resendInvitation('other', otherAdmin, inv!.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mailer.invites).toHaveLength(2);
    });

    it('resendInvitation pour un compte actif ailleurs ou désactivé : renvoyé comme les autres (R24)', async () => {
      await svc.invite('acme', acmeAdmin, 'admin@other.test', [{ entity_id: null, role: 'admin' }]);
      const [inv] = await svc.listInvitations('acme');
      await svc.resendInvitation('acme', acmeAdmin, inv!.id);
      await db.setUserStatus(otherAdmin, 'disabled');
      await svc.resendInvitation('acme', acmeAdmin, inv!.id);
      expect(mailer.invites).toHaveLength(3);
      expect(new Set(mailer.invites.map((m) => m.link)).size).toBe(3);
    });

    it('resendInvitation d\'une invitation acceptée : 409', async () => {
      await svc.invite('acme', acmeAdmin, 'new@acme.test', [{ entity_id: null, role: 'admin' }]);
      const [inv] = await svc.listInvitations('acme');
      await db.markInvitationAccepted(inv!.id);
      await expect(svc.resendInvitation('acme', acmeAdmin, inv!.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('revokeInvitation : d\'une autre organisation 404, sinon supprimée', async () => {
      await svc.invite('acme', acmeAdmin, 'new@acme.test', [{ entity_id: null, role: 'admin' }]);
      const [inv] = await svc.listInvitations('acme');
      await expect(svc.revokeInvitation('other', inv!.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await svc.revokeInvitation('acme', inv!.id);
      expect(await svc.listInvitations('acme')).toHaveLength(0);
    });
  });

  describe('listMembers', () => {
    it('membres de l\'organisation seulement, avec leurs seules appartenances de cette organisation', async () => {
      await seedOrgMember(db, { email: 'admin@other.test', password: PWD, clientId: 'acme', grants: [{ entity_id: acmeEntity, role: 'advisor' }] });
      // Une invitation en attente ne fait pas un membre.
      await svc.invite('acme', acmeAdmin, 'pending@x.test', [{ entity_id: acmeEntity, role: 'advisor' }]);
      const { userId: suspended } = await seedOrgMember(db, { email: 'sus@acme.test', password: PWD, clientId: 'acme', grants: [{ entity_id: acmeEntity, role: 'manager' }] });
      await db.setMembershipsStatus(suspended, 'acme', 'suspended');
      await seedOrgMember(db, { email: 'only@other.test', password: PWD, clientId: 'other', grants: 'admin' });

      const members = await svc.listMembers('acme');
      expect(members.map((m) => m.email).sort()).toEqual(['admin@acme.test', 'admin@other.test', 'sus@acme.test']);
      const shared = members.find((m) => m.email === 'admin@other.test')!;
      expect(shared.memberships).toEqual([{ entity_id: acmeEntity, role: 'advisor', read_only: false, status: 'active' }]);
      expect(members.find((m) => m.email === 'sus@acme.test')!.memberships[0]!.status).toBe('suspended');
      expect(JSON.stringify(members)).not.toContain('password_hash');
    });
  });

  describe('setMemberships', () => {
    it('seul admin qui se passe conseiller : 409', async () => {
      await expect(svc.setMemberships('acme', acmeAdmin, acmeAdmin, [{ entity_id: acmeEntity, role: 'advisor' }]))
        .rejects.toMatchObject({ code: 'CONFLICT', message: LAST_ADMIN });
      expect((await db.listUserMemberships(acmeAdmin, 'acme'))[0]!.role).toBe('admin');
    });

    it('avec deux admins : passage conseiller accepté, audit user.memberships', async () => {
      await seedOrgMember(db, { email: 'admin2@acme.test', password: PWD, clientId: 'acme', grants: 'admin' });
      await svc.setMemberships('acme', acmeAdmin, acmeAdmin, [{ entity_id: acmeEntity, role: 'advisor' }]);
      expect((await db.listUserMemberships(acmeAdmin, 'acme'))[0]).toMatchObject({ entity_id: acmeEntity, role: 'advisor' });
      expect((await db.listAuditLog('acme')).some((e) => e.action === 'user.memberships')).toBe(true);
    });

    it('le super admin, un admin désactivé ou suspendu ne comptent pas comme admin restant', async () => {
      await seedSuperAdmin(db, 'root@platform.test', PWD);
      const { userId: disabled } = await seedOrgMember(db, { email: 'gone@acme.test', password: PWD, clientId: 'acme', grants: 'admin' });
      await db.setUserStatus(disabled, 'disabled');
      const { userId: suspended } = await seedOrgMember(db, { email: 'sus@acme.test', password: PWD, clientId: 'acme', grants: 'admin' });
      await db.setMembershipsStatus(suspended, 'acme', 'suspended');
      await expect(svc.setMemberships('acme', acmeAdmin, acmeAdmin, [{ entity_id: acmeEntity, role: 'advisor' }]))
        .rejects.toMatchObject({ code: 'CONFLICT', message: LAST_ADMIN });
    });

    it('utilisateur sans appartenance dans l\'organisation (membre d\'une autre) : 404, rien n\'est créé', async () => {
      await expect(svc.setMemberships('acme', acmeAdmin, otherAdmin, [{ entity_id: null, role: 'admin' }]))
        .rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await db.listUserMemberships(otherAdmin, 'acme')).toHaveLength(0);
      expect((await db.listUserMemberships(otherAdmin, 'other'))[0]!.role).toBe('admin');
    });

    it('grant vers une entité d\'une autre organisation : 400', async () => {
      const { userId } = await seedOrgMember(db, { email: 'adv@acme.test', password: PWD, clientId: 'acme', grants: [{ entity_id: acmeEntity, role: 'advisor' }] });
      await expect(svc.setMemberships('acme', acmeAdmin, userId, [{ entity_id: otherEntity, role: 'advisor' }]))
        .rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: [expect.objectContaining({ path: 'grants' })] });
    });

    it('un membre suspendu le reste après modification de ses appartenances', async () => {
      const { userId } = await seedOrgMember(db, { email: 'adv@acme.test', password: PWD, clientId: 'acme', grants: [{ entity_id: acmeEntity, role: 'advisor' }] });
      await db.setMembershipsStatus(userId, 'acme', 'suspended');
      await svc.setMemberships('acme', acmeAdmin, userId, [{ entity_id: acmeEntity, role: 'manager' }]);
      const after = await db.listUserMemberships(userId, 'acme');
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({ role: 'manager', status: 'suspended' });
    });
  });

  describe('setStatus', () => {
    it('seul admin qui se suspend : 409', async () => {
      await expect(svc.setStatus('acme', acmeAdmin, acmeAdmin, 'suspended'))
        .rejects.toMatchObject({ code: 'CONFLICT', message: LAST_ADMIN });
      expect((await db.listUserMemberships(acmeAdmin, 'acme'))[0]!.status).toBe('active');
    });

    it('avec deux admins : suspension acceptée puis réactivation, audit user.status', async () => {
      await seedOrgMember(db, { email: 'admin2@acme.test', password: PWD, clientId: 'acme', grants: 'admin' });
      await svc.setStatus('acme', acmeAdmin, acmeAdmin, 'suspended');
      expect((await db.listUserMemberships(acmeAdmin, 'acme'))[0]!.status).toBe('suspended');
      await svc.setStatus('acme', acmeAdmin, acmeAdmin, 'active');
      expect((await db.listUserMemberships(acmeAdmin, 'acme'))[0]!.status).toBe('active');
      expect((await db.listAuditLog('acme')).filter((e) => e.action === 'user.status')).toHaveLength(2);
    });

    it('suspension dans acme d\'un membre aussi présent dans other : other intact', async () => {
      await seedOrgMember(db, { email: 'admin@other.test', password: PWD, clientId: 'acme', grants: [{ entity_id: acmeEntity, role: 'advisor' }] });
      await svc.setStatus('acme', acmeAdmin, otherAdmin, 'suspended');
      expect((await db.listUserMemberships(otherAdmin, 'acme'))[0]!.status).toBe('suspended');
      expect((await db.listUserMemberships(otherAdmin, 'other'))[0]!.status).toBe('active');
      expect((await db.getUserById(otherAdmin))!.status).toBe('active');
    });

    it('utilisateur d\'une autre organisation : 404, rien ne change', async () => {
      await expect(svc.setStatus('acme', acmeAdmin, otherAdmin, 'suspended')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect((await db.listUserMemberships(otherAdmin, 'other'))[0]!.status).toBe('active');
    });
  });

  describe('disableGlobally', () => {
    it('statut disabled, toutes les sessions révoquées, audit user.disable', async () => {
      const root = await seedSuperAdmin(db, 'root@platform.test', PWD);
      const session = await db.createAuthSession({ user_id: otherAdmin, token_hash: 'rt-x', expires_at: '2099-01-01T00:00:00.000Z' });
      await svc.disableGlobally(root, otherAdmin);
      expect((await db.getUserById(otherAdmin))!.status).toBe('disabled');
      expect((await db.getAuthSessionByTokenHash('rt-x'))!.revoked_at).not.toBeNull();
      expect(session.id).toBeGreaterThan(0);
    });

    it('utilisateur inconnu : 404', async () => {
      const root = await seedSuperAdmin(db, 'root@platform.test', PWD);
      await expect(svc.disableGlobally(root, 9999)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
