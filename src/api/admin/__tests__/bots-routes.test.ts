import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { serve } from '../../../test-support/http.js';
import { createTestDatabase } from '../../../test-support/test-database.js';
import { createMetaAccount, type AccountFixture } from '../../../test-support/whatsapp.js';
import { __setDatabaseForTests } from '../../../core/database/index.js';
import { findBotConfig, resetConfigStore } from '../../../core/config-store.js';
import type { Database } from '../../../core/database/types.js';
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
import { recordSignatureFailure, resetSignatureMonitor, SIGNATURE_REJECTION_THRESHOLD } from '../../../webhooks/signature-monitor.js';
import { invalidateAccountTransports } from '../../../transport/index.js';
import type { Mailer } from '../../../core/auth/mailer.js';
import { createAdminRouter } from '../router.js';
import { ORGANIZATION_HEADER } from '../../../core/auth/access-service.js';
import { seedOrgMember } from '../../../core/auth/__tests__/fixtures.js';

// Les deux moteurs (SQLite par défaut, Postgres avec TEST_DATABASE_URL).

class FakeMailer implements Mailer {
  async sendInvitation() {} async sendPasswordReset() {}
}

const bot = { bot_id: 'sales', name: 'Ventes', system_prompt: { fr: 'Agent IA.' }, lead_fields: 'nom', welcome: { enabled: false, message: {} } };
const REAL = '+33100000001';
const TEST = '+15550000001';
const ENTRY_MESSAGE = 'Numéro au format international (ex. +33612345678) ou identifiant WhatsApp attendu.';

