// Routes du profil WhatsApp, de la photo et du nom d'affichage d'un numéro (lot R2a, tâche 5 ; spec R2a §6.4, §9.4).
// Les deux moteurs (SQLite par défaut, Postgres avec TEST_DATABASE_URL). Faux Meta injecté par `fetchImpl`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { inspect } from 'node:util';
import { serve } from '../../../test-support/http.js';
import { createTestDatabase } from '../../../test-support/test-database.js';
import { __setDatabaseForTests } from '../../../core/database/index.js';
import { resetConfigStore } from '../../../core/config-store.js';
import type { Database } from '../../../core/database/types.js';
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
import { WhatsAppNumberProfileService } from '../../../core/services/whatsapp-number-profile-service.js';
import { invalidateAccountTransports } from '../../../transport/index.js';
import type { Mailer } from '../../../core/auth/mailer.js';
import { createAdminRouter } from '../router.js';
import { seedOrgMember } from '../../../core/auth/__tests__/fixtures.js';
import { fakeMetaWebhooks } from '../../../test-support/meta-webhooks-fake.js';

class FakeMailer implements Mailer {
  async sendInvitation() {} async sendPasswordReset() {}
}

const BASE = '/api/admin/v1/whatsapp-accounts';
const TOKEN = 'EAAG-jeton-de-test-0123456789abcdef';
const SECRET = 'secret-app-de-test-0123456789';
const PIN = '482915';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);

function num(i: number): ProviderNumber {
  return {
    provider_number_id: `pn-${i}`, phone_e164: `+3310000000${i}`, display_name: `Boutique ${i}`, meta_status: 'CONNECTED',
    quality: 'GREEN', is_test: false, cm_channel_id: null, name_request: null, pin_enabled: null,
  };
}

