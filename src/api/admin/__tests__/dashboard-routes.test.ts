import { beforeEach, describe, expect, it } from 'vitest';
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
import { hashPassword } from '../../../core/auth/passwords.js';
import { createAdminRouter } from '../router.js';

class FakeMailer implements Mailer { async sendInvitation() {} async sendPasswordReset() {} }
const KEY = '0'.repeat(64);
const botRec: BotRecord = { client_id: 'acme', bot_id: 'sales', name: 'Ventes', transport: 'meta-cloud', status: 'draft', default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'a' }, lead_fields: '', welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null };

async function build(): Promise<{ app: express.Express; db: Database }> {
  process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!';
  process.env['ADMIN_BCRYPT_ROUNDS'] = '4';
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = KEY;
  const db = createSqliteDriver(':memory:'); __setDatabaseForTests(db); resetConfigStore();
  const mailer = new FakeMailer();
  const credentials = new CredentialsService({ db });
  const app = express();
  app.use('/api/admin/v1', createAdminRouter({
    db, authService: new AuthService({ db, mailer }), adminService: new AdminService({ db, mailer }),
    botService: new BotService({ db }), connectionsService: new ConnectionsService({ db, credentials }),
    dashboardService: new DashboardService({ db, credentials }),
    simulateService: new SimulateService({}),
  }));
  await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
  await db.createUser({ email: 'ca@acme.test', password_hash: await hashPassword('motdepasse123'), role: 'client_admin', client_id: 'acme', status: 'active' });
  await upsertBot(botRec, ['+33611111111']);
  return { app, db };
}
async function bearer(app: express.Express): Promise<string> {
  return (await request(app).post('/api/admin/v1/auth/login').send({ email: 'ca@acme.test', password: 'motdepasse123' })).body.access_token as string;
}

describe('dashboard routes — health', () => {
  let app: express.Express;
  beforeEach(async () => { ({ app } = await build()); });

  it('GET health renvoie l\'état des connexions', async () => {
    const tok = await bearer(app);
    const res = await request(app).get('/api/admin/v1/bots/sales/health').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('draft');
    expect(res.body.numbers).toEqual(['33611111111']);
    expect(res.body.whatsapp.validated).toBe(false);
    expect(res.body.llm.mode).toBe('platform');
    expect(res.body.crm.configured).toBe(false);
  });

  it('health 404 pour un bot inconnu', async () => {
    const tok = await bearer(app);
    const res = await request(app).get('/api/admin/v1/bots/ghost/health').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(404);
  });

  it('health exige l\'auth', async () => {
    const res = await request(app).get('/api/admin/v1/bots/sales/health');
    expect(res.status).toBe(401);
  });
});