describe('bots routes', () => {
  let db: Database;
  let app: express.Express;
  let acme: AccountFixture;
  let beta: AccountFixture;
  let auth: Record<string, string>;

  async function bearer(email: string): Promise<string> {
    return (await request(await serve(app)).post('/api/admin/v1/auth/login').send({ email, password: 'motdepasse123' })).body.access_token as string;
  }

  async function call(method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, body?: unknown, headers = auth) {
    const req = request(await serve(app))[method](`/api/admin/v1${path}`).set(headers);
    return body === undefined ? req : req.send(body as object);
  }

  beforeEach(async () => {
    vi.stubEnv('ADMIN_JWT_SECRET', 'test-secret-at-least-32-bytes-long!!');
    vi.stubEnv('ADMIN_BCRYPT_ROUNDS', '4');
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '0'.repeat(64));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    db = await createTestDatabase(); __setDatabaseForTests(db); resetConfigStore(); resetSignatureMonitor();
    const mailer = new FakeMailer();
    const credentials = new CredentialsService({ db });
    app = express();
    app.use('/api/admin/v1', createAdminRouter({
      db, authService: new AuthService({ db, mailer }),
      adminService: new AdminService({ db, mailer }), botService: new BotService({ db }), entityService: new EntityService({ db }), settingsService: new SettingsService({ db }), userAdminService: new UserAdminService({ db, mailer: new FakeMailer() }),
      connectionsService: new ConnectionsService({ db, credentials }),
      dashboardService: new DashboardService({ db, credentials }),
      simulateService: new SimulateService({}),
    }));
    await seedOrgMember(db, { email: 'ca@acme.test', password: 'motdepasse123', clientId: 'acme', grants: 'admin' });
    await seedOrgMember(db, { email: 'ca2@other.test', password: 'motdepasse123', clientId: 'other', grants: 'admin' });
    const entity = (await db.listEntities('acme'))[0]!;
    await seedOrgMember(db, { email: 'adv@acme.test', password: 'motdepasse123', clientId: 'acme', grants: [{ entity_id: entity.id, role: 'advisor' }] });
    acme = await createMetaAccount(db, {
      clientId: 'acme', wabaId: '1111111111', metaAppId: 'app-acme', accessToken: 'EAAG-acme', appSecret: 'secret-acme',
      verifyToken: 'verify-acme', webhookKey: 'cle-acme', numbers: [{ phone: REAL, providerNumberId: 'pn-1' }, { phone: TEST, providerNumberId: 'pn-2', isTest: true }],
    });
    beta = await createMetaAccount(db, {
      clientId: 'other', wabaId: '2222222222', metaAppId: 'app-other', accessToken: 'EAAG-other', appSecret: 'secret-other',
      verifyToken: 'verify-other', webhookKey: 'cle-other', numbers: [{ phone: '+33200000001', providerNumberId: 'pn-9' }],
    });
    auth = { Authorization: `Bearer ${await bearer('ca@acme.test')}` };
  });

  afterEach(async () => {
    invalidateAccountTransports(acme.account.id);
    invalidateAccountTransports(beta.account.id);
    resetConfigStore(); resetSignatureMonitor();
    await db.close();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const real = () => acme.numbers[REAL]!.id;
  const testNumber = () => acme.numbers[TEST]!.id;

  it('client_admin crée un bot puis le liste (scopé), sans numéro ni liste', async () => {
    const created = await call('post', '/bots', bot);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'draft', whatsapp_number: null, allowlist: [], unserved: { count: 0, last_at: null } });
    expect(created.body).not.toHaveProperty('transport');
    expect(created.body).not.toHaveProperty('numbers');
    const list = await call('get', '/bots');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].entity_id).toEqual(expect.any(Number));
    const one = await call('get', '/bots/sales');
    expect(one.body.entity_id).toBe(list.body[0].entity_id);
  });

  it('isolation : un autre client_admin ne voit pas le bot', async () => {
    await call('post', '/bots', bot);
    const other = { Authorization: `Bearer ${await bearer('ca2@other.test')}` };
    expect((await call('get', '/bots', undefined, other)).body).toHaveLength(0);
    expect((await call('get', '/bots/sales', undefined, other)).status).toBe(404);
    expect((await call('put', '/bots/sales/status', { status: 'draft' }, other)).status).toBe(404);
    expect((await call('put', '/bots/sales/allowlist', { entries: ['+33612345678'] }, other)).status).toBe(404);
    expect((await call('post', '/bots/sales/number/unassign', { expected_number_id: real() }, other)).status).toBe(404);
  });

  // audit 3.5
  it("machine d'états par l'API : limited sans numéro, active depuis draft sur un numéro non test (409), sur un numéro de test (200)", async () => {
    await call('post', '/bots', bot);
    const noNumber = await call('put', '/bots/sales/status', { status: 'limited' });
    expect(noNumber.status).toBe(409);
    expect(noNumber.body.error.message).toBe("Branchez un numéro WhatsApp avant d'activer l'agent IA.");
    expect(noNumber.body.error.reason).toBe('transition.no_number');

    expect((await call('put', '/bots/sales/number', { number_id: real(), expected_bot_id: null })).status).toBe(200);
    const notFromDraft = await call('put', '/bots/sales/status', { status: 'active' });
    expect(notFromDraft.status).toBe(409);
    expect(notFromDraft.body.error.message).toBe("Passez d'abord en accès limité : seul un numéro de test peut être ouvert à tous directement.");
    expect(notFromDraft.body.error.reason).toBe('transition.not_from_draft');
    expect((await db.getBotRecord('acme', 'sales'))!.status).toBe('draft');

    const onTest = await call('put', '/bots/sales/number', { number_id: testNumber(), expected_bot_id: null });
    expect(onTest.body.whatsapp_number).toMatchObject({ id: testNumber(), is_test: true });
    const active = await call('put', '/bots/sales/status', { status: 'active' });
    expect(active.status).toBe(200);
    expect(active.body.status).toBe('active');
    expect(findBotConfig('acme', 'sales')!.status).toBe('active');
  });

  // audit 3.5
  it('statut inconnu : 400 ; pause depuis draft : 409 ; limited exige une liste non vide', async () => {
    await call('post', '/bots', bot);
    expect((await call('put', '/bots/sales/status', { status: 'open' })).status).toBe(400);
    const paused = await call('put', '/bots/sales/status', { status: 'paused' });
    expect(paused.status).toBe(409);
    expect(paused.body.error.message).toBe('Changement de statut impossible depuis le statut actuel.');
    expect(paused.body.error.reason).toBe('transition.invalid_transition');
    await call('put', '/bots/sales/number', { number_id: real(), expected_bot_id: null });
    const empty = await call('put', '/bots/sales/status', { status: 'limited' });
    expect(empty.status).toBe(409);
    expect(empty.body.error.message).toBe("Ajoutez au moins un numéro à la liste d'accès limité.");
    expect(empty.body.error.reason).toBe('transition.empty_allowlist');
    await call('put', '/bots/sales/allowlist', { entries: ['+33612345678'] });
    expect((await call('put', '/bots/sales/status', { status: 'limited' })).body.status).toBe('limited');
    expect((await call('put', '/bots/sales/status', { status: 'active' })).body.status).toBe('active');
  });

  // audit 3.5
  it('compte aux signatures rejetées en série : transitions bloquées, état affiché signature_rejected', async () => {
    await call('post', '/bots', bot);
    await call('put', '/bots/sales/number', { number_id: testNumber(), expected_bot_id: null });
    for (let i = 0; i <= SIGNATURE_REJECTION_THRESHOLD; i++) recordSignatureFailure(acme.account.id);
    const refused = await call('put', '/bots/sales/status', { status: 'active' });
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toBe("Le compte WhatsApp de ce numéro n'est pas connecté.");
    const detail = await call('get', '/bots/sales');
    expect(detail.body.whatsapp_number.account).toEqual({
      id: acme.account.id, name: acme.account.name, mode: 'meta_manual', state: 'error', error_reason: 'signature_rejected',
      // contre-audit D-1 : de simples signatures rejetées n'enregistrent ni motif ni cause
      error_detail: null, error_cause: null,
    });
    resetSignatureMonitor();
    expect((await call('get', '/bots/sales')).body.whatsapp_number.account).toMatchObject({ state: 'connected', error_reason: null });
  });

  // revue 2b-1 I-3
  it("édition concurrente d'une pause : PUT status paused pendant un PATCH (nom), statut final paused", async () => {
    await call('post', '/bots', bot);
    await call('put', '/bots/sales/number', { number_id: testNumber(), expected_bot_id: null });
    await call('put', '/bots/sales/status', { status: 'active' });
    // Simultanéité forcée : la pause passe entre la lecture de l'agent IA par le PATCH (encore actif) et son écriture.
    const realGet = db.getBotRecord.bind(db);
    let paused: Awaited<ReturnType<typeof call>> | undefined;
    let triggered = false;
    const spy = vi.spyOn(db, 'getBotRecord').mockImplementation(async (clientId, botId) => {
      const snapshot = await realGet(clientId, botId);
      if (!triggered) {
        triggered = true;
        paused = await call('put', '/bots/sales/status', { status: 'paused' });
      }
      return snapshot;
    });
    let patched: Awaited<ReturnType<typeof call>>;
    try {
      patched = await call('patch', '/bots/sales', { name: 'Ventes 2' });
    } finally {
      spy.mockRestore();
    }
    expect(paused?.status).toBe(200);
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ name: 'Ventes 2', status: 'paused' });
    expect(await db.getBotRecord('acme', 'sales')).toMatchObject({ name: 'Ventes 2', status: 'paused' });
    expect(findBotConfig('acme', 'sales')).toMatchObject({ name: 'Ventes 2', status: 'paused' });

    // Et en vrai parallèle, sur plusieurs tours.
    for (let round = 0; round < 5; round++) {
      await call('put', '/bots/sales/status', { status: 'active' });
      const [p, s] = await Promise.all([
        call('patch', '/bots/sales', { name: `Ventes ${round}` }),
        call('put', '/bots/sales/status', { status: 'paused' }),
      ]);
      expect([p.status, s.status]).toEqual([200, 200]);
      expect(await db.getBotRecord('acme', 'sales')).toMatchObject({ name: `Ventes ${round}`, status: 'paused' });
    }
  });

  // spec §7.6 : l'état de remise du numéro est lu sur la page de l'agent IA, pour tout membre qui la voit
  it("le résumé du numéro porte ses échecs de remise et leur dernier code, ceux du numéro de l'agent IA seulement", async () => {
    await call('post', '/bots', bot);
    expect((await call('put', '/bots/sales/number', { number_id: real(), expected_bot_id: null })).body.whatsapp_number)
      .toMatchObject({ delivery_failures: 0, last_delivery_error_code: null });
    await db.recordDeliveryFailure(real(), 131047, '2026-11-09T10:00:00.000Z');
    await db.recordDeliveryFailure(real(), 131026, '2026-11-09T11:00:00.000Z');
    // le numéro de test d'acme et le numéro d'une autre organisation ont leurs propres échecs : ils ne se mêlent pas
    await db.recordDeliveryFailure(testNumber(), 999001, '2026-11-09T11:00:00.000Z');
    await db.recordDeliveryFailure(beta.numbers['+33200000001']!.id, 131042, '2026-11-09T11:00:00.000Z');
    const detail = await call('get', '/bots/sales');
    expect(detail.body.whatsapp_number).toMatchObject({ id: real(), delivery_failures: 2, last_delivery_error_code: 131026 });
    // un conseiller de l'entité lit la même chose
    const advisor = { Authorization: `Bearer ${await bearer('adv@acme.test')}` };
    expect((await call('get', '/bots/sales', undefined, advisor)).body.whatsapp_number).toMatchObject({ delivery_failures: 2, last_delivery_error_code: 131026 });
    expect(JSON.stringify(detail.body)).not.toContain('999001');
    expect(JSON.stringify(detail.body)).not.toContain('131042');
    // la santé (même résumé) les porte aussi
    expect((await call('get', '/bots/sales/health')).body.whatsapp.number).toMatchObject({ delivery_failures: 2, last_delivery_error_code: 131026 });
  });

  // spec §8.2
  it('activate : un seul appel branche le numéro, enregistre la liste et passe limited', async () => {
    await call('post', '/bots', bot);
    const res = await call('post', '/bots/sales/activate', { number_id: real(), expected_bot_id: null, status: 'limited', allowlist: ['+33 6 12 34 56 78', 'FR.abc_1'] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'limited', allowlist: ['+33612345678', 'FR.abc_1'] });
    expect(res.body.whatsapp_number).toMatchObject({ id: real(), phone_e164: REAL, is_test: false, provider_state: 'present' });
    expect((await db.getWhatsAppNumberForBot('acme', 'sales'))?.id).toBe(real());
    const audits = await db.listAuditLog('acme');
    expect(audits.find((a) => a.action === 'bot.activate')?.metadata).toEqual({ status: 'limited', number_id: real(), count: 2 });
    expect(JSON.stringify(audits)).not.toContain('+33612345678');
  });

  // spec §8.2
  it('activate avec une liste vide en limited : 409, rien de changé (numéro non branché)', async () => {
    await call('post', '/bots', bot);
    const res = await call('post', '/bots/sales/activate', { number_id: real(), expected_bot_id: null, status: 'limited', allowlist: [] });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe("Ajoutez au moins un numéro à la liste d'accès limité.");
    expect(res.body.error.reason).toBe('transition.empty_allowlist');
    expect(await db.getWhatsAppNumberForBot('acme', 'sales')).toBeUndefined();
    expect((await db.getBotRecord('acme', 'sales'))!.status).toBe('draft');
    expect(await db.getAllowlist('acme', 'sales')).toEqual([]);
    expect((await db.listAuditLog('acme')).some((a) => a.action === 'bot.activate')).toBe(false);
  });

  // spec §8.2
  it('activate active depuis draft : refusé sur un numéro non test (rien de changé), accepté sur un numéro de test', async () => {
    await call('post', '/bots', bot);
    const refused = await call('post', '/bots/sales/activate', { number_id: real(), expected_bot_id: null, status: 'active', allowlist: [] });
    expect(refused.status).toBe(409);
    expect(await db.getWhatsAppNumberForBot('acme', 'sales')).toBeUndefined();
    const ok = await call('post', '/bots/sales/activate', { number_id: testNumber(), expected_bot_id: null, status: 'active', allowlist: [] });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('active');
  });

  it("activate : numéro d'une autre organisation ou inconnu 404, agent IA inconnu 404, corps invalide 400", async () => {
    await call('post', '/bots', bot);
    expect((await call('post', '/bots/sales/activate', { number_id: beta.numbers['+33200000001']!.id, expected_bot_id: null, status: 'limited', allowlist: ['+33612345678'] })).status).toBe(404);
    expect((await call('post', '/bots/sales/activate', { number_id: 99999, expected_bot_id: null, status: 'limited', allowlist: ['+33612345678'] })).status).toBe(404);
    expect((await call('post', '/bots/ghost/activate', { number_id: real(), expected_bot_id: null, status: 'limited', allowlist: ['+33612345678'] })).status).toBe(404);
    expect((await call('post', '/bots/sales/activate', { number_id: real(), expected_bot_id: null, status: 'paused', allowlist: [] })).status).toBe(400);
    const badEntry = await call('post', '/bots/sales/activate', { number_id: real(), expected_bot_id: null, status: 'limited', allowlist: ['06 12'] });
    expect(badEntry.status).toBe(400);
    expect(badEntry.body.error.details).toEqual([{ path: 'allowlist.0', message: ENTRY_MESSAGE }]);
    expect(await db.getWhatsAppNumberForBot('acme', 'sales')).toBeUndefined();
  });

  it("liste d'accès limité : 21 entrées 400, ['06 12'] 400 sur entries.0, doublons fusionnés, audit sans les entrées", async () => {
    await call('post', '/bots', bot);
    const tooMany = await call('put', '/bots/sales/allowlist', { entries: Array.from({ length: 21 }, (_, i) => `+336120000${String(i).padStart(2, '0')}`) });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.details[0].path).toBe('entries');
    const bad = await call('put', '/bots/sales/allowlist', { entries: ['06 12'] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details).toEqual([{ path: 'entries.0', message: ENTRY_MESSAGE }]);
    const tooLong = await call('put', '/bots/sales/allowlist', { entries: [`FR.${'a'.repeat(62)}`] });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.details[0].path).toBe('entries.0');
    const merged = await call('put', '/bots/sales/allowlist', { entries: ['+33 6 12 34 56 78', '0033612345678'] });
    expect(merged.status).toBe(200);
    expect(merged.body.allowlist).toEqual(['+33612345678']);
    expect(await db.getAllowlist('acme', 'sales')).toEqual(['+33612345678']);
    const audit = (await db.listAuditLog('acme')).find((a) => a.action === 'bot.allowlist');
    expect(audit?.metadata).toEqual({ count: 1 });
  });

  // recette Q-10
  it("liste d'accès limité vide : enregistrée (200) pour un agent IA limited, statut inchangé, et en brouillon ; l'entrée en accès limité exige toujours une entrée", async () => {
    await call('post', '/bots', bot);
    await call('post', '/bots/sales/activate', { number_id: real(), expected_bot_id: null, status: 'limited', allowlist: ['+33612345678'] });
    const emptied = await call('put', '/bots/sales/allowlist', { entries: [] });
    expect(emptied.status).toBe(200);
    expect(emptied.body).toMatchObject({ status: 'limited', allowlist: [] });
    expect(await db.getAllowlist('acme', 'sales')).toEqual([]);
    expect((await db.getBotRecord('acme', 'sales'))?.status).toBe('limited');
    expect((await db.listAuditLog('acme')).some((a) => a.action === 'bot.allowlist' && a.metadata?.['count'] === 0)).toBe(true);
    // Entrer en accès limité depuis le brouillon avec une liste vide reste refusé.
    await call('put', '/bots/sales/status', { status: 'draft' });
    expect((await call('put', '/bots/sales/allowlist', { entries: [] })).body.allowlist).toEqual([]);
    const refused = await call('put', '/bots/sales/status', { status: 'limited' });
    expect(refused.status).toBe(409);
    expect(refused.body.error.reason).toBe('transition.empty_allowlist');
  });

  // recette Q-10 : l'activation en accès limité exige toujours une entrée, même pour un agent IA déjà limited
  it('activate en limited avec une liste vide pour un agent IA déjà limited : 409 transition.empty_allowlist, liste et statut inchangés', async () => {
    await call('post', '/bots', bot);
    await call('post', '/bots/sales/activate', { number_id: real(), expected_bot_id: null, status: 'limited', allowlist: ['+33612345678'] });
    const res = await call('post', '/bots/sales/activate', { number_id: real(), expected_bot_id: 'sales', status: 'limited', allowlist: [] });
    expect(res.status).toBe(409);
    expect(res.body.error.reason).toBe('transition.empty_allowlist');
    expect(res.body.error.message).toBe("Ajoutez au moins un numéro à la liste d'accès limité.");
    expect(await db.getAllowlist('acme', 'sales')).toEqual(['+33612345678']);
    expect((await db.getBotRecord('acme', 'sales'))?.status).toBe('limited');
  });

  // spec §8.2, décision du 9 nov. 2026 : ce test décrit le comportement actuel de la route de statut (et non de l'activation)
  // audit décisions A22 : vers le statut actuel, 200 sans écriture ni ligne d'audit
  it("PUT /status de limited vers limited avec une liste vide : accepté (200), sans effet sur le statut ni sur la liste, sans audit", async () => {
    await call('post', '/bots', bot);
    await call('post', '/bots/sales/activate', { number_id: real(), expected_bot_id: null, status: 'limited', allowlist: ['+33612345678'] });
    await call('put', '/bots/sales/allowlist', { entries: [] });
    const res = await call('put', '/bots/sales/status', { status: 'limited' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'limited', allowlist: [] });
    expect(await db.getAllowlist('acme', 'sales')).toEqual([]);
    expect((await db.getBotRecord('acme', 'sales'))?.status).toBe('limited');
    expect(findBotConfig('acme', 'sales')!.status).toBe('limited');
    expect((await db.listAuditLog('acme')).filter((a) => a.action === 'bot.status')).toEqual([]);
  });

  // audit décisions A22
  it('PUT /status vers le statut actuel (brouillon, désactivé, ouvert à tous) : 200 avec la vue, aucune ligne d\'audit bot.status', async () => {
    await call('post', '/bots', bot);
    const draft = await call('put', '/bots/sales/status', { status: 'draft' });
    expect(draft.status).toBe(200);
    expect(draft.body).toMatchObject({ status: 'draft' });
    await call('post', '/bots/sales/activate', { number_id: real(), expected_bot_id: null, status: 'limited', allowlist: ['+33612345678'] });
    expect((await call('put', '/bots/sales/status', { status: 'active' })).status).toBe(200);
    const audits = async () => (await db.listAuditLog('acme')).filter((a) => a.action === 'bot.status');
    expect(await audits()).toHaveLength(1);
    expect((await call('put', '/bots/sales/status', { status: 'active' })).status).toBe(200);
    expect((await call('put', '/bots/sales/status', { status: 'paused' })).status).toBe(200);
    const again = await call('put', '/bots/sales/status', { status: 'paused' });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ status: 'paused' });
    // seuls les deux vrais changements sont audités (limited vers active, active vers paused)
    expect((await audits()).map((a) => a.metadata)).toEqual(expect.arrayContaining([{ from: 'limited', to: 'active' }, { from: 'active', to: 'paused' }]));
    expect(await audits()).toHaveLength(2);
  });

  // décision François A9
  it('brancher et débrancher : audit bot.number avec avant et après, ancien agent IA en service désactivé (number_unassigned)', async () => {
    await call('post', '/bots', bot);
    await call('post', '/bots', { ...bot, bot_id: 'support', name: 'Support' });
    await call('post', '/bots/sales/activate', { number_id: real(), expected_bot_id: null, status: 'limited', allowlist: ['+33612345678'] });
    const moved = await call('put', '/bots/support/number', { number_id: real(), expected_bot_id: 'sales' });
    expect(moved.status).toBe(200);
    expect(moved.body.whatsapp_number.id).toBe(real());
    expect((await db.getBotRecord('acme', 'sales'))).toMatchObject({ status: 'paused', status_reason: 'number_unassigned' });
    expect(findBotConfig('acme', 'sales')!.status).toBe('paused');
    const sales = await call('get', '/bots/sales');
    expect(sales.body).toMatchObject({ status: 'paused', status_reason: 'number_unassigned', whatsapp_number: null });
    const numberAudits = (await db.listAuditLog('acme')).filter((a) => a.action === 'bot.number');
    expect(numberAudits[0]).toMatchObject({ target: 'bot:acme/support', metadata: { from_number_id: null, to_number_id: real(), previous_bot_id: 'sales' } });

    expect((await call('put', '/bots/support/allowlist', { entries: ['+33612345678'] })).status).toBe(200);
    expect((await call('put', '/bots/support/status', { status: 'limited' })).status).toBe(200);
    const unassigned = await call('post', '/bots/support/number/unassign', { expected_number_id: real() });
    expect(unassigned.status).toBe(200);
    expect(unassigned.body).toMatchObject({ status: 'paused', status_reason: 'number_unassigned', whatsapp_number: null });
    expect(findBotConfig('acme', 'support')!.status).toBe('paused');
    const last = (await db.listAuditLog('acme')).find((a) => a.action === 'bot.number');
    expect(last?.metadata).toEqual({ from_number_id: real(), to_number_id: null, previous_bot_id: null });
  });

  // revue finale 2b-3 I-3 : brancher un numéro retiré chez le fournisseur dit que le numéro est retiré (pas le texte d'une transition)
  it("brancher ou activer sur un numéro retiré chez le fournisseur : 409 « Ce numéro a été retiré chez le fournisseur. », rien n'est écrit", async () => {
    await call('post', '/bots', bot);
    const REMOVED = 'Ce numéro a été retiré chez le fournisseur.';
    const found = { provider_number_id: 'pn-2', phone_e164: TEST, display_name: 'Test', meta_status: 'CONNECTED', quality: 'GREEN', is_test: true, cm_channel_id: null };
    await db.applyInventory('acme', acme.account.id, [found]);
    const assign = await call('put', '/bots/sales/number', { number_id: real(), expected_bot_id: null });
    expect(assign.status).toBe(409);
    expect(assign.body.error.message).toBe(REMOVED);
    expect(assign.body.error.reason).toBe('assign.number_removed');
    const activate = await call('post', '/bots/sales/activate', { number_id: real(), expected_bot_id: null, status: 'limited', allowlist: ['+33612345678'] });
    expect(activate.status).toBe(409);
    expect(activate.body.error.message).toBe(REMOVED);
    expect(activate.body.error.reason).toBe('assign.number_removed');
    expect((await call('get', '/bots/sales')).body).toMatchObject({ whatsapp_number: null, status: 'draft', allowlist: [] });
  });

  // revue finale 2b-3 I-2 : A passe du numéro N au numéro M pendant que l'écran affiche encore N
  it('débrancher avec un numéro attendu périmé : 409, A garde son nouveau numéro et son statut, rien d\'écrit', async () => {
    await call('post', '/bots', bot);
    const oldNumber = real();
    const newNumber = testNumber();
    await call('post', '/bots/sales/activate', { number_id: oldNumber, expected_bot_id: null, status: 'limited', allowlist: ['+33612345678'] });
    expect((await call('put', '/bots/sales/number', { number_id: newNumber, expected_bot_id: null })).status).toBe(200);
    const auditsBefore = (await db.listAuditLog('acme')).length;

    const stale = await call('post', '/bots/sales/number/unassign', { expected_number_id: oldNumber });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({
      code: 'CONFLICT',
      message: 'Ce numéro a changé depuis votre lecture : vérifiez la liste.',
      details: [{ path: 'expected_bot_id' }],
      reason: 'assign.holder_changed',
    });
    expect((await call('get', '/bots/sales')).body.whatsapp_number).toMatchObject({ id: newNumber });
    expect((await db.getBotRecord('acme', 'sales'))!.status).toBe('limited');
    expect((await db.listAuditLog('acme')).length).toBe(auditsBefore);
  });

  it('débrancher sans numéro attendu : 400 ; l\'ancienne route DELETE n\'existe plus', async () => {
    await call('post', '/bots', bot);
    await call('post', '/bots/sales/activate', { number_id: real(), expected_bot_id: null, status: 'limited', allowlist: ['+33612345678'] });
    expect((await call('post', '/bots/sales/number/unassign', {})).status).toBe(400);
    expect((await call('post', '/bots/sales/number/unassign', { expected_number_id: null })).status).toBe(400);
    expect((await call('delete', '/bots/sales/number')).status).toBe(404);
    expect((await call('get', '/bots/sales')).body.whatsapp_number).toMatchObject({ id: real() });
  });

  // revue 2b-3 M-1 : deux écrans lisent « numéro libre », le premier branche et active, le second est refusé
  it('brancher avec le même détenteur attendu (null) deux fois : le second est refusé 409, le premier agent IA garde numéro et statut', async () => {
    await call('post', '/bots', bot);
    await call('post', '/bots', { ...bot, bot_id: 'support', name: 'Support' });
    expect((await call('post', '/bots/sales/activate', { number_id: real(), expected_bot_id: null, status: 'limited', allowlist: ['+33612345678'] })).status).toBe(200);

    const stale = await call('put', '/bots/support/number', { number_id: real(), expected_bot_id: null });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({
      code: 'CONFLICT',
      message: 'Ce numéro a changé depuis votre lecture : vérifiez la liste.',
      details: [{ path: 'expected_bot_id' }],
      reason: 'assign.holder_changed',
    });
    expect((await db.getBotRecord('acme', 'sales'))!.status).toBe('limited');
    expect(findBotConfig('acme', 'sales')!.status).toBe('limited');
    expect((await call('get', '/bots/sales')).body.whatsapp_number).toMatchObject({ id: real() });
    expect((await call('get', '/bots/support')).body.whatsapp_number).toBeNull();
    expect((await db.listAuditLog('acme')).filter((a) => a.action === 'bot.number')).toHaveLength(0);
  });

  // revue 2b-3 M-1
  it("activer avec un détenteur attendu périmé : 409, rien d'écrit (numéro, liste, statut) ; le détenteur à jour est accepté", async () => {
    await call('post', '/bots', bot);
    await call('post', '/bots', { ...bot, bot_id: 'support', name: 'Support' });
    expect((await call('put', '/bots/sales/number', { number_id: real(), expected_bot_id: null })).status).toBe(200);
    await call('put', '/bots/sales/allowlist', { entries: ['+33612345678'] });
    await call('put', '/bots/sales/status', { status: 'limited' });

    const stale = await call('post', '/bots/support/activate', { number_id: real(), expected_bot_id: null, status: 'limited', allowlist: ['+33699999999'] });
    expect(stale.status).toBe(409);
    expect(stale.body.error.message).toBe('Ce numéro a changé depuis votre lecture : vérifiez la liste.');
    expect(stale.body.error.reason).toBe('assign.holder_changed');
    expect((await db.getBotRecord('acme', 'sales'))!.status).toBe('limited');
    expect((await call('get', '/bots/sales')).body.whatsapp_number).toMatchObject({ id: real() });
    expect(await db.getAllowlist('acme', 'support')).toEqual([]);
    expect((await db.getBotRecord('acme', 'support'))!.status).toBe('draft');

    const fresh = await call('post', '/bots/support/activate', { number_id: real(), expected_bot_id: 'sales', status: 'limited', allowlist: ['+33699999999'] });
    expect(fresh.status).toBe(200);
    // décision François A9
    expect((await db.getBotRecord('acme', 'sales'))).toMatchObject({ status: 'paused', status_reason: 'number_unassigned' });
  });

  // revue 2b-3 M-1 : le champ est obligatoire
  it('brancher ou activer sans expected_bot_id : 400', async () => {
    await call('post', '/bots', bot);
    expect((await call('put', '/bots/sales/number', { number_id: real() })).status).toBe(400);
    expect((await call('post', '/bots/sales/activate', { number_id: real(), status: 'limited', allowlist: ['+33612345678'] })).status).toBe(400);
    expect((await call('get', '/bots/sales')).body.whatsapp_number).toBeNull();
  });

  // audit R-15 : clé stable de chaque refus métier de la création d'un agent IA et de la liste d'accès limité
  it('refus de création et de liste : error.reason, texte inchangé', async () => {
    await call('post', '/bots', bot);

    const taken = await call('post', '/bots', bot);
    expect(taken.status).toBe(409);
    expect(taken.body.error).toMatchObject({ message: 'bot_id déjà pris.', reason: 'bot.id_taken' });

    const noLanguage = await call('post', '/bots', { ...bot, bot_id: 'en-only', default_language: 'en', languages: ['en', 'fr'] });
    expect(noLanguage.status).toBe(400);
    expect(noLanguage.body.error).toMatchObject({
      message: 'Données invalides.', reason: 'bot.default_language_missing',
      details: [{ path: 'system_prompt', message: 'Aucune personnalité ni prompt pour la langue par défaut (en).' }],
    });

    const unavailable = await call('post', '/bots', { ...bot, bot_id: 'ghost', entity_id: 999999 });
    expect(unavailable.status).toBe(400);
    expect(unavailable.body.error).toMatchObject({ reason: 'bot.entity_unavailable', details: [{ path: 'entity_id', message: 'Entité introuvable ou archivée.' }] });

    expect((await call('post', '/entities', { name: 'Lyon' })).status).toBe(201);
    const required = await call('post', '/bots', { ...bot, bot_id: 'second' });
    expect(required.status).toBe(400);
    expect(required.body.error).toMatchObject({ reason: 'bot.entity_required', details: [{ path: 'entity_id', message: 'Choisissez une entité.' }] });

    const invalidEntry = await call('put', '/bots/sales/allowlist', { entries: ['pas un numéro'] });
    expect(invalidEntry.status).toBe(400);
    expect(invalidEntry.body.error).toMatchObject({ reason: 'allowlist.invalid_entry', details: [{ path: 'entries.0', message: ENTRY_MESSAGE }] });

    const tooMany = await call('put', '/bots/sales/allowlist', { entries: Array.from({ length: 21 }, (_, i) => `+3361234567${String(i).padStart(2, '0')}`) });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error).toMatchObject({ reason: 'allowlist.too_many', details: [{ path: 'entries', message: '20 entrées au plus.' }] });
    expect((await call('get', '/bots/nope')).body.error).toMatchObject({ message: 'Agent IA introuvable.', reason: 'bot.not_found' });
  });

  // isolation : un numéro d'une autre organisation et un numéro inexistant répondent exactement pareil (texte et clé)
  it("404 d'un numéro d'une autre organisation et d'un numéro inexistant : même texte, même reason", async () => {
    const other = { Authorization: `Bearer ${await bearer('ca2@other.test')}` };
    await call('post', '/bots', { ...bot, bot_id: 'mine', name: 'Mine' }, other);
    const heldByAcme = { number_id: real(), expected_bot_id: null };
    const missing = { number_id: 987654, expected_bot_id: null };

    const foreign = await call('put', '/bots/mine/number', heldByAcme, other);
    const unknown = await call('put', '/bots/mine/number', missing, other);
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(foreign.body.error.message).toBe('Agent IA ou numéro WhatsApp introuvable.');
    expect(foreign.body.error.reason).toBe('assign.not_found');
    expect(unknown.body.error.message).toBe(foreign.body.error.message);
    expect(unknown.body.error.reason).toBe(foreign.body.error.reason);
    expect(unknown.body.error.code).toBe(foreign.body.error.code);

    const foreignActivate = await call('post', '/bots/mine/activate', { ...heldByAcme, status: 'limited', allowlist: ['+33612345678'] }, other);
    const unknownActivate = await call('post', '/bots/mine/activate', { ...missing, status: 'limited', allowlist: ['+33612345678'] }, other);
    expect(foreignActivate.body.error.reason).toBe('assign.not_found');
    expect(unknownActivate.body.error.reason).toBe(foreignActivate.body.error.reason);
    expect(unknownActivate.body.error.message).toBe(foreignActivate.body.error.message);
  });

  // revue 2b-3 (défense en profondeur) : aucune réponse de l'API d'administration ne se met en cache
  it("toutes les réponses de l'API d'administration portent Cache-Control: no-store : succès, refus, authentification, route inconnue, préflight", async () => {
    await call('post', '/bots', bot);
    const noToken = request(await serve(app));
    const responses = [
      ['succès (liste)', await call('get', '/bots')],
      ['succès (création)', await call('post', '/bots', { ...bot, bot_id: 'support', name: 'Support' })],
      ['404 (agent IA inconnu)', await call('get', '/bots/ghost')],
      ['409 (machine d\'états)', await call('put', '/bots/sales/status', { status: 'limited' })],
      ['400 (corps invalide)', await call('put', '/bots/sales/number', { number_id: 0, expected_bot_id: null })],
      ['403 (autre organisation active)', await call('get', '/bots', undefined, { ...auth, [ORGANIZATION_HEADER]: 'beta' })],
      ['401 (sans jeton)', await noToken.get('/api/admin/v1/bots')],
      ['401 (connexion refusée)', await noToken.post('/api/admin/v1/auth/login').send({ email: 'ca@acme.test', password: 'mauvais-mot-de-passe' })],
      ['404 (route inconnue)', await call('get', '/nexiste-pas')],
      ['204 (préflight)', await noToken.options('/api/admin/v1/bots')],
    ] as const;
    const statuses = responses.map(([label, res]) => [label, res.status]);
    expect(statuses).toEqual([
      ['succès (liste)', 200], ['succès (création)', 201], ['404 (agent IA inconnu)', 404], ["409 (machine d'états)", 409],
      ['400 (corps invalide)', 400], ['403 (autre organisation active)', 403], ['401 (sans jeton)', 401],
      ['401 (connexion refusée)', 401], ['404 (route inconnue)', 404], ['204 (préflight)', 204],
    ]);
    for (const [label, res] of responses) expect([label, res.headers['cache-control']]).toEqual([label, 'no-store']);
  });

  // revue 2b-3 (cycle 1, m-4) et revue finale 2b-3 I-1 : un corps JSON mal formé est un refus de validation (400),
  // avec l'en-tête no-store, un identifiant de requête, et sans que le corps brut (secret compris) n'atteigne un journal
  it("revue finale 2b-3 I-1 : corps JSON mal formé : 400 VALIDATION_ERROR, no-store, aucun journal ne porte le corps", async () => {
    const secret = 'sk-secret-a-ne-jamais-journaliser';
    const logs = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'log')];
    for (const spy of logs) spy.mockImplementation(() => undefined);
    const res = await request(await serve(app)).post('/api/admin/v1/bots').set(auth).set('Content-Type', 'application/json')
      .send(`{"bot_id": "sales", "api_key": "${secret}", `);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toBe('Corps JSON invalide.');
    expect(typeof res.body.error.request_id).toBe('string');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(res.body)).not.toContain(secret);
    for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
  });

  it("revue finale 2b-3 I-1 : corps trop volumineux : 400 VALIDATION_ERROR sans corps journalisé", async () => {
    const logs = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'log')];
    for (const spy of logs) spy.mockImplementation(() => undefined);
    const big = JSON.stringify({ bot_id: 'sales', system_prompt: { fr: 'SECRET-LONG'.repeat(40_000) } });
    const res = await request(await serve(app)).post('/api/admin/v1/bots').set(auth).set('Content-Type', 'application/json').send(big);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toBe('Corps JSON trop volumineux.');
    expect(res.headers['cache-control']).toBe('no-store');
    for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain('SECRET-LONG');
  });

  it("brancher un numéro d'une autre organisation ou inconnu : 404 ; number_id invalide : 400", async () => {
    await call('post', '/bots', bot);
    expect((await call('put', '/bots/sales/number', { number_id: beta.numbers['+33200000001']!.id, expected_bot_id: null })).status).toBe(404);
    expect((await call('put', '/bots/sales/number', { number_id: 99999, expected_bot_id: null })).status).toBe(404);
    expect((await call('put', '/bots/sales/number', { number_id: 0, expected_bot_id: null })).status).toBe(400);
    expect((await call('put', '/bots/sales/number', { number_id: 'x', expected_bot_id: null })).status).toBe(400);
    expect((await db.getWhatsAppNumber('other', beta.numbers['+33200000001']!.id))?.bot_id).toBeNull();
  });

  it("détail : unserved.count lu de l'état d'exécution", async () => {
    await call('post', '/bots', bot);
    await db.incrementUnserved('acme', 'sales');
    await db.incrementUnserved('acme', 'sales');
    const res = await call('get', '/bots/sales');
    expect(res.body.unserved.count).toBe(2);
    expect(res.body.unserved.last_at).toEqual(expect.any(String));
  });

  it('routes supprimées : 404', async () => {
    await call('post', '/bots', bot);
    expect((await call('put', '/bots/sales/numbers', { numbers: ['+33611111111'] })).status).toBe(404);
    expect((await call('get', '/bots/sales/transport')).status).toBe(404);
    expect((await call('put', '/bots/sales/transport', { values: { phone_number_id: '1' } })).status).toBe(404);
    expect((await call('post', '/bots/sales/transport/validate')).status).toBe(404);
  });

  it('catalogue des connecteurs : plus aucun fournisseur de transport', async () => {
    const res = await call('get', '/connectors');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.some((c: { service: string }) => c.service === 'transport')).toBe(false);
  });

  it('droits : un conseiller ne configure ni numéro, ni statut, ni liste, ni activation (403)', async () => {
    await call('post', '/bots', bot);
    const adv = { Authorization: `Bearer ${await bearer('adv@acme.test')}` };
    expect((await call('put', '/bots/sales/number', { number_id: real(), expected_bot_id: null }, adv)).status).toBe(403);
    expect((await call('post', '/bots/sales/number/unassign', { expected_number_id: real() }, adv)).status).toBe(403);
    expect((await call('put', '/bots/sales/status', { status: 'draft' }, adv)).status).toBe(403);
    expect((await call('put', '/bots/sales/allowlist', { entries: [] }, adv)).status).toBe(403);
    expect((await call('post', '/bots/sales/activate', { number_id: real(), expected_bot_id: null, status: 'limited', allowlist: ['+33612345678'] }, adv)).status).toBe(403);
  });

  it('sans token → 401 ; payload invalide → 400', async () => {
    expect((await request(await serve(app)).get('/api/admin/v1/bots')).status).toBe(401);
    const bad = await call('post', '/bots', { bot_id: 'Bad Id' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });
});
