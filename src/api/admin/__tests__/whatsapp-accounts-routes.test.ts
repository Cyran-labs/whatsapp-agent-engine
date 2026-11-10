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
import type { Mailer } from '../../../core/auth/mailer.js';
import { ORGANIZATION_HEADER } from '../../../core/auth/access-service.js';
import { createAdminRouter } from '../router.js';
import { seedOrgMember } from '../../../core/auth/__tests__/fixtures.js';
import { UNCHECKED } from '../../../test-support/whatsapp.js';

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
    token_expiry: null, numbers, skipped: { sandbox: 0, invalid_number: 0 },
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

  async function bearer(email: string): Promise<string> {
    const res = await request(await serve(app)).post('/api/admin/v1/auth/login').send({ email, password: 'motdepasse123' });
    return res.body.access_token as string;
  }

  beforeEach(async () => {
    vi.stubEnv('ADMIN_JWT_SECRET', 'test-secret-at-least-32-bytes-long!!');
    vi.stubEnv('ADMIN_BCRYPT_ROUNDS', '4');
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '0'.repeat(64));
    vi.stubEnv('PUBLIC_BASE_URL', '');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    db = await createTestDatabase(); __setDatabaseForTests(db); resetConfigStore();
    providers = {
      verifyMeta: vi.fn(async (c) => verified(c.waba_id, `app-${c.waba_id}`, [num(c.waba_id === '1111111111' ? 1 : 2)])),
      listMeta: vi.fn(async () => ({ numbers: [num(1)], skipped: { sandbox: 0, invalid_number: 0 } })),
      verifyCm: vi.fn(async () => verified('x', 'y', [])),
      listCm: vi.fn(async () => ({ numbers: [], skipped: { sandbox: 0, invalid_number: 0 } })),
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

  it('admin : raccorde (201), liste, lit, renomme, vérifie, rafraîchit, marque un numéro de test, déconnecte (204)', async () => {
    const auth = { Authorization: `Bearer ${await bearer('admin@acme.test')}` };
    const created = await request(await serve(app)).post(BASE).set(auth).send(metaBody());
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Compte Acme', state: 'connected', inventory: { added: 1, refused: 0 } });
    expect(created.body.webhook.path).toMatch(/^\/webhook\/meta\//);
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
    expect(verify.body.checks).toEqual([{ key: 'token', status: 'ok' }]);
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
    expect((await request(await serve(app)).get(`${BASE}/${id}/webhook`).set(auth)).body).toEqual(created.body.webhook);

    expect((await request(await serve(app)).post(`${BASE}/${id}/disconnect`).set(auth)).status).toBe(204);
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
    expect(res.body.error.message).toBe("Désactivez d'abord les agents IA qui utilisent ce compte :");
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
      const metaKey = String(meta.body.webhook.path).replace('/webhook/meta/', '');
      const cmKey = String(cm.body.webhook.path).replace('/webhook/cm-com/', '');
      const token = meta.body.webhook.verify_token as string;
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

    it("la route dédiée renvoie le webhook du compte de l'organisation active (Meta : chemin, adresse, jeton ; CM.com : chemin seul)", async () => {
      vi.stubEnv('PUBLIC_BASE_URL', 'https://moteur.example.test');
      const auth = { Authorization: `Bearer ${await bearer('admin@acme.test')}` };
      const meta = await request(await serve(app)).post(BASE).set(auth).send(metaBody());
      const cm = await request(await serve(app)).post(BASE).set(auth)
        .send({ mode: 'cm_com', name: 'Compte CM', account_id: CM_UUID, product_token: 'p'.repeat(20) });
      const read = await request(await serve(app)).get(`${BASE}/${meta.body.id}/webhook`).set(auth);
      expect(read.status).toBe(200);
      expect(read.body).toEqual(meta.body.webhook);
      expect(read.body.url).toBe(`https://moteur.example.test${read.body.path}`);
      expect(read.body.verify_token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      const readCm = await request(await serve(app)).get(`${BASE}/${cm.body.id}/webhook`).set(auth);
      expect(readCm.body).toEqual(cm.body.webhook);
      expect(readCm.body.path).toMatch(/^\/webhook\/cm-com\//);
      expect(readCm.body.verify_token).toBeNull();
    });

    it('compte déconnecté : la route dédiée ne renvoie aucun secret', async () => {
      const auth = { Authorization: `Bearer ${await bearer('admin@acme.test')}` };
      const meta = await request(await serve(app)).post(BASE).set(auth).send(metaBody());
      expect((await request(await serve(app)).post(`${BASE}/${meta.body.id}/disconnect`).set(auth)).status).toBe(204);
      const read = await request(await serve(app)).get(`${BASE}/${meta.body.id}/webhook`).set(auth);
      expect(read.status).toBe(200);
      expect(read.body).toEqual({ path: '', url: null, verify_token: null });
    });

    it("le compte d'une autre organisation répond 404, comme un identifiant inconnu, sans secret", async () => {
      const beta = await svc.create('beta', null, metaBody({ name: 'Compte Beta', waba_id: '3333333333' }) as Parameters<WhatsAppAccountService['create']>[2]);
      const auth = { Authorization: `Bearer ${await bearer('admin@acme.test')}` };
      const cross = await request(await serve(app)).get(`${BASE}/${beta.id}/webhook`).set(auth);
      const unknown = await request(await serve(app)).get(`${BASE}/999999/webhook`).set(auth);
      expect(cross.status).toBe(404);
      expect(errorOf(cross.body)).toEqual(errorOf(unknown.body));
      expect(JSON.stringify(cross.body)).not.toContain(beta.webhook.path);
      // Le même compte, lu par son propre administrateur, répond.
      const own = await request(await serve(app)).get(`${BASE}/${beta.id}/webhook`).set({ Authorization: `Bearer ${await bearer('admin@beta.test')}` });
      expect(own.status).toBe(200);
      expect(own.body.path).toBe(beta.webhook.path);
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
