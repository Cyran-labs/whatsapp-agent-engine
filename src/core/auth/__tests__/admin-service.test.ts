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

  it('createInvitation sur un email déjà invité ne recrée pas le user et réémet', async () => {
    await svc.createClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await svc.createInvitation('acme', 'again@acme.test', 'client_admin');
    await svc.createInvitation('acme', 'again@acme.test', 'client_admin'); // ne doit pas throw
    expect(mailer.invites).toHaveLength(2);
    expect(await svc.listInvitations('acme')).toHaveLength(2);
  });
});
