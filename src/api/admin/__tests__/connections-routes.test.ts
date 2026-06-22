import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import type { Mailer } from '../../../core/auth/mailer.js';
import { hashPassword } from '../../../core/auth/passwords.js';
import { createAdminRouter } from '../router.js';

class FakeMailer implements Mailer { async sendInvitation() {} async sendPasswordReset() {} }
const KEY = '0'.repeat(64);
const botRec: BotRecord = { client_id: 'acme', bot_id: 'sales', name: 'Ventes', transport: 'meta-cloud', status: 'draft', default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'a' }, lead_fields: '', welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null };

async function bearer(app: express.Express): Promise<string> {
  return (await request(app).post('/api/admin/v1/auth/login').send({ email: 'ca@acme.test', password: 'motdepasse123' })).body.access_token as string;
}

describe('connections routes', () => {
  let db: Database; let app: express.Express;
  beforeEach(async () => {
    process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!';
    process.env['ADMIN_BCRYPT_ROUNDS'] = '4';
    process.env['CREDENTIALS_ENCRYPTION_KEY'] = KEY;
    db = createSqliteDriver(':memory:'); __setDatabaseForTests(db); resetConfigStore();
    const mailer = new FakeMailer();
    const credentials = new CredentialsService({ db });
    app = express();
    app.use('/api/admin/v1', createAdminRouter({
      db, authService: new AuthService({ db, mailer }), adminService: new AdminService({ db, mailer }),
      botService: new BotService({ db }), connectionsService: new ConnectionsService({ db, credentials }),
    }));
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.createUser({ email: 'ca@acme.test', password_hash: await hashPassword('motdepasse123'), role: 'client_admin', client_id: 'acme', status: 'active' });
    await upsertBot(botRec, ['+33611111111']);
  });
  afterEach(() => { resetConfigStore(); vi.unstubAllGlobals(); });

  it('PUT transport (masqué au GET) puis validate OK', async () => {
    const tok = await bearer(app);
    const put = await request(app).put('/api/admin/v1/bots/sales/transport').set('Authorization', `Bearer ${tok}`).send({ values: { phone_number_id: '123', access_token: 'EAAtok9876', app_secret: 'sek5555' } });
    expect(put.status).toBe(204);
    const get = await request(app).get('/api/admin/v1/bots/sales/transport').set('Authorization', `Bearer ${tok}`);
    expect(get.body.fields.access_token).toBe('••••9876');
    expect(get.body.validated_at).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' }));
    const val = await request(app).post('/api/admin/v1/bots/sales/transport/validate').set('Authorization', `Bearer ${tok}`);
    expect(val.body.ok).toBe(true);
  });

  it('GET /connectors renvoie le catalogue', async () => {
    const tok = await bearer(app);
    const res = await request(app).get('/api/admin/v1/connectors').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('PUT mapping invalide → 400', async () => {
    const tok = await bearer(app);
    const bad = await request(app).put('/api/admin/v1/bots/sales/mappings/hubspot').set('Authorization', `Bearer ${tok}`).send({ version: 'x' });
    expect(bad.status).toBe(400);
  });

  it('isolation : autre client ne peut pas écrire le transport du bot', async () => {
    await db.upsertClient({ client_id: 'other', name: 'O', status: 'active' });
    await db.createUser({ email: 'o@o.test', password_hash: await hashPassword('motdepasse123'), role: 'client_admin', client_id: 'other', status: 'active' });
    const tokO = (await request(app).post('/api/admin/v1/auth/login').send({ email: 'o@o.test', password: 'motdepasse123' })).body.access_token;
    const put = await request(app).put('/api/admin/v1/bots/sales/transport').set('Authorization', `Bearer ${tokO}`).send({ values: { phone_number_id: '1', access_token: '2', app_secret: '3' } });
    expect(put.status).toBe(404); // scopé sur 'other' -> bot 'sales' introuvable
  });
});
