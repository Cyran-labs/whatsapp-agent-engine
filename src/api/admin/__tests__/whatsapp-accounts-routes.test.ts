import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { serve } from '../../../test-support/http.js';
import { createTestDatabase } from '../../../test-support/test-database.js';
import { __setDatabaseForTests } from '../../../core/database/index.js';
import { resetConfigStore } from '../../../core/config-store.js';
import type { BotRecord, Database } from '../../../core/database/types.js';
import type { ProviderNumber } from '../../../core/database/whatsapp-types.js';
import type { ProviderVerification } from '../../../whatsapp/provider-common.js';
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
import { WhatsAppAccountService, type WhatsAppProviders } from '../../../core/services/whatsapp-account-service.js';
import { invalidateAccountTransports } from '../../../transport/index.js';
import { hashWebhookKey } from '../../../whatsapp/webhook-key.js';
import type { Mailer } from '../../../core/auth/mailer.js';
import { ORGANIZATION_HEADER } from '../../../core/auth/access-service.js';
import { createAdminRouter } from '../router.js';
import { seedOrgMember } from '../../../core/auth/__tests__/fixtures.js';
import { UNCHECKED } from '../../../test-support/whatsapp.js';
import { fakeMetaWebhooks, keyOfMetaUrl, type FakeMetaWebhooks } from '../../../test-support/meta-webhooks-fake.js';

// Les deux moteurs (SQLite par défaut, Postgres avec TEST_DATABASE_URL). Clients fournisseurs simulés.

class FakeMailer implements Mailer {
  async sendInvitation() {} async sendPasswordReset() {}
}

const BASE = '/api/admin/v1/whatsapp-accounts';
const TOKEN = 'EAAG-jeton-de-test-0123456789abcdef';
const SECRET = 'secret-app-de-test-0123456789';

function num(i: number): ProviderNumber {
  return {
    provider_number_id: `pn-${i}`, phone_e164: `+3310000000${i}`, display_name: `Boutique ${i}`, meta_status: 'CONNECTED',
    quality: 'GREEN', is_test: false, cm_channel_id: null,
  };
}

function verified(wabaId: string, appId: string, numbers: ProviderNumber[]): ProviderVerification {
  return {
    ok: true, checks: [{ key: 'token', status: 'ok' }], account_name: 'Nom', waba_id: wabaId, meta_app_id: appId,
    token_expiry: null, numbers, skipped: { sandbox: 0, invalid_number: 0 }, meta_health: null,
  };
}

function bot(clientId: string, botId: string, name: string): BotRecord {
  return {
    client_id: clientId, bot_id: botId, name, status: 'draft', status_reason: null,
    default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'Agent IA.' }, lead_fields: '',
    welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null,
    personality: null, entity_id: null,
  };
}

const metaBody = (over: Record<string, string> = {}) => ({
  mode: 'meta_manual', name: 'Compte Acme', waba_id: '1111111111', access_token: TOKEN, app_secret: SECRET, ...over,
});

/** Corps d'erreur sans l'identifiant de requête, pour comparer deux réponses. */
function errorOf(body: { error: { request_id: string } & Record<string, unknown> }): Record<string, unknown> {
  const { request_id: _ignored, ...rest } = body.error;
  void _ignored;
  return rest;
}

