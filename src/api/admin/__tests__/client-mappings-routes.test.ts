import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { serve } from '../../../test-support/http.js';
import { createSqliteDriver } from '../../../core/database/sqlite.js';
import { __setDatabaseForTests } from '../../../core/database/index.js';
import { resetConfigStore, upsertBot } from '../../../core/config-store.js';
import type { BotRecord } from '../../../core/database/types.js';
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
import { seedOrgMember, seedSuperAdmin } from '../../../core/auth/__tests__/fixtures.js';
import { createAdminRouter } from '../router.js';

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
  crm: null, personality: null, entity_id: null,
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
    botService: new BotService({ db }), entityService: new EntityService({ db }), settingsService: new SettingsService({ db }), userAdminService: new UserAdminService({ db, mailer: new FakeMailer() }),
    connectionsService: new ConnectionsService({ db, credentials }),
    dashboardService: new DashboardService({ db, credentials }),
    simulateService: new SimulateService({ chatFn: vi.fn() as never }),
  }));
  await seedOrgMember(db, { email: 'ca@acme.test', password: 'motdepasse123', clientId: 'acme', grants: 'admin' });
  await seedSuperAdmin(db, 'sa@flowlabs.test', 'motdepasse123');
  await upsertBot(botRec, []);
  return { app, db };
}

// Mapping valide conforme a FieldMappingSchema (version: number, connector/client_id requis)
const VALID_MAPPING = {
  version: 1,
  connector: 'hubspot',
  target_object: 'contact',
  client_id: 'acme',
  field_mapping: [{ source: 'name', target: 'firstname' }],
};

describe('client-level mappings (super-admin)', () => {
  it('PUT puis GET /clients/:id/mappings/:connector', async () => {
    const { app } = await build();
    const sa = (await request(await serve(app)).post('/api/admin/v1/auth/login').send({ email: 'sa@flowlabs.test', password: 'motdepasse123' })).body.access_token;
    const put = await request(await serve(app))
      .put('/api/admin/v1/clients/acme/mappings/hubspot')
      .set('Authorization', `Bearer ${sa}`)
      .send(VALID_MAPPING);
    expect(put.status).toBe(204);
    const get = await request(await serve(app))
      .get('/api/admin/v1/clients/acme/mappings/hubspot')
      .set('Authorization', `Bearer ${sa}`);
    expect(get.status).toBe(200);
    expect(get.body.target_object).toBe('contact');
  });

  it('admin d\'organisation interdit (super-admin only)', async () => {
    const { app } = await build();
    const ca = (await request(await serve(app)).post('/api/admin/v1/auth/login').send({ email: 'ca@acme.test', password: 'motdepasse123' })).body.access_token;
    const res = await request(await serve(app))
      .get('/api/admin/v1/clients/acme/mappings/hubspot')
      .set('Authorization', `Bearer ${ca}`);
    expect(res.status).toBe(403);
  });
});