function verified(wabaId: string): ProviderVerification {
  return {
    ok: true, checks: [{ key: 'token', status: 'ok' }], account_name: 'Nom', waba_id: wabaId, meta_app_id: 'app-acme',
    token_expiry: null, numbers: [num(1)], skipped: { sandbox: 0, invalid_number: 0 }, meta_health: null,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('routes du profil et du nom d\'un numéro', () => {
  let db: Database;
  let app: express.Express;
  let graphCalls: Array<{ method: string; path: string }>;
  let registerResponse: () => Response;
  let accountId: number;
  let numberId: number;

  async function bearer(email: string): Promise<string> {
    const res = await request(await serve(app)).post('/api/admin/v1/auth/login').send({ email, password: 'motdepasse123' });
    return res.body.access_token as string;
  }

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname.replace(/^\/v[\d.]+/, '');
    const method = init?.method ?? 'GET';
    graphCalls.push({ method, path });
    if (path.endsWith('/whatsapp_business_profile') && method === 'GET') {
      return json(200, { data: [{ about: 'Bonjour', description: '', address: '', email: '', websites: [], vertical: 'RETAIL' }] });
    }
    if (path.endsWith('/uploads')) return json(200, { id: 'upload:MTphdHRhY2htZW50OjEyMzQ1Njc4OTA=?sig=ARZsigValue0123' });
    if (path.startsWith('/upload:')) return json(200, { h: '4::aW1hZ2UvanBlZw==:handle' });
    if (path.endsWith('/register')) return registerResponse();
    return json(200, { success: true });
  }) as typeof fetch;

  beforeEach(async () => {
    vi.stubEnv('ADMIN_JWT_SECRET', 'test-secret-at-least-32-bytes-long!!');
    vi.stubEnv('ADMIN_BCRYPT_ROUNDS', '4');
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '0'.repeat(64));
    vi.stubEnv('PUBLIC_BASE_URL', 'https://moteur.example.test');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    db = await createTestDatabase(); __setDatabaseForTests(db); resetConfigStore();
    graphCalls = [];
    registerResponse = () => json(200, { success: true });
    const providers: WhatsAppProviders = {
      verifyMeta: vi.fn(async (c) => verified(c.waba_id)),
      listMeta: vi.fn(async () => ({ numbers: [num(1)], skipped: { sandbox: 0, invalid_number: 0 } })),
      verifyCm: vi.fn(async () => verified('x')),
      listCm: vi.fn(async () => ({ numbers: [], skipped: { sandbox: 0, invalid_number: 0 } })),
      metaWebhooks: fakeMetaWebhooks(),
      readMetaBusiness: vi.fn(async () => ({ ok: false as const, failure: { kind: 'other' as const, message: 'Portefeuille non simulé' } })),
    };
    const accounts = new WhatsAppAccountService({ db, providers });
    const profiles = new WhatsAppNumberProfileService({ db, accounts, graph: { fetchImpl } });
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
      whatsappAccountService: accounts,
      whatsappNumberProfileService: profiles,
    }));
    await seedOrgMember(db, { email: 'admin@acme.test', password: 'motdepasse123', clientId: 'acme', grants: 'admin' });
    const entity = (await db.listEntities('acme'))[0]!;
    await seedOrgMember(db, { email: 'adv@acme.test', password: 'motdepasse123', clientId: 'acme', grants: [{ entity_id: entity.id, role: 'advisor' }] });
    const created = await accounts.create('acme', null, { mode: 'meta_manual', name: 'Compte Acme', waba_id: '1111111111', access_token: TOKEN, app_secret: SECRET });
    accountId = created.id;
    numberId = created.numbers[0]!.id;
    graphCalls = [];
  });

  afterEach(async () => {
    for (let id = 1; id <= 5; id++) invalidateAccountTransports(id);
    resetConfigStore();
    await db.close();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const numberBase = (): string => `${BASE}/${accountId}/numbers/${numberId}`;

  it('admin : lit et écrit le profil, change la photo, demande un nom', async () => {
    const auth = { Authorization: `Bearer ${await bearer('admin@acme.test')}` };
    const read = await request(await serve(app)).get(`${numberBase()}/profile`).set(auth);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ about: 'Bonjour', vertical: 'RETAIL', photo_url: null });

    const saved = await request(await serve(app)).put(`${numberBase()}/profile`).set(auth).send({ about: 'Bonjour à tous' });
    expect(saved.status).toBe(200);

    const photo = await request(await serve(app)).post(`${numberBase()}/profile/photo`).set(auth).set('Content-Type', 'image/jpeg').send(JPEG);
    expect(photo.status).toBe(200);
    expect(graphCalls.some((c) => c.path === '/app-acme/uploads')).toBe(true);

    const asked = await request(await serve(app)).post(`${numberBase()}/display-name`).set(auth).send({ new_display_name: 'Maison Acme' });
    expect(asked.status).toBe(200);
    expect(asked.body).toMatchObject({ id: numberId, display_name_request: { requested_name: 'Maison Acme', status: 'in_review' } });
  });

  it('profil : forme refusée en 400 VALIDATION_ERROR sans appel', async () => {
    const auth = { Authorization: `Bearer ${await bearer('admin@acme.test')}` };
    const res = await request(await serve(app)).put(`${numberBase()}/profile`).set(auth).send({ about: '', email: 'pas-un-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(graphCalls).toEqual([]);
  });

  it('photo : 6 Mo et type gif refusés avec photo_invalid', async () => {
    const auth = { Authorization: `Bearer ${await bearer('admin@acme.test')}` };
    const big = Buffer.alloc(6 * 1024 * 1024, 0xff);
    big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
    const tooBig = await request(await serve(app)).post(`${numberBase()}/profile/photo`).set(auth).set('Content-Type', 'image/jpeg').send(big);
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error.reason).toBe('whatsapp_account.photo_invalid');

    const gif = await request(await serve(app)).post(`${numberBase()}/profile/photo`).set(auth).set('Content-Type', 'image/gif').send(GIF);
    expect(gif.status).toBe(400);
    expect(gif.body.error.reason).toBe('whatsapp_account.photo_invalid');

    // En-tête JPEG, octets GIF : le contenu fait foi.
    const lying = await request(await serve(app)).post(`${numberBase()}/profile/photo`).set(auth).set('Content-Type', 'image/jpeg').send(GIF);
    expect(lying.body.error.reason).toBe('whatsapp_account.photo_invalid');

    const empty = await request(await serve(app)).post(`${numberBase()}/profile/photo`).set(auth).set('Content-Type', 'image/png');
    expect(empty.body.error.reason).toBe('whatsapp_account.photo_invalid');

    const asJson = await request(await serve(app)).post(`${numberBase()}/profile/photo`).set(auth).send({ photo: 'x' });
    expect(asJson.body.error.reason).toBe('whatsapp_account.photo_invalid');
    expect(graphCalls).toEqual([]);
  });

  it('limite JSON inchangée : corps de 300 ko sur PUT /profile refusé en 400 VALIDATION_ERROR', async () => {
    const auth = { Authorization: `Bearer ${await bearer('admin@acme.test')}` };
    const res = await request(await serve(app)).put(`${numberBase()}/profile`).set(auth).send({ description: 'x'.repeat(300 * 1024) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toBe('Corps JSON trop volumineux.');
    expect(graphCalls).toEqual([]);
  });

  it('conseiller : 403 sur les cinq routes', async () => {
    const auth = { Authorization: `Bearer ${await bearer('adv@acme.test')}` };
    const responses = [
      await request(await serve(app)).get(`${numberBase()}/profile`).set(auth),
      await request(await serve(app)).put(`${numberBase()}/profile`).set(auth).send({ about: 'x' }),
      await request(await serve(app)).post(`${numberBase()}/profile/photo`).set(auth).set('Content-Type', 'image/jpeg').send(JPEG),
      await request(await serve(app)).post(`${numberBase()}/display-name`).set(auth).send({ new_display_name: 'x' }),
      await request(await serve(app)).post(`${numberBase()}/display-name/apply`).set(auth).send({ pin: PIN }),
    ];
    for (const res of responses) expect(res.status).toBe(403);
    expect(graphCalls).toEqual([]);
  });

  it('identifiants de chemin inconnus : 404 sans appel', async () => {
    const auth = { Authorization: `Bearer ${await bearer('admin@acme.test')}` };
    expect((await request(await serve(app)).get(`${BASE}/999/numbers/${numberId}/profile`).set(auth)).body.error.reason).toBe('whatsapp_account.not_found');
    expect((await request(await serve(app)).get(`${BASE}/${accountId}/numbers/999/profile`).set(auth)).body.error.reason).toBe('whatsapp_account.number_not_found');
    expect((await request(await serve(app)).get(`${BASE}/${accountId}/numbers/abc/profile`).set(auth)).status).toBe(404);
    expect(graphCalls).toEqual([]);
  });

  // spec R2a §9.4
  it('apply : code absent des réponses HTTP et des journaux, en réussite et en échec', async () => {
    const seen: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { seen.push(args.map((a) => (typeof a === 'string' ? a : inspect(a))).join(' ')); });
    }
    const auth = { Authorization: `Bearer ${await bearer('admin@acme.test')}` };
    const approved = {
      requested_name: 'Maison Acme', status: 'approved_pending' as const, rejection_reason: null, requested_at: null,
      approved_at: '2026-11-11T10:00:00.000Z', apply_before: '2026-11-25T10:00:00.000Z', apply_before_approx: true,
    };
    await db.setWhatsAppNumberNameRequest('acme', accountId, numberId, approved);

    registerResponse = () => json(400, { error: { code: 133005, message: `Two step verification PIN ${PIN} mismatch`, type: 'OAuthException' } });
    const refused = await request(await serve(app)).post(`${numberBase()}/display-name/apply`).set(auth).send({ pin: PIN });
    expect(refused.status).toBe(422);
    expect(refused.body.error.reason).toBe('whatsapp_account.pin_rejected');

    registerResponse = () => json(400, { error: { code: 100, message: `Invalid parameter ${PIN}`, type: 'OAuthException' } });
    const generic = await request(await serve(app)).post(`${numberBase()}/display-name/apply`).set(auth).send({ pin: PIN });
    expect(generic.status).toBe(422);

    const malformed = await request(await serve(app)).post(`${numberBase()}/display-name/apply`).set(auth).send({ pin: `${PIN}0` });
    expect(malformed.status).toBe(400);

    registerResponse = () => json(200, { success: true });
    const ok = await request(await serve(app)).post(`${numberBase()}/display-name/apply`).set(auth).send({ pin: PIN });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ id: numberId, display_name_request: null });

    for (const res of [refused, generic, malformed, ok]) expect(res.text).not.toContain(PIN);
    expect(seen.join('\n')).not.toContain(PIN);
    expect(JSON.stringify(await db.listAuditLog('acme'))).not.toContain(PIN);
  });
});
