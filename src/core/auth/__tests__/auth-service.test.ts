import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import type { Database } from '../../database/types.js';
import { AuthService } from '../auth-service.js';
import type { Mailer } from '../mailer.js';
import { hashPassword } from '../passwords.js';
import { generateRefreshToken, hashRefreshToken } from '../tokens.js';
import { UserAdminService } from '../../services/user-admin-service.js';
import { seedOrgMember, seedSuperAdmin } from './fixtures.js';

class FakeMailer implements Mailer {
  invites: Array<{ to: string; link: string }> = [];
  resets: Array<{ to: string; link: string }> = [];
  async sendInvitation(to: string, link: string) { this.invites.push({ to, link }); }
  async sendPasswordReset(to: string, link: string) { this.resets.push({ to, link }); }
}

function tokenOf(link: string): string {
  return new URL(link).searchParams.get('token')!;
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
    expect(r.user).not.toHaveProperty('password_hash');
  });

  it('login mauvais mdp → throw UNAUTHORIZED', async () => {
    await makeActiveUser();
    await expect(svc.login('a@x.test', 'wrong-password')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('login user inexistant → throw UNAUTHORIZED (pas de fuite)', async () => {
    await expect(svc.login('ghost@x.test', 'longenough1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('login user non actif → UNAUTHORIZED', async () => {
    await db.createUser({ email: 'inv@x.test', password_hash: await hashPassword('longenough1'), role: 'member', client_id: null, status: 'invited' });
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

  async function pendingInvitation(email: string, clientId: string, grants: Array<{ entity_id: number | null; role: 'admin' | 'super_manager' | 'manager' | 'advisor' }>) {
    const raw = generateRefreshToken();
    await db.createInvitation({ email, client_id: clientId, role: 'member', token_hash: hashRefreshToken(raw), expires_at: '2099-01-01T00:00:00.000Z', grants });
    return raw;
  }

  it('acceptInvite active l\'utilisateur invité, crée ses appartenances et auto-login', async () => {
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    const u = await db.createUser({ email: 'invitee@acme.test', password_hash: null, role: 'member', client_id: null, status: 'invited' });
    const raw = await pendingInvitation('invitee@acme.test', 'acme', [{ entity_id: null, role: 'admin' }]);
    const r = await svc.acceptInvite(raw, 'longenough1');
    expect(r.user.status).toBe('active');
    expect(r.user.role).toBe('member');
    expect((await db.getUserByEmail('invitee@acme.test'))!.password_hash).toBeTruthy();
    expect(await db.listUserMemberships(u.id, 'acme')).toEqual([expect.objectContaining({ entity_id: null, role: 'admin', status: 'active' })]);
    // login fonctionne ensuite
    expect((await svc.login('invitee@acme.test', 'longenough1')).access_token).toBeTruthy();
  });

  it('acceptInvite token invalide → UNAUTHORIZED', async () => {
    await expect(svc.acceptInvite('nope', 'longenough1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('acceptInvite refuse une invitation traînante sur un compte déjà actif (pas de prise de compte)', async () => {
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.createUser({ email: 'u@acme.test', password_hash: null, role: 'member', client_id: null, status: 'invited' });
    const raw1 = await pendingInvitation('u@acme.test', 'acme', [{ entity_id: null, role: 'admin' }]);
    await svc.acceptInvite(raw1, 'longenough1');
    // Invitation créée après coup en base (héritage) : le compte actif ne peut pas être repris.
    const raw2 = await pendingInvitation('u@acme.test', 'acme', [{ entity_id: null, role: 'admin' }]);
    await expect(svc.acceptInvite(raw2, 'attacker-password1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect((await svc.login('u@acme.test', 'longenough1')).access_token).toBeTruthy();
  });

  it('acceptInvite : invitation expirée ou déjà acceptée → UNAUTHORIZED', async () => {
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.createUser({ email: 'late@acme.test', password_hash: null, role: 'member', client_id: null, status: 'invited' });
    const raw = generateRefreshToken();
    await db.createInvitation({ email: 'late@acme.test', client_id: 'acme', role: 'member', token_hash: hashRefreshToken(raw), expires_at: '2000-01-01T00:00:00.000Z', grants: [{ entity_id: null, role: 'admin' }] });
    await expect(svc.acceptInvite(raw, 'longenough1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const ok = await pendingInvitation('late@acme.test', 'acme', [{ entity_id: null, role: 'admin' }]);
    await svc.acceptInvite(ok, 'longenough1');
    await expect(svc.acceptInvite(ok, 'longenough1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('acceptInvite : compte désactivé → UNAUTHORIZED, statut inchangé', async () => {
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    const u = await db.createUser({ email: 'off@acme.test', password_hash: null, role: 'member', client_id: null, status: 'disabled' });
    const raw = await pendingInvitation('off@acme.test', 'acme', [{ entity_id: null, role: 'admin' }]);
    await expect(svc.acceptInvite(raw, 'longenough1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect((await db.getUserById(u.id))!.status).toBe('disabled');
    expect(await db.listUserMemberships(u.id)).toHaveLength(0);
  });

  it('acceptInvite garde une suspension existante dans l\'organisation (compte invité hérité de la migration)', async () => {
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    const u = await db.createUser({ email: 'legacy@acme.test', password_hash: null, role: 'member', client_id: null, status: 'invited' });
    await db.replaceMemberships(u.id, 'acme', [{ entity_id: null, role: 'admin' }]);
    await db.setMembershipsStatus(u.id, 'acme', 'suspended');
    const raw = await pendingInvitation('legacy@acme.test', 'acme', [{ entity_id: null, role: 'admin' }]);
    await svc.acceptInvite(raw, 'longenough1');
    expect((await db.listUserMemberships(u.id, 'acme')).map((m) => m.status)).toEqual(['suspended']);
  });

  describe('avec UserAdminService', () => {
    let admin: UserAdminService;
    let acmeAdmin: number;
    let otherAdmin: number;
    let acmeEntity: number;

    beforeEach(async () => {
      admin = new UserAdminService({ db, mailer });
      const a = await seedOrgMember(db, { email: 'admin@acme.test', password: 'longenough1', clientId: 'acme', grants: 'admin' });
      const o = await seedOrgMember(db, { email: 'admin@other.test', password: 'longenough1', clientId: 'other', grants: 'admin' });
      acmeAdmin = a.userId; acmeEntity = a.entityId; otherAdmin = o.userId;
    });

    it('invitée par acme puis par other : le lien de other active les deux appartenances et marque les deux invitations acceptées', async () => {
      await admin.invite('acme', acmeAdmin, 'x@y.test', [{ entity_id: acmeEntity, role: 'advisor' }]);
      await admin.invite('other', otherAdmin, 'x@y.test', [{ entity_id: null, role: 'super_manager' }]);
      expect(mailer.invites).toHaveLength(2);
      const r = await svc.acceptInvite(tokenOf(mailer.invites[1]!.link), 'longenough1');
      const userId = r.user.id;
      expect(await db.listUserMemberships(userId, 'acme')).toEqual([expect.objectContaining({ entity_id: acmeEntity, role: 'advisor', status: 'active' })]);
      expect(await db.listUserMemberships(userId, 'other')).toEqual([expect.objectContaining({ entity_id: null, role: 'super_manager', status: 'active' })]);
      expect((await db.listInvitations('acme')).every((i) => i.accepted_at !== null)).toBe(true);
      expect((await db.listInvitations('other')).every((i) => i.accepted_at !== null)).toBe(true);
      // Le premier lien est désormais inutilisable.
      await expect(svc.acceptInvite(tokenOf(mailer.invites[0]!.link), 'attacker-password1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('acceptInvite (compte neuf) : une ligne d\'audit user.invite.accept par organisation appliquée', async () => {
      await admin.invite('acme', acmeAdmin, 'x@y.test', [{ entity_id: acmeEntity, role: 'advisor' }]);
      await admin.invite('other', otherAdmin, 'x@y.test', [{ entity_id: null, role: 'super_manager' }]);
      const [acmeInv] = await db.listInvitations('acme');
      const [otherInv] = await db.listInvitations('other');
      const r = await svc.acceptInvite(tokenOf(mailer.invites[1]!.link), 'longenough1');
      for (const [clientId, inv, grants] of [
        ['acme', acmeInv, [{ entity_id: acmeEntity, role: 'advisor' }]],
        ['other', otherInv, [{ entity_id: null, role: 'super_manager' }]],
      ] as const) {
        const rows = (await db.listAuditLog(clientId)).filter((e) => e.action === 'user.invite.accept');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ actor_user_id: r.user.id, target: `invitation:${inv!.id}`, client_id: clientId, metadata: { grants } });
      }
    });

    it('deux invitations en attente vers la même organisation : la dernière gagne', async () => {
      // Invitations héritées en double (avant R23b) : la plus récente l'emporte à l'acceptation.
      await db.createUser({ email: 'x@y.test', password_hash: null, role: 'member', client_id: null, status: 'invited' });
      const first = await pendingInvitation('x@y.test', 'acme', [{ entity_id: null, role: 'admin' }]);
      await pendingInvitation('x@y.test', 'acme', [{ entity_id: acmeEntity, role: 'advisor' }]);
      const r = await svc.acceptInvite(first, 'longenough1');
      expect(await db.listUserMemberships(r.user.id, 'acme')).toEqual([expect.objectContaining({ entity_id: acmeEntity, role: 'advisor' })]);
    });

    it('réinviter vers la même organisation : l\'ancien lien est refusé, le nouveau donne les nouvelles grants (R23b)', async () => {
      await admin.invite('acme', acmeAdmin, 'x@y.test', [{ entity_id: null, role: 'admin' }]);
      await admin.invite('acme', acmeAdmin, 'x@y.test', [{ entity_id: acmeEntity, role: 'advisor' }]);
      await expect(svc.acceptInvite(tokenOf(mailer.invites[0]!.link), 'longenough1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      const r = await svc.acceptInvite(tokenOf(mailer.invites[1]!.link), 'longenough1');
      expect(await db.listUserMemberships(r.user.id, 'acme')).toEqual([expect.objectContaining({ entity_id: acmeEntity, role: 'advisor' })]);
    });

    it('resendInvitation : l\'ancien jeton est refusé, le nouveau accepté', async () => {
      await admin.invite('acme', acmeAdmin, 'x@y.test', [{ entity_id: null, role: 'admin' }]);
      const [inv] = await admin.listInvitations('acme');
      await admin.resendInvitation('acme', acmeAdmin, inv!.id);
      expect(mailer.invites).toHaveLength(2);
      await expect(svc.acceptInvite(tokenOf(mailer.invites[0]!.link), 'longenough1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      const r = await svc.acceptInvite(tokenOf(mailer.invites[1]!.link), 'longenough1');
      expect(r.user.status).toBe('active');
    });

    it('resendInvitation d\'une invitation expirée : le nouveau lien est valable', async () => {
      await admin.invite('acme', acmeAdmin, 'x@y.test', [{ entity_id: null, role: 'admin' }]);
      const [inv] = await admin.listInvitations('acme');
      await db.refreshInvitationToken(inv!.id, 'expired-hash', '2000-01-01T00:00:00.000Z');
      await admin.resendInvitation('acme', acmeAdmin, inv!.id);
      expect((await svc.acceptInvite(tokenOf(mailer.invites[1]!.link), 'longenough1')).user.status).toBe('active');
    });

    it('acceptInvite ignore une grant vers une entité archivée depuis l\'invitation', async () => {
      const paris = await db.createEntity('acme', 'Paris');
      await admin.invite('acme', acmeAdmin, 'x@y.test', [{ entity_id: acmeEntity, role: 'advisor' }, { entity_id: paris.id, role: 'manager' }]);
      await db.updateEntity('acme', paris.id, { status: 'archived' });
      const r = await svc.acceptInvite(tokenOf(mailer.invites[0]!.link), 'longenough1');
      expect(await db.listUserMemberships(r.user.id, 'acme')).toEqual([expect.objectContaining({ entity_id: acmeEntity, role: 'advisor' })]);
    });

    describe('liens restants (R26)', () => {
      it('rétrogradé après acceptation, un lien restant pour la même organisation ne rend pas admin : 401, rien n\'est écrit (R26a)', async () => {
        await admin.invite('acme', acmeAdmin, 'admin@other.test', [{ entity_id: null, role: 'admin' }]);
        await svc.acceptInvitationAsMember(otherAdmin, tokenOf(mailer.invites[0]!.link));
        await admin.setMemberships('acme', acmeAdmin, otherAdmin, [{ entity_id: acmeEntity, role: 'advisor' }]);
        // Lien restant (doublon hérité encore valide).
        const leftover = await pendingInvitation('admin@other.test', 'acme', [{ entity_id: null, role: 'admin' }]);
        await expect(svc.acceptInvitationAsMember(otherAdmin, leftover))
          .rejects.toMatchObject({ code: 'UNAUTHORIZED', message: 'Invitation invalide ou expirée.' });
        expect(await db.listUserMemberships(otherAdmin, 'acme')).toEqual([expect.objectContaining({ entity_id: acmeEntity, role: 'advisor' })]);
        const row = (await db.listInvitations('acme')).find((i) => i.accepted_at === null);
        expect(row).toBeDefined();
      });

      it('membre suspendu dans l\'organisation : un lien restant est refusé, la suspension tient (R26a)', async () => {
        await seedOrgMember(db, { email: 'admin@other.test', password: 'longenough1', clientId: 'acme', grants: [{ entity_id: acmeEntity, role: 'advisor' }] });
        await db.setMembershipsStatus(otherAdmin, 'acme', 'suspended');
        const leftover = await pendingInvitation('admin@other.test', 'acme', [{ entity_id: null, role: 'admin' }]);
        await expect(svc.acceptInvitationAsMember(otherAdmin, leftover)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        expect(await db.listUserMemberships(otherAdmin, 'acme')).toEqual([expect.objectContaining({ role: 'advisor', status: 'suspended' })]);
      });

      it('acceptation par un membre : les autres liens de la même organisation sont supprimés, ceux des autres organisations restent (R26b)', async () => {
        await admin.invite('acme', acmeAdmin, 'admin@other.test', [{ entity_id: acmeEntity, role: 'advisor' }]);
        const duplicate = await pendingInvitation('admin@other.test', 'acme', [{ entity_id: null, role: 'admin' }]);
        const expiredRaw = generateRefreshToken();
        await db.createInvitation({ email: 'admin@other.test', client_id: 'acme', role: 'member', token_hash: hashRefreshToken(expiredRaw), expires_at: '2000-01-01T00:00:00.000Z', grants: [{ entity_id: null, role: 'admin' }] });
        await seedOrgMember(db, { email: 'admin@third.test', password: 'longenough1', clientId: 'third', grants: 'admin' });
        const thirdInvite = await pendingInvitation('admin@other.test', 'third', [{ entity_id: null, role: 'admin' }]);

        await svc.acceptInvitationAsMember(otherAdmin, tokenOf(mailer.invites[0]!.link));
        const acme = (await db.listInvitations('acme')).filter((i) => i.email === 'admin@other.test');
        expect(acme).toHaveLength(1);
        expect(acme[0]!.accepted_at).not.toBeNull();
        await expect(svc.acceptInvitationAsMember(otherAdmin, duplicate)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        expect(await db.listUserMemberships(otherAdmin, 'acme')).toEqual([expect.objectContaining({ entity_id: acmeEntity, role: 'advisor' })]);
        expect((await svc.invitationInfo(thirdInvite)).organization_name).toBe('third');
      });

      it('première acceptation (mot de passe) : les liens expirés restants des organisations appliquées sont supprimés (R26b)', async () => {
        await admin.invite('acme', acmeAdmin, 'x@y.test', [{ entity_id: acmeEntity, role: 'advisor' }]);
        await db.createInvitation({ email: 'x@y.test', client_id: 'acme', role: 'member', token_hash: hashRefreshToken(generateRefreshToken()), expires_at: '2000-01-01T00:00:00.000Z', grants: [{ entity_id: null, role: 'admin' }] });
        await svc.acceptInvite(tokenOf(mailer.invites[0]!.link), 'longenough1');
        const left = (await db.listInvitations('acme')).filter((i) => i.email === 'x@y.test');
        expect(left).toHaveLength(1);
        expect(left[0]!.accepted_at).not.toBeNull();
      });
    });

    describe('acceptation par un compte existant (R24)', () => {
      it('le compte actif ailleurs n\'est membre qu\'après acceptation, et seule cette organisation est ajoutée', async () => {
        await admin.invite('acme', acmeAdmin, 'admin@other.test', [{ entity_id: acmeEntity, role: 'manager' }]);
        // Autre invitation en attente vers une troisième organisation : non appliquée par cette acceptation.
        await seedOrgMember(db, { email: 'admin@third.test', password: 'longenough1', clientId: 'third', grants: 'admin' });
        const thirdAdmin = (await db.getUserByEmail('admin@third.test'))!.id;
        await admin.invite('third', thirdAdmin, 'admin@other.test', [{ entity_id: null, role: 'admin' }]);
        expect(await db.listUserMemberships(otherAdmin, 'acme')).toHaveLength(0);

        const r = await svc.acceptInvitationAsMember(otherAdmin, tokenOf(mailer.invites[0]!.link));
        expect(await db.listUserMemberships(otherAdmin, 'acme')).toEqual([expect.objectContaining({ entity_id: acmeEntity, role: 'manager', status: 'active' })]);
        expect(await db.listUserMemberships(otherAdmin, 'third')).toHaveLength(0);
        expect(r.organizations.map((o) => o.client_id).sort()).toEqual(['acme', 'other']);
        expect((await db.listInvitations('acme'))[0]!.accepted_at).not.toBeNull();
        expect((await db.listInvitations('third'))[0]!.accepted_at).toBeNull();
        expect((await db.listAuditLog('acme')).some((e) => e.action === 'user.invite.accept' && e.actor_user_id === otherAdmin)).toBe(true);
        // Usage unique.
        await expect(svc.acceptInvitationAsMember(otherAdmin, tokenOf(mailer.invites[0]!.link))).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      });

      it('un autre compte connecté ne peut pas accepter l\'invitation : 401, rien n\'est créé', async () => {
        await admin.invite('acme', acmeAdmin, 'admin@other.test', [{ entity_id: null, role: 'admin' }]);
        await expect(svc.acceptInvitationAsMember(acmeAdmin, tokenOf(mailer.invites[0]!.link)))
          .rejects.toMatchObject({ code: 'UNAUTHORIZED', message: 'Invitation invalide ou expirée.' });
        await expect(svc.acceptInvitationAsMember(acmeAdmin, 'nope')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        expect(await db.listUserMemberships(otherAdmin, 'acme')).toHaveLength(0);
        expect((await db.listInvitations('acme'))[0]!.accepted_at).toBeNull();
      });

      it('invitation expirée : 401', async () => {
        await admin.invite('acme', acmeAdmin, 'admin@other.test', [{ entity_id: null, role: 'admin' }]);
        const [inv] = await db.listInvitations('acme');
        const raw = generateRefreshToken();
        await db.refreshInvitationToken(inv!.id, hashRefreshToken(raw), '2000-01-01T00:00:00.000Z');
        await expect(svc.acceptInvitationAsMember(otherAdmin, raw)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      });

      it('compte désactivé : refusé par les deux chemins d\'acceptation', async () => {
        await admin.invite('acme', acmeAdmin, 'admin@other.test', [{ entity_id: null, role: 'admin' }]);
        await db.setUserStatus(otherAdmin, 'disabled');
        const token = tokenOf(mailer.invites[0]!.link);
        await expect(svc.acceptInvitationAsMember(otherAdmin, token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        await expect(svc.acceptInvite(token, 'longenough1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        await expect(svc.invitationInfo(token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        expect(await db.listUserMemberships(otherAdmin, 'acme')).toHaveLength(0);
        expect((await db.getUserById(otherAdmin))!.status).toBe('disabled');
      });

      it('compte actif : le chemin de création de mot de passe reste refusé', async () => {
        await admin.invite('acme', acmeAdmin, 'admin@other.test', [{ entity_id: null, role: 'admin' }]);
        await expect(svc.acceptInvite(tokenOf(mailer.invites[0]!.link), 'attacker-password1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        expect((await svc.login('admin@other.test', 'longenough1')).access_token).toBeTruthy();
      });
    });

    describe('invitationInfo (R24)', () => {
      it('compte à créer : requires_account_creation true ; compte existant : false', async () => {
        await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
        await admin.invite('acme', acmeAdmin, 'new@x.test', [{ entity_id: null, role: 'admin' }]);
        await admin.invite('acme', acmeAdmin, 'admin@other.test', [{ entity_id: null, role: 'admin' }]);
        expect(await svc.invitationInfo(tokenOf(mailer.invites[0]!.link))).toEqual({
          organization_name: 'Acme', requires_account_creation: true, email_hint: 'n•••••@x.test',
          grants_summary: { scope: 'organization', role: 'admin', read_only: false },
        });
        expect(await svc.invitationInfo(tokenOf(mailer.invites[1]!.link))).toEqual({
          organization_name: 'Acme', requires_account_creation: false, email_hint: 'a•••••@other.test',
          grants_summary: { scope: 'organization', role: 'admin', read_only: false },
        });
      });

      it('super manager en lecture seule : read_only true', async () => {
        await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
        await admin.invite('acme', acmeAdmin, 'new@x.test', [{ entity_id: null, role: 'super_manager', read_only: true }]);
        expect((await svc.invitationInfo(tokenOf(mailer.invites[0]!.link))).grants_summary)
          .toEqual({ scope: 'organization', role: 'super_manager', read_only: true });
      });

      it('grants d\'entité : noms et rôles ; une entité archivée depuis l\'invitation est omise', async () => {
        await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
        const second = await db.createEntity('acme', 'Agence Sud');
        const acmeEntityName = (await db.getEntity('acme', acmeEntity))!.name;
        await admin.invite('acme', acmeAdmin, 'new@x.test', [{ entity_id: acmeEntity, role: 'advisor' }, { entity_id: second.id, role: 'manager' }]);
        const token = tokenOf(mailer.invites[0]!.link);
        expect((await svc.invitationInfo(token)).grants_summary).toEqual({
          scope: 'entities',
          entities: [{ entity_name: acmeEntityName, role: 'advisor' }, { entity_name: 'Agence Sud', role: 'manager' }],
        });
        await db.updateEntity('acme', second.id, { status: 'archived' });
        expect((await svc.invitationInfo(token)).grants_summary).toEqual({
          scope: 'entities', entities: [{ entity_name: acmeEntityName, role: 'advisor' }],
        });
      });

      it('plus aucune entité active dans l\'invitation : 401 générique', async () => {
        await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
        await admin.invite('acme', acmeAdmin, 'new@x.test', [{ entity_id: acmeEntity, role: 'advisor' }]);
        await db.updateEntity('acme', acmeEntity, { status: 'archived' });
        await expect(svc.invitationInfo(tokenOf(mailer.invites[0]!.link))).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      });

      it('jeton inconnu, accepté ou expiré : 401 générique', async () => {
        await expect(svc.invitationInfo('nope')).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: 'Invitation invalide ou expirée.' });
        await admin.invite('acme', acmeAdmin, 'new@x.test', [{ entity_id: null, role: 'admin' }]);
        const token = tokenOf(mailer.invites[0]!.link);
        await svc.acceptInvite(token, 'longenough1');
        await expect(svc.invitationInfo(token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      });
    });

    it('me : un membre de deux organisations les voit avec son rôle dans chacune (R22)', async () => {
      await seedOrgMember(db, { email: 'admin@other.test', password: 'longenough1', clientId: 'acme', grants: [{ entity_id: acmeEntity, role: 'advisor' }] });
      const me = await svc.me(otherAdmin);
      const orgs = [...me.organizations].sort((a, b) => a.client_id.localeCompare(b.client_id));
      expect(orgs).toEqual([
        { client_id: 'acme', name: 'acme', role: 'advisor', read_only: false },
        { client_id: 'other', name: 'other', role: 'admin', read_only: false },
      ]);
      expect((me as unknown as Record<string, unknown>)['password_hash']).toBeUndefined();
    });

    it('me : rôle le plus élevé parmi les appartenances actives d\'entité (R22)', async () => {
      const paris = await db.createEntity('acme', 'Paris');
      const { userId } = await seedOrgMember(db, { email: 'mix@acme.test', password: 'longenough1', clientId: 'acme', grants: [{ entity_id: acmeEntity, role: 'advisor' }, { entity_id: paris.id, role: 'manager' }] });
      expect((await svc.me(userId)).organizations).toEqual([{ client_id: 'acme', name: 'acme', role: 'manager', read_only: false }]);
    });

    it('me : super manager en lecture seule (R22)', async () => {
      const { userId } = await seedOrgMember(db, { email: 'ro@acme.test', password: 'longenough1', clientId: 'acme', grants: [{ entity_id: null, role: 'super_manager', read_only: true }] });
      expect((await svc.me(userId)).organizations).toEqual([{ client_id: 'acme', name: 'acme', role: 'super_manager', read_only: true }]);
    });

    it('me : le super admin voit toutes les organisations, rôle admin (R22)', async () => {
      const root = await seedSuperAdmin(db, 'root@platform.test', 'longenough1');
      const me = await svc.me(root);
      expect([...me.organizations].sort((a, b) => a.client_id.localeCompare(b.client_id))).toEqual([
        { client_id: 'acme', name: 'acme', role: 'admin', read_only: false, status: 'active' },
        { client_id: 'other', name: 'other', role: 'admin', read_only: false, status: 'active' },
      ]);
    });

    it('me : le super admin voit aussi une organisation suspendue, avec son statut', async () => {
      await db.upsertClient({ client_id: 'other', name: 'other', status: 'suspended' });
      const root = await seedSuperAdmin(db, 'root@platform.test', 'longenough1');
      const other = (await svc.me(root)).organizations.find((o) => o.client_id === 'other');
      expect(other).toEqual({ client_id: 'other', name: 'other', role: 'admin', read_only: false, status: 'suspended' });
    });

    it('me : une organisation suspendue n\'apparaît pas pour un membre, sans statut sur les autres', async () => {
      await seedOrgMember(db, { email: 'admin@other.test', password: 'longenough1', clientId: 'acme', grants: [{ entity_id: acmeEntity, role: 'advisor' }] });
      await db.upsertClient({ client_id: 'other', name: 'other', status: 'suspended' });
      expect((await svc.me(otherAdmin)).organizations).toEqual([
        { client_id: 'acme', name: 'acme', role: 'advisor', read_only: false },
      ]);
    });

    it('me : compte désactivé ou encore invité avec un jeton valide : 401', async () => {
      await db.setUserStatus(acmeAdmin, 'disabled');
      await expect(svc.me(acmeAdmin)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      await db.setUserStatus(acmeAdmin, 'invited');
      await expect(svc.me(acmeAdmin)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('me : une organisation où l\'appartenance est suspendue n\'apparaît pas', async () => {
      await seedOrgMember(db, { email: 'admin@other.test', password: 'longenough1', clientId: 'acme', grants: [{ entity_id: acmeEntity, role: 'advisor' }] });
      await admin.setStatus('acme', acmeAdmin, otherAdmin, 'suspended');
      expect((await svc.me(otherAdmin)).organizations.map((o) => o.client_id)).toEqual(['other']);
    });
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

  describe('forgotPassword avec invitation en cours', () => {
    const adminGrants = [{ entity_id: null, role: 'admin' as const }];

    async function setup(inviteEmail = 'a@x.test') {
      await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
      await makeActiveUser('a@x.test');
      return pendingInvitation(inviteEmail, 'acme', adminGrants);
    }

    function resetLinkParams(): URLSearchParams {
      expect(mailer.resets).toHaveLength(1);
      return new URL(mailer.resets[0]!.link).searchParams;
    }

    it('invitation valide pour le même e-mail : le lien porte invite', async () => {
      const raw = await setup();
      await svc.forgotPassword('a@x.test', raw);
      const params = resetLinkParams();
      expect(params.get('token')).toBeTruthy();
      expect(params.get('invite')).toBe(raw);
    });

    it('invite encodé dans le lien et e-mail de l\'invitation comparé après normalisation', async () => {
      const raw = await setup('A@X.test');
      await svc.forgotPassword('a@x.test', raw);
      expect(mailer.resets[0]!.link).toContain(`&invite=${encodeURIComponent(raw)}`);
    });

    it('jeton d\'invitation inconnu : ignoré en silence, lien sans invite', async () => {
      await setup();
      await expect(svc.forgotPassword('a@x.test', 'inconnu')).resolves.toBeUndefined();
      expect(resetLinkParams().has('invite')).toBe(false);
    });

    it('invitation expirée : ignorée', async () => {
      await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
      await makeActiveUser('a@x.test');
      const raw = generateRefreshToken();
      await db.createInvitation({ email: 'a@x.test', client_id: 'acme', role: 'member', token_hash: hashRefreshToken(raw), expires_at: '2000-01-01T00:00:00.000Z', grants: adminGrants });
      await expect(svc.forgotPassword('a@x.test', raw)).resolves.toBeUndefined();
      expect(resetLinkParams().has('invite')).toBe(false);
    });

    it('invitation déjà acceptée : ignorée', async () => {
      const raw = await setup();
      const inv = await db.getInvitationByTokenHash(hashRefreshToken(raw));
      await db.markInvitationAccepted(inv!.id);
      await expect(svc.forgotPassword('a@x.test', raw)).resolves.toBeUndefined();
      expect(resetLinkParams().has('invite')).toBe(false);
    });

    it('invitation destinée à une autre adresse : ignorée', async () => {
      const raw = await setup('autre@x.test');
      await expect(svc.forgotPassword('a@x.test', raw)).resolves.toBeUndefined();
      expect(resetLinkParams().has('invite')).toBe(false);
    });

    it('compte inconnu avec invitation : aucun mail, aucune erreur', async () => {
      const raw = await setup('ghost@x.test');
      await expect(svc.forgotPassword('ghost@x.test', raw)).resolves.toBeUndefined();
      expect(mailer.resets).toHaveLength(0);
    });

    it('aucun log du jeton d\'invitation, y compris si le mailer échoue', async () => {
      const raw = await setup();
      const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn')].map((s) => s.mockImplementation(() => {}));
      const boom: Mailer = { async sendInvitation() {}, async sendPasswordReset() { throw new Error('SMTP down'); } };
      await new AuthService({ db, mailer: boom }).forgotPassword('a@x.test', raw);
      await svc.forgotPassword('a@x.test', raw);
      for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(raw);
      vi.restoreAllMocks();
    });
  });

  describe('changePassword', () => {
    it('bon mot de passe actuel : nouveaux jetons, ancien refresh révoqué, nouveau mot de passe actif', async () => {
      const u = await makeActiveUser();
      const r1 = await svc.login('a@x.test', 'longenough1');
      const r2 = await svc.changePassword(u.id, 'longenough1', 'brandnew-password1');
      expect(r2.access_token).toBeTruthy();
      expect(r2.refresh_token).toBeTruthy();
      expect(r2.user.email).toBe('a@x.test');
      // la session réémise est valide ; l'ancien refresh est rejeté (en dernier : sa réutilisation coupe tout)
      expect((await svc.refresh(r2.refresh_token)).access_token).toBeTruthy();
      await expect(svc.refresh(r1.refresh_token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      expect((await svc.login('a@x.test', 'brandnew-password1')).access_token).toBeTruthy();
      await expect(svc.login('a@x.test', 'longenough1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('mauvais mot de passe actuel : 400 sur current_password et aucune session révoquée', async () => {
      const u = await makeActiveUser();
      const r1 = await svc.login('a@x.test', 'longenough1');
      await expect(svc.changePassword(u.id, 'wrong-password', 'brandnew-password1'))
        .rejects.toMatchObject({
          code: 'VALIDATION_ERROR',
          status: 400,
          message: 'Mot de passe actuel incorrect.',
          details: [{ path: 'current_password', message: 'Mot de passe actuel incorrect.' }],
        });
      expect((await svc.refresh(r1.refresh_token)).access_token).toBeTruthy();
      expect((await svc.login('a@x.test', 'longenough1')).access_token).toBeTruthy();
    });

    it('compte non actif : 401', async () => {
      const u = await makeActiveUser();
      await db.setUserStatus(u.id, 'disabled');
      await expect(svc.changePassword(u.id, 'longenough1', 'brandnew-password1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('écrit une entrée d\'audit user.password.change sans mot de passe', async () => {
      const u = await makeActiveUser();
      const spy = vi.spyOn(db, 'insertAuditLog');
      await svc.changePassword(u.id, 'longenough1', 'brandnew-password1');
      expect(spy).toHaveBeenCalledTimes(1);
      const entry = spy.mock.calls[0]![0];
      expect(entry).toMatchObject({ actor_user_id: u.id, action: 'user.password.change', target: `user:${u.id}`, client_id: null });
      expect(JSON.stringify(entry.metadata ?? {})).not.toMatch(/longenough1|brandnew-password1|password/i);
    });
  });

  it('me renvoie le public user et ses organisations', async () => {
    const u = await makeActiveUser();
    const me = await svc.me(u.id);
    expect(me.email).toBe('a@x.test');
    expect(me.organizations).toEqual([]);
    expect(me).not.toHaveProperty('password_hash');
  });

  it('forgotPassword n\'expose pas l\'existence du compte si le mailer échoue', async () => {
    await makeActiveUser();
    const boom: Mailer = {
      async sendInvitation() {},
      async sendPasswordReset() { throw new Error('SMTP down'); },
    };
    const svc2 = new AuthService({ db, mailer: boom });
    await expect(svc2.forgotPassword('a@x.test')).resolves.toBeUndefined();
  });
});

// audit R-15 : clé stable de chaque refus d'authentification, le texte reste celui du moteur
describe('AuthService : clés de refus (error.reason)', () => {
  let db: Database;
  let svc: AuthService;

  beforeEach(async () => {
    process.env['ADMIN_JWT_SECRET'] = SECRET;
    process.env['ADMIN_BCRYPT_ROUNDS'] = '4';
    db = createSqliteDriver(':memory:');
    svc = new AuthService({ db, mailer: new FakeMailer() });
    await db.createUser({ email: 'a@x.test', password_hash: await hashPassword('longenough1'), role: 'super_admin', client_id: null, status: 'active' });
  });

  it('connexion refusée : mauvais mot de passe, compte inconnu et compte non actif portent la même clé', async () => {
    await db.createUser({ email: 'inv@x.test', password_hash: await hashPassword('longenough1'), role: 'member', client_id: null, status: 'invited' });
    for (const [email, password] of [['a@x.test', 'mauvais-mot-de-passe'], ['ghost@x.test', 'longenough1'], ['inv@x.test', 'longenough1']] as const) {
      await expect(svc.login(email, password)).rejects.toMatchObject({
        code: 'UNAUTHORIZED', message: 'Identifiants invalides.', reason: 'auth.invalid_credentials',
      });
    }
  });

  it('mot de passe actuel faux : auth.current_password_incorrect', async () => {
    const user = (await db.getUserByEmail('a@x.test'))!;
    await expect(svc.changePassword(user.id, 'faux', 'nouveau-mot-de-passe'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', reason: 'auth.current_password_incorrect' });
  });

  it('jeton de renouvellement inconnu, réutilisé ou expiré : session.invalid ou session.expired', async () => {
    await expect(svc.refresh('inconnu')).rejects.toMatchObject({ message: 'Session invalide.', reason: 'session.invalid' });
    const first = await svc.login('a@x.test', 'longenough1');
    await svc.refresh(first.refresh_token);
    await expect(svc.refresh(first.refresh_token)).rejects.toMatchObject({ message: 'Session invalide.', reason: 'session.invalid' });

    const user = (await db.getUserByEmail('a@x.test'))!;
    const raw = generateRefreshToken();
    await db.createAuthSession({ user_id: user.id, token_hash: hashRefreshToken(raw), expires_at: '2000-01-01T00:00:00.000Z' });
    await expect(svc.refresh(raw)).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: 'Session expirée.', reason: 'session.expired' });
  });

  it('compte devenu inactif : session.invalid', async () => {
    const user = (await db.getUserByEmail('a@x.test'))!;
    await db.setUserStatus(user.id, 'disabled');
    await expect(svc.me(user.id)).rejects.toMatchObject({ message: 'Session invalide.', reason: 'session.invalid' });
  });

  it("lien d'invitation inconnu : auth.invalid_invitation", async () => {
    await expect(svc.invitationInfo('inconnu')).rejects.toMatchObject({
      code: 'UNAUTHORIZED', message: 'Invitation invalide ou expirée.', reason: 'auth.invalid_invitation',
    });
    await expect(svc.acceptInvite('inconnu', 'longenough1')).rejects.toMatchObject({ reason: 'auth.invalid_invitation' });
  });

  it('lien de réinitialisation inconnu : auth.invalid_reset_link', async () => {
    await expect(svc.resetPassword('inconnu', 'longenough1')).rejects.toMatchObject({
      code: 'UNAUTHORIZED', message: 'Lien de réinitialisation invalide ou expiré.', reason: 'auth.invalid_reset_link',
    });
  });
});
