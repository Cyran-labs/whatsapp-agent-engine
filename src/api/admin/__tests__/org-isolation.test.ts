import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
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
import { seedOrgMember, seedSuperAdmin } from '../../../core/auth/__tests__/fixtures.js';
import { createAdminRouter } from '../router.js';

class FakeMailer implements Mailer { async sendInvitation() {} async sendPasswordReset() {} }

const PWD = 'motdepasse123';
const BASE = '/api/admin/v1';

function botFor(clientId: string): BotRecord {
  return {
    client_id: clientId, bot_id: 'sales', name: 'Ventes', transport: 'meta-cloud', status: 'draft',
    default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'a' }, lead_fields: '',
    welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null,
  };
}

async function login(app: express.Express, email: string): Promise<string> {
  return (await request(await serve(app)).post(`${BASE}/auth/login`).send({ email, password: PWD })).body.access_token as string;
}

describe('isolation par organisation et droits par action', () => {
  let db: Database;
  let app: express.Express;
  let acmeEntity: number;

  beforeEach(async () => {
    process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!';
    process.env['ADMIN_BCRYPT_ROUNDS'] = '4';
    process.env['CREDENTIALS_ENCRYPTION_KEY'] = '0'.repeat(64);
    db = createSqliteDriver(':memory:'); __setDatabaseForTests(db); resetConfigStore();
    const mailer = new FakeMailer();
    const credentials = new CredentialsService({ db });
    app = express();
    app.use(BASE, createAdminRouter({
      db, authService: new AuthService({ db, mailer }), adminService: new AdminService({ db, mailer }),
      botService: new BotService({ db }), entityService: new EntityService({ db }), settingsService: new SettingsService({ db }), userAdminService: new UserAdminService({ db, mailer: new FakeMailer() }), connectionsService: new ConnectionsService({ db, credentials }),
      dashboardService: new DashboardService({ db, credentials }),
      simulateService: new SimulateService({ chatFn: vi.fn().mockResolvedValue('réponse simulée') as never }),
    }));
    acmeEntity = (await seedOrgMember(db, { email: 'admin@acme.test', password: PWD, clientId: 'acme', grants: 'admin' })).entityId;
    await seedOrgMember(db, { email: 'admin@other.test', password: PWD, clientId: 'other', grants: 'admin' });
    await upsertBot(botFor('acme'), []);
    await upsertBot({ ...botFor('other'), name: 'Ventes other' }, []);
    await db.saveLead('+33600000009', 'other', 'sales', { phone: '+33600000009', name: 'Zoé' });
  });
  afterEach(() => { resetConfigStore(); vi.unstubAllGlobals(); });

  it('admin de acme avec l\'en-tête other : 403 sur GET /bots', async () => {
    const tok = await login(app, 'admin@acme.test');
    const res = await request(await serve(app)).get(`${BASE}/bots`).set('Authorization', `Bearer ${tok}`).set('X-Organization-Id', 'other');
    expect(res.status).toBe(403);
  });

  it('admin de acme avec l\'en-tête acme : le bot de other est introuvable (404)', async () => {
    const tok = await login(app, 'admin@acme.test');
    await db.deleteBotRecord('acme', 'sales');
    const bot = await request(await serve(app)).get(`${BASE}/bots/sales`).set('Authorization', `Bearer ${tok}`).set('X-Organization-Id', 'acme');
    expect(bot.status).toBe(404);
    const leads = await request(await serve(app)).get(`${BASE}/bots/sales/leads`).set('Authorization', `Bearer ${tok}`).set('X-Organization-Id', 'acme');
    expect(leads.status).toBe(404);
  });

  it('admin de acme sans en-tête : repli sur acme, ne voit que ses bots', async () => {
    const tok = await login(app, 'admin@acme.test');
    const res = await request(await serve(app)).get(`${BASE}/bots`).set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Ventes');
  });

  describe('conseiller de acme', () => {
    let tok: string;
    beforeEach(async () => {
      await seedOrgMember(db, {
        email: 'advisor@acme.test', password: PWD, clientId: 'acme',
        grants: [{ entity_id: acmeEntity, role: 'advisor' }],
      });
      tok = await login(app, 'advisor@acme.test');
    });

    it('lit les bots (200)', async () => {
      const res = await request(await serve(app)).get(`${BASE}/bots`).set('Authorization', `Bearer ${tok}`);
      expect(res.status).toBe(200);
    });

    it('ne crée pas de bot (403)', async () => {
      const res = await request(await serve(app)).post(`${BASE}/bots`).set('Authorization', `Bearer ${tok}`).send({
        bot_id: 'support', name: 'Support', transport: 'meta-cloud', system_prompt: { fr: 'p' },
        welcome: { enabled: false, message: {} },
      });
      expect(res.status).toBe(403);
    });

    it('ne modifie pas la configuration d\'un bot (403)', async () => {
      const res = await request(await serve(app)).put(`${BASE}/bots/sales/llm`).set('Authorization', `Bearer ${tok}`).send({});
      expect(res.status).toBe(403);
    });

    it('peut simuler (pas de 403)', async () => {
      const res = await request(await serve(app)).post(`${BASE}/bots/sales/simulate`).set('Authorization', `Bearer ${tok}`).send({ message: 'salut' });
      expect(res.status).not.toBe(403);
      expect(res.status).toBe(200);
    });

    it('ne lit pas le journal d\'audit (403)', async () => {
      const res = await request(await serve(app)).get(`${BASE}/audit`).set('Authorization', `Bearer ${tok}`);
      expect(res.status).toBe(403);
    });
  });

  it('super manager en lecture seule : simulation refusée (403), lecture permise', async () => {
    await seedOrgMember(db, {
      email: 'sm@acme.test', password: PWD, clientId: 'acme',
      grants: [{ entity_id: null, role: 'super_manager', read_only: true }],
    });
    const tok = await login(app, 'sm@acme.test');
    const sim = await request(await serve(app)).post(`${BASE}/bots/sales/simulate`).set('Authorization', `Bearer ${tok}`).send({ message: 'salut' });
    expect(sim.status).toBe(403);
    const read = await request(await serve(app)).get(`${BASE}/bots`).set('Authorization', `Bearer ${tok}`);
    expect(read.status).toBe(200);
  });

  it('super admin : en-tête obligatoire, puis accès à l\'organisation désignée', async () => {
    await seedSuperAdmin(db, 'root@wab.test', PWD);
    const tok = await login(app, 'root@wab.test');
    const without = await request(await serve(app)).get(`${BASE}/bots`).set('Authorization', `Bearer ${tok}`);
    expect(without.status).toBe(400);
    const ok = await request(await serve(app)).get(`${BASE}/bots`).set('Authorization', `Bearer ${tok}`).set('X-Organization-Id', 'other');
    expect(ok.status).toBe(200);
    expect(ok.body[0].name).toBe('Ventes other');
  });

  it('le paramètre ?client_id n\'a aucun effet sur l\'organisation', async () => {
    const tok = await login(app, 'admin@acme.test');
    const res = await request(await serve(app)).get(`${BASE}/bots?client_id=other`).set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(res.body[0].name).toBe('Ventes');
  });

  it('organisation suspendue : membre 403 « Organisation suspendue. », super admin 200 (R12)', async () => {
    await db.upsertClient({ client_id: 'acme', name: 'acme', status: 'suspended' });
    const member = await login(app, 'admin@acme.test');
    const refused = await request(await serve(app)).get(`${BASE}/bots`).set('Authorization', `Bearer ${member}`).set('X-Organization-Id', 'acme');
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toBe('Organisation suspendue.');
    await seedSuperAdmin(db, 'root@wab.test', PWD);
    const root = await login(app, 'root@wab.test');
    const allowed = await request(await serve(app)).get(`${BASE}/bots`).set('Authorization', `Bearer ${root}`).set('X-Organization-Id', 'acme');
    expect(allowed.status).toBe(200);
  });

  describe('agent d\'une autre organisation : 404 « Bot introuvable. » (R15)', () => {
    let tok: string;
    beforeEach(async () => {
      await upsertBot({ ...botFor('other'), bot_id: 'solo', name: 'Solo other' }, []);
      tok = await login(app, 'admin@acme.test');
    });

    const cases: Array<{ label: string; send: (server: Server, url: string) => request.Test; suffix: string; body?: object }> = [
      { label: 'GET', send: (s, u) => request(s).get(u), suffix: '/crm/hubspot' },
      { label: 'GET', send: (s, u) => request(s).get(u), suffix: '/mappings/hubspot' },
      { label: 'POST', send: (s, u) => request(s).post(u), suffix: '/crm/hubspot/validate' },
      { label: 'POST', send: (s, u) => request(s).post(u), suffix: '/simulate', body: { message: 'salut' } },
      { label: 'PATCH', send: (s, u) => request(s).patch(u), suffix: '', body: { name: 'Renommé' } },
    ];
    for (const { label, send, suffix, body } of cases) {
      it(`${label} /bots/solo${suffix} avec l'en-tête acme : 404`, async () => {
        const test = send(await serve(app), `${BASE}/bots/solo${suffix}`).set('Authorization', `Bearer ${tok}`).set('X-Organization-Id', 'acme');
        const res = body ? await test.send(body) : await test;
        expect(res.status).toBe(404);
        expect(res.body.error.message).toBe('Bot introuvable.');
      });
    }

    it('mapping absent pour un bot existant : « Mapping introuvable. » conservé', async () => {
      const res = await request(await serve(app)).get(`${BASE}/bots/sales/mappings/hubspot`).set('Authorization', `Bearer ${tok}`).set('X-Organization-Id', 'acme');
      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('Mapping introuvable.');
    });
  });
});
