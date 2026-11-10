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

  it('createClient crée la première entité avec le nom donné, pas celui de l\'organisation', async () => {
    await svc.createClient({ client_id: 'acme', name: 'Acme', status: 'active', first_entity_name: 'Boutique Lyon' });
    const entities = await db.listEntities('acme');
    expect(entities).toHaveLength(1);
    expect(entities[0]!.name).toBe('Boutique Lyon');
  });

  it('createClient crée puis refuse le doublon', async () => {
    const c = await svc.createClient({ client_id: 'acme', name: 'Acme', status: 'active', first_entity_name: 'Siège' });
    expect(c.client_id).toBe('acme');
    await expect(svc.createClient({ client_id: 'acme', name: 'Acme2', status: 'active', first_entity_name: 'Siège' }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('updateClient sur client absent → NOT_FOUND', async () => {
    await expect(svc.updateClient('ghost', { name: 'X' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('updateClient merge le patch', async () => {
    await svc.createClient({ client_id: 'acme', name: 'Acme', status: 'active', first_entity_name: 'Siège' });
    const u = await svc.updateClient('acme', { status: 'suspended' });
    expect(u.status).toBe('suspended');
    expect(u.name).toBe('Acme');
  });
});
