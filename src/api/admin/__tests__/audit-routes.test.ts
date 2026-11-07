import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSqliteDriver } from '../../../core/database/sqlite.js';
import { __setDatabaseForTests } from '../../../core/database/index.js';
import { resetConfigStore, upsertBot } from '../../../core/config-store.js';
import type { Database, BotRecord } from '../../../core/database/types.js';
import { AuthService } from '../../../core/auth/auth-service.js';
import { AdminService } from '../../../core/auth/admin-service.js';
import { BotService } from '../../../core/services/bot-service.js';
import { CredentialsService } from '../../../core/services/credentials-service.js';
import { ConnectionsService } from '../../../core/services/connections-service.js';
import { DashboardService } from '../../../core/services/dashboard-service.js';
import { SimulateService } from '../../../core/services/simulate-service.js';
import type { Mailer } from '../../../core/auth/mailer.js';
import { createAdminRouter } from '../router.js';
import { seedOrgMember, seedSuperAdmin } from '../../../core/auth/__tests__/fixtures.js';

class FakeMailer implements Mailer { async sendInvitation() {} async sendPasswordReset() {} }
const KEY = '0'.repeat(64);
const botRec: BotRecord = {
  client_id: 'acme',
  bot_id: 'sales',
  name: 'Ventes',
  transport: 'meta-cloud',
  status: 'draft',
  default_language: 'fr',
  languages: ['fr'],
  system_prompt: { fr: 'p' },
  lead_fields: '',
  welcome: { enabled: false, message: {} },
  error_messages: {},
  catalog: null,
  llm: null,
  crm: null,
};

async function build() {
  process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!';
  process.env['ADMIN_BCRYPT_ROUNDS'] = '4';
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = KEY;
  const db = createSqliteDriver(':memory:');
  __setDatabaseForTests(db);
  resetConfigStore();
  const mailer = new FakeMailer();
  const credentials = new CredentialsService({ db });
  const app = express();
  app.use('/api/admin/v1', createAdminRouter({
    db,
    authService: new AuthService({ db, mailer }),
    adminService: new AdminService({ db, mailer }),
    botService: new BotService({ db }),
    connectionsService: new ConnectionsService({ db, credentials }),
    dashboardService: new DashboardService({ db, credentials }),
    simulateService: new SimulateService({ chatFn: vi.fn() as never }),
  }));
  await seedOrgMember(db, { email: 'ca@acme.test', password: 'motdepasse123', clientId: 'acme', grants: 'admin' });
  await seedSuperAdmin(db, 'sa@flowlabs.test', 'motdepasse123');
  await upsertBot(botRec, []);
  return { app, db };
}

describe('audit routes', () => {
  it('GET /audit renvoie les mutations du client (créées par une action admin)', async () => {
    const { app } = await build();
    const tok = (await request(app).post('/api/admin/v1/auth/login').send({ email: 'ca@acme.test', password: 'motdepasse123' })).body.access_token;
    // Déclenche une mutation auditée
    await request(app)
      .post('/api/admin/v1/bots')
      .set('Authorization', `Bearer ${tok}`)
      .send({
        bot_id: 'support',
        name: 'Support',
        transport: 'meta-cloud',
        system_prompt: { fr: 'p' },
        welcome: { enabled: false, message: {} },
      });
    const res = await request(app).get('/api/admin/v1/audit').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((e: { action: string }) => e.action === 'bot.create')).toBe(true);
  });

  it("GET /audit exige l'auth", async () => {
    const { app } = await build();
    const res = await request(app).get('/api/admin/v1/audit');
    expect(res.status).toBe(401);
  });

  it('l\'admin de acme ne lit que l\'audit de acme, le paramètre ?client_id=beta est ignoré', async () => {
    const { app, db } = await build();
    const sa = (await request(app).post('/api/admin/v1/auth/login').send({ email: 'sa@flowlabs.test', password: 'motdepasse123' })).body.access_token;
    const ca = (await request(app).post('/api/admin/v1/auth/login').send({ email: 'ca@acme.test', password: 'motdepasse123' })).body.access_token;

    // Crée un second client 'beta'
    await db.upsertClient({ client_id: 'beta', name: 'Beta', status: 'active' });

    // Déclenche une mutation auditée côté 'acme' (client_admin)
    await request(app)
      .post('/api/admin/v1/bots')
      .set('Authorization', `Bearer ${ca}`)
      .send({
        bot_id: 'acme-support',
        name: 'Support Acme',
        transport: 'meta-cloud',
        system_prompt: { fr: 'p' },
        welcome: { enabled: false, message: {} },
      });

    // Déclenche une mutation auditée côté 'beta' via super_admin avec l'en-tête d'organisation
    await request(app)
      .post('/api/admin/v1/bots')
      .set('Authorization', `Bearer ${sa}`)
      .set('X-Organization-Id', 'beta')
      .send({
        bot_id: 'beta-sales',
        name: 'Sales Beta',
        transport: 'meta-cloud',
        system_prompt: { fr: 'p' },
        welcome: { enabled: false, message: {} },
      });

    // client_admin 'acme' appelle GET /audit?client_id=beta
    // L'organisation vient de l'appartenance en base (repli sur acme) : le ?client_id=beta est ignoré
    const res = await request(app)
      .get('/api/admin/v1/audit?client_id=beta')
      .set('Authorization', `Bearer ${ca}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    // Vérifie qu'aucune entrée n'a client_id === 'beta' (scoping anti-escalade en vigueur)
    const betaEntries = res.body.filter((e: { client_id: string }) => e.client_id === 'beta');
    expect(betaEntries.length).toBe(0);

    // Vérifie que toutes les entrées ont client_id === 'acme'
    const allHaveAcme = res.body.every((e: { client_id: string }) => e.client_id === 'acme');
    expect(allHaveAcme).toBe(true);

    // Vérifie que l'audit de 'acme' (bot.create) est présent
    expect(res.body.some((e: { action: string; target: string }) => e.action === 'bot.create' && e.target === 'bot:acme/acme-support')).toBe(true);
  });
});
