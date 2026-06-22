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
