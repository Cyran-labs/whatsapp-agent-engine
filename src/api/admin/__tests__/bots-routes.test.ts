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
import type { Mailer } from '../../../core/auth/mailer.js';
import { hashPassword } from '../../../core/auth/passwords.js';
import { createAdminRouter } from '../router.js';

class FakeMailer implements Mailer {
  async sendInvitation() {} async sendPasswordReset() {}
}

const bot = { bot_id: 'immo', name: 'Immo', transport: 'meta-cloud', system_prompt: { fr: 'Agent.' }, lead_fields: 'nom', welcome: { enabled: false, message: {} } };

async function bearer(app: express.Express, email: string, password: string): Promise<string> {
  return (await request(app).post('/api/admin/v1/auth/login').send({ email, password })).body.access_token as string;
}

describe('bots routes', () => {
  let db: Database;
  let app: express.Express;
  beforeEach(async () => {
    process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!';
    process.env['ADMIN_BCRYPT_ROUNDS'] = '4';
    db = createSqliteDriver(':memory:'); __setDatabaseForTests(db); resetConfigStore();
    const mailer = new FakeMailer();
    app = express();
    app.use('/api/admin/v1', createAdminRouter({
      db, authService: new AuthService({ db, mailer }),
      adminService: new AdminService({ db, mailer }), botService: new BotService({ db }),
    }));
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.createUser({ email: 'ca@acme.test', password_hash: await hashPassword('motdepasse123'), role: 'client_admin', client_id: 'acme', status: 'active' });
    await db.createUser({ email: 'ca2@other.test', password_hash: await hashPassword('motdepasse123'), role: 'client_admin', client_id: 'other', status: 'active' });
    await db.upsertClient({ client_id: 'other', name: 'Other', status: 'active' });
  });
  afterEach(() => { resetConfigStore(); });

  it('client_admin crée un bot puis le liste (scopé)', async () => {
    const tok = await bearer(app, 'ca@acme.test', 'motdepasse123');
    const created = await request(app).post('/api/admin/v1/bots').set('Authorization', `Bearer ${tok}`).send(bot);
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('draft');
    const list = await request(app).get('/api/admin/v1/bots').set('Authorization', `Bearer ${tok}`);
    expect(list.body).toHaveLength(1);
  });

  it('isolation : un autre client_admin ne voit pas le bot', async () => {
    const tokA = await bearer(app, 'ca@acme.test', 'motdepasse123');
    await request(app).post('/api/admin/v1/bots').set('Authorization', `Bearer ${tokA}`).send(bot);
    const tokB = await bearer(app, 'ca2@other.test', 'motdepasse123');
    const list = await request(app).get('/api/admin/v1/bots').set('Authorization', `Bearer ${tokB}`);
    expect(list.body).toHaveLength(0);
    // accès direct au bot de acme depuis other -> 404 (scopé sur other)
    const direct = await request(app).get('/api/admin/v1/bots/immo').set('Authorization', `Bearer ${tokB}`);
    expect(direct.status).toBe(404);
  });

  it('numbers + activation', async () => {
    const tok = await bearer(app, 'ca@acme.test', 'motdepasse123');
    await request(app).post('/api/admin/v1/bots').set('Authorization', `Bearer ${tok}`).send(bot);
    const noNum = await request(app).put('/api/admin/v1/bots/immo/status').set('Authorization', `Bearer ${tok}`).send({ status: 'active' });
    expect(noNum.status).toBe(409);
    await request(app).put('/api/admin/v1/bots/immo/numbers').set('Authorization', `Bearer ${tok}`).send({ numbers: ['+33611111111'] });
    const active = await request(app).put('/api/admin/v1/bots/immo/status').set('Authorization', `Bearer ${tok}`).send({ status: 'active' });
    expect(active.status).toBe(200);
    expect(active.body.status).toBe('active');
  });

  it('sans token → 401 ; payload invalide → 400', async () => {
    expect((await request(app).get('/api/admin/v1/bots')).status).toBe(401);
    const tok = await bearer(app, 'ca@acme.test', 'motdepasse123');
    const bad = await request(app).post('/api/admin/v1/bots').set('Authorization', `Bearer ${tok}`).send({ bot_id: 'Bad Id' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });
});