describe('routes des comptes WhatsApp', () => {
  let db: Database;
  let app: express.Express;
  let svc: WhatsAppAccountService;
  let providers: WhatsAppProviders;
  let metaWebhooks: FakeMetaWebhooks;

  async function bearer(email: string): Promise<string> {
    const res = await request(await serve(app)).post('/api/admin/v1/auth/login').send({ email, password: 'motdepasse123' });
    return res.body.access_token as string;
  }

  beforeEach(async () => {
    vi.stubEnv('ADMIN_JWT_SECRET', 'test-secret-at-least-32-bytes-long!!');
    vi.stubEnv('ADMIN_BCRYPT_ROUNDS', '4');
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '0'.repeat(64));
    // Lot R1 : l'adresse publique est obligatoire pour raccorder un compte Meta.
    vi.stubEnv('PUBLIC_BASE_URL', 'https://moteur.example.test');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    db = await createTestDatabase(); __setDatabaseForTests(db); resetConfigStore();
    metaWebhooks = fakeMetaWebhooks();
    providers = {
      verifyMeta: vi.fn(async (c) => verified(c.waba_id, `app-${c.waba_id}`, [num(c.waba_id === '1111111111' ? 1 : 2)])),
      listMeta: vi.fn(async () => ({ numbers: [num(1)], skipped: { sandbox: 0, invalid_number: 0 } })),
      verifyCm: vi.fn(async () => verified('x', 'y', [])),
      listCm: vi.fn(async () => ({ numbers: [], skipped: { sandbox: 0, invalid_number: 0 } })),
      metaWebhooks,
    };
    svc = new WhatsAppAccountService({ db, providers });
    const mailer = new FakeMailer();
    const credentials = new CredentialsService({ db });
    app = express();
    app.use('/api/admin/v1', createAdminRouter({
      db, authService: new AuthService({ db, mailer }),
      adminService: new AdminService({ db, mailer }), botService: new BotService({ db }),
      entityService: new EntityService({ db }), settingsService: new SettingsService({ db }),
      userAdminService: new UserAdminService({ db, mailer }),
      connectionsService: new ConnectionsService({ db, credentials }),
      dashboardService: new DashboardService({ db, credentials }),
      simulateService: new SimulateService({}),
      whatsappAccountService: svc,
    }));
    await seedOrgMember(db, { email: 'admin@acme.test', password: 'motdepasse123', clientId: 'acme', grants: 'admin' });
    await seedOrgMember(db, { email: 'admin@beta.test', password: 'motdepasse123', clientId: 'beta', grants: 'admin' });
    // Admin des deux organisations : l'organisation active est choisie par l'en-tête.
    await seedOrgMember(db, { email: 'both@x.test', password: 'motdepasse123', clientId: 'acme', grants: 'admin' });
    await seedOrgMember(db, { email: 'both@x.test', password: 'motdepasse123', clientId: 'beta', grants: 'admin' });
    await seedOrgMember(db, { email: 'sm@acme.test', password: 'motdepasse123', clientId: 'acme', grants: [{ entity_id: null, role: 'super_manager' }] });
    const entity = (await db.listEntities('acme'))[0]!;
    await seedOrgMember(db, { email: 'mgr@acme.test', password: 'motdepasse123', clientId: 'acme', grants: [{ entity_id: entity.id, role: 'manager' }] });
    await seedOrgMember(db, { email: 'adv@acme.test', password: 'motdepasse123', clientId: 'acme', grants: [{ entity_id: entity.id, role: 'advisor' }] });
    await seedOrgMember(db, {
      email: 'smro@acme.test', password: 'motdepasse123', clientId: 'acme', grants: [{ entity_id: null, role: 'super_manager', read_only: true }],
    });
  });

  afterEach(async () => {
    for (let id = 1; id <= 5; id++) invalidateAccountTransports(id);
    resetConfigStore();
    await db.close();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('admin : raccorde (201), liste, lit, renomme, vérifie, rafraîchit, marque un numéro de test, déconnecte (200 avec le bilan Meta)', async () => {
    const auth = { Authorization: `Bearer ${await bearer('admin@acme.test')}` };
    const created = await request(await serve(app)).post(BASE).set(auth).send(metaBody());
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Compte Acme', state: 'connected', inventory: { added: 1, refused: 0 } });
    // Lot R1 : le moteur inscrit lui-même le webhook chez Meta, la réponse n'en porte plus.
    expect(created.body.webhook).toBeNull();
    expect(created.body.webhooks).toMatchObject({ waba: 'ok', app: 'ok' });
    expect(JSON.stringify(created.body)).not.toContain(TOKEN);
    expect(JSON.stringify(created.body)).not.toContain(SECRET);
    const id = created.body.id as number;
    const numberId = created.body.numbers[0].id as number;

    const list = await request(await serve(app)).get(BASE).set(auth);
    expect(list.status).toBe(200);
    expect(list.body.map((a: { id: number }) => a.id)).toEqual([id]);
    expect((await request(await serve(app)).get(`${BASE}/${id}`).set(auth)).body.id).toBe(id);
    expect((await request(await serve(app)).patch(`${BASE}/${id}`).set(auth).send({ name: 'Renommé' })).body.name).toBe('Renommé');
    const verify = await request(await serve(app)).post(`${BASE}/${id}/verify`).set(auth);
    expect(verify.status).toBe(200);
    // Lot R1 : la vérification relit aussi les deux webhooks inscrits chez Meta (déjà en place, rien n'est réécrit).
    expect(verify.body.checks).toEqual([{ key: 'token', status: 'ok' }, { key: 'webhook_waba', status: 'ok' }, { key: 'webhook_app', status: 'ok' }]);
    const refreshed = await request(await serve(app)).post(`${BASE}/${id}/refresh-numbers`).set(auth);
    expect(refreshed.body.inventory).toMatchObject({ added: 0, removed: 0, refused: 0 });
    const flagged = await request(await serve(app)).patch(`${BASE}/${id}/numbers/${numberId}`).set(auth).send({ is_test: true });
    expect(flagged.status).toBe(200);
    expect(flagged.body.is_test).toBe(true);
    const replaced = await request(await serve(app)).put(`${BASE}/${id}/credentials`).set(auth)
      .send({ mode: 'meta_manual', waba_id: '1111111111', access_token: 'EAAG-nouveau-jeton-0123456789', app_secret: 'nouveau-secret-0123456789' });
    expect(replaced.status).toBe(200);
    // La clé d'URL et le jeton survivent au remplacement des identifiants ; la réponse ne les porte pas (revue 2b-3 M-2).
    expect(replaced.body).not.toHaveProperty('webhook');

    // Lot R1, spec R1 §5.5 : bilan du retrait chez Meta (dernier compte de l'app : webhook de l'app laissé).
    const disconnected = await request(await serve(app)).post(`${BASE}/${id}/disconnect`).set(auth);
    expect(disconnected.status).toBe(200);
    expect(disconnected.body).toEqual({ waba_cleanup: 'done', app_webhook: 'left' });
    expect((await request(await serve(app)).get(`${BASE}/${id}`).set(auth)).body.state).toBe('disconnected');
  });

  it("déconnexion refusée : 409 avec le message et les agents IA concernés", async () => {
    const created = await svc.create('acme', null, metaBody() as Parameters<WhatsAppAccountService['create']>[2]);
    await db.upsertBotRecord(bot('acme', 'ventes', 'Ventes'));
    await db.replaceAllowlist('acme', 'ventes', ['+33600000001']);
    expect((await db.activateWithNumber('acme', 'ventes', created.numbers[0]!.id, 'limited', null, UNCHECKED)).ok).toBe(true);
    const auth = { Authorization: `Bearer ${await bearer('admin@acme.test')}` };
    const res = await request(await serve(app)).post(`${BASE}/${created.id}/disconnect`).set(auth);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe("Mettez d'abord Offline les agents IA qui utilisent ce compte :");
    expect(res.body.error.reason).toBe('whatsapp_account.in_use');
    expect(res.body.error.details).toEqual([{ path: 'bots.ventes', message: 'Ventes' }]);
  });

  it('échec de vérification du fournisseur : 422 WA_VALIDATION_FAILED', async () => {
    vi.mocked(providers.verifyMeta).mockResolvedValueOnce({
      ok: false, checks: [{ key: 'app_secret', status: 'failed', detail: "Secret de l'app refusé" }], error_reason: 'other', message: "Secret de l'app refusé",
    });
    const auth = { Authorization: `Bearer ${await bearer('admin@acme.test')}` };
    const res = await request(await serve(app)).post(BASE).set(auth).send(metaBody());
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'WA_VALIDATION_FAILED', details: [{ path: 'app_secret', message: "Secret de l'app refusé" }] });
  });

  // revue 2b-3 M-2
  describe('secrets de webhook', () => {
    const CM_UUID = '3f9a7c52-1b84-4e0d-9a6b-5d2e8f1c7a40';

    it("les lectures et les réponses de mutation d'un compte ne contiennent ni la clé d'URL ni le jeton de vérification d'aucun compte", async () => {
      const auth = { Authorization: `Bearer ${await bearer('admin@acme.test')}` };
      const meta = await request(await serve(app)).post(BASE).set(auth).send(metaBody());
      const cm = await request(await serve(app)).post(BASE).set(auth)
        .send({ mode: 'cm_com', name: 'Compte CM', account_id: CM_UUID, product_token: 'p'.repeat(20) });
      expect([meta.status, cm.status]).toEqual([201, 201]);
      expect(meta.body.webhook).toBeNull();
      // Lot R1 : clé et jeton du compte Meta lus sur l'inscription faite chez Meta (Meta simulé).
      const inscription = metaWebhooks.calls.find((c) => c.op === 'setWabaOverride')!;
      const metaKey = keyOfMetaUrl(inscription.url!);
      const cmKey = String(cm.body.webhook.path).replace('/webhook/cm-com/', '');
      const token = inscription.verify_token!;
      for (const secret of [metaKey, token, inscription.url!]) expect(JSON.stringify(meta.body)).not.toContain(secret);
      expect(metaKey).not.toBe('');
      expect(cmKey).not.toBe('');
      expect(token).not.toBe('');

      const metaId = meta.body.id as number;
      const responses = [
        await request(await serve(app)).get(BASE).set(auth),
        await request(await serve(app)).get(`${BASE}/${metaId}`).set(auth),
        await request(await serve(app)).get(`${BASE}/${cm.body.id}`).set(auth),
        await request(await serve(app)).patch(`${BASE}/${metaId}`).set(auth).send({ name: 'Renommé' }),
        await request(await serve(app)).post(`${BASE}/${metaId}/verify`).set(auth),
        await request(await serve(app)).post(`${BASE}/${metaId}/refresh-numbers`).set(auth),
        await request(await serve(app)).patch(`${BASE}/${metaId}/numbers/${meta.body.numbers[0].id}`).set(auth).send({ is_test: true }),
        await request(await serve(app)).put(`${BASE}/${metaId}/credentials`).set(auth)
          .send({ mode: 'meta_manual', waba_id: '1111111111', access_token: 'EAAG-nouveau-jeton-0123456789', app_secret: 'nouveau-secret-0123456789' }),
      ];
      for (const res of responses) {
        expect(res.status).toBe(200);
        const text = JSON.stringify(res.body);
        for (const secret of [metaKey, cmKey, token, '/webhook/']) expect(text).not.toContain(secret);
        expect(text).not.toContain('"webhook"');
      }
      expect(responses[0]!.body).toHaveLength(2);
    });

    it("GET webhook d'un compte Meta : 404, comme un identifiant inconnu, sans secret ; CM.com : chemin seul", async () => {
      const auth = { Authorization: `Bearer ${await bearer('admin@acme.test')}` };
      const meta = await request(await serve(app)).post(BASE).set(auth).send(metaBody());
      const cm = await request(await serve(app)).post(BASE).set(auth)
        .send({ mode: 'cm_com', name: 'Compte CM', account_id: CM_UUID, product_token: 'p'.repeat(20) });
      const read = await request(await serve(app)).get(`${BASE}/${meta.body.id}/webhook`).set(auth);
      const unknown = await request(await serve(app)).get(`${BASE}/999999/webhook`).set(auth);
      expect(read.status).toBe(404);
      expect(read.body.error.reason).toBe('whatsapp_account.not_found');
      expect(errorOf(read.body)).toEqual(errorOf(unknown.body));
      // Lot R1 : ni la clé, ni l'adresse, ni le jeton de vérification inscrits chez Meta.
      const inscription = metaWebhooks.calls.find((c) => c.op === 'setWabaOverride')!;
      for (const secret of [keyOfMetaUrl(inscription.url!), inscription.verify_token!, '/webhook/']) {
        expect(JSON.stringify(read.body)).not.toContain(secret);
      }
      const readCm = await request(await serve(app)).get(`${BASE}/${cm.body.id}/webhook`).set(auth);
      expect(readCm.status).toBe(200);
      expect(readCm.body).toEqual(cm.body.webhook);
      expect(readCm.body.path).toMatch(/^\/webhook\/cm-com\//);
      // revue R1 ISO-M5 : la vue webhook ne connaît plus de jeton de vérification (CM.com n'en a pas, Meta ne sort jamais le sien).
      expect(Object.keys(readCm.body).sort()).toEqual(['path', 'url']);
    });

    it('compte déconnecté : la route dédiée ne renvoie aucun secret (CM.com : webhook vide ; Meta : 404)', async () => {
      const auth = { Authorization: `Bearer ${await bearer('admin@acme.test')}` };
      const cm = await request(await serve(app)).post(BASE).set(auth)
        .send({ mode: 'cm_com', name: 'Compte CM', account_id: CM_UUID, product_token: 'p'.repeat(20) });
      const cmDisconnected = await request(await serve(app)).post(`${BASE}/${cm.body.id}/disconnect`).set(auth);
      expect([cmDisconnected.status, cmDisconnected.body]).toEqual([200, { waba_cleanup: 'not_applicable', app_webhook: 'not_applicable' }]);
      const read = await request(await serve(app)).get(`${BASE}/${cm.body.id}/webhook`).set(auth);
      expect(read.status).toBe(200);
      expect(read.body).toEqual({ path: '', url: null });

      const meta = await request(await serve(app)).post(BASE).set(auth).send(metaBody());
      expect((await request(await serve(app)).post(`${BASE}/${meta.body.id}/disconnect`).set(auth)).status).toBe(200);
      expect((await request(await serve(app)).get(`${BASE}/${meta.body.id}/webhook`).set(auth)).status).toBe(404);
    });

    it("le compte d'une autre organisation répond 404, comme un identifiant inconnu, sans secret", async () => {
      vi.mocked(providers.verifyCm).mockResolvedValueOnce(verified('x', 'y', []));
      const beta = await svc.create('beta', null, { mode: 'cm_com', name: 'Compte Beta', account_id: CM_UUID, product_token: 'p'.repeat(20) });
      const auth = { Authorization: `Bearer ${await bearer('admin@acme.test')}` };
      const cross = await request(await serve(app)).get(`${BASE}/${beta.id}/webhook`).set(auth);
      const unknown = await request(await serve(app)).get(`${BASE}/999999/webhook`).set(auth);
      expect(cross.status).toBe(404);
      expect(errorOf(cross.body)).toEqual(errorOf(unknown.body));
      const betaWebhook = await svc.getWebhook('beta', beta.id);
      expect(betaWebhook.path).toMatch(/^\/webhook\/cm-com\//);
      expect(JSON.stringify(cross.body)).not.toContain(betaWebhook.path);
      // Le même compte, lu par son propre administrateur, répond.
      const own = await request(await serve(app)).get(`${BASE}/${beta.id}/webhook`).set({ Authorization: `Bearer ${await bearer('admin@beta.test')}` });
      expect(own.status).toBe(200);
      expect(own.body.path).toBe(betaWebhook.path);
    });
  });

  describe('droits', () => {
    const routes = (id: number, numberId: number): Array<[string, string, Record<string, unknown> | undefined]> => [
      ['get', BASE, undefined],
      ['post', BASE, metaBody({ waba_id: '5555555555' })],
      ['get', `${BASE}/${id}`, undefined],
      ['get', `${BASE}/${id}/webhook`, undefined],
      ['patch', `${BASE}/${id}`, { name: 'X' }],
      ['put', `${BASE}/${id}/credentials`, { mode: 'meta_manual', waba_id: '1111111111', access_token: TOKEN, app_secret: SECRET }],
      ['post', `${BASE}/${id}/verify`, undefined],
      ['post', `${BASE}/${id}/refresh-numbers`, undefined],
      ['post', `${BASE}/${id}/app-webhook`, undefined],
      ['post', `${BASE}/${id}/disconnect`, undefined],
      ['patch', `${BASE}/${id}/numbers/${numberId}`, { is_test: true }],
    ];

    async function call(method: string, path: string, headers: Record<string, string>, body?: Record<string, unknown>) {
      const agent = request(await serve(app));
      const req = method === 'get' ? agent.get(path) : method === 'post' ? agent.post(path) : method === 'patch' ? agent.patch(path) : agent.put(path);
      return body === undefined ? req.set(headers) : req.set(headers).send(body);
    }

    it.each(['sm@acme.test', 'smro@acme.test', 'mgr@acme.test', 'adv@acme.test'])("un membre non admin (%s) reçoit 403 sur chaque route, sans appel au fournisseur", async (email) => {
      const created = await svc.create('acme', null, metaBody() as Parameters<WhatsAppAccountService['create']>[2]);
      vi.mocked(providers.verifyMeta).mockClear();
      const auth = { Authorization: `Bearer ${await bearer(email)}` };
      for (const [method, path, body] of routes(created.id, created.numbers[0]!.id)) {
        const res = await call(method, path, auth, body);
        expect([method, path, res.status]).toEqual([method, path, 403]);
      }
      expect(providers.verifyMeta).not.toHaveBeenCalled();
      expect(providers.listMeta).not.toHaveBeenCalled();
      expect((await db.getWhatsAppAccount('acme', created.id))!.state).toBe('connected');
    });

    it('sans jeton : 401', async () => {
      expect((await request(await serve(app)).get(BASE)).status).toBe(401);
    });
  });

  describe('isolation entre organisations', () => {
    it.each(['admin@acme.test', 'both@x.test'])(
      "un compte de beta demandé avec l'organisation acme active (%s) : 404 identique à un identifiant inconnu, rien de modifié",
      async (email) => {
        const beta = await svc.create('beta', null, metaBody({ name: 'Compte Beta', waba_id: '3333333333' }) as Parameters<WhatsAppAccountService['create']>[2]);
        const betaNumber = beta.numbers[0]!.id;
        vi.mocked(providers.verifyMeta).mockClear();
        const auth = { Authorization: `Bearer ${await bearer(email)}`, [ORGANIZATION_HEADER]: 'acme' };
        const cases: Array<[string, string, Record<string, unknown> | undefined]> = [
          ['get', '', undefined],
          ['get', '/webhook', undefined],
          ['patch', '', { name: 'Volé' }],
          ['put', '/credentials', { mode: 'meta_manual', waba_id: '3333333333', access_token: TOKEN, app_secret: SECRET }],
          ['post', '/verify', undefined],
          ['post', '/refresh-numbers', undefined],
          ['post', '/app-webhook', undefined],
          ['post', '/disconnect', undefined],
          ['patch', `/numbers/${betaNumber}`, { is_test: true }],
        ];
        for (const [method, suffix, body] of cases) {
          const agent = request(await serve(app));
          const send = async (path: string) => {
            const req = method === 'get' ? agent.get(path) : method === 'post' ? agent.post(path) : method === 'patch' ? agent.patch(path) : agent.put(path);
            return body === undefined ? req.set(auth) : req.set(auth).send(body);
          };
          const cross = await send(`${BASE}/${beta.id}${suffix}`);
          const unknown = await send(`${BASE}/999999${suffix}`);
          expect([method, suffix, cross.status]).toEqual([method, suffix, 404]);
          expect(errorOf(cross.body)).toEqual(errorOf(unknown.body));
          expect(JSON.stringify(cross.body)).not.toContain('Compte Beta');
          expect(JSON.stringify(cross.body)).not.toContain('/webhook/');
        }
        expect((await request(await serve(app)).get(BASE).set(auth)).body).toEqual([]);
        expect(providers.verifyMeta).not.toHaveBeenCalled();
        expect(providers.listMeta).not.toHaveBeenCalled();
        const after = (await db.getWhatsAppAccount('beta', beta.id))!;
        expect([after.name, after.state]).toEqual(['Compte Beta', 'connected']);
        expect((await db.getWhatsAppNumber('beta', betaNumber))!.is_test).toBe(false);
      },
    );

    // spec R1 §8
    it("route app-webhook : compte d'une autre organisation répond 404", async () => {
      const beta = await svc.create('beta', null, metaBody({ name: 'Compte Beta', waba_id: '3333333333' }) as Parameters<WhatsAppAccountService['create']>[2]);
      metaWebhooks.appWebhooks.set('app-3333333333', 'https://autre-produit.example.com/hooks');
      metaWebhooks.clearCalls();
      const auth = { Authorization: `Bearer ${await bearer('both@x.test')}`, [ORGANIZATION_HEADER]: 'acme' };
      const cross = await request(await serve(app)).post(`${BASE}/${beta.id}/app-webhook`).set(auth);
      const unknown = await request(await serve(app)).post(`${BASE}/999999/app-webhook`).set(auth);
      expect(cross.status).toBe(404);
      expect(errorOf(cross.body)).toEqual(errorOf(unknown.body));
      expect(metaWebhooks.calls).toEqual([]);
      expect(metaWebhooks.appWebhooks.get('app-3333333333')).toBe('https://autre-produit.example.com/hooks');
      expect((await db.listAuditLog('acme')).filter((e) => e.action === 'whatsapp_account.app_webhook')).toEqual([]);
      expect((await db.listAuditLog('beta')).filter((e) => e.action === 'whatsapp_account.app_webhook')).toEqual([]);
      // Le même compte, par son organisation : le webhook de l'app est inscrit sur l'adresse de beta.
      const own = await request(await serve(app)).post(`${BASE}/${beta.id}/app-webhook`)
        .set({ Authorization: `Bearer ${await bearer('admin@beta.test')}` });
      expect(own.status).toBe(200);
      expect(own.body.checks).toEqual([{ key: 'webhook_app', status: 'created' }]);
      expect(own.body.webhooks.app).toBe('ok');
      const betaUrl = metaWebhooks.appWebhooks.get('app-3333333333')!;
      expect(hashWebhookKey(keyOfMetaUrl(betaUrl))).toBe((await db.getWhatsAppAccount('beta', beta.id))!.webhook_key_hash);
      expect(JSON.stringify(own.body)).not.toContain(keyOfMetaUrl(betaUrl));
    });

    it("route app-webhook en échec : 422 avec la raison app_webhook_failed", async () => {
      const created = await svc.create('acme', null, metaBody() as Parameters<WhatsAppAccountService['create']>[2]);
      metaWebhooks.setAppWebhook.mockResolvedValueOnce({ ok: false, failure: { kind: 'callback_failed' } });
      metaWebhooks.appWebhooks.set('app-1111111111', 'https://autre-produit.example.com/hooks');
      const res = await request(await serve(app)).post(`${BASE}/${created.id}/app-webhook`)
        .set({ Authorization: `Bearer ${await bearer('admin@acme.test')}` });
      expect(res.status).toBe(422);
      expect(res.body.error.reason).toBe('whatsapp_account.app_webhook_failed');
      expect(typeof res.body.error.request_id).toBe('string');
    });

    it("numéro de beta via un compte d'acme : 404 « Numéro WhatsApp introuvable. »", async () => {
      const acme = await svc.create('acme', null, metaBody() as Parameters<WhatsAppAccountService['create']>[2]);
      const beta = await svc.create('beta', null, metaBody({ name: 'Compte Beta', waba_id: '3333333333' }) as Parameters<WhatsAppAccountService['create']>[2]);
      const auth = { Authorization: `Bearer ${await bearer('admin@acme.test')}` };
      const res = await request(await serve(app)).patch(`${BASE}/${acme.id}/numbers/${beta.numbers[0]!.id}`).set(auth).send({ is_test: true });
      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('Numéro WhatsApp introuvable.');
      expect(res.body.error.reason).toBe('whatsapp_account.number_not_found');
      // Isolation : un numéro inexistant et un identifiant non entier répondent exactement pareil.
      const absent = await request(await serve(app)).patch(`${BASE}/${acme.id}/numbers/987654`).set(auth).send({ is_test: true });
      const malformed = await request(await serve(app)).patch(`${BASE}/${acme.id}/numbers/abc`).set(auth).send({ is_test: true });
      for (const other of [absent, malformed]) {
        expect([other.status, other.body.error.message, other.body.error.reason]).toEqual([404, res.body.error.message, res.body.error.reason]);
      }
    });
  });

  describe('entrées invalides', () => {
    it.each(['abc', '1.5', '-1', '0', '1e3'])('identifiant de compte non entier (%s) : 404', async (raw) => {
      const auth = { Authorization: `Bearer ${await bearer('admin@acme.test')}` };
      const res = await request(await serve(app)).get(`${BASE}/${raw}`).set(auth);
      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('Compte WhatsApp introuvable.');
      expect(res.body.error.reason).toBe('whatsapp_account.not_found');
    });

    it('corps invalide : 400, sans appel au fournisseur', async () => {
      const created = await svc.create('acme', null, metaBody() as Parameters<WhatsAppAccountService['create']>[2]);
      vi.mocked(providers.verifyMeta).mockClear();
      const auth = { Authorization: `Bearer ${await bearer('admin@acme.test')}` };
      const id = created.id;
      const bad: Array<[string, string, Record<string, unknown>]> = [
        ['post', BASE, metaBody({ waba_id: 'abc' })],
        ['post', BASE, { mode: 'meta_embedded', name: 'X' }],
        ['post', BASE, { mode: 'cm_com', name: 'X', account_id: 'pas-un-uuid', product_token: 'p'.repeat(20) }],
        ['patch', `${BASE}/${id}`, { name: '   ' }],
        ['put', `${BASE}/${id}/credentials`, { mode: 'meta_manual', waba_id: '1111111111' }],
        ['patch', `${BASE}/${id}/numbers/${created.numbers[0]!.id}`, { is_test: 'oui' }],
      ];
      for (const [method, path, body] of bad) {
        const agent = request(await serve(app));
        const req = method === 'post' ? agent.post(path) : method === 'patch' ? agent.patch(path) : agent.put(path);
        const res = await req.set(auth).send(body);
        expect([method, path, res.status, res.body.error.code]).toEqual([method, path, 400, 'VALIDATION_ERROR']);
      }
      expect(providers.verifyMeta).not.toHaveBeenCalled();
    });

    // audit 6.4
    it('valeur masquée : 400 avec le message dédié', async () => {
      const auth = { Authorization: `Bearer ${await bearer('admin@acme.test')}` };
      const res = await request(await serve(app)).post(BASE).set(auth).send(metaBody({ access_token: `••••${'x'.repeat(30)}` }));
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe("Saisissez la valeur complète : une valeur masquée n'est pas acceptée.");
      expect(res.body.error.reason).toBe('whatsapp_account.masked_value');
      expect(providers.verifyMeta).not.toHaveBeenCalled();
    });
  });
});
