/**
 * Coûts réservés à l'admin (spec « Refonte de la navigation », 9.1 et 15.5) : `GET /bots/:botId/usage` est la seule
 * route du moteur qui renvoie des coûts. Le contrôle des droits précède la lecture de l'agent IA : un non-admin reçoit
 * le même 403 pour son agent IA, un identifiant inconnu ou un agent IA d'une autre organisation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { serve } from '../../../test-support/http.js';
import { createTestDatabase } from '../../../test-support/test-database.js';
import { __setDatabaseForTests } from '../../../core/database/index.js';
import { resetConfigStore, upsertBot } from '../../../core/config-store.js';
import type { BotRecord, Database } from '../../../core/database/types.js';
import type { MembershipGrantRecord } from '../../../core/database/accounts-types.js';
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

function botFor(clientId: string, botId: string, entityId: number): BotRecord {
  return {
    client_id: clientId, bot_id: botId, name: botId, status: 'draft', status_reason: null,
    default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'a' }, lead_fields: '',
    welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null, personality: null,
    entity_id: entityId,
  };
}

/** Corps d'un refus sans sa référence de requête (amendement A-11). */
function refusal(res: request.Response): unknown {
  const error = (res.body.error ?? {}) as Record<string, unknown>;
  return { status: res.status, code: error['code'], reason: error['reason'], message: error['message'] };
}

describe('GET /bots/:botId/usage : coûts réservés à l\'admin', () => {
  let db: Database;
  let app: express.Express;

  const usage = async (email: string, botId: string): Promise<request.Response> => {
    const login = await request(await serve(app)).post(`${BASE}/auth/login`).send({ email, password: PWD });
    expect(login.status).toBe(200);
    return request(await serve(app)).get(`${BASE}/bots/${botId}/usage`)
      .set('Authorization', `Bearer ${login.body.access_token as string}`).set('X-Organization-Id', 'acme');
  };

  beforeEach(async () => {
    vi.stubEnv('ADMIN_JWT_SECRET', 'test-secret-at-least-32-bytes-long!!');
    vi.stubEnv('ADMIN_BCRYPT_ROUNDS', '4');
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '0'.repeat(64));
    db = await createTestDatabase(); __setDatabaseForTests(db); resetConfigStore();
    const mailer = new FakeMailer();
    const credentials = new CredentialsService({ db });
    app = express();
    app.use(BASE, createAdminRouter({
      db, authService: new AuthService({ db, mailer }), adminService: new AdminService({ db, mailer }),
      botService: new BotService({ db }), entityService: new EntityService({ db }), settingsService: new SettingsService({ db }),
      userAdminService: new UserAdminService({ db, mailer }), connectionsService: new ConnectionsService({ db, credentials }),
      dashboardService: new DashboardService({ db, credentials }), simulateService: new SimulateService({}),
    }));
    const entityId = (await seedOrgMember(db, { email: 'admin@acme.test', password: PWD, clientId: 'acme', grants: 'admin' })).entityId;
    const betaEntity = (await seedOrgMember(db, { email: 'admin@beta.test', password: PWD, clientId: 'beta', grants: 'admin' })).entityId;
    await seedSuperAdmin(db, 'root@plateforme.test', PWD);
    const members: Record<string, MembershipGrantRecord[]> = {
      'super-manager@acme.test': [{ entity_id: null, role: 'super_manager' }],
      'super-manager-ro@acme.test': [{ entity_id: null, role: 'super_manager', read_only: true }],
      'manager@acme.test': [{ entity_id: entityId, role: 'manager' }],
      'advisor@acme.test': [{ entity_id: entityId, role: 'advisor' }],
    };
    for (const [email, grants] of Object.entries(members)) {
      await seedOrgMember(db, { email, password: PWD, clientId: 'acme', grants });
    }
    await upsertBot(botFor('acme', 'ventes', entityId));
    await upsertBot(botFor('beta', 'accueil', betaEntity));
    await db.insertLlmUsage({
      client_id: 'acme', bot_id: 'ventes', phone: null, call_type: 'reply', mode: 'platform', platform_key_id: null,
      model: 'claude-haiku-4-5', input_tokens: 100, output_tokens: 20, cache_read_tokens: 0, cache_creation_tokens: 0,
      cost_usd: 0.25, pricing_version: null, anthropic_request_id: null,
    });
  });

  afterEach(async () => {
    resetConfigStore();
    await db.close();
    vi.unstubAllEnvs();
  });

  // nav 15.5
  it.each([['admin', 'admin@acme.test'], ['opérateur', 'root@plateforme.test']])('%s : 200 avec les coûts', async (_who, email) => {
    const res = await usage(email, 'ventes');
    expect(res.status).toBe(200);
    expect(res.body.totals).toMatchObject({ calls: 1, cost_usd: 0.25 });
  });

  // nav 15.5
  it.each([
    ['super manager', 'super-manager@acme.test'],
    ['super manager en lecture seule', 'super-manager-ro@acme.test'],
    ['manager', 'manager@acme.test'],
    ['conseiller', 'advisor@acme.test'],
  ])('%s : 403 générique, sans clé de refus', async (_who, email) => {
    const res = await usage(email, 'ventes');
    expect(refusal(res)).toEqual({ status: 403, code: 'FORBIDDEN', reason: undefined, message: 'Accès refusé.' });
    expect(JSON.stringify(res.body)).not.toMatch(/cost|0\.25|totals/);
  });

  // nav 15.5 : aucun indice d'existence
  it.each([
    ['super manager', 'super-manager@acme.test'],
    ['manager', 'manager@acme.test'],
    ['conseiller', 'advisor@acme.test'],
  ])('%s : même refus pour son agent IA, un identifiant inconnu et un agent IA d\'une autre organisation', async (_who, email) => {
    const own = refusal(await usage(email, 'ventes'));
    expect(refusal(await usage(email, 'inconnu'))).toEqual(own);
    expect(refusal(await usage(email, 'accueil'))).toEqual(own);
  });

  // nav 15.5 : comportement actuel à garder
  it("admin d'acme sur l'agent IA de beta : 404, comme un agent IA inconnu", async () => {
    const res = await usage('admin@acme.test', 'accueil');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', reason: 'bot.not_found' });
    expect(refusal(res)).toEqual(refusal(await usage('admin@acme.test', 'inconnu')));
  });
});
