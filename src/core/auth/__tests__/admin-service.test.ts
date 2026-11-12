import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createTestDatabase } from '../../../test-support/test-database.js';
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

  beforeEach(async () => {
    db = await createTestDatabase();
    mailer = new FakeMailer();
    svc = new AdminService({ db, mailer });
  });
  afterEach(async () => { await db.close(); });

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

  it('createClientWithEntity : organisation et entité écrites ensemble, même client_id', async () => {
    const { client, entity } = await db.createClientWithEntity({ client_id: 'acme', name: 'Acme', status: 'active' }, 'Boutique Lyon');
    expect(client).toEqual({ client_id: 'acme', name: 'Acme', status: 'active' });
    expect([entity.client_id, entity.name, entity.status]).toEqual(['acme', 'Boutique Lyon', 'active']);
    expect(await db.getClient('acme')).toEqual(client);
    expect(await db.listEntities('acme')).toEqual([entity]);
  });

  it("createClientWithEntity : un échec à l'écriture de l'entité annule l'organisation", async () => {
    // Nom null (contourne le typage) : violation NOT NULL dans les deux schémas, après l'écriture de l'organisation.
    await expect(db.createClientWithEntity({ client_id: 'acme', name: 'Acme', status: 'active' }, null as unknown as string))
      .rejects.toBeDefined();
    expect(await db.getClient('acme')).toBeUndefined();
    expect(await db.listEntities('acme')).toEqual([]);
  });

  it("createClientWithEntity : INSERT strict, une organisation existante n'est ni écrasée ni dotée d'une seconde entité", async () => {
    await db.createClientWithEntity({ client_id: 'acme', name: 'Acme', status: 'active' }, 'Siège');
    await expect(db.createClientWithEntity({ client_id: 'acme', name: 'Autre', status: 'suspended' }, 'Annexe')).rejects.toBeDefined();
    expect(await db.getClient('acme')).toEqual({ client_id: 'acme', name: 'Acme', status: 'active' });
    expect((await db.listEntities('acme')).map((e) => e.name)).toEqual(['Siège']);
  });

  it("createClient : un échec de l'entité n'est pas pris pour un doublon (pas CONFLICT)", async () => {
    await expect(svc.createClient({ client_id: 'acme', name: 'Acme', status: 'active', first_entity_name: null as unknown as string }))
      .rejects.not.toMatchObject({ code: 'CONFLICT' });
    expect(await db.getClient('acme')).toBeUndefined();
  });

  it('createClient : deux créations simultanées du même client_id, une seule réussit, une seule entité', async () => {
    const results = await Promise.allSettled([
      svc.createClient({ client_id: 'acme', name: 'Acme A', status: 'active', first_entity_name: 'Entité A' }),
      svc.createClient({ client_id: 'acme', name: 'Acme B', status: 'suspended', first_entity_name: 'Entité B' }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const ko = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect([ok.length, ko.length]).toEqual([1, 1]);
    expect(ko[0]!.reason).toMatchObject({ code: 'CONFLICT' });
    const winner = results[0]!.status === 'fulfilled' ? 'A' : 'B';
    expect(await db.getClient('acme')).toEqual(
      winner === 'A' ? { client_id: 'acme', name: 'Acme A', status: 'active' } : { client_id: 'acme', name: 'Acme B', status: 'suspended' },
    );
    expect((await db.listEntities('acme')).map((e) => e.name)).toEqual([`Entité ${winner}`]);
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
