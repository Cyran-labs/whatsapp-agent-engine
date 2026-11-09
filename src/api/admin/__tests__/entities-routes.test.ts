import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { serve } from '../../../test-support/http.js';
import { createSqliteDriver } from '../../../core/database/sqlite.js';
import { __setDatabaseForTests } from '../../../core/database/index.js';
import { resetConfigStore } from '../../../core/config-store.js';
import type { Database } from '../../../core/database/types.js';
import { AuthService } from '../../../core/auth/auth-service.js';
import { AdminService } from '../../../core/auth/admin-service.js';
import { BotService } from '../../../core/services/bot-service.js';
import { UserAdminService } from '../../../core/services/user-admin-service.js';
import { EntityService } from '../../../core/services/entity-service.js';
import { SettingsService } from '../../../core/services/settings-service.js';
import { CredentialsService } from '../../../core/services/credentials-service.js';
import { ConnectionsService } from '../../../core/services/connections-service.js';
import { DashboardService } from '../../../core/services/dashboard-service.js';
import { SimulateService } from '../../../core/services/simulate-service.js';
import type { Mailer } from '../../../core/auth/mailer.js';
import { createAdminRouter } from '../router.js';
import { seedOrgMember } from '../../../core/auth/__tests__/fixtures.js';

class FakeMailer implements Mailer {
  async sendInvitation() {} async sendPasswordReset() {}
}

async function bearer(app: express.Express, email: string): Promise<string> {
  return (await request(await serve(app)).post('/api/admin/v1/auth/login').send({ email, password: 'motdepasse123' })).body.access_token as string;
}

