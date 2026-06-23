import { beforeEach, describe, expect, it, vi } from 'vitest';
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

class FakeMailer implements Mailer {
  async sendInvitation() {}
  async sendPasswordReset() {}
}
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

describe('simulate routes', () => {
  let db: Database;
  let app: express.Express;

  beforeEach(async () => {
    process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!';
    process.env['ADMIN_BCRYPT_ROUNDS'] = '4';
    process.env['CREDENTIALS_ENCRYPTION_KEY'] = KEY;
    db = createSqliteDriver(':memory:');
    __setDatabaseForTests(db);
    resetConfigStore();
    const mailer = new FakeMailer();
    const credentials = new CredentialsService({ db });
    app = express();
    app.use(
      '/api/admin/v1',
      createAdminRouter({
        db,
        authService: new AuthService({ db, mailer }),
        adminService: new AdminService({ db, mailer }),
        botService: new BotService({ db }),
        connectionsService: new ConnectionsService({ db, credentials }),
        dashboardService: new DashboardService({ db, credentials }),
        simulateService: new SimulateService({
          chatFn: vi.fn().mockResolvedValue('réponse simulée') as never,
        }),
      }),
    );
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.createUser({
      email: 'ca@acme.test',
      password_hash: await hashPassword('motdepasse123'),
      role: 'client_admin',
      client_id: 'acme',
      status: 'active',
    });
    await upsertBot(botRec, []);
  });

  it('POST simulate renvoie reply + session_id + model', async () => {
    const tok = (
      await request(app)
        .post('/api/admin/v1/auth/login')
        .send({ email: 'ca@acme.test', password: 'motdepasse123' })
    ).body.access_token;
    const res = await request(app)
      .post('/api/admin/v1/bots/sales/simulate')
      .set('Authorization', `Bearer ${tok}`)
      .send({ message: 'salut' });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('réponse simulée');
    expect(res.body.session_id).toBeTruthy();
    expect(res.body.model).toBe('claude-haiku-4-5-20251001');
  });

  it('message vide → 400', async () => {
    const tok = (
      await request(app)
        .post('/api/admin/v1/auth/login')
        .send({ email: 'ca@acme.test', password: 'motdepasse123' })
    ).body.access_token;
    const res = await request(app)
      .post('/api/admin/v1/bots/sales/simulate')
      .set('Authorization', `Bearer ${tok}`)
      .send({ message: '' });
    expect(res.status).toBe(400);
  });
});
