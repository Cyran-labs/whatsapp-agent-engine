import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSqliteDriver } from '../../../core/database/sqlite.js';
import { __setDatabaseForTests } from '../../../core/database/index.js';
import { resetConfigStore } from '../../../core/config-store.js';
import type { Database } from '../../../core/database/types.js';
import { AuthService } from '../../../core/auth/auth-service.js';
import { AdminService } from '../../../core/auth/admin-service.js';
import { BotService } from '../../../core/services/bot-service.js';
import { EntityService } from '../../../core/services/entity-service.js';
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
  return (await request(app).post('/api/admin/v1/auth/login').send({ email, password: 'motdepasse123' })).body.access_token as string;
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
      entityService: new EntityService({ db }),
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
    const created = await request(app).post('/api/admin/v1/entities').set(auth).send({ name: 'Paris' });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Paris');

    const list = await request(app).get('/api/admin/v1/entities').set(auth);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
    expect(list.body[1]).toMatchObject({ name: 'Paris', bots: 0, members: 0 });

    const renamed = await request(app).patch(`/api/admin/v1/entities/${created.body.id}`).set(auth).send({ name: 'Lyon' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Lyon');

    const archived = await request(app).patch(`/api/admin/v1/entities/${created.body.id}`).set(auth).send({ status: 'archived' });
    expect(archived.body.status).toBe('archived');
    expect((await request(app).get('/api/admin/v1/entities').set(auth)).body).toHaveLength(1);
    expect((await request(app).get('/api/admin/v1/entities?include_archived=true').set(auth)).body).toHaveLength(2);
  });

  it('nom en double : 409 ; payload invalide : 400', async () => {
    const tok = await bearer(app, 'admin@acme.test');
    const auth = { Authorization: `Bearer ${tok}` };
    await request(app).post('/api/admin/v1/entities').set(auth).send({ name: 'Paris' });
    const dup = await request(app).post('/api/admin/v1/entities').set(auth).send({ name: 'Paris' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toBe('Une entité porte déjà ce nom.');
    expect((await request(app).post('/api/admin/v1/entities').set(auth).send({ name: '   ' })).status).toBe(400);
  });

  it('conseiller : lecture autorisée, POST et PATCH refusés (403)', async () => {
    const tok = await bearer(app, 'adv@acme.test');
    const auth = { Authorization: `Bearer ${tok}` };
    expect((await request(app).get('/api/admin/v1/entities').set(auth)).status).toBe(200);
    expect((await request(app).post('/api/admin/v1/entities').set(auth).send({ name: 'Paris' })).status).toBe(403);
    const id = (await db.listEntities('acme'))[0]!.id;
    expect((await request(app).patch(`/api/admin/v1/entities/${id}`).set(auth).send({ name: 'X' })).status).toBe(403);
  });

  it('PATCH d\'une entité d\'une autre organisation : 404 ; sans jeton : 401', async () => {
    const otherEntity = (await db.listEntities('other'))[0]!;
    const tok = await bearer(app, 'admin@acme.test');
    const res = await request(app).patch(`/api/admin/v1/entities/${otherEntity.id}`).set('Authorization', `Bearer ${tok}`).send({ name: 'X' });
    expect(res.status).toBe(404);
    expect((await request(app).get('/api/admin/v1/entities')).status).toBe(401);
  });

  it('archivage refusé tant qu\'un agent IA est rattaché (409)', async () => {
    const tok = await bearer(app, 'admin@acme.test');
    const auth = { Authorization: `Bearer ${tok}` };
    const entity = (await db.listEntities('acme'))[0]!;
    const bot = await request(app).post('/api/admin/v1/bots').set(auth).send({
      bot_id: 'sales', name: 'Ventes', transport: 'meta-cloud', system_prompt: { fr: 'Agent.' }, welcome: { enabled: false, message: {} },
    });
    expect(bot.status).toBe(201);
    expect(bot.body.entity_id).toBe(entity.id);
    const res = await request(app).patch(`/api/admin/v1/entities/${entity.id}`).set(auth).send({ status: 'archived' });
    expect(res.status).toBe(409);
  });
});
