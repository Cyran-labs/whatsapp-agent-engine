import { describe, expect, it, beforeEach } from 'vitest';
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
  granted: Array<{ to: string; organizationName: string }> = [];
  async sendInvitation(to: string, link: string) { this.invites.push({ to, link }); }
  async sendPasswordReset(to: string, link: string) { this.resets.push({ to, link }); }
  async sendAccessGranted(to: string, organizationName: string) { this.granted.push({ to, organizationName }); }
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

    it('deux invitations en attente vers la même organisation : la dernière gagne', async () => {
      await admin.invite('acme', acmeAdmin, 'x@y.test', [{ entity_id: null, role: 'admin' }]);
      await admin.invite('acme', acmeAdmin, 'x@y.test', [{ entity_id: acmeEntity, role: 'advisor' }]);
      const r = await svc.acceptInvite(tokenOf(mailer.invites[0]!.link), 'longenough1');
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

    it('me : un membre de deux organisations les voit toutes les deux', async () => {
      await admin.invite('acme', acmeAdmin, 'admin@other.test', [{ entity_id: acmeEntity, role: 'advisor' }]);
      const me = await svc.me(otherAdmin);
      expect(me.organizations.map((o) => o.client_id).sort()).toEqual(['acme', 'other']);
      expect((me as unknown as Record<string, unknown>)['password_hash']).toBeUndefined();
    });

    it('me : le super admin voit toutes les organisations', async () => {
      const root = await seedSuperAdmin(db, 'root@platform.test', 'longenough1');
      const me = await svc.me(root);
      expect(me.organizations.map((o) => o.client_id).sort()).toEqual(['acme', 'other']);
    });

    it('me : une organisation où l\'appartenance est suspendue n\'apparaît pas', async () => {
      await admin.invite('acme', acmeAdmin, 'admin@other.test', [{ entity_id: acmeEntity, role: 'advisor' }]);
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

  it('me renvoie le public user et ses organisations', async () => {
    const u = await makeActiveUser();
    const me = await svc.me(u.id);
    expect(me.email).toBe('a@x.test');
    expect(me.organizations).toEqual([]);
    expect((me as Record<string, unknown>)['password_hash']).toBeUndefined();
  });

  it('forgotPassword n\'expose pas l\'existence du compte si le mailer échoue', async () => {
    await makeActiveUser();
    const boom: Mailer = {
      async sendInvitation() {},
      async sendPasswordReset() { throw new Error('SMTP down'); },
      async sendAccessGranted() {},
    };
    const svc2 = new AuthService({ db, mailer: boom });
    await expect(svc2.forgotPassword('a@x.test')).resolves.toBeUndefined();
  });
});
