import { beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { serve } from '../../../test-support/http.js';
import { createSqliteDriver } from '../../../core/database/sqlite.js';
import { __setDatabaseForTests } from '../../../core/database/index.js';
import { resetConfigStore, upsertBot } from '../../../core/config-store.js';
import type { Database, BotRecord } from '../../../core/database/types.js';
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
import { createMetaAccount, UNCHECKED } from '../../../test-support/whatsapp.js';
import { recordSignatureFailure, resetSignatureMonitor, SIGNATURE_REJECTION_THRESHOLD } from '../../../webhooks/signature-monitor.js';

class FakeMailer implements Mailer { async sendInvitation() {} async sendPasswordReset() {} }
const KEY = '0'.repeat(64);
const botRec: BotRecord = { client_id: 'acme', bot_id: 'sales', name: 'Ventes', status: 'draft', status_reason: null, default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'a' }, lead_fields: '', welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null, personality: null, entity_id: null };

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
    botService: new BotService({ db }), entityService: new EntityService({ db }), settingsService: new SettingsService({ db }), userAdminService: new UserAdminService({ db, mailer: new FakeMailer() }), connectionsService: new ConnectionsService({ db, credentials }),
    dashboardService: new DashboardService({ db, credentials }),
    simulateService: new SimulateService({}),
  }));
  await seedOrgMember(db, { email: 'ca@acme.test', password: 'motdepasse123', clientId: 'acme', grants: 'admin' });
  await upsertBot(botRec);
  return { app, db };
}
async function bearer(app: express.Express): Promise<string> {
  return (await request(await serve(app)).post('/api/admin/v1/auth/login').send({ email: 'ca@acme.test', password: 'motdepasse123' })).body.access_token as string;
}

describe('dashboard routes: leads', () => {
  let app: express.Express; let db: Database;
  beforeEach(async () => {
    ({ app, db } = await build());
    await db.saveLead('+33600000001', 'acme', 'sales', { phone: '+33600000001', name: 'Alice' });
    await db.saveLead('+33600000002', 'acme', 'sales', { phone: '+33600000002', name: 'Bob' });
  });

  it('GET leads paginé', async () => {
    const tok = await bearer(app);
    const res = await request(await serve(app)).get('/api/admin/v1/bots/sales/leads?page=1&page_size=10').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.page).toBe(1);
  });

  it('GET leads/:phone détail + transcript', async () => {
    const tok = await bearer(app);
    const res = await request(await serve(app)).get('/api/admin/v1/bots/sales/leads/+33600000001').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Alice');
    expect(Array.isArray(res.body.transcript)).toBe(true);
  });

  it('isolation : un autre client ne voit pas les leads de acme', async () => {
    await seedOrgMember(db, { email: 'o@o.test', password: 'motdepasse123', clientId: 'other', grants: 'admin' });
    const tokO = (await request(await serve(app)).post('/api/admin/v1/auth/login').send({ email: 'o@o.test', password: 'motdepasse123' })).body.access_token;
    const res = await request(await serve(app)).get('/api/admin/v1/bots/sales/leads').set('Authorization', `Bearer ${tokO}`);
    expect(res.status).toBe(404); // bot 'sales' introuvable pour 'other'
  });
});

describe('dashboard routes: metrics & usage', () => {
  let app: express.Express; let db: Database;
  beforeEach(async () => {
    ({ app, db } = await build());
    await db.insertLlmUsage({ client_id: 'acme', bot_id: 'sales', phone: null, call_type: 'chat', mode: 'platform', platform_key_id: null, model: 'claude-haiku-4-5-20251001', input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: 0.0001, pricing_version: null, anthropic_request_id: null });
  });
  it('GET metrics', async () => {
    const tok = await bearer(app);
    const res = await request(await serve(app)).get('/api/admin/v1/bots/sales/metrics').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.leads_total).toBe('number');
  });
  it('GET usage agrège', async () => {
    const tok = await bearer(app);
    const res = await request(await serve(app)).get('/api/admin/v1/bots/sales/usage').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(res.body.totals.calls).toBe(1);
    expect(res.body.by_model.length).toBe(1);
  });

  // revue finale M-10 : `since` est validé et lu comme un instant (le web envoie le minuit de Paris en ISO)
  it('GET usage ?since= : instant ISO et date seule acceptés et comparés comme des instants', async () => {
    const tok = await bearer(app);
    const get = async (since: string) =>
      request(await serve(app)).get(`/api/admin/v1/bots/sales/usage?since=${encodeURIComponent(since)}`).set('Authorization', `Bearer ${tok}`);
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const inOneHour = new Date(Date.now() + 3600_000).toISOString();
    const today = new Date().toISOString().slice(0, 10);
    expect((await get(hourAgo)).body.totals.calls).toBe(1);
    expect((await get(inOneHour)).body.totals.calls).toBe(0);
    expect((await get(today)).body.totals.calls).toBe(1);
  });

  // revue finale M-10
  it('GET usage ?since= invalide : 400 VALIDATION_ERROR sur since, jamais une erreur de base', async () => {
    const tok = await bearer(app);
    for (const since of ['hier', '2026-02-30', '2026-11-02T23:00:00']) {
      const res = await request(await serve(app)).get(`/api/admin/v1/bots/sales/usage?since=${encodeURIComponent(since)}`).set('Authorization', `Bearer ${tok}`);
      expect([since, res.status, res.body.error.code, res.body.error.details[0].path]).toEqual([since, 400, 'VALIDATION_ERROR', 'since']);
    }
  });
});