describe('entities routes', () => {
  let db: Database;
  let app: express.Express;
  beforeEach(async () => {
    process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!';
    process.env['ADMIN_BCRYPT_ROUNDS'] = '4';
    process.env['CREDENTIALS_ENCRYPTION_KEY'] = '0'.repeat(64);
    db = createSqliteDriver(':memory:'); __setDatabaseForTests(db); resetConfigStore();
    const mailer = new FakeMailer();
    const credentials = new CredentialsService({ db });
    app = express();
    app.use('/api/admin/v1', createAdminRouter({
      db, authService: new AuthService({ db, mailer }),
      adminService: new AdminService({ db, mailer }), botService: new BotService({ db }),
      entityService: new EntityService({ db }), settingsService: new SettingsService({ db }), userAdminService: new UserAdminService({ db, mailer: new FakeMailer() }),
      connectionsService: new ConnectionsService({ db, credentials }),
      dashboardService: new DashboardService({ db, credentials }),
      simulateService: new SimulateService({}),
    }));
    await seedOrgMember(db, { email: 'admin@acme.test', password: 'motdepasse123', clientId: 'acme', grants: 'admin' });
    await seedOrgMember(db, { email: 'admin@other.test', password: 'motdepasse123', clientId: 'other', grants: 'admin' });
    const acmeEntity = (await db.listEntities('acme'))[0]!;
    await seedOrgMember(db, { email: 'adv@acme.test', password: 'motdepasse123', clientId: 'acme', grants: [{ entity_id: acmeEntity.id, role: 'advisor' }] });
  });
  afterEach(async () => { resetConfigStore(); await db.close(); });

  it('admin : crée, liste avec compteurs, renomme et archive', async () => {
    const tok = await bearer(app, 'admin@acme.test');
    const auth = { Authorization: `Bearer ${tok}` };
    const created = await request(await serve(app)).post('/api/admin/v1/entities').set(auth).send({ name: 'Paris' });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Paris');

    const list = await request(await serve(app)).get('/api/admin/v1/entities').set(auth);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
    expect(list.body[1]).toMatchObject({ name: 'Paris', bots: 0, members: 0 });

    const renamed = await request(await serve(app)).patch(`/api/admin/v1/entities/${created.body.id}`).set(auth).send({ name: 'Lyon' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Lyon');

    const archived = await request(await serve(app)).patch(`/api/admin/v1/entities/${created.body.id}`).set(auth).send({ status: 'archived' });
    expect(archived.body.status).toBe('archived');
    expect((await request(await serve(app)).get('/api/admin/v1/entities').set(auth)).body).toHaveLength(1);
    expect((await request(await serve(app)).get('/api/admin/v1/entities?include_archived=true').set(auth)).body).toHaveLength(2);
  });

  it('nom en double : 409 ; payload invalide : 400', async () => {
    const tok = await bearer(app, 'admin@acme.test');
    const auth = { Authorization: `Bearer ${tok}` };
    await request(await serve(app)).post('/api/admin/v1/entities').set(auth).send({ name: 'Paris' });
    const dup = await request(await serve(app)).post('/api/admin/v1/entities').set(auth).send({ name: 'Paris' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toBe('Une entité porte déjà ce nom.');
    expect(dup.body.error.reason).toBe('entity.duplicate_name');
    expect((await request(await serve(app)).post('/api/admin/v1/entities').set(auth).send({ name: '   ' })).status).toBe(400);
  });

  it('conseiller : lecture autorisée, POST et PATCH refusés (403)', async () => {
    const tok = await bearer(app, 'adv@acme.test');
    const auth = { Authorization: `Bearer ${tok}` };
    expect((await request(await serve(app)).get('/api/admin/v1/entities').set(auth)).status).toBe(200);
    expect((await request(await serve(app)).post('/api/admin/v1/entities').set(auth).send({ name: 'Paris' })).status).toBe(403);
    const id = (await db.listEntities('acme'))[0]!.id;
    expect((await request(await serve(app)).patch(`/api/admin/v1/entities/${id}`).set(auth).send({ name: 'X' })).status).toBe(403);
  });

  it('PATCH d\'une entité d\'une autre organisation : 404 ; sans jeton : 401', async () => {
    const otherEntity = (await db.listEntities('other'))[0]!;
    const tok = await bearer(app, 'admin@acme.test');
    const res = await request(await serve(app)).patch(`/api/admin/v1/entities/${otherEntity.id}`).set('Authorization', `Bearer ${tok}`).send({ name: 'X' });
    expect(res.status).toBe(404);
    expect(res.body.error.reason).toBe('entity.not_found');
    // Isolation : une entité inexistante et un identifiant non numérique répondent exactement pareil.
    for (const id of ['987654', 'abc']) {
      const other = await request(await serve(app)).patch(`/api/admin/v1/entities/${id}`).set('Authorization', `Bearer ${tok}`).send({ name: 'X' });
      expect([other.status, other.body.error.message, other.body.error.reason]).toEqual([404, res.body.error.message, res.body.error.reason]);
    }
    expect((await request(await serve(app)).get('/api/admin/v1/entities')).status).toBe(401);
  });

  it('archivage refusé tant qu\'un agent IA est rattaché (409)', async () => {
    const tok = await bearer(app, 'admin@acme.test');
    const auth = { Authorization: `Bearer ${tok}` };
    const entity = (await db.listEntities('acme'))[0]!;
    await request(await serve(app)).post('/api/admin/v1/entities').set(auth).send({ name: 'Reserve' });
    const bot = await request(await serve(app)).post('/api/admin/v1/bots').set(auth).send({
      bot_id: 'sales', name: 'Ventes', entity_id: entity.id, system_prompt: { fr: 'Agent.' }, welcome: { enabled: false, message: {} },
    });
    expect(bot.status).toBe(201);
    expect(bot.body.entity_id).toBe(entity.id);
    const res = await request(await serve(app)).patch(`/api/admin/v1/entities/${entity.id}`).set(auth).send({ status: 'archived' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe("Déplacez d'abord les agents IA et les membres de cette entité.");
    expect(res.body.error.reason).toBe('entity.in_use');
  });

  it('refuse d\'archiver la dernière entité active (409), accepte d\'en archiver une de deux', async () => {
    const tok = await bearer(app, 'admin@other.test');
    const auth = { Authorization: `Bearer ${tok}` };
    const only = (await db.listEntities('other'))[0]!;
    const refused = await request(await serve(app)).patch(`/api/admin/v1/entities/${only.id}`).set(auth).send({ status: 'archived' });
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toBe("L'organisation doit garder au moins une entité active.");
    expect(refused.body.error.reason).toBe('entity.last_active');
    const extra = await request(await serve(app)).post('/api/admin/v1/entities').set(auth).send({ name: 'Annexe' });
    const ok = await request(await serve(app)).patch(`/api/admin/v1/entities/${extra.body.id}`).set(auth).send({ status: 'archived' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('archived');
  });

  it('include_archived n\'est honoré que pour un admin ; ignoré pour un conseiller', async () => {
    const adminAuth = { Authorization: `Bearer ${await bearer(app, 'admin@acme.test')}` };
    const advisorAuth = { Authorization: `Bearer ${await bearer(app, 'adv@acme.test')}` };
    const archivedOne = await request(await serve(app)).post('/api/admin/v1/entities').set(adminAuth).send({ name: 'Ancienne' });
    await request(await serve(app)).patch(`/api/admin/v1/entities/${archivedOne.body.id}`).set(adminAuth).send({ status: 'archived' });
    const asAdmin = await request(await serve(app)).get('/api/admin/v1/entities?include_archived=true').set(adminAuth);
    expect(asAdmin.body.map((e: { name: string }) => e.name)).toContain('Ancienne');
    const asAdvisor = await request(await serve(app)).get('/api/admin/v1/entities?include_archived=true').set(advisorAuth);
    expect(asAdvisor.status).toBe(200);
    expect(asAdvisor.body.map((e: { name: string }) => e.name)).not.toContain('Ancienne');
  });
});
