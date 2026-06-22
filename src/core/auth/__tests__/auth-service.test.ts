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