describe('dashboard routes: health', () => {
  let app: express.Express; let db: Database;
  beforeEach(async () => { ({ app, db } = await build()); });

  it('GET health renvoie l\'état des connexions (sans numéro branché)', async () => {
    const tok = await bearer(app);
    const res = await request(await serve(app)).get('/api/admin/v1/bots/sales/health').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('draft');
    expect(res.body.status_reason).toBeNull();
    expect(res.body).not.toHaveProperty('numbers');
    expect(res.body.whatsapp).toEqual({ number: null });
    expect(res.body.llm.mode).toBe('platform');
    expect(res.body.crm.configured).toBe(false);
  });

  it('GET health : numéro branché avec son compte (état affiché), motif de pause automatique', async () => {
    const tok = await bearer(app);
    const fixture = await createMetaAccount(db, {
      clientId: 'acme', wabaId: '1111111111', metaAppId: 'app-acme', accessToken: 'EAAG-acme', appSecret: 'secret-acme',
      verifyToken: 'verify-acme', webhookKey: 'cle-acme', numbers: [{ phone: '+33100000001', providerNumberId: 'pn-1' }],
    });
    const numberId = fixture.numbers['+33100000001']!.id;
    expect((await db.assignNumber('acme', 'sales', numberId, UNCHECKED)).ok).toBe(true);
    for (let i = 0; i <= SIGNATURE_REJECTION_THRESHOLD; i++) recordSignatureFailure(fixture.account.id);
    try {
      const res = await request(await serve(app)).get('/api/admin/v1/bots/sales/health').set('Authorization', `Bearer ${tok}`);
      expect(res.body.whatsapp.number).toEqual({
        id: numberId, phone_e164: '+33100000001', display_name: '+33100000001', is_test: false, provider_state: 'present', quality: 'GREEN',
        delivery_failures: 0, last_delivery_error_code: null,
        account: { id: fixture.account.id, name: fixture.account.name, mode: 'meta_manual', state: 'error', error_reason: 'signature_rejected',
          // contre-audit D-1 : de simples signatures rejetées n'enregistrent ni motif ni cause
          error_detail: null, error_cause: null,
      // Lot R1 : compte Meta jamais relu chez Meta (créé par le store) : webhooks inconnus, état Meta non lu.
      webhooks: { waba: 'unknown', app: 'unknown', app_host: null, checked_at: null }, meta_health: null,
        },
      });
    } finally {
      resetSignatureMonitor();
    }
    // Retrait chez le fournisseur : l'agent IA (servant) passe en pause avec motif, le numéro reste affiché retiré.
    await db.replaceAllowlist('acme', 'sales', ['+33612345678']);
    expect((await db.transitionBotStatus('acme', 'sales', 'limited')).ok).toBe(true);
    await db.applyInventory('acme', fixture.account.id, [{
      provider_number_id: 'pn-autre', phone_e164: '+33100000099', display_name: 'Autre', meta_status: 'CONNECTED', quality: 'GREEN',
      is_test: false, cm_channel_id: null,
    }]);
    const paused = await request(await serve(app)).get('/api/admin/v1/bots/sales/health').set('Authorization', `Bearer ${tok}`);
    expect(paused.body).toMatchObject({ status: 'paused', status_reason: 'number_removed', whatsapp: { number: { id: numberId, provider_state: 'removed' } } });
  });

  it('health 404 pour un bot inconnu', async () => {
    const tok = await bearer(app);
    const res = await request(await serve(app)).get('/api/admin/v1/bots/ghost/health').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(404);
  });

  it('health exige l\'auth', async () => {
    const res = await request(await serve(app)).get('/api/admin/v1/bots/sales/health');
    expect(res.status).toBe(401);
  });
});
