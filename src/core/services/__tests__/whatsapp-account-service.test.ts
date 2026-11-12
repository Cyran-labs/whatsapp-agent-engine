import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from '../../../test-support/test-database.js';
import type { BotRecord, Database } from '../../database/types.js';
import type { ProviderNumber } from '../../database/whatsapp-types.js';
import type { ProviderListing, ProviderVerification } from '../../../whatsapp/provider-common.js';
import { ADMIN_INVENTORY, WhatsAppAccountService, type WhatsAppProviders } from '../whatsapp-account-service.js';
import { decryptAccountSecrets, encryptAccountSecrets, getTransportForNumber, invalidateAccountTransports } from '../../../transport/index.js';
import { hashWebhookKey } from '../../../whatsapp/webhook-key.js';
import { recordSignatureFailure, recordSignatureSuccess, resetSignatureMonitor } from '../../../webhooks/signature-monitor.js';
import { AppError } from '../../../api/errors.js';
import { verifyMetaManual } from '../../../whatsapp/meta-graph.js';
import { UNCHECKED } from '../../../test-support/whatsapp.js';
import { fakeMetaWebhooks, keyOfMetaUrl, type FakeMetaWebhooks } from '../../../test-support/meta-webhooks-fake.js';
import { createMetaWebhookClient } from '../../../whatsapp/meta-webhooks.js';
import { matchPendingVerification, pendingVerificationKeysForTests, resetPendingVerificationsForTests } from '../../../webhooks/pending-verification.js';
import { loadBotNumberSummary } from '../bot-number-summary.js';

// Les deux moteurs (SQLite par défaut, Postgres avec TEST_DATABASE_URL). Clients fournisseurs simulés.

const ACME_TOKEN = 'EAAG-acme-jeton-0123456789abcdef';
const ACME_SECRET = 'acme-secret-app-0123456789';
const BETA_TOKEN = 'EAAG-beta-jeton-0123456789abcdef';
const BETA_SECRET = 'beta-secret-app-0123456789';
const CM_ACCOUNT = '0b9c8a52-4f1e-4d4c-9a39-2a3d5f7e9b10';
const CM_TOKEN = 'cm-product-token-0123456789';
const BASE_URL = 'https://moteur.example.test';

function num(i: number, over: Partial<ProviderNumber> = {}): ProviderNumber {
  return {
    provider_number_id: `pn-${i}`, phone_e164: `+3310000000${i}`, display_name: `Boutique ${i}`, meta_status: 'CONNECTED',
    quality: 'GREEN', is_test: false, cm_channel_id: null, ...over,
  };
}

function verified(over: Partial<Extract<ProviderVerification, { ok: true }>> = {}): ProviderVerification {
  return {
    ok: true,
    checks: [{ key: 'token', status: 'ok' }, { key: 'waba_access', status: 'ok' }, { key: 'app_secret', status: 'ok' }],
    account_name: 'Nom chez Meta', waba_id: '1111111111', meta_app_id: 'app-1', token_expiry: null,
    numbers: [num(1)], skipped: { sandbox: 0, invalid_number: 0 }, meta_health: null, ...over,
  };
}

function refusedToken(): ProviderVerification {
  return {
    ok: false, checks: [{ key: 'token', status: 'failed', detail: 'Jeton refusé par Meta' }],
    error_reason: 'token_invalid', message: 'Jeton refusé par Meta',
  };
}

function listing(numbers: ProviderNumber[]): ProviderListing {
  return { numbers, skipped: { sandbox: 0, invalid_number: 0 } };
}

function bot(clientId: string, botId: string, status: string, name = botId): BotRecord {
  return {
    client_id: clientId, bot_id: botId, name, status, status_reason: null,
    default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'Agent IA.' }, lead_fields: '',
    welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null,
    personality: null, entity_id: null,
  };
}

const metaInput = (over: Record<string, string> = {}) => ({
  mode: 'meta_manual' as const, name: 'Compte Acme Paris', waba_id: '1111111111', access_token: ACME_TOKEN, app_secret: ACME_SECRET, ...over,
});

async function caught(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error('aucune erreur levée');
}

describe('WhatsAppAccountService', () => {
  let db: Database;
  type ProviderFns = Omit<WhatsAppProviders, 'metaWebhooks'>;
  let providers: { [K in keyof ProviderFns]: ReturnType<typeof vi.fn<ProviderFns[K]>> } & { metaWebhooks: WhatsAppProviders['metaWebhooks'] };
  let metaWebhooks: FakeMetaWebhooks;
  let svc: WhatsAppAccountService;

  beforeEach(async () => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '0'.repeat(64));
    // Lot R1 : l'adresse publique est obligatoire pour raccorder un compte Meta.
    vi.stubEnv('PUBLIC_BASE_URL', BASE_URL);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    db = await createTestDatabase();
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.upsertClient({ client_id: 'beta', name: 'Beta', status: 'active' });
    providers = {
      verifyMeta: vi.fn<WhatsAppProviders['verifyMeta']>(async () => verified()),
      listMeta: vi.fn<WhatsAppProviders['listMeta']>(async () => listing([num(1)])),
      verifyCm: vi.fn<WhatsAppProviders['verifyCm']>(async () => verified({ meta_app_id: null, waba_id: '2222222222' })),
      listCm: vi.fn<WhatsAppProviders['listCm']>(async () => listing([num(1)])),
      metaWebhooks: (metaWebhooks = fakeMetaWebhooks()),
    };
    svc = new WhatsAppAccountService({ db, providers });
  });

  afterEach(async () => {
    resetSignatureMonitor();
    resetPendingVerificationsForTests();
    for (let id = 1; id <= 10; id++) invalidateAccountTransports(id);
    await db.close();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('raccordement', () => {
    it('Meta : vue sans aucun secret, URL de webhook propre au compte, numéros inventoriés, audit sans secret', async () => {
      const created = await svc.create('acme', 7, metaInput());
      const record = (await db.getWhatsAppAccount('acme', created.id))!;
      const text = JSON.stringify(created);
      expect(text).not.toContain(ACME_TOKEN);
      expect(text).not.toContain(ACME_SECRET);
      expect(text).not.toContain(record.webhook_key_hash!);
      expect(text).not.toContain(record.secret_encrypted);

      expect(created).toMatchObject({
        name: 'Compte Acme Paris', mode: 'meta_manual', provider_account_id: '1111111111', waba_id: '1111111111',
        state: 'connected', error_reason: null, is_test: false,
        inventory: { added: 1, removed: 0, refused: 0, skipped_sandbox: 0, skipped_invalid: 0 },
      });
      // Lot R1 : le moteur inscrit lui-même l'adresse chez Meta, la réponse ne porte plus de webhook à recopier.
      expect(created.webhook).toBeNull();
      const inscription = metaWebhooks.calls.find((c) => c.op === 'setWabaOverride')!;
      const key = keyOfMetaUrl(inscription.url!);
      expect(inscription.url).toBe(`${BASE_URL}/webhook/meta/${key}`);
      expect(hashWebhookKey(key)).toBe(record.webhook_key_hash);
      expect(inscription.verify_token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      expect(text).not.toContain(key);
      expect(text).not.toContain(inscription.verify_token!);
      expect(created.numbers.map((n) => [n.phone_e164, n.bot])).toEqual([['+33100000001', null]]);
      expect(created.checks.map((c) => [c.key, c.status])).toEqual([
        ['token', 'ok'], ['waba_access', 'ok'], ['app_secret', 'ok'], ['webhook_waba', 'created'], ['webhook_app', 'created'],
      ]);
      expect(providers.verifyMeta).toHaveBeenCalledWith({ waba_id: '1111111111', access_token: ACME_TOKEN, app_secret: ACME_SECRET });

      const secrets = decryptAccountSecrets(record);
      expect(secrets).toEqual({
        mode: 'meta_manual', access_token: ACME_TOKEN, app_secret: ACME_SECRET, verify_token: inscription.verify_token, webhook_key: key,
      });
      expect(record.meta_app_id).toBe('app-1');
      // La vue porte l'identifiant public de l'app Meta (lien vers l'app dans le back-office).
      expect(created.meta_app_id).toBe('app-1');
      expect((await svc.get('acme', created.id)).meta_app_id).toBe('app-1');

      const audits = await db.listAuditLog('acme');
      expect(audits.map((a) => [a.action, a.metadata])).toEqual([['whatsapp_account.create', {
        mode: 'meta_manual', numbers: 1, refused: 0, webhook_waba: 'ok', webhook_app: 'ok',
      }]]);
      const auditText = JSON.stringify(audits);
      for (const secret of [ACME_TOKEN, ACME_SECRET, key, inscription.verify_token!, record.webhook_key_hash!, BASE_URL]) {
        expect(auditText).not.toContain(secret);
      }
    });

    it("CM.com : URL cm-com, pas de jeton de vérification, WABA lue à titre indicatif", async () => {
      const created = await svc.create('acme', 7, { mode: 'cm_com', name: 'CM', account_id: CM_ACCOUNT, product_token: CM_TOKEN });
      expect(JSON.stringify(created)).not.toContain(CM_TOKEN);
      expect(created).toMatchObject({ mode: 'cm_com', provider_account_id: CM_ACCOUNT, waba_id: '2222222222' });
      expect(created.webhook!.path.startsWith('/webhook/cm-com/')).toBe(true);
      // revue R1 ISO-M5
      expect(Object.keys(created.webhook!).sort()).toEqual(['path', 'url']);
      expect(created.meta_app_id).toBeNull();
      expect(providers.verifyCm).toHaveBeenCalledWith({ account_id: CM_ACCOUNT, product_token: CM_TOKEN });
      // CM.com inchangé : aucun appel d'inscription chez Meta, pas d'état de webhook ni d'état Meta.
      expect(metaWebhooks.calls).toEqual([]);
      expect([created.webhooks, created.meta_health]).toEqual([null, null]);
    });

    it("CM.com : l'URL complète est préfixée par PUBLIC_BASE_URL quand il est défini, le chemin seul sinon", async () => {
      const created = await svc.create('acme', 7, { mode: 'cm_com', name: 'CM', account_id: CM_ACCOUNT, product_token: CM_TOKEN });
      expect(created.webhook!.url).toBe(`${BASE_URL}${created.webhook!.path}`);
      vi.stubEnv('PUBLIC_BASE_URL', '');
      expect((await svc.getWebhook('acme', created.id)).url).toBeNull();
    });

    it('échec de vérification : 422 WA_VALIDATION_FAILED, un détail par contrôle en échec, rien écrit', async () => {
      providers.verifyMeta.mockResolvedValueOnce(refusedToken());
      const err = await caught(svc.create('acme', 7, metaInput()));
      expect(err.code).toBe('WA_VALIDATION_FAILED');
      expect(err.status).toBe(422);
      expect(err.message).toBe('Jeton refusé par Meta');
      expect(err.details).toEqual([{ path: 'token', message: 'Jeton refusé par Meta' }]);
      expect(await db.listWhatsAppAccounts('acme')).toEqual([]);
      expect(await db.listWhatsAppNumbers('acme')).toEqual([]);
      expect(await db.listAuditLog('acme')).toEqual([]);
    });

    // audit 6.4
    it.each([
      ['access_token', { access_token: `••••${'x'.repeat(30)}` }],
      ['app_secret', { app_secret: `••••${'y'.repeat(20)}` }],
    ])('valeur masquée (%s) refusée avant tout appel au fournisseur', async (field, over) => {
      const err = await caught(svc.create('acme', 7, metaInput(over)));
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.message).toBe("Saisissez la valeur complète : une valeur masquée n'est pas acceptée.");
      expect(err.reason).toBe('whatsapp_account.masked_value');
      expect(err.details?.[0]?.path).toBe(field);
      expect(providers.verifyMeta).not.toHaveBeenCalled();
      expect(await db.listWhatsAppAccounts('acme')).toEqual([]);
    });

    // audit 6.4
    it('productToken masqué refusé avant tout appel au fournisseur', async () => {
      const err = await caught(svc.create('acme', 7, { mode: 'cm_com', name: 'CM', account_id: CM_ACCOUNT, product_token: '••••abcdefghij' }));
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(providers.verifyCm).not.toHaveBeenCalled();
    });

    it('forme invalide : refus avant tout appel au fournisseur', async () => {
      await expect(svc.create('acme', 7, metaInput({ waba_id: 'abc' }))).rejects.toThrow();
      expect(providers.verifyMeta).not.toHaveBeenCalled();
    });

    it("même compte déjà raccordé dans l'organisation : 409 avant vérification ; permis après déconnexion", async () => {
      const first = await svc.create('acme', 7, metaInput());
      providers.verifyMeta.mockClear();
      const err = await caught(svc.create('acme', 7, metaInput({ name: 'Doublon' })));
      expect(err.status).toBe(409);
      expect(err.message).toBe('Ce compte WhatsApp est déjà raccordé.');
      expect(err.reason).toBe('whatsapp_account.already_connected');
      expect(providers.verifyMeta).not.toHaveBeenCalled();
      await svc.disconnect('acme', first.id, 7);
      const again = await svc.create('acme', 7, metaInput({ name: 'Nouveau' }));
      expect(again.id).not.toBe(first.id);
    });

    // audit 1.5
    it("numéro tenu par un compte connected d'une autre organisation : refusé, compté, rien ne révèle l'autre organisation", async () => {
      await svc.create('acme', 7, metaInput());
      providers.verifyMeta.mockResolvedValueOnce(verified({ waba_id: '3333333333', meta_app_id: 'app-beta', numbers: [num(1), num(2)] }));
      const created = await svc.create('beta', 8, {
        mode: 'meta_manual', name: 'Compte Beta', waba_id: '3333333333', access_token: BETA_TOKEN, app_secret: BETA_SECRET,
      });
      expect(created.inventory).toMatchObject({ added: 1, refused: 1 });
      expect(created.numbers.map((n) => n.phone_e164)).toEqual(['+33100000002']);
      const text = JSON.stringify(created);
      expect(text).not.toContain('acme');
      expect(text).not.toContain('Compte Acme Paris');
      const betaAudits = JSON.stringify(await db.listAuditLog('beta'));
      expect(betaAudits).not.toContain('acme');
      expect((await db.listWhatsAppNumbers('acme')).map((n) => n.provider_state)).toEqual(['present']);
    });

    // audit 1.5
    it("reprise d'un numéro d'une autre organisation en erreur : l'agent IA mis en pause n'apparaît ni dans la réponse ni dans l'audit de beta", async () => {
      const acme = await svc.create('acme', 7, metaInput());
      await db.upsertBotRecord(bot('acme', 'ventes-acme', 'active', 'Ventes Acme'));
      expect((await db.assignNumber('acme', 'ventes-acme', acme.numbers[0]!.id, UNCHECKED)).ok).toBe(true);
      await db.setWhatsAppAccountError(acme.id, 'token_invalid', 'Jeton refusé');
      providers.verifyMeta.mockResolvedValueOnce(verified({ waba_id: '3333333333', meta_app_id: 'app-beta' }));
      const created = await svc.create('beta', 8, {
        mode: 'meta_manual', name: 'Compte Beta', waba_id: '3333333333', access_token: BETA_TOKEN, app_secret: BETA_SECRET,
      });
      expect(created.inventory).toMatchObject({ added: 1, refused: 0 });
      const text = JSON.stringify(created);
      for (const leak of ['acme', 'ventes-acme', 'Ventes Acme', 'paused_bots']) expect(text).not.toContain(leak);
      const betaAudits = JSON.stringify(await db.listAuditLog('beta'));
      for (const leak of ['acme', 'ventes-acme']) expect(betaAudits).not.toContain(leak);
      expect((await db.getBotRecord('acme', 'ventes-acme'))!.status).toBe('paused');
    });

    // revue 2b-1 M-2
    it("app Meta déjà utilisée par un compte connected d'une autre organisation : 409 neutre, rien écrit", async () => {
      await svc.create('acme', 7, metaInput());
      providers.verifyMeta.mockResolvedValueOnce(verified({ waba_id: '3333333333', meta_app_id: 'app-1', numbers: [num(5)] }));
      const err = await caught(svc.create('beta', 8, {
        mode: 'meta_manual', name: 'Compte Beta', waba_id: '3333333333', access_token: BETA_TOKEN, app_secret: BETA_SECRET,
      }));
      expect(err.status).toBe(409);
      expect(err.message).toBe('Ce compte ne peut pas être raccordé. Contactez le support.');
      expect(err.reason).toBe('whatsapp_account.cannot_connect');
      expect(JSON.stringify({ message: err.message, details: err.details ?? null, reason: err.reason })).not.toContain('acme');
      expect(await db.listWhatsAppAccounts('beta')).toEqual([]);
      expect(await db.listWhatsAppNumbers('beta')).toEqual([]);
      // Lot R1 : l'app est contrôlée avant toute écriture chez Meta.
      expect(metaWebhooks.writes().filter((c) => c.credential === BETA_TOKEN || c.credential === BETA_SECRET)).toEqual([]);
    });
  });

  describe('raccordement Meta : inscription des webhooks (lot R1)', () => {
    const PUBLIC_URL_MISSING = "La plateforme n'a pas d'adresse publique pour recevoir les messages. Contactez le support.";
    const UNREACHABLE = "Meta n'a pas pu joindre WABAGENT pour vérifier l'adresse du webhook. Réessayez dans quelques minutes ; si cela continue, contactez le support.";
    const UNCONFIRMED = "Meta n'a pas confirmé l'adresse du webhook de WABAGENT. Réessayez ; si cela continue, contactez le support.";
    const CLEANUP_DONE = "L'adresse inscrite chez Meta a été retirée.";
    const CLEANUP_FAILED = "WABAGENT n'a pas pu retirer l'adresse inscrite chez Meta ; elle ne reçoit rien. Réessayez le raccordement ou contactez le support.";
    const APP_WEBHOOK_FAILED = "WABAGENT n'a pas pu lire ou inscrire le webhook de votre app Meta.";
    const HEALTH = { can_send: 'limited' as const, business_verification: 'not_verified', issues: [{ code: 141010, text: 'Business verification' }], read_at: '2026-11-12T10:00:00.000Z' };

    async function nothingWritten(clientId: string): Promise<void> {
      expect(await db.listWhatsAppAccounts(clientId)).toEqual([]);
      expect(await db.listWhatsAppNumbers(clientId)).toEqual([]);
      expect(await db.listAuditLog(clientId)).toEqual([]);
      expect(pendingVerificationKeysForTests()).toEqual([]);
    }

    it('PUBLIC_BASE_URL absente : refus public_url_missing, aucun appel Meta', async () => {
      vi.stubEnv('PUBLIC_BASE_URL', '');
      const err = await caught(svc.create('acme', 7, metaInput()));
      expect([err.code, err.status, err.message, err.reason]).toEqual(['WA_VALIDATION_FAILED', 422, PUBLIC_URL_MISSING, 'whatsapp_account.public_url_missing']);
      expect(providers.verifyMeta).not.toHaveBeenCalled();
      expect(metaWebhooks.calls).toEqual([]);
      await nothingWritten('acme');
    });

    it('adresse de webhook de plus de 200 caractères : refus webhook_url_too_long, aucun appel Meta', async () => {
      vi.stubEnv('PUBLIC_BASE_URL', `${BASE_URL}/${'chemin'.repeat(25)}`);
      const err = await caught(svc.create('acme', 7, metaInput()));
      expect([err.code, err.reason]).toEqual(['WA_VALIDATION_FAILED', 'whatsapp_account.webhook_url_too_long']);
      expect(providers.verifyMeta).not.toHaveBeenCalled();
      expect(metaWebhooks.calls).toEqual([]);
      await nothingWritten('acme');
    });

    it("ordre des appels : lectures, unicité, override, relecture, enregistrement, webhook de l'app", async () => {
      const order: string[] = [];
      const holder = db.findProviderAccountHolder.bind(db);
      vi.spyOn(db, 'findProviderAccountHolder').mockImplementation(async (...a) => { order.push('unicité WABA'); return holder(...a); });
      const appHeld = db.isMetaAppHeldElsewhere.bind(db);
      vi.spyOn(db, 'isMetaAppHeldElsewhere').mockImplementation(async (...a) => { order.push('unicité app'); return appHeld(...a); });
      const createRow = db.createWhatsAppAccountWithInventory.bind(db);
      vi.spyOn(db, 'createWhatsAppAccountWithInventory').mockImplementation(async (...a) => { order.push('enregistrement'); return createRow(...a); });
      providers.verifyMeta.mockImplementation(async () => { order.push('lectures'); return verified(); });
      let servedDuringWrite = false;
      const write = metaWebhooks.setWabaOverride.getMockImplementation()!;
      metaWebhooks.setWabaOverride.mockImplementation(async (c, t) => {
        order.push('override');
        // Meta vérifie l'adresse pendant l'appel : le GET doit être servi par le registre, le compte n'existe pas encore.
        servedDuringWrite = matchPendingVerification(keyOfMetaUrl(t.callbackUrl), t.verifyToken) && (await db.listWhatsAppAccounts('acme')).length === 0;
        return write(c, t);
      });
      const readBack = metaWebhooks.readWabaOverride.getMockImplementation()!;
      metaWebhooks.readWabaOverride.mockImplementation(async (c, appId) => { order.push('relecture'); return readBack(c, appId); });
      const readApp = metaWebhooks.readAppWebhook.getMockImplementation()!;
      metaWebhooks.readAppWebhook.mockImplementation(async (app) => { order.push("lecture du webhook de l'app"); return readApp(app); });
      const writeApp = metaWebhooks.setAppWebhook.getMockImplementation()!;
      metaWebhooks.setAppWebhook.mockImplementation(async (app, t) => { order.push("webhook de l'app"); return writeApp(app, t); });

      const created = await svc.create('acme', 7, metaInput());
      expect(order).toEqual([
        'unicité WABA', 'lectures', 'unicité WABA', 'unicité app', 'override', 'relecture', 'enregistrement',
        "lecture du webhook de l'app", "webhook de l'app",
      ]);
      expect(servedDuringWrite).toBe(true);
      expect(pendingVerificationKeysForTests()).toEqual([]);
      expect(created.state).toBe('connected');
      // Les appels de la WABA portent les identifiants saisis, ceux de l'app le secret saisi (aucun repli .env).
      expect(metaWebhooks.calls.map((c) => [c.op, c.target, c.credential])).toEqual([
        ['setWabaOverride', '1111111111', ACME_TOKEN], ['readWabaOverride', '1111111111', ACME_TOKEN],
        ['readAppWebhook', 'app-1', ACME_SECRET], ['setAppWebhook', 'app-1', ACME_SECRET],
      ]);
      expect(metaWebhooks.setAppWebhook.mock.calls[0]![1].fields).toContain('messages');
    });

    it('URL inscrite sans double barre (adresse publique avec un chemin) ; même adresse pour la WABA et pour l\'app', async () => {
      vi.stubEnv('PUBLIC_BASE_URL', 'https://dev.wabagent.com/moteur');
      const created = await svc.create('acme', 7, metaInput());
      const record = (await db.getWhatsAppAccount('acme', created.id))!;
      const urls = metaWebhooks.writes().map((c) => c.url);
      const key = keyOfMetaUrl(urls[0]!);
      expect(hashWebhookKey(key)).toBe(record.webhook_key_hash);
      expect(urls).toEqual([`https://dev.wabagent.com/moteur/webhook/meta/${key}`, `https://dev.wabagent.com/moteur/webhook/meta/${key}`]);
      for (const url of urls) expect(url!.slice('https://'.length)).not.toContain('//');
    });

    // spec R1 §5.2
    it('2200 au POST : rien en base, registre libéré', async () => {
      metaWebhooks.setWabaOverride.mockResolvedValueOnce({ ok: false, failure: { kind: 'callback_failed', provider_text: '(#2200) Callback verification failed' } });
      const err = await caught(svc.create('acme', 7, metaInput()));
      expect([err.code, err.status, err.message, err.reason]).toEqual(['WA_VALIDATION_FAILED', 422, UNREACHABLE, 'whatsapp_account.webhook_unreachable']);
      expect(err.details).toEqual([{ path: 'webhook_waba', message: UNREACHABLE, provider_text: '(#2200) Callback verification failed' }]);
      // Meta n'a rien écrit (2200) : aucun retrait, aucun webhook de l'app.
      expect(metaWebhooks.calls.map((c) => c.op)).toEqual(['setWabaOverride']);
      await nothingWritten('acme');
    });

    it.each([
      ['délai dépassé', { kind: 'timeout' as const }],
      ['réponse 5xx', { kind: 'other' as const, message: 'Meta a répondu avec le code HTTP 503', transient: true as const }],
    ])("panne passagère au POST (%s) : webhook_unreachable, transient dans le détail, retrait tenté, rien en base", async (_label, failure) => {
      metaWebhooks.setWabaOverride.mockResolvedValueOnce({ ok: false, failure });
      const err = await caught(svc.create('acme', 7, metaInput()));
      expect([err.message, err.reason]).toEqual([UNREACHABLE, 'whatsapp_account.webhook_unreachable']);
      expect(err.details?.map((d) => d.path)).toEqual(['webhook_waba', 'transient', 'webhook_cleanup.done']);
      expect(err.details?.[2]?.message).toBe(CLEANUP_DONE);
      // L'écriture a pu aboutir chez Meta sans réponse : l'adresse est retirée, sur la WABA de la requête seulement.
      expect(metaWebhooks.calls.map((c) => [c.op, c.target])).toEqual([['setWabaOverride', '1111111111'], ['clearWabaOverride', '1111111111']]);
      await nothingWritten('acme');
    });

    it('refus net de Meta au POST (4xx générique) : verification_failed avec le texte de Meta, rien en base, aucun retrait', async () => {
      metaWebhooks.setWabaOverride.mockResolvedValueOnce({ ok: false, failure: { kind: 'other', message: 'Meta a refusé la demande', provider_text: '(#100) Invalid parameter' } });
      const err = await caught(svc.create('acme', 7, metaInput()));
      expect(err.reason).toBe('whatsapp_account.verification_failed');
      expect(err.details).toEqual([{ path: 'webhook_waba', message: 'Meta a refusé la demande', provider_text: '(#100) Invalid parameter' }]);
      expect(metaWebhooks.calls.map((c) => c.op)).toEqual(['setWabaOverride']);
      await nothingWritten('acme');
    });

    // spec R1 §5.2
    it.each([
      ['autre adresse', { ok: true as const, subscribed: true, override: 'https://autre.example.com/x' }],
      ['app non abonnée', { ok: true as const, subscribed: false, override: null }],
      ['relecture en échec', { ok: false as const, failure: { kind: 'timeout' as const } }],
    ])('relecture sans notre adresse (%s) : retrait tenté, raison webhook_unconfirmed', async (_label, readBack) => {
      metaWebhooks.readWabaOverride.mockResolvedValueOnce(readBack);
      const err = await caught(svc.create('acme', 7, metaInput()));
      expect([err.code, err.message, err.reason]).toEqual(['WA_VALIDATION_FAILED', UNCONFIRMED, 'whatsapp_account.webhook_unconfirmed']);
      expect(err.details).toEqual([{ path: 'webhook_waba', message: UNCONFIRMED }, { path: 'webhook_cleanup.done', message: CLEANUP_DONE }]);
      expect(metaWebhooks.calls.map((c) => [c.op, c.target])).toEqual([
        ['setWabaOverride', '1111111111'], ['readWabaOverride', '1111111111'], ['clearWabaOverride', '1111111111'],
      ]);
      await nothingWritten('acme');
    });

    it("retrait en échec : le détail le dit, l'événement est journalisé sans adresse ni secret", async () => {
      const log = vi.mocked(console.log);
      metaWebhooks.readWabaOverride.mockResolvedValueOnce({ ok: true, subscribed: true, override: null });
      metaWebhooks.clearWabaOverride.mockResolvedValueOnce({ ok: false, failure: { kind: 'unreachable' } });
      const err = await caught(svc.create('acme', 7, metaInput()));
      expect(err.reason).toBe('whatsapp_account.webhook_unconfirmed');
      expect(err.details?.[1]).toEqual({ path: 'webhook_cleanup.failed', message: CLEANUP_FAILED });
      const url = metaWebhooks.calls[0]!.url!;
      const lines = log.mock.calls.map((args) => args.join(' '));
      expect(lines.some((l) => l.startsWith('[WhatsAppAccounts]') && l.includes('retrait'))).toBe(true);
      for (const secret of [url, keyOfMetaUrl(url), metaWebhooks.calls[0]!.verify_token!, ACME_TOKEN, ACME_SECRET]) {
        expect(lines.join('\n')).not.toContain(secret);
      }
      await nothingWritten('acme');
    });

    // relecture finale R1 FR-M1 : une panne de la base n'est pas présentée comme un refus de Meta ; la cause est journalisée.
    it('enregistrement en échec après l\'inscription : erreur interne distincte, retrait tenté, cause journalisée, registre libéré', async () => {
      vi.spyOn(db, 'createWhatsAppAccountWithInventory').mockRejectedValueOnce(new Error('base indisponible'));
      const log = vi.mocked(console.log);
      log.mockClear();
      const err = await caught(svc.create('acme', 7, metaInput()));
      expect([err.status, err.code, err.reason]).toEqual([500, 'INTERNAL', undefined]);
      expect(err.message).toBe("L'enregistrement du compte a échoué : rien n'a été raccordé. Réessayez ; si cela continue, contactez le support en citant la référence.");
      expect(err.message).not.toBe(UNCONFIRMED);
      expect(err.details).toEqual([{ path: 'webhook_cleanup.done', message: CLEANUP_DONE }]);
      expect(log.mock.calls.map((args) => args.join(' ')).some((l) => l.includes('Enregistrement du compte en échec') && l.includes('base indisponible'))).toBe(true);
      expect(metaWebhooks.calls.map((c) => c.op)).toEqual(['setWabaOverride', 'readWabaOverride', 'clearWabaOverride']);
      await nothingWritten('acme');
    });

    // spec R1 §8
    it("l'URL inscrite est celle du compte créé dans l'organisation de la requête", async () => {
      const acme = await svc.create('acme', 7, metaInput());
      providers.verifyMeta.mockResolvedValueOnce(verified({ waba_id: '3333333333', meta_app_id: 'app-beta', numbers: [num(2)] }));
      const beta = await svc.create('beta', 8, { mode: 'meta_manual', name: 'Compte Beta', waba_id: '3333333333', access_token: BETA_TOKEN, app_secret: BETA_SECRET });
      const acmeHash = (await db.getWhatsAppAccount('acme', acme.id))!.webhook_key_hash;
      const betaHash = (await db.getWhatsAppAccount('beta', beta.id))!.webhook_key_hash;
      const writes = metaWebhooks.writes().map((c) => [c.op, c.target, hashWebhookKey(keyOfMetaUrl(c.url!)), c.credential]);
      expect(writes).toEqual([
        ['setWabaOverride', '1111111111', acmeHash, ACME_TOKEN], ['setAppWebhook', 'app-1', acmeHash, ACME_SECRET],
        ['setWabaOverride', '3333333333', betaHash, BETA_TOKEN], ['setAppWebhook', 'app-beta', betaHash, BETA_SECRET],
      ]);
    });

    it('la vue porte webhooks et meta_health ; webhook null pour Meta dans la réponse de création', async () => {
      providers.verifyMeta.mockResolvedValueOnce(verified({ meta_health: HEALTH }));
      const created = await svc.create('acme', 7, metaInput());
      expect(created.webhook).toBeNull();
      expect(created.webhooks).toMatchObject({ waba: 'ok', app: 'ok', app_host: null });
      expect(Date.parse(created.webhooks!.checked_at!)).not.toBeNaN();
      expect(created.meta_health).toEqual(HEALTH);
      const view = await svc.get('acme', created.id);
      expect([view.webhooks, view.meta_health]).toEqual([created.webhooks, HEALTH]);
      expect((await svc.list('acme'))[0]!.webhooks).toEqual(created.webhooks);

      // La page de l'agent IA lit les mêmes valeurs (même phrase que Connexions).
      await db.upsertBotRecord(bot('acme', 'ventes', 'draft'));
      expect((await db.assignNumber('acme', 'ventes', created.numbers[0]!.id, UNCHECKED)).ok).toBe(true);
      const summary = (await loadBotNumberSummary(db, 'acme', 'ventes'))!;
      expect([summary.account.webhooks, summary.account.meta_health]).toEqual([created.webhooks, HEALTH]);
      expect((await db.unassignNumber('acme', 'ventes', created.numbers[0]!.id)).ok).toBe(true);

      // Compte déconnecté : null, même si les colonnes gardent les anciennes valeurs (revue de la tâche 2).
      await svc.disconnect('acme', created.id, 7);
      const record = (await db.getWhatsAppAccount('acme', created.id))!;
      expect(record.webhook_state).not.toBeNull();
      const gone = await svc.get('acme', created.id);
      expect([gone.webhooks, gone.meta_health]).toEqual([null, null]);
    });

    it('compte Meta raccordé avant le lot (aucun état de webhook en base) : état inconnu, jamais « ok »', async () => {
      const created = await svc.create('acme', 7, metaInput());
      const encrypted = encryptAccountSecrets({ mode: 'meta_manual', access_token: ACME_TOKEN, app_secret: ACME_SECRET, verify_token: 'v'.repeat(32), webhook_key: 'k'.repeat(43) });
      const old = await db.insertWhatsAppAccount({
        client_id: 'acme', name: 'Ancien', mode: 'meta_manual', provider_account_id: '9999999999', waba_id: '9999999999', meta_app_id: 'app-9',
        ...encrypted, webhook_key_hash: hashWebhookKey('k'.repeat(43)), token_expiry: null, last_verified_at: null,
      });
      expect(created.webhooks!.waba).toBe('ok');
      const view = await svc.get('acme', old.id);
      expect([view.webhooks, view.meta_health]).toEqual([{ waba: 'unknown', app: 'unknown', app_host: null, checked_at: null }, null]);
    });

    describe('revue PO R-9', () => {
      const BETA_ON_ACME_WABA = { mode: 'meta_manual' as const, name: 'Compte Beta', waba_id: '1111111111', access_token: BETA_TOKEN, app_secret: BETA_SECRET };

      // revue PO R-9, point 1 : la réservation précède les contrôles d'unicité
      it("raccordement concurrent de la même WABA : une lecture d'unicité faite avant l'enregistrement du premier ne permet jamais d'écrire après sa libération", async () => {
        providers.verifyMeta.mockImplementation(async (c) => verified({ waba_id: c.waba_id, meta_app_id: c.access_token === ACME_TOKEN ? 'app-1' : 'app-beta' }));
        let releaseAcme!: () => void;
        const acmeWriting = new Promise<void>((resolve) => { releaseAcme = resolve; });
        let acmeInWrite!: () => void;
        const acmeReachedWrite = new Promise<void>((resolve) => { acmeInWrite = resolve; });
        const write = metaWebhooks.setWabaOverride.getMockImplementation()!;
        metaWebhooks.setWabaOverride.mockImplementation(async (c, t) => {
          if (c.access_token === ACME_TOKEN) { acmeInWrite(); await acmeWriting; }
          return write(c, t);
        });
        // Contrôle d'unicité de beta après sa vérification : lu tout de suite (acme pas encore enregistré), rendu
        // seulement après la fin du raccordement d'acme. Avec l'ancien ordre, beta réservait ensuite la WABA libérée.
        let betaAtGate!: () => void;
        const betaReachedGate = new Promise<void>((resolve) => { betaAtGate = resolve; });
        let acmeDone: Promise<unknown> = Promise.resolve();
        const holder = db.findProviderAccountHolder.bind(db);
        let betaCalls = 0;
        vi.spyOn(db, 'findProviderAccountHolder').mockImplementation(async (clientId, mode, id) => {
          const answer = await holder(clientId, mode, id);
          if (clientId === 'beta' && ++betaCalls === 2) { betaAtGate(); await acmeDone.catch(() => undefined); }
          return answer;
        });

        const acme = svc.create('acme', 7, metaInput());
        acmeDone = acme;
        await acmeReachedWrite;
        const beta = caught(svc.create('beta', 8, BETA_ON_ACME_WABA));
        await Promise.race([beta, betaReachedGate]);
        releaseAcme();
        const [acmeAccount, betaErr] = await Promise.all([acme, beta]);

        expect([betaErr.status, betaErr.message, betaErr.reason]).toEqual([409, 'Ce compte ne peut pas être raccordé. Contactez le support.', 'whatsapp_account.cannot_connect']);
        // beta n'a rien écrit chez Meta, et l'adresse d'acme est restée en place.
        expect(metaWebhooks.writes().filter((c) => c.credential === BETA_TOKEN || c.credential === BETA_SECRET)).toEqual([]);
        expect(metaWebhooks.calls.filter((c) => c.op === 'clearWabaOverride')).toEqual([]);
        expect(metaWebhooks.overrides.get('1111111111')).toBe(metaWebhooks.calls.find((c) => c.op === 'setWabaOverride')!.url);
        expect(acmeAccount.state).toBe('connected');
        expect(await db.listWhatsAppAccounts('beta')).toEqual([]);
        expect(pendingVerificationKeysForTests()).toEqual([]);
      });

      // revue PO R-9, point 2 : enregistrement refusé dans la transaction (autre instance)
      it.each([
        ['compte du fournisseur tenu ailleurs', { ok: false as const, reason: 'provider_account_taken' as const, same_organization: false }],
        ['app Meta tenue ailleurs', { ok: false as const, reason: 'meta_app_taken' as const }],
      ])("enregistrement refusé (%s) : retrait sur la WABA de la requête, 409 neutre avec le détail du retrait", async (_label, refusal) => {
        await svc.create('acme', 7, metaInput({ name: 'Compte Acme Lyon', waba_id: '7777777777' }));
        metaWebhooks.clearCalls();
        providers.verifyMeta.mockResolvedValueOnce(verified({ waba_id: '3333333333', meta_app_id: 'app-beta' }));
        vi.spyOn(db, 'createWhatsAppAccountWithInventory').mockResolvedValueOnce(refusal);
        const err = await caught(svc.create('beta', 8, { mode: 'meta_manual', name: 'Compte Beta', waba_id: '3333333333', access_token: BETA_TOKEN, app_secret: BETA_SECRET }));
        expect([err.code, err.status, err.message, err.reason]).toEqual(['CONFLICT', 409, 'Ce compte ne peut pas être raccordé. Contactez le support.', 'whatsapp_account.cannot_connect']);
        expect(err.details).toEqual([{ path: 'webhook_cleanup.done', message: CLEANUP_DONE }]);
        expect(metaWebhooks.calls.map((c) => [c.op, c.target, c.credential])).toEqual([
          ['setWabaOverride', '3333333333', BETA_TOKEN], ['readWabaOverride', '3333333333', BETA_TOKEN], ['clearWabaOverride', '3333333333', BETA_TOKEN],
        ]);
        const text = JSON.stringify({ message: err.message, details: err.details ?? null });
        for (const marker of ['acme', 'Acme', '7777777777', 'app-1', ACME_TOKEN]) expect(text).not.toContain(marker);
        expect(await db.listWhatsAppAccounts('beta')).toEqual([]);
        expect(await db.listAuditLog('beta')).toEqual([]);
        expect(pendingVerificationKeysForTests()).toEqual([]);
      });

      // revue PO R-9, point 3
      it('chiffrement des identifiants en échec : aucune écriture chez Meta, rien en base', async () => {
        vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '');
        await expect(svc.create('acme', 7, metaInput())).rejects.toThrow();
        expect(providers.verifyMeta).toHaveBeenCalledTimes(1);
        expect(metaWebhooks.calls).toEqual([]);
        expect(await db.listWhatsAppAccounts('acme')).toEqual([]);
        expect(pendingVerificationKeysForTests()).toEqual([]);
      });

      // revue PO R-9, point 4
      it("exception dans la règle du webhook de l'app après l'enregistrement : compte connecté rendu, état failed", async () => {
        vi.spyOn(db, 'listConnectedMetaAccountsForApp').mockRejectedValueOnce(new Error('base indisponible'));
        const created = await svc.create('acme', 7, metaInput());
        expect(created.state).toBe('connected');
        expect(created.webhooks).toMatchObject({ waba: 'ok', app: 'failed' });
        const check = created.checks.find((c) => c.key === 'webhook_app')!;
        expect([check.status, check.detail]).toEqual(['failed', APP_WEBHOOK_FAILED]);
        expect(metaWebhooks.writes().map((c) => c.op)).toEqual(['setWabaOverride']);
        expect(pendingVerificationKeysForTests()).toEqual([]);
      });

      // revue PO R-9, point 4
      it("écritures d'état et relecture en échec après l'enregistrement : compte connecté rendu, échecs journalisés sans identifiants", async () => {
        const log = vi.mocked(console.log);
        vi.spyOn(db, 'setWhatsAppAccountWebhookState').mockRejectedValueOnce(new Error('base indisponible'));
        vi.spyOn(db, 'setWhatsAppAccountMetaHealth').mockRejectedValueOnce(new Error('base indisponible'));
        // Première lecture : relecture du compte avant l'écriture du webhook de l'app (revue R1 ISO-I1) ; seconde : relecture finale.
        const original = db.getWhatsAppAccount.bind(db);
        const reread = vi.spyOn(db, 'getWhatsAppAccount').mockImplementationOnce(original).mockRejectedValueOnce(new Error('base indisponible'));
        providers.verifyMeta.mockResolvedValueOnce(verified({ meta_health: HEALTH }));
        const created = await svc.create('acme', 7, metaInput());
        expect(reread).toHaveBeenCalled();
        expect(created.state).toBe('connected');
        expect(created.webhook).toBeNull();
        expect((await db.getWhatsAppAccount('acme', created.id))!.state).toBe('connected');
        const lines = log.mock.calls.map((args) => args.join(' '));
        expect(lines.some((l) => l.includes('État des webhooks') && l.includes('non enregistré'))).toBe(true);
        expect(lines.some((l) => l.includes('État Meta') && l.includes('non enregistré'))).toBe(true);
        expect(lines.some((l) => l.includes('Relecture du compte'))).toBe(true);
        // relecture finale R1 FR-M1 : la cause est journalisée (message de l'erreur, sans identifiant).
        expect(lines.filter((l) => l.includes('base indisponible'))).toHaveLength(3);
        const inscription = metaWebhooks.calls.find((c) => c.op === 'setWabaOverride')!;
        for (const secret of [inscription.url!, keyOfMetaUrl(inscription.url!), inscription.verify_token!, ACME_TOKEN, ACME_SECRET]) {
          expect(lines.join('\n')).not.toContain(secret);
        }
      });
    });

    describe("webhook de l'app (spec R1 §5.4, ruling R-3)", () => {
      it("webhook de l'app déjà sur un compte de la même app : aucune écriture", async () => {
        await svc.create('acme', 7, metaInput());
        metaWebhooks.clearCalls();
        providers.verifyMeta.mockResolvedValueOnce(verified({ waba_id: '4444444444', numbers: [num(4)] }));
        const second = await svc.create('acme', 7, metaInput({ name: 'Second', waba_id: '4444444444' }));
        expect(metaWebhooks.calls.map((c) => c.op)).toEqual(['setWabaOverride', 'readWabaOverride', 'readAppWebhook']);
        expect(second.webhooks).toMatchObject({ waba: 'ok', app: 'ok', app_host: null });
        expect(second.checks.find((c) => c.key === 'webhook_app')).toEqual({ key: 'webhook_app', status: 'ok' });
      });

      it("webhook de l'app ailleurs : pas d'écriture au raccordement, état elsewhere et domaine seul", async () => {
        metaWebhooks.appWebhooks.set('app-1', 'https://autre-produit.example.com/hooks/chemin-secret-du-client');
        const created = await svc.create('acme', 7, metaInput());
        expect(metaWebhooks.writes().map((c) => c.op)).toEqual(['setWabaOverride']);
        expect(created.state).toBe('connected');
        expect(created.webhooks).toMatchObject({ waba: 'ok', app: 'elsewhere', app_host: 'autre-produit.example.com' });
        expect(created.checks.find((c) => c.key === 'webhook_app')?.status).toBe('pending');
        const text = JSON.stringify([created, await svc.get('acme', created.id), await db.listAuditLog('acme')]);
        expect(text).not.toContain('chemin-secret-du-client');
        expect((await db.listAuditLog('acme'))[0]!.metadata).toMatchObject({ webhook_waba: 'ok', webhook_app: 'elsewhere' });
      });

      it("webhook de l'app sur une adresse de WABAGENT d'un compte retiré : remplacé par l'adresse du compte", async () => {
        metaWebhooks.appWebhooks.set('app-1', `${BASE_URL}/webhook/meta/cle-d-un-compte-retire-0123456789abcdefgh`);
        const created = await svc.create('acme', 7, metaInput());
        const [override, app] = metaWebhooks.writes();
        expect(app).toMatchObject({ op: 'setAppWebhook', url: override!.url, verify_token: override!.verify_token });
        expect(created.webhooks!.app).toBe('ok');
      });

      it("adresse d'un compte connecté d'une autre organisation : jamais tenue pour la nôtre", async () => {
        const acme = await svc.create('acme', 7, metaInput());
        const acmeUrl = metaWebhooks.writes()[0]!.url!;
        // Cas impossible par le choix 3 (une app n'est qu'à une organisation), rejoué : l'app de beta pointe vers acme.
        metaWebhooks.appWebhooks.set('app-beta', acmeUrl);
        metaWebhooks.clearCalls();
        providers.verifyMeta.mockResolvedValueOnce(verified({ waba_id: '3333333333', meta_app_id: 'app-beta', numbers: [num(2)] }));
        const beta = await svc.create('beta', 8, { mode: 'meta_manual', name: 'Compte Beta', waba_id: '3333333333', access_token: BETA_TOKEN, app_secret: BETA_SECRET });
        const betaHash = (await db.getWhatsAppAccount('beta', beta.id))!.webhook_key_hash;
        const appWrite = metaWebhooks.writes().find((c) => c.op === 'setAppWebhook')!;
        expect(hashWebhookKey(keyOfMetaUrl(appWrite.url!))).toBe(betaHash);
        expect(appWrite.url).not.toBe(acmeUrl);
        expect(acme.state).toBe('connected');
      });

      it("pointAppWebhook remplace après confirmation et audite sans URL", async () => {
        metaWebhooks.appWebhooks.set('app-1', 'https://autre-produit.example.com/hooks/chemin-secret-du-client');
        const created = await svc.create('acme', 7, metaInput());
        const accountUrl = metaWebhooks.writes()[0]!.url!;
        const verifyToken = metaWebhooks.writes()[0]!.verify_token!;
        metaWebhooks.clearCalls();
        let pendingDuringWrite: string[] = [];
        const write = metaWebhooks.setAppWebhook.getMockImplementation()!;
        metaWebhooks.setAppWebhook.mockImplementationOnce(async (a, t) => {
          pendingDuringWrite = pendingVerificationKeysForTests();
          return write(a, t);
        });
        const result = await svc.pointAppWebhook('acme', created.id, 7);
        expect(metaWebhooks.calls.map((c) => c.op)).toEqual(['readAppWebhook', 'setAppWebhook']);
        const appWrite = metaWebhooks.writes()[0]!;
        expect([appWrite.target, appWrite.url, appWrite.verify_token, appWrite.credential]).toEqual(['app-1', accountUrl, verifyToken, ACME_SECRET]);
        // Revue R1 ISO-I1 : compte existant, la base sert le GET de Meta ; le registre des vérifications attendues n'est jamais armé.
        expect(pendingDuringWrite).toEqual([]);
        expect(pendingVerificationKeysForTests()).toEqual([]);
        expect(result.checks).toEqual([{ key: 'webhook_app', status: 'created' }]);
        expect(result.webhooks).toMatchObject({ waba: 'ok', app: 'ok', app_host: null });
        expect([result.state, result.error_reason]).toEqual(['connected', null]);
        expect((await db.getWhatsAppAccount('acme', created.id))!.webhook_state).toMatchObject({ waba: 'ok', app: 'ok', app_host: null });
        const audit = (await db.listAuditLog('acme')).find((e) => e.action === 'whatsapp_account.app_webhook')!;
        expect(audit.metadata).toEqual({ result: 'ok' });
        expect(audit.target).toBe(`whatsapp_account:acme/${created.id}`);
        const text = JSON.stringify([result, await db.listAuditLog('acme')]);
        for (const secret of [accountUrl, keyOfMetaUrl(accountUrl), verifyToken, 'chemin-secret-du-client', 'autre-produit.example.com']) {
          expect(text).not.toContain(secret);
        }
      });

      // revue R1 ISO-M1 : l'état de la WABA n'est jamais réécrit depuis la lecture du début de l'opération.
      it("pointAppWebhook concurrent d'un marquage « webhook de la WABA absent » : missing gardé", async () => {
        metaWebhooks.appWebhooks.set('app-1', 'https://autre-produit.example.com/hooks');
        const created = await svc.create('acme', 7, metaInput());
        expect((await db.getWhatsAppAccount('acme', created.id))!.webhook_state).toMatchObject({ waba: 'ok', app: 'elsewhere' });
        const read = metaWebhooks.readAppWebhook.getMockImplementation()!;
        metaWebhooks.readAppWebhook.mockImplementationOnce(async (a) => {
          // Un message du compte arrive sur l'adresse d'un autre compte pendant l'opération (meta.ts).
          expect(await db.markWhatsAppAccountWabaWebhookMissing('acme', created.id)).toBe(true);
          return read(a);
        });
        const result = await svc.pointAppWebhook('acme', created.id, 7);
        expect(result.webhooks).toMatchObject({ waba: 'missing', app: 'ok', app_host: null });
        expect((await db.getWhatsAppAccount('acme', created.id))!.webhook_state).toMatchObject({ waba: 'missing', app: 'ok', app_host: null });
      });

      it("pointAppWebhook déjà sur le compte : aucune écriture, contrôle ok, audit", async () => {
        const created = await svc.create('acme', 7, metaInput());
        metaWebhooks.clearCalls();
        const result = await svc.pointAppWebhook('acme', created.id, 7);
        expect(metaWebhooks.writes()).toEqual([]);
        expect(result.checks).toEqual([{ key: 'webhook_app', status: 'ok' }]);
        expect((await db.listAuditLog('acme')).find((e) => e.action === 'whatsapp_account.app_webhook')!.metadata).toEqual({ result: 'ok' });
      });

      // Ruling R-4 : l'échec d'écriture du webhook de l'app est un refus porté par la raison app_webhook_failed.
      it.each([
        ["jeton d'app refusé à la lecture (190)", 'readAppWebhook' as const, { kind: 'token_invalid' as const }],
        ["2200 à l'inscription", 'setAppWebhook' as const, { kind: 'callback_failed' as const, provider_text: '(#2200) Callback verification failed' }],
      ])("pointAppWebhook en échec (%s) : 422 app_webhook_failed, état du compte et des webhooks inchangés, audit", async (_label, op, failure) => {
        metaWebhooks.appWebhooks.set('app-1', 'https://autre-produit.example.com/hooks');
        const created = await svc.create('acme', 7, metaInput());
        if (op === 'readAppWebhook') metaWebhooks.readAppWebhook.mockResolvedValueOnce({ ok: false, failure });
        else metaWebhooks.setAppWebhook.mockResolvedValueOnce({ ok: false, failure });
        const err = await caught(svc.pointAppWebhook('acme', created.id, 7));
        expect([err.status, err.reason, err.message]).toEqual([422, 'whatsapp_account.app_webhook_failed', APP_WEBHOOK_FAILED]);
        expect(err.details).toEqual([{
          path: 'webhook_app', message: APP_WEBHOOK_FAILED, ...('provider_text' in failure ? { provider_text: failure.provider_text } : {}),
        }]);
        const record = (await db.getWhatsAppAccount('acme', created.id))!;
        expect([record.state, record.error_reason, record.error_detail]).toEqual(['connected', null, null]);
        // Ruling R-15 : l'état enregistré reste celui d'avant (le bouton « Faire pointer vers WABAGENT » reste proposé).
        expect(record.webhook_state).toMatchObject({ waba: 'ok', app: 'elsewhere', app_host: 'autre-produit.example.com' });
        expect(pendingVerificationKeysForTests()).toEqual([]);
        expect((await db.listAuditLog('acme')).find((e) => e.action === 'whatsapp_account.app_webhook')!.metadata).toEqual({ result: 'failed' });
      });

      it("pointAppWebhook : compte inconnu, d'une autre organisation ou CM.com : 404 ; compte retiré : 409 ; aucun appel Meta", async () => {
        const created = await svc.create('acme', 7, metaInput());
        const cm = await svc.create('acme', 7, { mode: 'cm_com', name: 'CM', account_id: CM_ACCOUNT, product_token: CM_TOKEN });
        metaWebhooks.clearCalls();
        for (const [clientId, id] of [['beta', created.id], ['acme', 999999], ['acme', cm.id]] as const) {
          const err = await caught(svc.pointAppWebhook(clientId, id, 7));
          expect([clientId, id, err.status, err.reason]).toEqual([clientId, id, 404, 'whatsapp_account.not_found']);
        }
        await svc.disconnect('acme', created.id, 7);
        metaWebhooks.clearCalls();
        const gone = await caught(svc.pointAppWebhook('acme', created.id, 7));
        expect([gone.status, gone.reason]).toEqual([409, 'whatsapp_account.disconnected']);
        expect(metaWebhooks.calls).toEqual([]);
      });

      it("pointAppWebhook sans PUBLIC_BASE_URL : refus public_url_missing, aucun appel Meta, rien d'écrit", async () => {
        const created = await svc.create('acme', 7, metaInput());
        const before = (await db.getWhatsAppAccount('acme', created.id))!.webhook_state;
        vi.stubEnv('PUBLIC_BASE_URL', '');
        metaWebhooks.clearCalls();
        const err = await caught(svc.pointAppWebhook('acme', created.id, 7));
        expect([err.status, err.reason, err.message]).toEqual([422, 'whatsapp_account.public_url_missing', PUBLIC_URL_MISSING]);
        expect(metaWebhooks.calls).toEqual([]);
        expect((await db.getWhatsAppAccount('acme', created.id))!.webhook_state).toEqual(before);
        expect((await db.listAuditLog('acme')).filter((e) => e.action === 'whatsapp_account.app_webhook')).toEqual([]);
      });

      it("pointAppWebhook sur un compte en erreur : refusé avant tout appel Meta, état inchangé", async () => {
        const created = await svc.create('acme', 7, metaInput());
        await db.setWhatsAppAccountError(created.id, 'token_invalid', 'Jeton refusé par Meta');
        metaWebhooks.clearCalls();
        const err = await caught(svc.pointAppWebhook('acme', created.id, 7));
        expect([err.status, err.reason]).toEqual([422, 'whatsapp_account.app_webhook_failed']);
        expect(metaWebhooks.calls).toEqual([]);
        expect((await db.getWhatsAppAccount('acme', created.id))!.state).toBe('error');
      });

      it("pointAppWebhook pendant une autre opération sur la WABA : aucune écriture chez Meta", async () => {
        metaWebhooks.appWebhooks.set('app-1', 'https://autre-produit.example.com/hooks');
        const created = await svc.create('acme', 7, metaInput());
        metaWebhooks.overrides.delete('1111111111');
        metaWebhooks.clearCalls();
        const write = metaWebhooks.setWabaOverride.getMockImplementation()!;
        let second: AppError | undefined;
        metaWebhooks.setWabaOverride.mockImplementationOnce(async (c, t) => {
          second = await caught(svc.pointAppWebhook('acme', created.id, 7));
          return write(c, t);
        });
        await svc.verify('acme', created.id, 7);
        expect([second!.status, second!.reason]).toEqual([422, 'whatsapp_account.app_webhook_failed']);
        expect(second!.details).toEqual([{ path: 'webhook_app', message: 'Une autre opération est en cours sur ce compte WhatsApp, réessayez.' }]);
        // Seule la vérification lit le webhook de l'app (et le laisse ailleurs, elle ne remplace jamais).
        expect(metaWebhooks.calls.filter((c) => c.op === 'readAppWebhook')).toHaveLength(1);
        expect(metaWebhooks.writes().filter((c) => c.op === 'setAppWebhook')).toEqual([]);
      });

      // Revue 2b-2 M-2
      it("pointAppWebhook : identifiants remplacés pendant la lecture du webhook de l'app : rien n'est écrit en base", async () => {
        metaWebhooks.appWebhooks.set('app-1', 'https://autre-produit.example.com/hooks');
        const created = await svc.create('acme', 7, metaInput());
        const before = (await db.getWhatsAppAccount('acme', created.id))!;
        const secrets = decryptAccountSecrets(before)!;
        if (secrets.mode !== 'meta_manual') throw new Error('[Test] compte Meta attendu');
        const read = metaWebhooks.readAppWebhook.getMockImplementation()!;
        metaWebhooks.readAppWebhook.mockImplementationOnce(async (a) => {
          const encrypted = encryptAccountSecrets({ ...secrets, access_token: 'EAAG-nouveau-jeton-0123456789', app_secret: 'nouveau-secret-0123456789' });
          expect((await db.replaceWhatsAppAccountSecrets('acme', created.id, {
            secret_encrypted: encrypted.secret_encrypted, key_version: encrypted.key_version, waba_id: '1111111111',
            meta_app_id: 'app-1', token_expiry: null, verified_at: new Date().toISOString(),
          })).ok).toBe(true);
          return read(a);
        });
        const err = await caught(svc.pointAppWebhook('acme', created.id, 7));
        expect([err.status, err.reason]).toEqual([422, 'whatsapp_account.app_webhook_failed']);
        expect((await db.getWhatsAppAccount('acme', created.id))!.webhook_state).toEqual(before.webhook_state);
        // Revue R1 ISO-I1 : le compte est relu juste avant l'écriture, rien n'est écrit chez Meta ; l'opération est auditée
        // sans enregistrement d'état (revue de la tâche 7, mineur 2).
        expect(metaWebhooks.writes().filter((c) => c.op === 'setAppWebhook')).toHaveLength(0);
        expect((await db.listAuditLog('acme')).find((e) => e.action === 'whatsapp_account.app_webhook')!.metadata).toEqual({ result: 'failed', saved: false });
        expect(pendingVerificationKeysForTests()).toEqual([]);
      });

      it.each([
        ["jeton d'app refusé à la lecture (190)", 'readAppWebhook' as const, { kind: 'token_invalid' as const }],
        ["jeton d'app refusé à l'inscription (190)", 'setAppWebhook' as const, { kind: 'token_invalid' as const }],
        ["2200 à l'inscription du webhook de l'app", 'setAppWebhook' as const, { kind: 'callback_failed' as const, provider_text: '(#2200) Callback verification failed' }],
      ])("%s : raccordement réussi, état failed avec le texte du service, jamais d'erreur sur le compte", async (_label, op, failure) => {
        if (op === 'readAppWebhook') metaWebhooks.readAppWebhook.mockResolvedValueOnce({ ok: false, failure });
        else metaWebhooks.setAppWebhook.mockResolvedValueOnce({ ok: false, failure });
        const created = await svc.create('acme', 7, metaInput());
        expect([created.state, created.error_reason, created.error_detail]).toEqual(['connected', null, null]);
        expect(created.webhooks).toMatchObject({ waba: 'ok', app: 'failed', app_host: null });
        const check = created.checks.find((c) => c.key === 'webhook_app')!;
        expect([check.status, check.detail]).toEqual(['failed', APP_WEBHOOK_FAILED]);
        expect(JSON.stringify(created)).not.toContain('Jeton refusé par Meta');
        expect(pendingVerificationKeysForTests()).toEqual([]);
        expect((await db.getWhatsAppAccount('acme', created.id))!.state).toBe('connected');
      });
    });
  });

  describe('corrections de sécurité (choix 3, déconnexion, signatures)', () => {
    /** Compte de beta qui détient déjà app-1, posé sans passer par le service (état hérité ou course passée). */
    async function betaHoldsApp1(): Promise<void> {
      await db.insertWhatsAppAccount({
        client_id: 'beta', name: 'Compte Beta', mode: 'meta_manual', provider_account_id: '3333333333', waba_id: '3333333333',
        meta_app_id: 'app-1', secret_encrypted: 'enc:beta', key_version: 1, webhook_key_hash: 'hash-beta', token_expiry: null,
        last_verified_at: '2026-11-08T10:00:00.000Z',
      });
    }

    // revue 2b-1 M-2
    it("acme en erreur détient encore son app : beta ne peut pas la raccorder", async () => {
      const acme = await svc.create('acme', 7, metaInput());
      await db.setWhatsAppAccountError(acme.id, 'token_invalid', 'Jeton refusé');
      providers.verifyMeta.mockResolvedValueOnce(verified({ waba_id: '3333333333', meta_app_id: 'app-1', numbers: [num(5)] }));
      const err = await caught(svc.create('beta', 8, {
        mode: 'meta_manual', name: 'Compte Beta', waba_id: '3333333333', access_token: BETA_TOKEN, app_secret: BETA_SECRET,
      }));
      expect([err.status, err.message]).toEqual([409, 'Ce compte ne peut pas être raccordé. Contactez le support.']);
      expect(await db.listWhatsAppAccounts('beta')).toEqual([]);
    });

    // revue 2b-1 M-2
    it("« Vérifier maintenant » : acme en erreur, app détenue par beta : acme reste en erreur, message neutre", async () => {
      const acme = await svc.create('acme', 7, metaInput());
      await db.setWhatsAppAccountError(acme.id, 'token_invalid', 'Jeton refusé');
      await betaHoldsApp1();
      const view = await svc.verify('acme', acme.id, 7);
      expect(view).toMatchObject({ state: 'error', error_reason: 'other' });
      // Issue « refusée » alors que le fournisseur a répondu et que tous les contrôles sont `ok`.
      expect(view.outcome).toBe('refused');
      expect(view.checks.length).toBeGreaterThan(0);
      expect(view.checks.every((c) => c.status !== 'failed')).toBe(true);
      const record = (await db.getWhatsAppAccount('acme', acme.id))!;
      expect([record.state, record.error_detail]).toEqual(['error', 'Ce compte ne peut pas être raccordé. Contactez le support.']);
      const text = JSON.stringify(view);
      for (const leak of ['beta', 'Compte Beta', '3333333333']) expect(text).not.toContain(leak);
      const audit = (await db.listAuditLog('acme')).find((a) => a.action === 'whatsapp_account.verify');
      expect(audit?.metadata).toEqual({ ok: false });
    });

    // audit R-5
    it("vue d'un compte en erreur après app détenue par beta : error_detail neutre, rien de beta ; compte connecté : error_detail null", async () => {
      const acme = await svc.create('acme', 7, metaInput());
      expect(acme.error_detail).toBeNull();
      await db.setWhatsAppAccountError(acme.id, 'token_invalid', 'Jeton refusé');
      await betaHoldsApp1();
      const view = await svc.verify('acme', acme.id, 7);
      expect(view).toMatchObject({ state: 'error', error_detail: 'Ce compte ne peut pas être raccordé. Contactez le support.' });
      expect((await svc.get('acme', acme.id)).error_detail).toBe('Ce compte ne peut pas être raccordé. Contactez le support.');
      expect((await svc.list('acme'))[0]!.error_detail).toBe('Ce compte ne peut pas être raccordé. Contactez le support.');
      const text = JSON.stringify(await svc.list('acme'));
      for (const leak of ['beta', 'Compte Beta', '3333333333']) expect(text).not.toContain(leak);
    });

    // audit R-5
    it("error_detail : le texte du fournisseur est exposé pour un refus de jeton, null une fois reconnecté", async () => {
      const acme = await svc.create('acme', 7, metaInput());
      providers.verifyMeta.mockResolvedValueOnce({
        ok: false, checks: [{ key: 'token', status: 'failed', detail: 'Jeton refusé par Meta' }], error_reason: 'token_invalid', message: 'Jeton refusé par Meta',
      });
      expect(await svc.verify('acme', acme.id, 7)).toMatchObject({ state: 'error', error_reason: 'token_invalid', error_detail: 'Jeton refusé par Meta' });
      providers.verifyMeta.mockResolvedValueOnce(verified());
      expect(await svc.verify('acme', acme.id, 7)).toMatchObject({ state: 'connected', error_reason: null, error_detail: null });
    });

    // audit R-5
    it("error_detail : null pour un compte connecté dont les signatures sont rejetées (état affiché seulement)", async () => {
      const acme = await svc.create('acme', 7, metaInput());
      for (let i = 0; i < 21; i++) recordSignatureFailure(acme.id);
      expect(await svc.get('acme', acme.id)).toMatchObject({ state: 'error', error_reason: 'signature_rejected', error_detail: null });
    });

    // audit R-5 : la cause est décidée par le moteur, le web ne la déduit pas du texte
    it("error_cause : « support » pour l'app détenue ailleurs, « credentials » pour un contrôle refusé, null hors erreur stockée", async () => {
      const acme = await svc.create('acme', 7, metaInput());
      expect(acme.error_cause).toBeNull();
      providers.verifyMeta.mockResolvedValueOnce({
        ok: false, checks: [{ key: 'app_secret', status: 'failed', detail: "Secret de l'app refusé" }], error_reason: 'other', message: "Secret de l'app refusé",
      });
      expect(await svc.verify('acme', acme.id, 7)).toMatchObject({ state: 'error', error_reason: 'other', error_cause: 'credentials' });
      providers.verifyMeta.mockResolvedValueOnce({
        ok: false, checks: [{ key: 'token', status: 'failed', detail: 'Jeton refusé par Meta' }], error_reason: 'token_invalid', message: 'Jeton refusé par Meta',
      });
      expect(await svc.verify('acme', acme.id, 7)).toMatchObject({ error_reason: 'token_invalid', error_cause: 'credentials' });
      await betaHoldsApp1();
      providers.verifyMeta.mockResolvedValueOnce(verified());
      expect(await svc.verify('acme', acme.id, 7)).toMatchObject({ state: 'error', error_reason: 'other', error_cause: 'support' });
      expect((await svc.list('acme'))[0]!.error_cause).toBe('support');
    });

    // revue finale M-1 : des identifiants enregistrés illisibles ne se remplacent pas (409 secrets_unreadable),
    // le conseil est de retirer le compte puis de le raccorder de nouveau, jamais « Remplacez les identifiants ».
    it("error_cause : « reconnect » pour des identifiants enregistrés illisibles, aussi dans la liste et après rechargement", async () => {
      const acme = await svc.create('acme', 7, metaInput());
      expect(await db.replaceWhatsAppAccountSecrets('acme', acme.id, {
        secret_encrypted: 'illisible', key_version: 1, waba_id: '1111111111', meta_app_id: 'app-1111111111', token_expiry: null,
        verified_at: new Date().toISOString(),
      })).toEqual({ ok: true });
      expect(await svc.verify('acme', acme.id, 7)).toMatchObject({
        state: 'error', error_reason: 'other', error_detail: 'Identifiants enregistrés illisibles', error_cause: 'reconnect',
      });
      expect(await svc.get('acme', acme.id)).toMatchObject({ error_cause: 'reconnect' });
      expect((await svc.list('acme'))[0]!.error_cause).toBe('reconnect');
    });

    // audit R-21 : le texte de Meta a son propre champ, rechargeable, jamais mêlé au motif du moteur
    it("provider_text : le message de Meta d'un refus est dans la vue (aussi après rechargement), pas dans error_detail ; efface à la reconnexion", async () => {
      const acme = await svc.create('acme', 7, metaInput());
      expect(acme.provider_text).toBeNull();
      providers.verifyMeta.mockResolvedValueOnce({
        ok: false, checks: [{ key: 'subscription', status: 'failed', detail: 'Meta a renvoyé une erreur', provider_text: '(#200) Permissions error' }],
        error_reason: 'other', message: 'Meta a renvoyé une erreur', provider_text: '(#200) Permissions error',
      });
      const refused = await svc.verify('acme', acme.id, 7);
      expect(refused).toMatchObject({ state: 'error', error_detail: 'Meta a renvoyé une erreur', provider_text: '(#200) Permissions error' });
      expect(refused.checks).toEqual([expect.objectContaining({ key: 'subscription', provider_text: '(#200) Permissions error' })]);
      expect((await svc.get('acme', acme.id)).provider_text).toBe('(#200) Permissions error');
      expect((await svc.list('acme'))[0]!.provider_text).toBe('(#200) Permissions error');
      providers.verifyMeta.mockResolvedValueOnce(verified());
      expect(await svc.verify('acme', acme.id, 7)).toMatchObject({ state: 'connected', provider_text: null });
    });

    // audit R-21
    it('provider_text : null pour un motif écrit par le moteur (app détenue ailleurs, jeton refusé), et dans la 422 le texte du fournisseur voyage dans le détail du contrôle', async () => {
      const acme = await svc.create('acme', 7, metaInput());
      providers.verifyMeta.mockResolvedValueOnce(refusedToken());
      expect(await svc.verify('acme', acme.id, 7)).toMatchObject({ state: 'error', provider_text: null });
      await betaHoldsApp1();
      providers.verifyMeta.mockResolvedValueOnce(verified());
      expect(await svc.verify('acme', acme.id, 7)).toMatchObject({ state: 'error', error_cause: 'support', provider_text: null });
      providers.verifyMeta.mockResolvedValueOnce({
        ok: false, checks: [{ key: 'subscription', status: 'failed', detail: 'Meta a renvoyé une erreur', provider_text: '(#200) Permissions error' }],
        error_reason: 'other', message: 'Meta a renvoyé une erreur', provider_text: '(#200) Permissions error',
      });
      const err = await caught(svc.create('acme', 7, metaInput({ waba_id: '2222222222' })));
      expect(err.details).toEqual([{ path: 'subscription', message: 'Meta a renvoyé une erreur', provider_text: '(#200) Permissions error' }]);
    });

    // audit R-5 : une panne du fournisseur ne met jamais le compte en erreur, donc « provider » n'est jamais produite
    it("error_cause : une vérification non concluante (fournisseur en panne) ne crée aucune erreur ni cause", async () => {
      const acme = await svc.create('acme', 7, metaInput());
      providers.verifyMeta.mockResolvedValueOnce({
        ok: false, transient: true, checks: [{ key: 'token', status: 'failed', detail: 'Meta ne répond pas' }], error_reason: 'other', message: 'Meta ne répond pas',
      });
      expect(await svc.verify('acme', acme.id, 7)).toMatchObject({ state: 'connected', outcome: 'inconclusive', error_cause: null });
    });

    // audit R-5
    it("error_cause : null pour signatures rejetées (état affiché seulement) et pour un compte déconnecté", async () => {
      const acme = await svc.create('acme', 7, metaInput());
      for (let i = 0; i < 21; i++) recordSignatureFailure(acme.id);
      expect(await svc.get('acme', acme.id)).toMatchObject({ error_reason: 'signature_rejected', error_cause: null });
      const other = await svc.create('acme', 7, metaInput({ waba_id: '2222222222' }));
      await db.setWhatsAppAccountError(other.id, 'token_invalid', 'Jeton refusé');
      await svc.disconnect('acme', other.id, 7);
      expect(await svc.get('acme', other.id)).toMatchObject({ state: 'disconnected', error_cause: null });
    });

    // audit R-5
    it("error_detail : null pour un compte déconnecté, même si un motif avait été enregistré", async () => {
      const acme = await svc.create('acme', 7, metaInput());
      await db.setWhatsAppAccountError(acme.id, 'token_invalid', 'Jeton refusé');
      await svc.disconnect('acme', acme.id, 7);
      expect(await svc.get('acme', acme.id)).toMatchObject({ state: 'disconnected', error_detail: null });
    });

    // revue 2b-1 M-2
    it("« Vérifier maintenant » avec un jeton d'une autre app que celle du compte : erreur, jamais connected", async () => {
      const acme = await svc.create('acme', 7, metaInput());
      await db.setWhatsAppAccountError(acme.id, 'token_invalid', 'Jeton refusé');
      providers.verifyMeta.mockResolvedValueOnce(verified({ meta_app_id: 'app-autre' }));
      expect(await svc.verify('acme', acme.id, 7)).toMatchObject({ state: 'error', error_reason: 'other', outcome: 'refused' });
    });

    // revue 2b-1 M-2
    it("remplacement des identifiants vers une app détenue par beta : 409 neutre, rien remplacé", async () => {
      const acme = await svc.create('acme', 7, metaInput());
      const before = (await db.getWhatsAppAccount('acme', acme.id))!;
      await betaHoldsApp1();
      const err = await caught(svc.replaceCredentials('acme', acme.id, 7, {
        mode: 'meta_manual', waba_id: '1111111111', access_token: 'EAAG-nouveau-jeton-0123456789', app_secret: 'nouveau-secret-0123456789',
      }));
      expect([err.status, err.message, err.reason]).toEqual([409, 'Ce compte ne peut pas être raccordé. Contactez le support.', 'whatsapp_account.cannot_connect']);
      const after = (await db.getWhatsAppAccount('acme', acme.id))!;
      expect([after.secret_encrypted, after.key_version]).toEqual([before.secret_encrypted, before.key_version]);
    });

    it("compte déconnecté pendant « Vérifier maintenant » : il ne revient jamais en connected", async () => {
      const acme = await svc.create('acme', 7, metaInput());
      providers.verifyMeta.mockImplementationOnce(async () => {
        expect(await db.disconnectWhatsAppAccount('acme', acme.id)).toEqual({ ok: true });
        return verified();
      });
      const view = await svc.verify('acme', acme.id, 7);
      expect(view.state).toBe('disconnected');
      // Rien n'est enregistré : l'issue n'est pas `verified`.
      expect(view.outcome).toBe('inconclusive');
      expect((await db.getWhatsAppAccount('acme', acme.id))!.state).toBe('disconnected');
    });

    it("compte déconnecté pendant le remplacement des identifiants : il ne revient jamais en connected", async () => {
      const acme = await svc.create('acme', 7, metaInput());
      providers.verifyMeta.mockImplementationOnce(async () => {
        expect(await db.disconnectWhatsAppAccount('acme', acme.id)).toEqual({ ok: true });
        return verified();
      });
      const err = await caught(svc.replaceCredentials('acme', acme.id, 7, {
        mode: 'meta_manual', waba_id: '1111111111', access_token: 'EAAG-nouveau-jeton-0123456789', app_secret: 'nouveau-secret-0123456789',
      }));
      expect(err.status).toBe(404);
      const record = (await db.getWhatsAppAccount('acme', acme.id))!;
      expect([record.state, record.webhook_key_hash]).toEqual(['disconnected', null]);
      expect(decryptAccountSecrets(record)).toBeNull();
    });

    // revue 2b-1 M-2
    it("deux raccordements simultanés de la même app par deux organisations : un seul réussit, l'autre 409 neutre", async () => {
      providers.verifyMeta.mockImplementation(async (c) => verified({ waba_id: c.waba_id, meta_app_id: 'app-partagee', numbers: [num(c.waba_id === '1111111111' ? 1 : 2)] }));
      const results = await Promise.allSettled([
        svc.create('acme', 7, metaInput()),
        svc.create('beta', 8, { mode: 'meta_manual', name: 'Compte Beta', waba_id: '3333333333', access_token: BETA_TOKEN, app_secret: BETA_SECRET }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toBeInstanceOf(AppError);
      expect([(rejected[0]!.reason as AppError).status, (rejected[0]!.reason as AppError).message])
        .toEqual([409, 'Ce compte ne peut pas être raccordé. Contactez le support.']);
      expect([...await db.listWhatsAppAccounts('acme'), ...await db.listWhatsAppAccounts('beta')]).toHaveLength(1);
    });

    // revue 2b-1 M-2
    it("raccordement Meta sans app lue (debug_token sans app_id) : 422 avec le contrôle app, rien écrit", async () => {
      providers.verifyMeta.mockResolvedValueOnce(verified({ meta_app_id: null }));
      const err = await caught(svc.create('acme', 7, metaInput()));
      expect([err.code, err.status, err.message]).toEqual(['WA_VALIDATION_FAILED', 422, "Impossible de lire l'application du jeton auprès de Meta, réessayez."]);
      expect(err.details).toEqual([{ path: 'app', message: "Impossible de lire l'application du jeton auprès de Meta, réessayez." }]);
      expect(await db.listWhatsAppAccounts('acme')).toEqual([]);
      expect(await db.listWhatsAppNumbers('acme')).toEqual([]);
      expect(await db.listAuditLog('acme')).toEqual([]);
    });

    // revue 2b-1 M-2
    it("remplacement Meta sans app lue : 422 avec le contrôle app, secrets et app inchangés", async () => {
      const acme = await svc.create('acme', 7, metaInput());
      const before = (await db.getWhatsAppAccount('acme', acme.id))!;
      providers.verifyMeta.mockResolvedValueOnce(verified({ meta_app_id: null }));
      const err = await caught(svc.replaceCredentials('acme', acme.id, 7, {
        mode: 'meta_manual', waba_id: '1111111111', access_token: 'EAAG-nouveau-jeton-0123456789', app_secret: 'nouveau-secret-0123456789',
      }));
      expect([err.code, err.details?.[0]?.path]).toEqual(['WA_VALIDATION_FAILED', 'app']);
      const after = (await db.getWhatsAppAccount('acme', acme.id))!;
      expect([after.secret_encrypted, after.meta_app_id]).toEqual([before.secret_encrypted, 'app-1']);
    });

    // revue 2b-1 M-2
    it.each(['connected', 'error'] as const)(
      "« Vérifier maintenant » avec une app illisible (compte %s) : non concluant, état et date de vérification inchangés",
      async (state) => {
        const acme = await svc.create('acme', 7, metaInput());
        if (state === 'error') await db.setWhatsAppAccountError(acme.id, 'token_invalid', 'Jeton refusé');
        const before = (await db.getWhatsAppAccount('acme', acme.id))!;
        providers.verifyMeta.mockResolvedValueOnce(verified({ meta_app_id: null, token_expiry: 'never' }));
        const view = await svc.verify('acme', acme.id, 7);
        expect(view.state).toBe(state);
        expect(view.outcome).toBe('inconclusive');
        expect(view.checks).toContainEqual({ key: 'app', status: 'failed', detail: "Impossible de lire l'application du jeton auprès de Meta, réessayez." });
        const after = (await db.getWhatsAppAccount('acme', acme.id))!;
        expect([after.state, after.error_reason, after.last_verified_at, after.token_expiry])
          .toEqual([before.state, before.error_reason, before.last_verified_at, before.token_expiry]);
      },
    );

    // revue 2b-1 M-2
    it("remplacement vers l'app Y concurrent d'un raccordement de beta avec Y : une seule organisation détient Y", async () => {
      const acme = await svc.create('acme', 7, metaInput());
      providers.verifyMeta.mockImplementation(async (c) => verified({ waba_id: c.waba_id, meta_app_id: 'app-y', numbers: [num(c.waba_id === '1111111111' ? 1 : 2)] }));
      const results = await Promise.allSettled([
        svc.replaceCredentials('acme', acme.id, 7, {
          mode: 'meta_manual', waba_id: '1111111111', access_token: 'EAAG-jeton-app-y-0123456789', app_secret: 'secret-app-y-0123456789',
        }),
        svc.create('beta', 8, { mode: 'meta_manual', name: 'Compte Beta', waba_id: '3333333333', access_token: BETA_TOKEN, app_secret: BETA_SECRET }),
      ]);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect([(rejected[0]!.reason as AppError).status, (rejected[0]!.reason as AppError).message])
        .toEqual([409, 'Ce compte ne peut pas être raccordé. Contactez le support.']);
      const holders = [...await db.listWhatsAppAccounts('acme'), ...await db.listWhatsAppAccounts('beta')]
        .filter((a) => a.meta_app_id === 'app-y' && a.state !== 'disconnected')
        .map((a) => a.client_id);
      expect(holders).toHaveLength(1);
    });

    it("CM.com : le waba_id indicatif est relu au remplacement des identifiants", async () => {
      const created = await svc.create('acme', 7, { mode: 'cm_com', name: 'CM', account_id: CM_ACCOUNT, product_token: CM_TOKEN });
      expect(created.waba_id).toBe('2222222222');
      providers.verifyCm.mockResolvedValueOnce(verified({ meta_app_id: null, waba_id: '4444444444' }));
      const replaced = await svc.replaceCredentials('acme', created.id, 7, { mode: 'cm_com', account_id: CM_ACCOUNT, product_token: 'cm-nouveau-token-0123456789' });
      expect(replaced.waba_id).toBe('4444444444');
    });

    it("21 signatures rejetées puis « Vérifier maintenant » réussi : état affiché connected", async () => {
      const acme = await svc.create('acme', 7, metaInput());
      for (let i = 0; i < 21; i++) recordSignatureFailure(acme.id);
      expect((await svc.get('acme', acme.id)).error_reason).toBe('signature_rejected');
      expect(await svc.verify('acme', acme.id, 7)).toMatchObject({ state: 'connected', error_reason: null, outcome: 'verified' });
    });

    it("21 signatures rejetées puis remplacement des identifiants réussi : état affiché connected", async () => {
      const acme = await svc.create('acme', 7, metaInput());
      for (let i = 0; i < 21; i++) recordSignatureFailure(acme.id);
      const replaced = await svc.replaceCredentials('acme', acme.id, 7, {
        mode: 'meta_manual', waba_id: '1111111111', access_token: 'EAAG-nouveau-jeton-0123456789', app_secret: 'nouveau-secret-0123456789',
      });
      expect(replaced).toMatchObject({ state: 'connected', error_reason: null });
    });

    it("« Vérifier maintenant » en échec ne remet pas le compteur à zéro", async () => {
      const acme = await svc.create('acme', 7, metaInput());
      for (let i = 0; i < 21; i++) recordSignatureFailure(acme.id);
      providers.verifyMeta.mockResolvedValueOnce(refusedToken());
      await svc.verify('acme', acme.id, 7);
      await db.markWhatsAppAccountVerified(acme.id, { token_expiry: null, verified_at: '2026-11-08T12:00:00.000Z' });
      expect((await svc.get('acme', acme.id)).error_reason).toBe('signature_rejected');
    });
  });

  describe('remplacement des identifiants', () => {
    it('vers une autre WABA ou un autre mode : 409, secrets inchangés, aucun appel au fournisseur', async () => {
      const created = await svc.create('acme', 7, metaInput());
      const before = decryptAccountSecrets((await db.getWhatsAppAccount('acme', created.id))!);
      providers.verifyMeta.mockClear();
      const other = await caught(svc.replaceCredentials('acme', created.id, 7, {
        mode: 'meta_manual', waba_id: '9999999999', access_token: 'EAAG-nouveau-jeton-0123456789', app_secret: 'nouveau-secret-0123456789',
      }));
      expect(other.status).toBe(409);
      expect(other.message).toBe('Pour une autre WABA ou un autre compte CM.com, raccordez un nouveau compte.');
      expect(other.reason).toBe('whatsapp_account.other_provider_account');
      const mode = await caught(svc.replaceCredentials('acme', created.id, 7, { mode: 'cm_com', account_id: CM_ACCOUNT, product_token: CM_TOKEN }));
      expect(mode.status).toBe(409);
      expect(mode.message).toBe(other.message);
      expect(providers.verifyMeta).not.toHaveBeenCalled();
      expect(decryptAccountSecrets((await db.getWhatsAppAccount('acme', created.id))!)).toEqual(before);
    });

    it("réussi : le jeton envoyé ensuite est le nouveau, la clé d'URL et le jeton de vérification sont conservés", async () => {
      const sent: string[] = [];
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
        sent.push(init.headers['Authorization'] ?? '');
        return { ok: true, status: 200, text: async () => '{}' } as unknown as Response;
      }));
      const created = await svc.create('acme', 7, metaInput());
      const account1 = (await db.getWhatsAppAccount('acme', created.id))!;
      // Lot R1 : la route du webhook ne sert plus un compte Meta, la clé et le jeton sont lus dans les secrets.
      const secretsBefore = decryptAccountSecrets(account1);
      const hookOf = (s: typeof secretsBefore) => (s?.mode === 'meta_manual' ? { key: s.webhook_key, verify_token: s.verify_token } : null);
      const number = (await db.listWhatsAppNumbers('acme', created.id))[0]!;
      await getTransportForNumber(account1, number)!.sendText('33600000001', 'Bonjour');

      const replaced = await svc.replaceCredentials('acme', created.id, 7, {
        mode: 'meta_manual', waba_id: '1111111111', access_token: 'EAAG-nouveau-jeton-0123456789', app_secret: 'nouveau-secret-0123456789',
      });
      // Clé d'URL et jeton conservés ; la réponse ne les porte pas (revue 2b-3 M-2).
      expect(replaced).not.toHaveProperty('webhook');
      expect(hookOf(decryptAccountSecrets((await db.getWhatsAppAccount('acme', created.id))!))).toEqual(hookOf(secretsBefore));
      expect(hookOf(secretsBefore)?.verify_token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      expect(JSON.stringify(replaced)).not.toContain('EAAG-nouveau-jeton-0123456789');
      const account2 = (await db.getWhatsAppAccount('acme', created.id))!;
      expect(account2.webhook_key_hash).toBe(account1.webhook_key_hash);
      await getTransportForNumber(account2, number)!.sendText('33600000001', 'Bonjour');
      expect(sent).toEqual([`Bearer ${ACME_TOKEN}`, 'Bearer EAAG-nouveau-jeton-0123456789']);
      const audits = await db.listAuditLog('acme');
      expect(audits.map((a) => a.action)).toContain('whatsapp_account.credentials');
      expect(JSON.stringify(audits)).not.toContain('EAAG-nouveau-jeton-0123456789');
    });

    it('vérification en échec : 422, secrets et état inchangés', async () => {
      const created = await svc.create('acme', 7, metaInput());
      const before = (await db.getWhatsAppAccount('acme', created.id))!;
      providers.verifyMeta.mockResolvedValueOnce(refusedToken());
      const err = await caught(svc.replaceCredentials('acme', created.id, 7, {
        mode: 'meta_manual', waba_id: '1111111111', access_token: 'EAAG-mauvais-jeton-0123456789', app_secret: 'mauvais-secret-0123456789',
      }));
      expect(err.code).toBe('WA_VALIDATION_FAILED');
      const after = (await db.getWhatsAppAccount('acme', created.id))!;
      expect([after.secret_encrypted, after.state]).toEqual([before.secret_encrypted, before.state]);
    });

    // audit 6.4
    it('valeur masquée refusée avant tout appel au fournisseur', async () => {
      const created = await svc.create('acme', 7, metaInput());
      providers.verifyMeta.mockClear();
      const err = await caught(svc.replaceCredentials('acme', created.id, 7, {
        mode: 'meta_manual', waba_id: '1111111111', access_token: `••••${'z'.repeat(30)}`, app_secret: ACME_SECRET,
      }));
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(providers.verifyMeta).not.toHaveBeenCalled();
    });

    it("compte d'une autre organisation : 404 sans appel au fournisseur", async () => {
      const created = await svc.create('acme', 7, metaInput());
      providers.verifyMeta.mockClear();
      const err = await caught(svc.replaceCredentials('beta', created.id, 8, {
        mode: 'meta_manual', waba_id: '1111111111', access_token: BETA_TOKEN, app_secret: BETA_SECRET,
      }));
      expect(err.status).toBe(404);
      expect(err.message).toBe('Compte WhatsApp introuvable.');
      expect(err.reason).toBe('whatsapp_account.not_found');
      expect(providers.verifyMeta).not.toHaveBeenCalled();
    });
  });

  describe('« Vérifier maintenant », remplacement et rafraîchissement : webhooks et état Meta (lot R1, spec R1 §5.3 et §5.6)', () => {
    const PUBLIC_URL_MISSING = "La plateforme n'a pas d'adresse publique pour recevoir les messages. Contactez le support.";
    const UNREACHABLE = "Meta n'a pas pu joindre WABAGENT pour vérifier l'adresse du webhook. Réessayez dans quelques minutes ; si cela continue, contactez le support.";
    const UNCONFIRMED = "Meta n'a pas confirmé l'adresse du webhook de WABAGENT. Réessayez ; si cela continue, contactez le support.";
    const BUSY = 'Une autre opération est en cours sur ce compte WhatsApp, réessayez.';
    const CREDENTIALS_CHANGED = 'Les identifiants de ce compte WhatsApp ont changé pendant la vérification, relancez-la.';
    const APP_WEBHOOK_FAILED = "WABAGENT n'a pas pu lire ou inscrire le webhook de votre app Meta.";
    const HEALTH = { can_send: 'limited' as const, business_verification: 'not_verified', issues: [{ code: 141010, text: 'Business verification' }], read_at: '2026-11-12T10:00:00.000Z' };
    const LEGACY_KEY = 'k'.repeat(43);
    const LEGACY_VERIFY = 'v'.repeat(32);
    const NEW_TOKEN = 'EAAG-nouveau-jeton-0123456789';
    const NEW_SECRET = 'nouveau-secret-0123456789';

    async function legacyAccount(): Promise<number> {
      const encrypted = encryptAccountSecrets({ mode: 'meta_manual', access_token: ACME_TOKEN, app_secret: ACME_SECRET, verify_token: LEGACY_VERIFY, webhook_key: LEGACY_KEY });
      const old = await db.insertWhatsAppAccount({
        client_id: 'acme', name: 'Ancien', mode: 'meta_manual', provider_account_id: '1111111111', waba_id: '1111111111', meta_app_id: 'app-1',
        ...encrypted, webhook_key_hash: hashWebhookKey(LEGACY_KEY), token_expiry: null, last_verified_at: null,
      });
      return old.id;
    }

    function webhookChecks(checks: Array<{ key: string; status: string; detail?: string }>): Array<[string, string, string | undefined]> {
      return checks.filter((c) => c.key === 'webhook_waba' || c.key === 'webhook_app').map((c) => [c.key, c.status, c.detail]);
    }

    // Revue : point 4 du Review Focus
    it('compte sans webhook_state : réinscription et état renseigné', async () => {
      const id = await legacyAccount();
      expect((await db.getWhatsAppAccount('acme', id))!.webhook_state).toBeNull();
      // Revue R1 ISO-I1 : compte existant, le GET de Meta est servi par la base (clé du compte), jamais par le registre.
      let servedDuringWrite = false;
      const write = metaWebhooks.setWabaOverride.getMockImplementation()!;
      metaWebhooks.setWabaOverride.mockImplementation(async (c, t) => {
        const key = keyOfMetaUrl(t.callbackUrl);
        servedDuringWrite = !matchPendingVerification(key, t.verifyToken)
          && (await db.findWhatsAppAccountByWebhookKeyHash(hashWebhookKey(key)))?.id === id;
        return write(c, t);
      });

      const view = await svc.verify('acme', id, 7);
      expect([view.state, view.outcome]).toEqual(['connected', 'verified']);
      expect(webhookChecks(view.checks)).toEqual([['webhook_waba', 'created', undefined], ['webhook_app', 'created', undefined]]);
      expect(view.webhooks).toMatchObject({ waba: 'ok', app: 'ok', app_host: null });
      expect(Date.parse(view.webhooks!.checked_at!)).not.toBeNaN();
      expect((await svc.get('acme', id)).webhooks).toEqual(view.webhooks);
      // L'adresse et le jeton de vérification sont ceux du compte, jamais de nouveaux ; identifiants du compte.
      const expectedUrl = `${BASE_URL}/webhook/meta/${LEGACY_KEY}`;
      expect(metaWebhooks.calls.map((c) => [c.op, c.target, c.credential])).toEqual([
        ['readWabaOverride', '1111111111', ACME_TOKEN], ['setWabaOverride', '1111111111', ACME_TOKEN], ['readWabaOverride', '1111111111', ACME_TOKEN],
        ['readAppWebhook', 'app-1', ACME_SECRET], ['setAppWebhook', 'app-1', ACME_SECRET],
      ]);
      expect(metaWebhooks.writes().map((c) => [c.url, c.verify_token])).toEqual([[expectedUrl, LEGACY_VERIFY], [expectedUrl, LEGACY_VERIFY]]);
      expect(servedDuringWrite).toBe(true);
      expect(pendingVerificationKeysForTests()).toEqual([]);
      // Rien de secret dans la réponse.
      const text = JSON.stringify(view);
      for (const secret of [LEGACY_KEY, LEGACY_VERIFY, ACME_TOKEN, ACME_SECRET]) expect(text).not.toContain(secret);
    });

    // revue R1 ISO-I1 : compte retiré pendant la vérification, avant la règle du webhook de l'app.
    it("« Vérifier maintenant » dont le compte est retiré avant la règle de l'app : aucun setAppWebhook, contrôle jamais created", async () => {
      const created = await svc.create('acme', 7, metaInput());
      metaWebhooks.appWebhooks.delete('app-1');
      metaWebhooks.clearCalls();
      metaWebhooks.readAppWebhook.mockImplementationOnce(async () => {
        expect(await db.disconnectWhatsAppAccount('acme', created.id)).toEqual({ ok: true });
        return { ok: true, callbackUrl: null };
      });

      const view = await svc.verify('acme', created.id, 7);

      expect(metaWebhooks.calls.filter((c) => c.op === 'setAppWebhook')).toEqual([]);
      const app = view.checks.find((c) => c.key === 'webhook_app');
      expect(app).toEqual({ key: 'webhook_app', status: 'failed', detail: CREDENTIALS_CHANGED });
      expect(metaWebhooks.appWebhooks.has('app-1')).toBe(false);
    });

    // revue R1 ISO-I1 : un compte existant n'arme jamais le registre des vérifications attendues ; la base sert le GET.
    it("réinscription d'un compte existant : registre jamais armé, le compte en base sert la vérification", async () => {
      const id = await legacyAccount();
      const states: Array<[boolean, number | undefined]> = [];
      const write = metaWebhooks.setWabaOverride.getMockImplementation()!;
      metaWebhooks.setWabaOverride.mockImplementation(async (c, t) => {
        const key = keyOfMetaUrl(t.callbackUrl);
        states.push([matchPendingVerification(key, t.verifyToken), (await db.findWhatsAppAccountByWebhookKeyHash(hashWebhookKey(key)))?.id]);
        return write(c, t);
      });
      const setApp = metaWebhooks.setAppWebhook.getMockImplementation()!;
      metaWebhooks.setAppWebhook.mockImplementation(async (app, t) => {
        const key = keyOfMetaUrl(t.callbackUrl);
        states.push([matchPendingVerification(key, t.verifyToken), (await db.findWhatsAppAccountByWebhookKeyHash(hashWebhookKey(key)))?.id]);
        return setApp(app, t);
      });
      await svc.verify('acme', id, 7);
      expect(states).toEqual([[false, id], [false, id]]);
    });

    it('override présent et correct : aucune écriture chez Meta', async () => {
      const created = await svc.create('acme', 7, metaInput());
      metaWebhooks.clearCalls();
      const view = await svc.verify('acme', created.id, 7);
      expect([view.state, view.outcome]).toEqual(['connected', 'verified']);
      expect(metaWebhooks.writes()).toEqual([]);
      expect(metaWebhooks.calls.map((c) => c.op)).toEqual(['readWabaOverride', 'readAppWebhook']);
      expect(webhookChecks(view.checks)).toEqual([['webhook_waba', 'ok', undefined], ['webhook_app', 'ok', undefined]]);
      expect(view.webhooks).toMatchObject({ waba: 'ok', app: 'ok' });
    });

    it("adresse remplacée chez Meta : réinscrite avec l'adresse du compte, le résultat le dit", async () => {
      const created = await svc.create('acme', 7, metaInput());
      const url = metaWebhooks.overrides.get('1111111111')!;
      metaWebhooks.overrides.set('1111111111', 'https://autre.example.com/hook');
      metaWebhooks.clearCalls();
      const view = await svc.verify('acme', created.id, 7);
      expect(metaWebhooks.writes().map((c) => [c.op, c.url])).toEqual([['setWabaOverride', url]]);
      expect(webhookChecks(view.checks)).toEqual([['webhook_waba', 'created', undefined], ['webhook_app', 'ok', undefined]]);
      expect(view.webhooks!.waba).toBe('ok');
    });

    // spec R1 §5.3, revue 2b-2 M-1
    it.each([
      ['2200', { kind: 'callback_failed' as const, provider_text: '(#2200) Callback verification failed' }],
      ['délai dépassé', { kind: 'timeout' as const }],
      ['réponse 5xx', { kind: 'other' as const, message: 'Meta a répondu avec le code HTTP 503', transient: true as const }],
    ])('réinscription en échec (%s) : compte reste connected, waba missing, issue verified (ruling R-11)', async (_label, failure) => {
      const created = await svc.create('acme', 7, metaInput());
      metaWebhooks.overrides.delete('1111111111');
      metaWebhooks.clearCalls();
      metaWebhooks.setWabaOverride.mockResolvedValueOnce({ ok: false, failure });
      const view = await svc.verify('acme', created.id, 7);
      expect([view.state, view.error_reason, view.outcome]).toEqual(['connected', null, 'verified']);
      expect(view.webhooks!.waba).toBe('missing');
      const waba = view.checks.find((c) => c.key === 'webhook_waba')!;
      expect([waba.status, waba.detail]).toEqual(['failed', UNREACHABLE]);
      if (failure.kind === 'callback_failed') expect(waba.provider_text).toBe('(#2200) Callback verification failed');
      // Le compte existe : aucun retrait de l'adresse ; le webhook de l'app suit sa règle.
      expect(metaWebhooks.calls.map((c) => c.op)).toEqual(['readWabaOverride', 'setWabaOverride', 'readAppWebhook']);
      expect(pendingVerificationKeysForTests()).toEqual([]);
      const record = (await db.getWhatsAppAccount('acme', created.id))!;
      expect([record.state, record.error_reason, record.webhook_state!.waba]).toEqual(['connected', null, 'missing']);
    });

    it("relecture sans notre adresse après la réinscription : waba missing, issue verified, aucun retrait", async () => {
      const created = await svc.create('acme', 7, metaInput());
      metaWebhooks.overrides.delete('1111111111');
      metaWebhooks.readWabaOverride.mockResolvedValueOnce({ ok: true, subscribed: false, override: null });
      metaWebhooks.readWabaOverride.mockResolvedValueOnce({ ok: true, subscribed: true, override: 'https://autre.example.com/x' });
      metaWebhooks.clearCalls();
      const view = await svc.verify('acme', created.id, 7);
      expect([view.state, view.outcome, view.webhooks!.waba]).toEqual(['connected', 'verified', 'missing']);
      expect(view.checks.find((c) => c.key === 'webhook_waba')).toEqual({ key: 'webhook_waba', status: 'failed', detail: UNCONFIRMED });
      expect(metaWebhooks.writes().map((c) => c.op)).toEqual(['setWabaOverride']);
    });

    it("lecture de l'abonnement en échec : état des webhooks de la WABA inchangé, issue verified, aucune écriture", async () => {
      const created = await svc.create('acme', 7, metaInput());
      metaWebhooks.clearCalls();
      metaWebhooks.readWabaOverride.mockResolvedValueOnce({ ok: false, failure: { kind: 'unreachable' } });
      const view = await svc.verify('acme', created.id, 7);
      expect([view.state, view.outcome, view.webhooks!.waba]).toEqual(['connected', 'verified', 'ok']);
      expect(view.checks.find((c) => c.key === 'webhook_waba')!.status).toBe('failed');
      expect(metaWebhooks.writes()).toEqual([]);
    });

    it('jeton refusé : error comme avant (règle 2b inchangée)', async () => {
      const created = await svc.create('acme', 7, metaInput());
      const before = (await db.getWhatsAppAccount('acme', created.id))!;
      metaWebhooks.clearCalls();
      providers.verifyMeta.mockResolvedValueOnce(refusedToken());
      const view = await svc.verify('acme', created.id, 7);
      expect(view).toMatchObject({ state: 'error', error_reason: 'token_invalid', outcome: 'refused' });
      expect(view.checks).toEqual([{ key: 'token', status: 'failed', detail: 'Jeton refusé par Meta' }]);
      // Aucun appel d'inscription avec un jeton refusé ; état des webhooks inchangé.
      expect(metaWebhooks.calls).toEqual([]);
      expect((await db.getWhatsAppAccount('acme', created.id))!.webhook_state).toEqual(before.webhook_state);
    });

    it("jeton refusé par Meta pendant la réinscription : error (règle 2b), rien d'autre n'est appelé", async () => {
      const created = await svc.create('acme', 7, metaInput());
      metaWebhooks.overrides.delete('1111111111');
      metaWebhooks.clearCalls();
      metaWebhooks.setWabaOverride.mockResolvedValueOnce({ ok: false, failure: { kind: 'token_invalid' } });
      const view = await svc.verify('acme', created.id, 7);
      expect(view).toMatchObject({ state: 'error', error_reason: 'token_invalid', outcome: 'refused' });
      expect((await db.getWhatsAppAccount('acme', created.id))!.error_provider_text).toBeNull();
      expect(view.checks.find((c) => c.key === 'webhook_waba')!.status).toBe('failed');
      expect(metaWebhooks.calls.map((c) => c.op)).toEqual(['readWabaOverride', 'setWabaOverride']);
    });

    // spec R1 §5.3
    it('PUBLIC_BASE_URL absente : inconclusive, contrôle webhook_waba en échec, aucun appel à Meta, état inchangé', async () => {
      const created = await svc.create('acme', 7, metaInput());
      await db.setWhatsAppAccountError(created.id, 'token_invalid', 'Jeton refusé');
      const before = (await db.getWhatsAppAccount('acme', created.id))!;
      metaWebhooks.clearCalls();
      providers.verifyMeta.mockClear();
      vi.stubEnv('PUBLIC_BASE_URL', '');
      const view = await svc.verify('acme', created.id, 7);
      expect([view.state, view.error_reason, view.outcome]).toEqual(['error', 'token_invalid', 'inconclusive']);
      expect(view.checks).toEqual([{ key: 'webhook_waba', status: 'failed', detail: PUBLIC_URL_MISSING }]);
      expect(providers.verifyMeta).not.toHaveBeenCalled();
      expect(metaWebhooks.calls).toEqual([]);
      const after = (await db.getWhatsAppAccount('acme', created.id))!;
      expect([after.state, after.last_verified_at, after.webhook_state]).toEqual([before.state, before.last_verified_at, before.webhook_state]);
    });

    it("webhook de l'app en échec : état du compte inchangé, issue verified, état app failed", async () => {
      const created = await svc.create('acme', 7, metaInput());
      metaWebhooks.readAppWebhook.mockResolvedValueOnce({ ok: false, failure: { kind: 'token_invalid' } });
      const view = await svc.verify('acme', created.id, 7);
      expect([view.state, view.error_reason, view.outcome]).toEqual(['connected', null, 'verified']);
      expect(webhookChecks(view.checks)).toEqual([['webhook_waba', 'ok', undefined], ['webhook_app', 'failed', APP_WEBHOOK_FAILED]]);
      expect(view.webhooks).toMatchObject({ waba: 'ok', app: 'failed' });
    });

    it('meta_health réécrit par la vérification ; non lu : inchangé', async () => {
      const created = await svc.create('acme', 7, metaInput());
      providers.verifyMeta.mockResolvedValueOnce(verified({ meta_health: HEALTH }));
      expect((await svc.verify('acme', created.id, 7)).meta_health).toEqual(HEALTH);
      providers.verifyMeta.mockResolvedValueOnce(verified({ meta_health: null }));
      expect((await svc.verify('acme', created.id, 7)).meta_health).toEqual(HEALTH);
    });

    it("WABA réservée pendant la réinscription : une seconde vérification simultanée n'écrit rien chez Meta", async () => {
      const created = await svc.create('acme', 7, metaInput());
      metaWebhooks.overrides.delete('1111111111');
      metaWebhooks.clearCalls();
      const write = metaWebhooks.setWabaOverride.getMockImplementation()!;
      let second: Awaited<ReturnType<WhatsAppAccountService['verify']>> | undefined;
      metaWebhooks.setWabaOverride.mockImplementationOnce(async (c, t) => {
        second = await svc.verify('acme', created.id, 7);
        return write(c, t);
      });
      const first = await svc.verify('acme', created.id, 7);
      expect(first.outcome).toBe('verified');
      expect(second!.outcome).toBe('verified');
      expect(second!.checks.find((c) => c.key === 'webhook_waba')).toEqual({ key: 'webhook_waba', status: 'failed', detail: BUSY });
      expect(metaWebhooks.writes().filter((c) => c.op === 'setWabaOverride')).toHaveLength(1);
      expect((await db.getWhatsAppAccount('acme', created.id))!.webhook_state!.waba).toBe('ok');
    });

    // Ruling R-11
    it("vérification enregistrée, réinscription en échec : issue verified, contrôle webhook_waba en échec, waba missing", async () => {
      const created = await svc.create('acme', 7, metaInput());
      await db.setWhatsAppAccountError(created.id, 'other', 'Panne');
      metaWebhooks.overrides.delete('1111111111');
      metaWebhooks.setWabaOverride.mockResolvedValueOnce({ ok: false, failure: { kind: 'callback_failed' } });
      const view = await svc.verify('acme', created.id, 7);
      expect([view.state, view.outcome]).toEqual(['connected', 'verified']);
      expect(view.checks.find((c) => c.key === 'webhook_waba')).toMatchObject({ status: 'failed', detail: UNREACHABLE });
      expect(view.webhooks!.waba).toBe('missing');
      // La vérification est enregistrée : le compte en erreur est repassé connected.
      const record = (await db.getWhatsAppAccount('acme', created.id))!;
      expect([record.state, record.webhook_state!.waba]).toEqual(['connected', 'missing']);
    });

    // revue 2b-2 M-2 ; registre R1 T6a : cas « app », secret_encrypted identique, seule l'app change (seul meta_app_id
    // distingue alors le compte relu de celui lu au début).
    it.each([
      ['identifiants', { access_token: NEW_TOKEN, app_secret: NEW_SECRET, meta_app_id: 'app-1', keepSecret: false }],
      ['app', { access_token: ACME_TOKEN, app_secret: ACME_SECRET, meta_app_id: 'app-2', keepSecret: true }],
    ])('identifiants remplacés pendant la vérification (%s) : aucune écriture chez Meta ni de webhook_state', async (_label, next) => {
      const created = await svc.create('acme', 7, metaInput());
      metaWebhooks.overrides.delete('1111111111');
      const before = (await db.getWhatsAppAccount('acme', created.id))!;
      const secrets = decryptAccountSecrets(before)!;
      if (secrets.mode !== 'meta_manual') throw new Error('[Test] compte Meta attendu');
      metaWebhooks.clearCalls();
      providers.verifyMeta.mockImplementationOnce(async () => {
        // Remplacement concurrent, écrit en base pendant la lecture chez Meta.
        const encrypted = next.keepSecret
          ? { secret_encrypted: before.secret_encrypted, key_version: before.key_version }
          : encryptAccountSecrets({ ...secrets, access_token: next.access_token, app_secret: next.app_secret });
        expect((await db.replaceWhatsAppAccountSecrets('acme', created.id, {
          secret_encrypted: encrypted.secret_encrypted, key_version: encrypted.key_version, waba_id: '1111111111',
          meta_app_id: next.meta_app_id, token_expiry: null, verified_at: new Date().toISOString(),
        })).ok).toBe(true);
        return verified();
      });
      const view = await svc.verify('acme', created.id, 7);
      expect(view.outcome).toBe('verified');
      if (next.keepSecret) expect((await db.getWhatsAppAccount('acme', created.id))!.secret_encrypted).toBe(before.secret_encrypted);
      expect(metaWebhooks.calls).toEqual([]);
      expect(view.checks.find((c) => c.key === 'webhook_waba')).toMatchObject({ status: 'failed', detail: CREDENTIALS_CHANGED });
      expect((await db.getWhatsAppAccount('acme', created.id))!.webhook_state).toEqual(before.webhook_state);
      expect(pendingVerificationKeysForTests()).toEqual([]);
    });

    it("replaceCredentials garde la clé d'URL et réinscrit avec le même jeton de vérification", async () => {
      const created = await svc.create('acme', 7, metaInput());
      const first = metaWebhooks.calls.find((c) => c.op === 'setWabaOverride')!;
      const hashBefore = (await db.getWhatsAppAccount('acme', created.id))!.webhook_key_hash;
      metaWebhooks.clearCalls();
      providers.verifyMeta.mockResolvedValueOnce(verified({ meta_health: HEALTH }));
      const replaced = await svc.replaceCredentials('acme', created.id, 7, { mode: 'meta_manual', waba_id: '1111111111', access_token: NEW_TOKEN, app_secret: NEW_SECRET });
      expect(metaWebhooks.calls.map((c) => [c.op, c.target, c.credential])).toEqual([
        ['setWabaOverride', '1111111111', NEW_TOKEN], ['readWabaOverride', '1111111111', NEW_TOKEN],
        ['readAppWebhook', 'app-1', NEW_SECRET],
      ]);
      const inscription = metaWebhooks.calls[0]!;
      expect([inscription.url, inscription.verify_token]).toEqual([first.url, first.verify_token]);
      expect((await db.getWhatsAppAccount('acme', created.id))!.webhook_key_hash).toBe(hashBefore);
      expect(webhookChecks(replaced.checks)).toEqual([['webhook_waba', 'created', undefined], ['webhook_app', 'ok', undefined]]);
      expect(replaced.webhooks).toMatchObject({ waba: 'ok', app: 'ok' });
      expect(replaced.meta_health).toEqual(HEALTH);
      expect(pendingVerificationKeysForTests()).toEqual([]);
      const text = JSON.stringify(replaced);
      for (const secret of [NEW_TOKEN, NEW_SECRET, keyOfMetaUrl(first.url!), first.verify_token!]) expect(text).not.toContain(secret);
    });

    it('replaceCredentials : inscription en 2200, identifiants gardés, waba missing, contrôle en échec', async () => {
      const created = await svc.create('acme', 7, metaInput());
      metaWebhooks.clearCalls();
      metaWebhooks.setWabaOverride.mockResolvedValueOnce({ ok: false, failure: { kind: 'callback_failed' } });
      const replaced = await svc.replaceCredentials('acme', created.id, 7, { mode: 'meta_manual', waba_id: '1111111111', access_token: NEW_TOKEN, app_secret: NEW_SECRET });
      expect([replaced.state, replaced.webhooks!.waba]).toEqual(['connected', 'missing']);
      expect(replaced.checks.find((c) => c.key === 'webhook_waba')).toMatchObject({ status: 'failed', detail: UNREACHABLE });
      const secrets = decryptAccountSecrets((await db.getWhatsAppAccount('acme', created.id))!);
      expect(secrets).toMatchObject({ access_token: NEW_TOKEN, app_secret: NEW_SECRET });
      expect(metaWebhooks.calls.map((c) => c.op)).not.toContain('clearWabaOverride');
      expect(pendingVerificationKeysForTests()).toEqual([]);
    });

    // relecture finale R1 FR-M5 : une panne inattendue de l'inscription au remplacement laisse la WABA sans l'adresse
    // inscrite avec les nouveaux identifiants : missing, jamais l'état ancien ; « Vérifier maintenant » : état inchangé.
    it('panne inattendue de l\'inscription : replaceCredentials pose waba missing ; « Vérifier maintenant » ne change rien', async () => {
      const created = await svc.create('acme', 7, metaInput());
      expect((await svc.get('acme', created.id)).webhooks!.waba).toBe('ok');
      metaWebhooks.setWabaOverride.mockRejectedValueOnce(new Error('panne inattendue'));
      const replaced = await svc.replaceCredentials('acme', created.id, 7, { mode: 'meta_manual', waba_id: '1111111111', access_token: NEW_TOKEN, app_secret: NEW_SECRET });
      expect([replaced.state, replaced.webhooks!.waba]).toEqual(['connected', 'missing']);
      expect(replaced.checks.find((c) => c.key === 'webhook_waba')).toMatchObject({ status: 'failed' });

      // « Vérifier maintenant » : rien de sûr n'a été lu, l'état en base reste celui d'avant.
      metaWebhooks.overrides.delete('1111111111');
      await svc.verify('acme', created.id, 7);
      expect((await svc.get('acme', created.id)).webhooks!.waba).toBe('ok');
      metaWebhooks.overrides.delete('1111111111');
      metaWebhooks.setWabaOverride.mockRejectedValueOnce(new Error('panne inattendue'));
      await db.setWhatsAppAccountWebhookState('acme', created.id, { waba: 'ok', checked_at: null });
      const verifiedNow = await svc.verify('acme', created.id, 7);
      expect(verifiedNow.webhooks!.waba).toBe('ok');
    });

    // relecture finale R1 FR-M2 : vers une autre app, l'adresse inscrite pour l'ancienne app est retirée avec les anciens
    // identifiants (sinon chaque message arrive deux fois, une fois signé avec l'ancien secret).
    it("replaceCredentials vers une autre app : override de l'ancienne app retiré avec les anciens identifiants, avant l'inscription", async () => {
      const created = await svc.create('acme', 7, metaInput());
      metaWebhooks.clearCalls();
      providers.verifyMeta.mockResolvedValueOnce(verified({ meta_app_id: 'app-2' }));
      const replaced = await svc.replaceCredentials('acme', created.id, 7, { mode: 'meta_manual', waba_id: '1111111111', access_token: NEW_TOKEN, app_secret: NEW_SECRET });
      expect(replaced.state).toBe('connected');
      expect(metaWebhooks.writes().map((c) => [c.op, c.target, c.credential])).toEqual([
        ['clearWabaOverride', '1111111111', ACME_TOKEN],
        ['setWabaOverride', '1111111111', NEW_TOKEN],
        ['setAppWebhook', 'app-2', NEW_SECRET],
      ]);
      const audit = (await db.listAuditLog('acme')).find((a) => a.action === 'whatsapp_account.credentials')!;
      expect(audit.metadata).toMatchObject({ old_app_cleanup: 'done' });

      // Même app : rien n'est retiré.
      metaWebhooks.clearCalls();
      providers.verifyMeta.mockResolvedValueOnce(verified({ meta_app_id: 'app-2' }));
      await svc.replaceCredentials('acme', created.id, 7, { mode: 'meta_manual', waba_id: '1111111111', access_token: ACME_TOKEN, app_secret: ACME_SECRET });
      expect(metaWebhooks.calls.filter((c) => c.op === 'clearWabaOverride')).toEqual([]);
    });

    it("replaceCredentials vers une autre app, retrait de l'ancien override refusé : remplacement fait, échec journalisé et audité", async () => {
      const created = await svc.create('acme', 7, metaInput());
      metaWebhooks.clearWabaOverride.mockResolvedValueOnce({ ok: false, failure: { kind: 'token_invalid' } });
      providers.verifyMeta.mockResolvedValueOnce(verified({ meta_app_id: 'app-2' }));
      const log = vi.mocked(console.log);
      log.mockClear();
      const replaced = await svc.replaceCredentials('acme', created.id, 7, { mode: 'meta_manual', waba_id: '1111111111', access_token: NEW_TOKEN, app_secret: NEW_SECRET });
      expect([replaced.state, replaced.webhooks!.waba]).toEqual(['connected', 'ok']);
      expect((await db.listAuditLog('acme')).find((a) => a.action === 'whatsapp_account.credentials')!.metadata).toMatchObject({ old_app_cleanup: 'failed' });
      const lines = log.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(lines).toContain("ancienne app");
      for (const secret of [ACME_TOKEN, ACME_SECRET, NEW_TOKEN, NEW_SECRET, '1111111111']) expect(lines).not.toContain(secret);
    });

    it("replaceCredentials pendant une autre opération sur la WABA : aucune inscription, waba missing, le contrôle le dit", async () => {
      const created = await svc.create('acme', 7, metaInput());
      metaWebhooks.overrides.delete('1111111111');
      metaWebhooks.clearCalls();
      const write = metaWebhooks.setWabaOverride.getMockImplementation()!;
      let replaced: Awaited<ReturnType<WhatsAppAccountService['replaceCredentials']>> | undefined;
      metaWebhooks.setWabaOverride.mockImplementationOnce(async (c, t) => {
        replaced = await svc.replaceCredentials('acme', created.id, 7, { mode: 'meta_manual', waba_id: '1111111111', access_token: NEW_TOKEN, app_secret: NEW_SECRET });
        return write(c, t);
      });
      await svc.verify('acme', created.id, 7);
      expect(replaced!.checks.find((c) => c.key === 'webhook_waba')).toEqual({ key: 'webhook_waba', status: 'failed', detail: BUSY });
      expect(replaced!.webhooks!.waba).toBe('missing');
      expect(metaWebhooks.calls.filter((c) => c.credential === NEW_TOKEN)).toEqual([]);
    });

    it('replaceCredentials : PUBLIC_BASE_URL absente, refus public_url_missing avant tout appel, identifiants inchangés', async () => {
      const created = await svc.create('acme', 7, metaInput());
      const before = (await db.getWhatsAppAccount('acme', created.id))!;
      metaWebhooks.clearCalls();
      providers.verifyMeta.mockClear();
      vi.stubEnv('PUBLIC_BASE_URL', '');
      const err = await caught(svc.replaceCredentials('acme', created.id, 7, { mode: 'meta_manual', waba_id: '1111111111', access_token: NEW_TOKEN, app_secret: NEW_SECRET }));
      expect([err.code, err.reason]).toEqual(['WA_VALIDATION_FAILED', 'whatsapp_account.public_url_missing']);
      expect(providers.verifyMeta).not.toHaveBeenCalled();
      expect(metaWebhooks.calls).toEqual([]);
      expect((await db.getWhatsAppAccount('acme', created.id))!.secret_encrypted).toBe(before.secret_encrypted);
    });

    it('refreshNumbers met à jour meta_health ; lecture en échec : meta_health inchangé', async () => {
      const created = await svc.create('acme', 7, metaInput());
      metaWebhooks.clearCalls();
      metaWebhooks.readMetaHealth.mockResolvedValueOnce(HEALTH);
      const refreshed = await svc.refreshNumbers('acme', created.id, 7);
      expect(refreshed.meta_health).toEqual(HEALTH);
      expect(metaWebhooks.calls.map((c) => [c.op, c.target, c.credential])).toEqual([['readMetaHealth', '1111111111', ACME_TOKEN]]);

      metaWebhooks.readMetaHealth.mockResolvedValueOnce(null);
      expect((await svc.refreshNumbers('acme', created.id, 7)).meta_health).toEqual(HEALTH);
      metaWebhooks.readMetaHealth.mockRejectedValueOnce(new Error('panne'));
      expect((await svc.refreshNumbers('acme', created.id, 7)).meta_health).toEqual(HEALTH);
      // CM.com : aucune lecture chez Meta.
      const cm = await svc.create('acme', 7, { mode: 'cm_com', name: 'CM', account_id: CM_ACCOUNT, product_token: CM_TOKEN });
      metaWebhooks.clearCalls();
      await svc.refreshNumbers('acme', cm.id, 7);
      expect(metaWebhooks.calls).toEqual([]);
    });
  });

  describe('vérification et état affiché', () => {
    // spec §7.7
    it("« Vérifier maintenant » sur jeton révoqué : état error, motif token_invalid ; puis succès : connected", async () => {
      const created = await svc.create('acme', 7, metaInput());
      providers.verifyMeta.mockResolvedValueOnce(refusedToken());
      const failed = await svc.verify('acme', created.id, 7);
      expect(failed).toMatchObject({ state: 'error', error_reason: 'token_invalid', outcome: 'refused' });
      expect(failed.checks).toEqual([{ key: 'token', status: 'failed', detail: 'Jeton refusé par Meta' }]);
      expect((await db.getWhatsAppAccount('acme', created.id))!.state).toBe('error');

      providers.verifyMeta.mockResolvedValueOnce(verified({ token_expiry: 'never' }));
      const ok = await svc.verify('acme', created.id, 7);
      expect(ok).toMatchObject({ state: 'connected', error_reason: null, token_expiry: 'never', outcome: 'verified' });
      expect(providers.verifyMeta).toHaveBeenLastCalledWith({ waba_id: '1111111111', access_token: ACME_TOKEN, app_secret: ACME_SECRET });
      const audits = await db.listAuditLog('acme');
      expect(audits.filter((a) => a.action === 'whatsapp_account.verify').map((a) => a.metadata)).toEqual(
        expect.arrayContaining([{ ok: false }, { ok: true }]),
      );
    });

    // revue 2b-2 M-1
    it.each([
      ['connected', 'meta_manual'], ['error', 'meta_manual'], ['connected', 'cm_com'], ['error', 'cm_com'],
    ] as const)("« Vérifier maintenant » sans réponse du fournisseur (compte %s, %s) : non concluant, état et dates inchangés", async (state, mode) => {
      const created = mode === 'meta_manual'
        ? await svc.create('acme', 7, metaInput())
        : await svc.create('acme', 7, { mode: 'cm_com', name: 'CM', account_id: CM_ACCOUNT, product_token: CM_TOKEN });
      if (state === 'error') await db.setWhatsAppAccountError(created.id, 'token_invalid', 'Jeton refusé');
      const before = (await db.getWhatsAppAccount('acme', created.id))!;
      const unavailable: ProviderVerification = {
        ok: false, transient: true, error_reason: 'other', message: 'Meta ne répond pas',
        checks: [{ key: 'token', status: 'ok' }, { key: 'numbers', status: 'failed', detail: 'Meta ne répond pas' }],
      };
      (mode === 'meta_manual' ? providers.verifyMeta : providers.verifyCm).mockResolvedValueOnce(unavailable);
      const view = await svc.verify('acme', created.id, 7);
      expect([view.state, view.error_reason]).toEqual([state, before.error_reason]);
      expect(view.outcome).toBe('inconclusive');
      expect(view.checks).toEqual([{ key: 'token', status: 'ok' }, { key: 'numbers', status: 'failed', detail: 'Le fournisseur ne répond pas, réessayez.' }]);
      const after = (await db.getWhatsAppAccount('acme', created.id))!;
      expect([after.state, after.error_reason, after.error_detail, after.last_verified_at, after.token_expiry])
        .toEqual([before.state, before.error_reason, before.error_detail, before.last_verified_at, before.token_expiry]);
      const audit = (await db.listAuditLog('acme')).find((a) => a.action === 'whatsapp_account.verify');
      expect(audit?.metadata).toEqual({ ok: false });
    });

    // revue 2b-2 M-1
    it.each([[429, 80007], [400, 4], [400, 130429]] as const)(
      "« Vérifier maintenant » en limite de débit Meta (HTTP %s, code %s) par le vrai client : non concluant, jamais en erreur",
      async (status, code) => {
        const created = await svc.create('acme', 7, metaInput());
        const before = (await db.getWhatsAppAccount('acme', created.id))!;
        const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: 'Limite atteinte', code } }), { status })) as typeof fetch;
        providers.verifyMeta.mockImplementationOnce((c) => verifyMetaManual(c, { fetchImpl }));
        const view = await svc.verify('acme', created.id, 7);
        expect([view.state, view.error_reason]).toEqual(['connected', null]);
        expect(view.outcome).toBe('inconclusive');
        expect(view.checks.filter((c) => c.status === 'failed').map((c) => c.detail)).toEqual(['Le fournisseur ne répond pas, réessayez.']);
        const after = (await db.getWhatsAppAccount('acme', created.id))!;
        expect([after.state, after.last_verified_at, after.token_expiry]).toEqual(['connected', before.last_verified_at, before.token_expiry]);
      },
    );

    // revue finale 2b-2, re-revue : une app illisible (5xx, autre 400, 200 sans app_id) n'est jamais un refus d'identifiants.
    describe("application du jeton illisible chez Meta (vrai client Graph simulé par fetchImpl)", () => {
      const UNREADABLE = "Impossible de lire l'application du jeton auprès de Meta, réessayez.";
      const cases = [
        ['debug_token en 5xx', 'http500'],
        ['debug_token en 400 autre que le jeton', 'http400'],
        ['debug_token en 200 sans app_id', 'no_app_id'],
      ] as const;

      function graphFake(debug: (typeof cases)[number][1]): { fetchImpl: typeof fetch; posts: () => string[] } {
        const posts: string[] = [];
        const reply = (status: number, body: unknown): Response =>
          new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        const fetchImpl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
          const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
          const method = init?.method ?? 'GET';
          if (method === 'POST') { posts.push(url.pathname); return reply(200, { success: true }); }
          if (url.pathname.endsWith('/debug_token')) {
            if (debug === 'http500') return reply(500, { error: { message: 'boom', code: 2 } });
            if (debug === 'http400') return reply(400, { error: { message: 'Bad request', code: 100 } });
            return reply(200, { data: { type: 'SYSTEM_USER', is_valid: true, expires_at: 0 } });
          }
          // Abonnement absent : une écriture serait tentée si le client ne s'arrêtait pas.
          if (url.pathname.endsWith('/subscribed_apps')) return reply(200, { data: [] });
          if (url.pathname.endsWith('/phone_numbers')) {
            return reply(200, { data: [{ id: 'pn-1', display_phone_number: '+33 1 00 00 00 01', verified_name: 'Boutique 1', status: 'CONNECTED', quality_rating: 'GREEN', account_mode: 'LIVE' }] });
          }
          return reply(200, { id: '1111111111', name: 'Nom chez Meta' });
        }) as typeof fetch;
        return { fetchImpl, posts: () => posts };
      }

      it.each(cases)('« Vérifier maintenant » (%s) : compte connecté inchangé, dates inchangées, aucun POST', async (_label, debug) => {
        const created = await svc.create('acme', 7, metaInput());
        const before = (await db.getWhatsAppAccount('acme', created.id))!;
        const g = graphFake(debug);
        providers.verifyMeta.mockImplementationOnce((c) => verifyMetaManual(c, { fetchImpl: g.fetchImpl }));
        const view = await svc.verify('acme', created.id, 7);
        expect([view.state, view.error_reason]).toEqual(['connected', null]);
        expect(view.outcome).toBe('inconclusive');
        expect(view.checks.filter((c) => c.status === 'failed').map((c) => c.key)).toEqual(['app']);
        const after = (await db.getWhatsAppAccount('acme', created.id))!;
        expect([after.state, after.error_reason, after.error_detail, after.last_verified_at, after.token_expiry])
          .toEqual([before.state, before.error_reason, before.error_detail, before.last_verified_at, before.token_expiry]);
        expect(g.posts()).toEqual([]);
      });

      it.each(cases)('raccordement (%s) : 422 avec le message, rien écrit, aucun POST', async (_label, debug) => {
        const g = graphFake(debug);
        providers.verifyMeta.mockImplementationOnce((c) => verifyMetaManual(c, { fetchImpl: g.fetchImpl }));
        const err = await caught(svc.create('acme', 7, metaInput()));
        expect([err.code, err.status, err.message]).toEqual(['WA_VALIDATION_FAILED', 422, UNREADABLE]);
        expect(await db.listWhatsAppAccounts('acme')).toEqual([]);
        expect(await db.listWhatsAppNumbers('acme')).toEqual([]);
        expect(await db.listAuditLog('acme')).toEqual([]);
        expect(g.posts()).toEqual([]);
      });

      it.each(cases)('remplacement (%s) : 422 avec le message, secrets inchangés, aucun POST', async (_label, debug) => {
        const created = await svc.create('acme', 7, metaInput());
        const before = (await db.getWhatsAppAccount('acme', created.id))!;
        const g = graphFake(debug);
        providers.verifyMeta.mockImplementationOnce((c) => verifyMetaManual(c, { fetchImpl: g.fetchImpl }));
        const err = await caught(svc.replaceCredentials('acme', created.id, 7, {
          mode: 'meta_manual', waba_id: '1111111111', access_token: 'EAAG-nouveau-jeton-0123456789', app_secret: 'nouveau-secret-0123456789',
        }));
        expect([err.code, err.status, err.message]).toEqual(['WA_VALIDATION_FAILED', 422, UNREADABLE]);
        const after = (await db.getWhatsAppAccount('acme', created.id))!;
        expect([after.secret_encrypted, after.meta_app_id, after.state]).toEqual([before.secret_encrypted, 'app-1', 'connected']);
        expect(g.posts()).toEqual([]);
      });
    });

    // revue 2b-2 M-1
    it("« Vérifier maintenant » refusé clairement (WABA inaccessible) : le compte passe en erreur", async () => {
      const created = await svc.create('acme', 7, metaInput());
      providers.verifyMeta.mockResolvedValueOnce({
        ok: false, error_reason: 'other', message: 'Identifiant de compte introuvable ou non partagé avec le jeton',
        checks: [{ key: 'waba_access', status: 'failed', detail: 'Identifiant de compte introuvable ou non partagé avec le jeton' }],
      });
      expect(await svc.verify('acme', created.id, 7)).toMatchObject({ state: 'error', error_reason: 'other' });
    });

    it('21 signatures rejetées : la vue dit error / signature_rejected ; une signature valide : connected', async () => {
      const created = await svc.create('acme', 7, metaInput());
      for (let i = 0; i < 21; i++) recordSignatureFailure(created.id);
      expect(await svc.get('acme', created.id)).toMatchObject({ state: 'error', error_reason: 'signature_rejected' });
      expect((await db.getWhatsAppAccount('acme', created.id))!.state).toBe('connected');
      recordSignatureSuccess(created.id);
      expect(await svc.get('acme', created.id)).toMatchObject({ state: 'connected', error_reason: null });
    });

    it('alertes : jeton qui expire dans moins de 7 jours, qualité RED ; is_test si tous les numéros sont de test', async () => {
      const soon = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
      providers.verifyMeta.mockResolvedValueOnce(verified({ token_expiry: soon, numbers: [num(1, { quality: 'RED' }), num(2)] }));
      const created = await svc.create('acme', 7, metaInput());
      const red = created.numbers.find((n) => n.phone_e164 === '+33100000001')!;
      expect(created.alerts).toEqual([{ kind: 'token_expiring', at: soon }, { kind: 'quality_degraded', number_id: red.id }]);
      expect(created.is_test).toBe(false);
      for (const n of created.numbers) await svc.setNumberTestFlag('acme', created.id, n.id, 7, true);
      expect((await svc.get('acme', created.id)).is_test).toBe(true);
    });

    it("pas d'alerte de jeton pour une expiration lointaine, 'never' ou inconnue ; alertes du fournisseur conservées", async () => {
      const later = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
      for (const expiry of [later, 'never', null]) {
        providers.verifyMeta.mockResolvedValueOnce(verified({ token_expiry: expiry }));
        const created = await svc.create('acme', 7, metaInput());
        expect(created.alerts).toEqual([]);
        await svc.disconnect('acme', created.id, 7);
      }
      providers.verifyMeta.mockResolvedValueOnce(verified());
      const created = await svc.create('acme', 7, metaInput());
      const alert = { kind: 'payment' as const, code: 141006, event: null, at: '2026-11-08T10:00:00.000Z' };
      await db.addWhatsAppAccountAlert(created.id, alert);
      expect((await svc.get('acme', created.id)).alerts).toEqual([alert]);
    });

    it("liste et lecture : propres à l'organisation ; agent IA branché lu dans l'organisation", async () => {
      const created = await svc.create('acme', 7, metaInput());
      await db.upsertBotRecord(bot('acme', 'ventes', 'draft', 'Ventes'));
      await db.assignNumber('acme', 'ventes', created.numbers[0]!.id, UNCHECKED);
      expect((await svc.list('acme')).map((a) => a.id)).toEqual([created.id]);
      expect(await svc.list('beta')).toEqual([]);
      expect((await svc.get('acme', created.id)).numbers[0]!.bot).toEqual({ bot_id: 'ventes', name: 'Ventes', status: 'draft', status_reason: null, not_responding: null });
      const err = await caught(svc.get('beta', created.id));
      expect(err.status).toBe(404);
      expect(err.message).toBe('Compte WhatsApp introuvable.');
    });
  });

    // nav 15.1 : Connexions affiche la mention et le motif de pause de l'agent IA branché, calculés par le moteur.
    it("vue d'un numéro : status_reason et not_responding de l'agent IA branché", async () => {
      providers.verifyMeta.mockResolvedValueOnce(verified({ numbers: [num(1), num(2)] }));
      const created = await svc.create('acme', 7, metaInput());
      const [n1, n2] = created.numbers;
      await db.upsertBotRecord(bot('acme', 'ventes', 'limited', 'Ventes'));
      expect((await db.replaceAllowlist('acme', 'ventes', ['+33600000001'])).ok).toBe(true);
      expect((await db.assignNumber('acme', 'ventes', n1!.id, UNCHECKED)).ok).toBe(true);
      await db.upsertBotRecord(bot('acme', 'accueil', 'active', 'Accueil'));
      expect((await db.assignNumber('acme', 'accueil', n2!.id, UNCHECKED)).ok).toBe(true);
      const botOf = async (id: number) => (await svc.get('acme', created.id)).numbers.find((n) => n.id === id)!.bot;

      expect(await botOf(n1!.id)).toEqual({ bot_id: 'ventes', name: 'Ventes', status: 'limited', status_reason: null, not_responding: null });
      expect((await db.replaceAllowlist('acme', 'ventes', [])).ok).toBe(true);
      expect(await botOf(n1!.id)).toMatchObject({ status: 'limited', not_responding: 'empty_allowlist' });

      // Compte en erreur : chaque agent IA en service branché sur un numéro du compte porte la mention, aussi dans la liste.
      await db.setWhatsAppAccountError(created.id, 'token_invalid', 'Jeton refusé');
      expect(await botOf(n2!.id)).toMatchObject({ status: 'active', not_responding: 'account_not_connected' });
      expect((await svc.list('acme'))[0]!.numbers.map((n) => n.bot?.not_responding)).toEqual(['account_not_connected', 'account_not_connected']);

      // Numéro retiré par l'admin : l'agent IA passe Offline avec son motif ; Offline ne porte jamais la mention.
      await db.markWhatsAppAccountVerified(created.id, { token_expiry: null, verified_at: new Date().toISOString() });
      providers.listMeta.mockResolvedValueOnce(listing([num(1)]));
      await svc.refreshNumbers('acme', created.id, 7, ADMIN_INVENTORY);
      expect(await botOf(n2!.id)).toEqual({ bot_id: 'accueil', name: 'Accueil', status: 'paused', status_reason: 'number_removed', not_responding: null });
    });

  describe('inventaire, renommage, marquage, déconnexion', () => {
    it("rafraîchir les numéros : bilan sans détail, audit, compte d'une autre organisation : 404 sans appel", async () => {
      const created = await svc.create('acme', 7, metaInput());
      providers.listMeta.mockResolvedValueOnce(listing([num(2)]));
      const refreshed = await svc.refreshNumbers('acme', created.id, 7);
      expect(refreshed.inventory).toEqual({ added: 1, removed: 1, refused: 0, skipped_sandbox: 0, skipped_invalid: 0 });
      expect(refreshed.numbers.map((n) => [n.phone_e164, n.provider_state])).toEqual([['+33100000001', 'removed'], ['+33100000002', 'present']]);
      expect(providers.listMeta).toHaveBeenCalledWith({ waba_id: '1111111111', access_token: ACME_TOKEN, app_secret: ACME_SECRET });
      const audit = (await db.listAuditLog('acme')).find((a) => a.action === 'whatsapp_account.refresh');
      expect(audit?.metadata).toEqual({ added: 1, removed: 1, refused: 0 });

      providers.listMeta.mockClear();
      expect((await caught(svc.refreshNumbers('beta', created.id, 8))).status).toBe(404);
      expect(providers.listMeta).not.toHaveBeenCalled();
    });

    // revue 2b-2 I-1 (décision 2)
    it("rafraîchissement sur événement du fournisseur : ne reprend jamais le numéro d'un compte en erreur ; l'admin le reprend", async () => {
      const acme = await svc.create('acme', 7, metaInput());
      await db.upsertBotRecord(bot('acme', 'ventes-acme', 'active', 'Ventes Acme'));
      expect((await db.assignNumber('acme', 'ventes-acme', acme.numbers[0]!.id, UNCHECKED)).ok).toBe(true);
      await db.setWhatsAppAccountError(acme.id, 'token_invalid', 'Jeton refusé');
      providers.verifyMeta.mockResolvedValueOnce(verified({ waba_id: '3333333333', meta_app_id: 'app-beta', numbers: [num(2)] }));
      const beta = await svc.create('beta', 8, {
        mode: 'meta_manual', name: 'Compte Beta', waba_id: '3333333333', access_token: BETA_TOKEN, app_secret: BETA_SECRET,
      });
      providers.listMeta.mockResolvedValue(listing([num(1), num(2)]));

      for (const refresh of [() => svc.refreshOnProviderEvent('beta', beta.id), () => svc.refreshNumbers('beta', beta.id, null)]) {
        expect((await refresh()).inventory).toMatchObject({ added: 0, removed: 0, refused: 1 });
        expect((await db.getBotRecord('acme', 'ventes-acme'))!.status).toBe('active');
        expect((await db.getWhatsAppNumber('acme', acme.numbers[0]!.id))!.provider_state).toBe('present');
      }

      const byAdmin = await svc.refreshNumbers('beta', beta.id, 8, ADMIN_INVENTORY);
      expect(byAdmin.inventory).toMatchObject({ added: 1, refused: 0 });
      expect((await db.getBotRecord('acme', 'ventes-acme'))!.status).toBe('paused');
    });

    // revue 2b-2 M-3
    it("inventaire vide du fournisseur sur un compte qui a des numéros : rien retiré, ni pause, message clair (admin, événement, remplacement)", async () => {
      const created = await svc.create('acme', 7, metaInput());
      await db.upsertBotRecord(bot('acme', 'ventes', 'active', 'Ventes'));
      expect((await db.assignNumber('acme', 'ventes', created.numbers[0]!.id, UNCHECKED)).ok).toBe(true);
      const auditsBefore = await db.listAuditLog('acme');
      providers.listMeta.mockResolvedValue(listing([]));
      const EMPTY = "Le fournisseur n'a renvoyé aucun numéro : rien n'a été retiré.";

      for (const refresh of [() => svc.refreshNumbers('acme', created.id, 7, ADMIN_INVENTORY), () => svc.refreshOnProviderEvent('acme', created.id)]) {
        const err = await caught(refresh());
        expect([err.code, err.status, err.message, err.details]).toEqual(['WA_VALIDATION_FAILED', 422, EMPTY, [{ path: 'numbers', message: EMPTY }]]);
        expect(err.reason).toBe('whatsapp_account.empty_inventory');
      }
      expect(await db.listAuditLog('acme')).toEqual(auditsBefore);
      expect((await db.listWhatsAppNumbers('acme', created.id)).map((n) => n.provider_state)).toEqual(['present']);
      expect((await db.getBotRecord('acme', 'ventes'))!.status).toBe('active');

      // Remplacement des identifiants : les secrets sont remplacés, l'inventaire vide n'est pas appliqué et le dit.
      providers.verifyMeta.mockResolvedValueOnce(verified({ numbers: [] }));
      const replaced = await svc.replaceCredentials('acme', created.id, 7, {
        mode: 'meta_manual', waba_id: '1111111111', access_token: 'EAAG-nouveau-jeton-0123456789', app_secret: 'nouveau-secret-0123456789',
      });
      expect(replaced.inventory).toMatchObject({ added: 0, removed: 0 });
      expect(replaced.checks).toContainEqual({ key: 'numbers', status: 'pending', detail: EMPTY });
      expect(replaced.numbers.map((n) => n.provider_state)).toEqual(['present']);
      expect((await db.getBotRecord('acme', 'ventes'))!.status).toBe('active');
    });

    it("rafraîchir : jeton refusé par le fournisseur : 422, compte en erreur token_invalid, inventaire inchangé", async () => {
      const created = await svc.create('acme', 7, metaInput());
      providers.listMeta.mockResolvedValueOnce({ numbers: [], skipped: { sandbox: 0, invalid_number: 0 }, error: { reason: 'token_invalid', message: 'Jeton refusé par Meta' } });
      const err = await caught(svc.refreshNumbers('acme', created.id, 7));
      expect(err.code).toBe('WA_VALIDATION_FAILED');
      expect(await svc.get('acme', created.id)).toMatchObject({ state: 'error', error_reason: 'token_invalid' });
      expect((await db.listWhatsAppNumbers('acme', created.id)).map((n) => n.provider_state)).toEqual(['present']);
    });

    it("renommer : propre à l'organisation, audité", async () => {
      const created = await svc.create('acme', 7, metaInput());
      expect((await svc.rename('acme', created.id, 7, 'Nouveau nom')).name).toBe('Nouveau nom');
      expect((await caught(svc.rename('beta', created.id, 8, 'Volé'))).status).toBe(404);
      expect((await db.getWhatsAppAccount('acme', created.id))!.name).toBe('Nouveau nom');
      expect((await db.listAuditLog('acme')).map((a) => a.action)).toContain('whatsapp_account.rename');
    });

    it("marquage « numéro de test » : numéro d'un autre compte ou d'une autre organisation : 404 ; audité", async () => {
      const created = await svc.create('acme', 7, metaInput());
      const numberId = created.numbers[0]!.id;
      const view = await svc.setNumberTestFlag('acme', created.id, numberId, 7, true);
      expect(view.numbers[0]!.is_test).toBe(true);
      const audit = (await db.listAuditLog('acme')).find((a) => a.action === 'whatsapp_number.test_flag');
      expect(audit?.metadata).toEqual({ number_id: numberId, is_test: true });

      providers.verifyMeta.mockResolvedValueOnce(verified({ waba_id: '3333333333', meta_app_id: 'app-beta', numbers: [num(3)] }));
      const beta = await svc.create('beta', 8, {
        mode: 'meta_manual', name: 'Compte Beta', waba_id: '3333333333', access_token: BETA_TOKEN, app_secret: BETA_SECRET,
      });
      const crossOrg = await caught(svc.setNumberTestFlag('beta', beta.id, numberId, 8, false));
      expect(crossOrg.status).toBe(404);
      expect(crossOrg.message).toBe('Numéro WhatsApp introuvable.');
      expect(crossOrg.reason).toBe('whatsapp_account.number_not_found');
      expect((await caught(svc.setNumberTestFlag('beta', created.id, numberId, 8, false))).status).toBe(404);
      expect((await db.getWhatsAppNumber('acme', numberId))!.is_test).toBe(true);
    });

    it("déconnexion refusée tant qu'un agent IA en accès limité l'utilise, puis acceptée : webhook vidé, numéros libérés", async () => {
      const created = await svc.create('acme', 7, metaInput());
      await db.upsertBotRecord(bot('acme', 'ventes', 'draft', 'Ventes'));
      await db.replaceAllowlist('acme', 'ventes', ['+33600000001']);
      expect((await db.activateWithNumber('acme', 'ventes', created.numbers[0]!.id, 'limited', null, UNCHECKED)).ok).toBe(true);

      const err = await caught(svc.disconnect('acme', created.id, 7));
      expect(err.status).toBe(409);
      expect(err.message).toBe("Mettez d'abord Offline les agents IA qui utilisent ce compte :");
      expect(err.reason).toBe('whatsapp_account.in_use');
      expect(err.details).toEqual([{ path: 'bots.ventes', message: 'Ventes' }]);

      await db.transitionBotStatus('acme', 'ventes', 'draft');
      const account = (await db.getWhatsAppAccount('acme', created.id))!;
      const number = (await db.listWhatsAppNumbers('acme', created.id))[0]!;
      expect(getTransportForNumber(account, number)).not.toBeNull();
      await svc.disconnect('acme', created.id, 7);
      const view = await svc.get('acme', created.id);
      expect(view).toMatchObject({ state: 'disconnected', numbers: [] });
      expect(view).not.toHaveProperty('webhook');
      // Lot R1 : la route du webhook ne sert jamais un compte Meta ; le compte retiré n'a plus de clé d'URL.
      expect((await caught(svc.getWebhook('acme', created.id))).status).toBe(404);
      expect((await db.getWhatsAppAccount('acme', created.id))!.webhook_key_hash).toBeNull();
      expect((await caught(svc.getWebhook('beta', created.id))).status).toBe(404);
      expect((await db.listAuditLog('acme')).map((a) => a.action)).toContain('whatsapp_account.disconnect');
      expect((await caught(svc.disconnect('beta', created.id, 8))).status).toBe(404);
    });

    it('un compte déconnecté ne se vérifie, ne se rafraîchit ni ne se remplace plus', async () => {
      const created = await svc.create('acme', 7, metaInput());
      await svc.disconnect('acme', created.id, 7);
      providers.verifyMeta.mockClear();
      const reasons = [
        await caught(svc.verify('acme', created.id, 7)),
        await caught(svc.refreshNumbers('acme', created.id, 7)),
        await caught(svc.replaceCredentials('acme', created.id, 7, {
          mode: 'meta_manual', waba_id: '1111111111', access_token: ACME_TOKEN, app_secret: ACME_SECRET,
        })),
      ];
      expect(reasons.map((e) => [e.status, e.reason])).toEqual(Array(3).fill([409, 'whatsapp_account.disconnected']));
      // recette Q-5, vocabulaire C-1 : le compte est « retiré », jamais « déconnecté » (confondu avec la session) ; spec navigation 6.4 : plus de « de WABAGENT »
      expect(reasons.map((e) => e.message)).toEqual(Array(3).fill('Ce compte WhatsApp a été retiré : raccordez un nouveau compte.'));
      expect(providers.verifyMeta).not.toHaveBeenCalled();
      expect(providers.listMeta).not.toHaveBeenCalled();
    });
  });

  describe('déconnexion : webhooks chez Meta (lot R1, spec R1 §5.5)', () => {
    const SECOND_SECRET = 'acme-second-secret-0123456789';

    /** Second compte d'acme sur la même app (app-1), avec son propre secret d'app. */
    async function secondAcmeAccount() {
      providers.verifyMeta.mockResolvedValueOnce(verified({ waba_id: '4444444444', numbers: [num(4)] }));
      return svc.create('acme', 7, metaInput({ name: 'Second', waba_id: '4444444444', app_secret: SECOND_SECRET }));
    }

    async function betaAccount() {
      providers.verifyMeta.mockResolvedValueOnce(verified({ waba_id: '3333333333', meta_app_id: 'app-beta', numbers: [num(2)] }));
      return svc.create('beta', 8, { mode: 'meta_manual', name: 'Compte Beta', waba_id: '3333333333', access_token: BETA_TOKEN, app_secret: BETA_SECRET });
    }

    function metaSecretsOf(record: Parameters<typeof decryptAccountSecrets>[0]) {
      const s = decryptAccountSecrets(record);
      if (s === null || s.mode !== 'meta_manual') throw new Error('[Test] secrets Meta attendus');
      return s;
    }

    it("déconnexion : retrait de l'override sur la WABA du compte seulement", async () => {
      // spec R1 §8 : « Retrait à la déconnexion appliqué à la WABA d'une autre organisation »
      const acme = await svc.create('acme', 7, metaInput());
      await betaAccount();
      const betaOverride = metaWebhooks.overrides.get('3333333333');
      expect(betaOverride).toBeDefined();
      metaWebhooks.clearCalls();

      const result = await svc.disconnect('acme', acme.id, 7);

      expect(result).toEqual({ waba_cleanup: 'done', app_webhook: 'left' });
      const clears = metaWebhooks.calls.filter((c) => c.op === 'clearWabaOverride');
      expect(clears.map((c) => [c.target, c.credential])).toEqual([['1111111111', ACME_TOKEN]]);
      expect(metaWebhooks.calls.filter((c) => c.credential === BETA_TOKEN || c.credential === BETA_SECRET)).toEqual([]);
      expect(metaWebhooks.calls.filter((c) => c.target === '3333333333' || c.target === 'app-beta')).toEqual([]);
      expect(metaWebhooks.overrides.has('1111111111')).toBe(false);
      expect(metaWebhooks.overrides.get('3333333333')).toBe(betaOverride);
      expect((await db.getWhatsAppAccount('acme', acme.id))!.state).toBe('disconnected');
      const audit = (await db.listAuditLog('acme')).find((a) => a.action === 'whatsapp_account.disconnect')!;
      expect(audit.metadata).toEqual({ waba_cleanup: 'done', app_webhook: 'left' });
    });

    it("déconnexion : webhook de l'app repointé sur l'autre compte de la même app", async () => {
      // spec R1 §8 : « Le webhook de l'app pointe vers un compte d'une autre organisation »
      const first = await svc.create('acme', 7, metaInput());
      const firstUrl = metaWebhooks.appWebhooks.get('app-1');
      // Compte de beta créé entre les deux comptes d'acme : un « premier autre compte » pris hors de l'organisation
      // ou hors de l'app tomberait sur lui.
      await betaAccount();
      const second = await secondAcmeAccount();
      expect(metaWebhooks.appWebhooks.get('app-1')).toBe(firstUrl);
      const secondRecord = (await db.getWhatsAppAccount('acme', second.id))!;
      const secondSecrets = metaSecretsOf(secondRecord);
      await db.setWhatsAppAccountWebhookState('acme', second.id, { waba: 'ok', app: 'failed', app_host: null, checked_at: null });
      metaWebhooks.clearCalls();

      const result = await svc.disconnect('acme', first.id, 7);

      // relecture finale R1 FR-M7 : le bilan nomme le compte qui reçoit désormais le webhook de l'app (même organisation).
      expect(result).toEqual({ waba_cleanup: 'done', app_webhook: 'repointed', repointed_to: 'Second' });
      // Lu avec le secret du compte retiré, réécrit avec le secret du compte qui prend le relais.
      expect(metaWebhooks.calls.find((c) => c.op === 'readAppWebhook')).toMatchObject({ target: 'app-1', credential: ACME_SECRET });
      const appWrites = metaWebhooks.writes().filter((c) => c.op === 'setAppWebhook');
      expect(appWrites).toHaveLength(1);
      expect(appWrites[0]).toMatchObject({ target: 'app-1', credential: SECOND_SECRET, verify_token: secondSecrets.verify_token });
      expect(hashWebhookKey(keyOfMetaUrl(appWrites[0]!.url!))).toBe(secondRecord.webhook_key_hash);
      expect(appWrites[0]!.url).toBe(`${BASE_URL}/webhook/meta/${secondSecrets.webhook_key}`);
      expect(metaWebhooks.calls.filter((c) => c.credential === BETA_TOKEN || c.credential === BETA_SECRET)).toEqual([]);
      expect(metaWebhooks.appWebhooks.get('app-1')).toBe(appWrites[0]!.url);
      expect((await svc.get('acme', second.id)).webhooks).toMatchObject({ app: 'ok' });
      // Aucune vérification attendue ne reste après l'écriture.
      expect(pendingVerificationKeysForTests()).toEqual([]);
    });

    // revue R1 ISO-I1 : le compte choisi pour reprendre le webhook de l'app est relu juste avant l'écriture.
    it("déconnexion : compte choisi pour le repointage retiré avant l'écriture, aucun setAppWebhook", async () => {
      const first = await svc.create('acme', 7, metaInput());
      const second = await secondAcmeAccount();
      metaWebhooks.clearCalls();
      const read = metaWebhooks.readAppWebhook.getMockImplementation()!;
      let calls = 0;
      metaWebhooks.readAppWebhook.mockImplementation(async (app) => {
        calls += 1;
        // Seconde lecture : celle de la règle appliquée au compte choisi ; il est retiré entre-temps.
        if (calls === 2) expect(await db.disconnectWhatsAppAccount('acme', second.id)).toEqual({ ok: true });
        return read(app);
      });

      const result = await svc.disconnect('acme', first.id, 7);

      expect(calls).toBe(2);
      expect(result.app_webhook).toBe('left');
      expect(metaWebhooks.calls.filter((c) => c.op === 'setAppWebhook')).toEqual([]);
      expect(pendingVerificationKeysForTests()).toEqual([]);
    });

    // revue R1 ISO-M4 : seul le filtre par organisation écarte ce compte de beta (même app, connecté, inséré directement :
    // le choix 3 le rend impossible en régime normal).
    it("déconnexion : compte connecté de beta sur la même app, jamais choisi pour le repointage", async () => {
      const first = await svc.create('acme', 7, metaInput());
      const encrypted = encryptAccountSecrets({ mode: 'meta_manual', access_token: BETA_TOKEN, app_secret: BETA_SECRET, verify_token: 'v'.repeat(32), webhook_key: 'b'.repeat(43) });
      const betaSameApp = await db.insertWhatsAppAccount({
        client_id: 'beta', name: 'Beta même app', mode: 'meta_manual', provider_account_id: '3333333333', waba_id: '3333333333', meta_app_id: 'app-1',
        ...encrypted, webhook_key_hash: hashWebhookKey('b'.repeat(43)), token_expiry: null, last_verified_at: null,
      });
      expect(betaSameApp.state).toBe('connected');
      metaWebhooks.clearCalls();

      const result = await svc.disconnect('acme', first.id, 7);

      expect(result).toEqual({ waba_cleanup: 'done', app_webhook: 'left' });
      expect(metaWebhooks.calls.filter((c) => c.op === 'setAppWebhook')).toEqual([]);
      expect(metaWebhooks.calls.filter((c) => c.credential === BETA_TOKEN || c.credential === BETA_SECRET)).toEqual([]);
      expect((await db.getWhatsAppAccount('beta', betaSameApp.id))!.webhook_state).toBeNull();
    });

    it("déconnexion : dernier compte de l'app, webhook laissé, app_webhook = left", async () => {
      const created = await svc.create('acme', 7, metaInput());
      const appUrl = metaWebhooks.appWebhooks.get('app-1');
      metaWebhooks.clearCalls();
      const result = await svc.disconnect('acme', created.id, 7);
      expect(result).toEqual({ waba_cleanup: 'done', app_webhook: 'left' });
      expect(metaWebhooks.writes().map((c) => c.op)).toEqual(['clearWabaOverride']);
      expect(metaWebhooks.appWebhooks.get('app-1')).toBe(appUrl);
    });

    it("déconnexion : webhook de l'app qui ne pointe pas vers ce compte, laissé, app_webhook = not_applicable", async () => {
      metaWebhooks.appWebhooks.set('app-1', 'https://autre-produit.example.com/hooks/chemin-secret-du-client');
      const created = await svc.create('acme', 7, metaInput());
      await secondAcmeAccount();
      metaWebhooks.clearCalls();
      const result = await svc.disconnect('acme', created.id, 7);
      expect(result).toEqual({ waba_cleanup: 'done', app_webhook: 'not_applicable' });
      expect(metaWebhooks.writes().map((c) => c.op)).toEqual(['clearWabaOverride']);
      expect(metaWebhooks.appWebhooks.get('app-1')).toBe('https://autre-produit.example.com/hooks/chemin-secret-du-client');
    });

    it("déconnexion : repointage refusé par Meta, webhook laissé, app_webhook = left", async () => {
      const first = await svc.create('acme', 7, metaInput());
      await secondAcmeAccount();
      metaWebhooks.setAppWebhook.mockResolvedValueOnce({ ok: false, failure: { kind: 'unreachable' } });
      const result = await svc.disconnect('acme', first.id, 7);
      expect(result).toEqual({ waba_cleanup: 'done', app_webhook: 'left' });
      expect((await db.getWhatsAppAccount('acme', first.id))!.state).toBe('disconnected');
    });

    it("déconnexion : webhook de l'app illisible, rien n'est écrit sur l'app, app_webhook = left", async () => {
      const first = await svc.create('acme', 7, metaInput());
      await secondAcmeAccount();
      metaWebhooks.clearCalls();
      metaWebhooks.readAppWebhook.mockResolvedValueOnce({ ok: false, failure: { kind: 'unreachable' } });
      const result = await svc.disconnect('acme', first.id, 7);
      expect(result).toEqual({ waba_cleanup: 'done', app_webhook: 'left' });
      expect(metaWebhooks.writes().map((c) => c.op)).toEqual(['clearWabaOverride']);
    });

    it('Meta injoignable au retrait : compte déconnecté quand même, waba_cleanup = failed', async () => {
      const created = await svc.create('acme', 7, metaInput());
      const key = keyOfMetaUrl(metaWebhooks.overrides.get('1111111111')!);
      const verifyToken = metaWebhooks.calls.find((c) => c.op === 'setWabaOverride')!.verify_token!;
      metaWebhooks.clearWabaOverride.mockResolvedValueOnce({ ok: false, failure: { kind: 'unreachable' } });
      const log = vi.mocked(console.log);
      log.mockClear();

      const result = await svc.disconnect('acme', created.id, 7);

      expect(result).toEqual({ waba_cleanup: 'failed', app_webhook: 'left' });
      const record = (await db.getWhatsAppAccount('acme', created.id))!;
      expect([record.state, record.webhook_key_hash]).toEqual(['disconnected', null]);
      const logs = JSON.stringify(log.mock.calls);
      expect(logs).toContain('retrait');
      for (const secret of [key, verifyToken, ACME_TOKEN, ACME_SECRET, '1111111111', BASE_URL]) expect(logs).not.toContain(secret);

      // Une exception du client Meta a le même effet.
      const other = await secondAcmeAccount();
      metaWebhooks.clearWabaOverride.mockRejectedValueOnce(new Error('panne'));
      expect(await svc.disconnect('acme', other.id, 7)).toEqual({ waba_cleanup: 'failed', app_webhook: 'left' });
      expect((await db.getWhatsAppAccount('acme', other.id))!.state).toBe('disconnected');
    });

    it('compte en usage : refus, aucun appel Meta', async () => {
      const created = await svc.create('acme', 7, metaInput());
      await db.upsertBotRecord(bot('acme', 'ventes', 'draft', 'Ventes'));
      await db.replaceAllowlist('acme', 'ventes', ['+33600000001']);
      expect((await db.activateWithNumber('acme', 'ventes', created.numbers[0]!.id, 'limited', null, UNCHECKED)).ok).toBe(true);
      metaWebhooks.clearCalls();
      const err = await caught(svc.disconnect('acme', created.id, 7));
      expect([err.status, err.reason]).toEqual([409, 'whatsapp_account.in_use']);
      expect(metaWebhooks.calls).toEqual([]);
      expect((await db.getWhatsAppAccount('acme', created.id))!.state).toBe('connected');
      // La réservation de la WABA est libérée : « Vérifier maintenant » écrit de nouveau.
      metaWebhooks.overrides.delete('1111111111');
      const verifiedNow = await svc.verify('acme', created.id, 7);
      expect(verifiedNow.checks.find((c) => c.key === 'webhook_waba')).toEqual({ key: 'webhook_waba', status: 'created' });
    });

    it('CM.com : not_applicable partout, aucun appel Meta ; compte déjà retiré : rien chez Meta', async () => {
      const cm = await svc.create('acme', 7, { mode: 'cm_com', name: 'CM', account_id: CM_ACCOUNT, product_token: CM_TOKEN });
      const meta = await svc.create('acme', 7, metaInput());
      await svc.disconnect('acme', meta.id, 7);
      metaWebhooks.clearCalls();
      expect(await svc.disconnect('acme', cm.id, 7)).toEqual({ waba_cleanup: 'not_applicable', app_webhook: 'not_applicable' });
      expect(await svc.disconnect('acme', meta.id, 7)).toEqual({ waba_cleanup: 'not_applicable', app_webhook: 'not_applicable' });
      expect(metaWebhooks.calls).toEqual([]);
    });

    it('réservation de la WABA tenue pendant le retrait : un raccordement de la même WABA ne peut pas écrire en même temps', async () => {
      const created = await svc.create('acme', 7, metaInput());
      let release!: () => void;
      metaWebhooks.clearWabaOverride.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ ok: true }); }));
      const pending = svc.disconnect('acme', created.id, 7);
      await vi.waitFor(() => expect(metaWebhooks.clearWabaOverride).toHaveBeenCalled());
      metaWebhooks.clearCalls();
      const err = await caught(svc.create('acme', 7, metaInput({ name: 'Nouveau' })));
      expect(err.reason).toBe('whatsapp_account.already_connected');
      expect(metaWebhooks.writes()).toEqual([]);
      release();
      expect(await pending).toEqual({ waba_cleanup: 'done', app_webhook: 'left' });
      // Réservation libérée : le nouveau raccordement passe.
      expect((await svc.create('acme', 7, metaInput({ name: 'Nouveau' }))).state).toBe('connected');
    });

    it('GET webhook d\'un compte Meta : 404 ; CM.com inchangé', async () => {
      const meta = await svc.create('acme', 7, metaInput());
      const cm = await svc.create('acme', 7, { mode: 'cm_com', name: 'CM', account_id: CM_ACCOUNT, product_token: CM_TOKEN });
      const err = await caught(svc.getWebhook('acme', meta.id));
      expect([err.status, err.reason, err.message]).toEqual([404, 'whatsapp_account.not_found', 'Compte WhatsApp introuvable.']);
      expect((await svc.getWebhook('acme', cm.id)).path).toMatch(/^\/webhook\/cm-com\//);
      await svc.disconnect('acme', meta.id, 7);
      expect((await caught(svc.getWebhook('acme', meta.id))).status).toBe(404);
    });
  });

  // revue 2b-2 I-1, M-5 : un compte du fournisseur (WABA ou accountId CM.com) n'est raccordé qu'une fois sur la plateforme.
  describe('compte du fournisseur déjà raccordé', () => {
    const betaOnAcmeWaba = { mode: 'meta_manual' as const, name: 'Compte Beta', waba_id: '1111111111', access_token: BETA_TOKEN, app_secret: BETA_SECRET };
    const CANNOT = 'Ce compte ne peut pas être raccordé. Contactez le support.';

    /** Les deux vérifications se répondent seulement quand les deux ont commencé : les deux lectures préalables sont passées. */
    function bothVerificationsInFlight(appOf: (c: { waba_id: string; access_token: string }) => string): void {
      let waiting: Array<() => void> = [];
      providers.verifyMeta.mockImplementation(async (c) => {
        await new Promise<void>((resolve) => {
          waiting.push(resolve);
          if (waiting.length === 2) { for (const r of waiting) r(); waiting = []; }
        });
        return verified({ waba_id: c.waba_id, meta_app_id: appOf(c), numbers: [] });
      });
    }

    const BAD_TOKEN = 'EAAG-jeton-refuse-0123456789abcdef';
    /**
     * Graph simulé pour le vrai client Meta (vérification et inscription des webhooks) : jeton refusé (190) pour
     * BAD_TOKEN, sinon lectures réussies, app non abonnée au départ. Un POST `subscribed_apps` abonne l'app du jeton
     * avec son adresse (relue ensuite), un POST `subscriptions` inscrit le webhook de l'app. Les POST reçus sont relevés.
     */
    function fakeGraph(): { posts: string[]; fetchImpl: typeof fetch } {
      const posts: string[] = [];
      const overrides = new Map<string, { app: string; url: string }>();
      const reply = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status });
      const fetchImpl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        const token = new Headers(init?.headers).get('Authorization')?.replace('Bearer ', '') ?? '';
        const appOfToken = token === ACME_TOKEN ? 'app-1' : 'app-beta';
        if (token === BAD_TOKEN) return reply(401, { error: { message: 'Invalid OAuth access token', code: 190 } });
        if ((init?.method ?? 'GET') === 'POST') {
          posts.push(url.pathname);
          const override = url.searchParams.get('override_callback_uri');
          if (url.pathname.endsWith('/subscribed_apps') && override !== null) overrides.set(url.pathname, { app: appOfToken, url: override });
          return reply(200, { success: true });
        }
        if (url.pathname.endsWith('/debug_token')) return reply(200, { data: { app_id: appOfToken, is_valid: true, expires_at: 0 } });
        if (url.pathname.endsWith('/subscribed_apps')) {
          const held = overrides.get(url.pathname);
          return reply(200, { data: held ? [{ whatsapp_business_api_data: { id: held.app }, override_callback_uri: held.url }] : [] });
        }
        if (url.pathname.endsWith('/subscriptions')) return reply(200, { data: [] });
        if (url.pathname.endsWith('/phone_numbers')) return reply(200, { data: [] });
        return reply(200, { id: 'waba', name: 'Compte' });
      }) as typeof fetch;
      return { posts, fetchImpl };
    }

    /** Vrai client Meta (vérification et inscription des webhooks) sur le Graph simulé ; rend les POST reçus. */
    function useRealMetaClient(): string[] {
      const graph = fakeGraph();
      providers.verifyMeta.mockImplementation((c) => verifyMetaManual(c, { fetchImpl: graph.fetchImpl }));
      providers.metaWebhooks = createMetaWebhookClient({ fetchImpl: graph.fetchImpl });
      return graph.posts;
    }

    // revue 2b-2 I-1 ; spec R1 §8 : WABA tenue par une autre organisation, aucune écriture chez Meta (vrai client injecté)
    it.each(['connected', 'error'] as const)(
      "beta raccorde avec des identifiants valides la WABA d'acme (compte d'acme %s) : 409 neutre, aucun POST chez Meta, rien écrit",
      async (state) => {
        const acme = await svc.create('acme', 7, metaInput());
        if (state === 'error') await db.setWhatsAppAccountError(acme.id, 'token_invalid', 'Jeton refusé');
        const posts = useRealMetaClient();
        providers.verifyMeta.mockClear();
        providers.listMeta.mockClear();
        const err = await caught(svc.create('beta', 8, betaOnAcmeWaba));
        expect([err.status, err.message]).toEqual([409, CANNOT]);
        expect(JSON.stringify({ message: err.message, details: err.details ?? null })).not.toContain('acme');
        expect(providers.verifyMeta).toHaveBeenCalledTimes(1);
        expect(posts).toEqual([]);
        expect(providers.listMeta).not.toHaveBeenCalled();
        expect(await db.listWhatsAppAccounts('beta')).toEqual([]);
        expect(await db.listAuditLog('beta')).toEqual([]);
        expect((await db.getWhatsAppAccount('acme', acme.id))!.state).toBe(state);
      },
    );

    // revue 2b-2 I-1 (re-revue) : aucun oracle d'existence avant la preuve d'accès.
    it("jeton refusé : même réponse 422 sur la WABA tenue par acme que sur une WABA libre ; WABA libre et identifiants valides : aucun POST (la vérification est en lecture seule)", async () => {
      await svc.create('acme', 7, metaInput());
      const posts = useRealMetaClient();
      const answer = async (wabaId: string) => {
        const err = await caught(svc.create('beta', 8, { ...betaOnAcmeWaba, waba_id: wabaId, access_token: BAD_TOKEN }));
        return [err.status, err.code, err.message, err.details];
      };
      const onHeld = await answer('1111111111');
      expect(onHeld[0]).toBe(422);
      expect(onHeld).toEqual(await answer('5555555555'));
      expect(posts).toEqual([]);
      // Lot R1 : la vérification reste en lecture seule ; seule l'inscription du raccordement réussi écrit chez Meta,
      // sur la WABA et l'app de la requête.
      expect((await svc.create('beta', 8, { ...betaOnAcmeWaba, waba_id: '5555555555' })).state).toBe('connected');
      expect(posts).toEqual(['/v26.0/5555555555/subscribed_apps', '/v26.0/app-beta/subscriptions']);
    });

    // revue 2b-2 I-1
    it("CM.com : accountId d'acme (casse différente) avec des identifiants valides de beta : 409 neutre après vérification ; jeton refusé : même 422 que sur un compte libre", async () => {
      await svc.create('acme', 7, { mode: 'cm_com', name: 'CM', account_id: CM_ACCOUNT, product_token: CM_TOKEN });
      providers.verifyCm.mockClear();
      const betaCm = { mode: 'cm_com' as const, name: 'CM Beta', account_id: CM_ACCOUNT.toUpperCase(), product_token: 'cm-beta-token-0123456789' };
      const err = await caught(svc.create('beta', 8, betaCm));
      expect([err.status, err.message]).toEqual([409, CANNOT]);
      expect(providers.verifyCm).toHaveBeenCalledTimes(1);
      expect(await db.listWhatsAppAccounts('beta')).toEqual([]);

      const refused: ProviderVerification = {
        ok: false, error_reason: 'token_invalid', message: 'Jeton CM.com refusé', checks: [{ key: 'cm_account', status: 'failed', detail: 'Jeton CM.com refusé' }],
      };
      providers.verifyCm.mockResolvedValue(refused);
      const onHeld = await caught(svc.create('beta', 8, betaCm));
      const onFree = await caught(svc.create('beta', 8, { ...betaCm, account_id: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f' }));
      expect([onHeld.status, onHeld.code, onHeld.message, onHeld.details]).toEqual([onFree.status, onFree.code, onFree.message, onFree.details]);
      expect(onHeld.status).toBe(422);
    });

    // revue 2b-2 I-1
    it("WABA d'acme déconnectée : beta peut la raccorder", async () => {
      const acme = await svc.create('acme', 7, metaInput());
      await svc.disconnect('acme', acme.id, 7);
      providers.verifyMeta.mockResolvedValueOnce(verified({ meta_app_id: 'app-beta' }));
      expect((await svc.create('beta', 8, betaOnAcmeWaba)).state).toBe('connected');
    });

    // revue 2b-2 I-1
    it("deux raccordements simultanés de la même WABA par deux organisations (apps différentes) : un seul réussit, l'autre 409 neutre", async () => {
      bothVerificationsInFlight((c) => (c.access_token === ACME_TOKEN ? 'app-acme' : 'app-beta'));
      const results = await Promise.allSettled([svc.create('acme', 7, metaInput()), svc.create('beta', 8, betaOnAcmeWaba)]);
      expect(providers.verifyMeta).toHaveBeenCalledTimes(2);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected.map((r) => [(r.reason as AppError).status, (r.reason as AppError).message])).toEqual([[409, CANNOT]]);
      const held = [...await db.listWhatsAppAccounts('acme'), ...await db.listWhatsAppAccounts('beta')]
        .filter((a) => a.provider_account_id === '1111111111' && a.state !== 'disconnected');
      expect(held).toHaveLength(1);
      // Lot R1 : le perdant est refusé avant d'écrire chez Meta, il ne retire jamais l'adresse du gagnant.
      expect(metaWebhooks.writes().filter((c) => c.target === '1111111111').map((c) => c.op)).toEqual(['setWabaOverride']);
    });

    // revue 2b-2 M-5
    it("double raccordement simultané de la même WABA dans une organisation : un seul compte, l'autre 409 « déjà raccordé »", async () => {
      bothVerificationsInFlight(() => 'app-1');
      const results = await Promise.allSettled([svc.create('acme', 7, metaInput()), svc.create('acme', 7, metaInput({ name: 'Doublon' }))]);
      expect(providers.verifyMeta).toHaveBeenCalledTimes(2);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected.map((r) => [(r.reason as AppError).status, (r.reason as AppError).message])).toEqual([[409, 'Ce compte WhatsApp est déjà raccordé.']]);
      expect(await db.listWhatsAppAccounts('acme')).toHaveLength(1);
      expect(metaWebhooks.writes().filter((c) => c.target === '1111111111').map((c) => c.op)).toEqual(['setWabaOverride']);
    });
  });

  // audit R-15 : chaque refus du service porte sa clé stable, le texte reste celui du moteur
  describe('clés de refus (error.reason)', () => {
    const NEW_CREDENTIALS = {
      mode: 'meta_manual', waba_id: '1111111111', access_token: 'EAAG-nouveau-jeton-0123456789', app_secret: 'nouveau-secret-0123456789',
    } as const;

    it('vérification refusée à la création : whatsapp_account.verification_failed', async () => {
      providers.verifyMeta.mockResolvedValueOnce(refusedToken());
      expect((await caught(svc.create('acme', 7, metaInput()))).reason).toBe('whatsapp_account.verification_failed');
    });

    it('app du jeton illisible : whatsapp_account.app_unreadable', async () => {
      providers.verifyMeta.mockResolvedValueOnce(verified({ meta_app_id: null }));
      expect((await caught(svc.create('acme', 7, metaInput()))).reason).toBe('whatsapp_account.app_unreadable');
    });

    // audit décisions B7 : la clé dit la cause, l'écran ne dit « Réessayez » que pour une panne passagère
    it('lecture des numéros : jeton refusé (listing_token_invalid, compte en erreur), panne passagère (listing_unavailable, compte inchangé), autre (listing_failed)', async () => {
      const created = await svc.create('acme', 7, metaInput());
      const empty = { numbers: [], skipped: { sandbox: 0, invalid_number: 0 } };
      providers.listMeta.mockResolvedValueOnce({ ...empty, error: { reason: 'other', message: 'Meta injoignable', transient: true } });
      const unavailable = await caught(svc.refreshNumbers('acme', created.id, 7));
      expect([unavailable.status, unavailable.reason]).toEqual([422, 'whatsapp_account.listing_unavailable']);
      expect(unavailable.details).toEqual([{ path: 'numbers', message: 'Meta injoignable' }]);
      expect((await svc.get('acme', created.id)).state).toBe('connected');

      providers.listMeta.mockResolvedValueOnce({ ...empty, error: { reason: 'other', message: 'Liste de numéros illisible' } });
      const other = await caught(svc.refreshNumbers('acme', created.id, 7));
      expect([other.status, other.reason]).toEqual([422, 'whatsapp_account.listing_failed']);
      expect((await svc.get('acme', created.id)).state).toBe('connected');

      providers.listMeta.mockResolvedValueOnce({ ...empty, error: { reason: 'token_invalid', message: 'Jeton refusé par Meta' } });
      const refused = await caught(svc.refreshNumbers('acme', created.id, 7));
      expect([refused.status, refused.reason]).toEqual([422, 'whatsapp_account.listing_token_invalid']);
      expect(await svc.get('acme', created.id)).toMatchObject({ state: 'error', error_reason: 'token_invalid', error_cause: 'credentials' });
    });

    // audit décisions A23 : le refus dit la suite exacte, « retirez le compte puis raccordez-le de nouveau » (menu « Retirer le compte », spec navigation 6.4)
    it('identifiants enregistrés illisibles : whatsapp_account.secrets_unreadable au remplacement et au rafraîchissement', async () => {
      const created = await svc.create('acme', 7, metaInput());
      expect(await db.replaceWhatsAppAccountSecrets('acme', created.id, {
        secret_encrypted: 'illisible', key_version: 1, waba_id: '1111111111', meta_app_id: 'app-1111111111', token_expiry: null,
        verified_at: new Date().toISOString(),
      })).toEqual({ ok: true });
      const replace = await caught(svc.replaceCredentials('acme', created.id, 7, NEW_CREDENTIALS));
      const refresh = await caught(svc.refreshNumbers('acme', created.id, 7));
      for (const err of [replace, refresh]) {
        expect([err.status, err.message, err.reason]).toEqual([
          409, 'Les identifiants enregistrés de ce compte sont illisibles : retirez le compte puis raccordez-le de nouveau.',
          'whatsapp_account.secrets_unreadable',
        ]);
      }
    });

    // audit décisions A23 : la suite indiquée réussit (retirer, puis raccorder la même WABA) ; raccorder avant de retirer
    // est refusé, le compte en erreur tient toujours sa WABA (spec §6, « Unicité »)
    it('identifiants enregistrés illisibles : « Retirer le compte » réussit, puis le raccordement de la même WABA aussi', async () => {
      const created = await svc.create('acme', 7, metaInput());
      expect(await db.replaceWhatsAppAccountSecrets('acme', created.id, {
        secret_encrypted: 'illisible', key_version: 1, waba_id: '1111111111', meta_app_id: 'app-1111111111', token_expiry: null,
        verified_at: new Date().toISOString(),
      })).toEqual({ ok: true });
      expect((await svc.verify('acme', created.id, 7))).toMatchObject({ state: 'error', error_cause: 'reconnect', outcome: 'refused' });
      expect((await caught(svc.create('acme', 7, metaInput()))).reason).toBe('whatsapp_account.already_connected');

      await svc.disconnect('acme', created.id, 7);
      expect(await svc.get('acme', created.id)).toMatchObject({ state: 'disconnected' });
      const again = await svc.create('acme', 7, metaInput());
      expect(again).toMatchObject({ state: 'connected', waba_id: created.waba_id });
      expect(again.id).not.toBe(created.id);
      expect((await svc.refreshNumbers('acme', again.id, 7)).state).toBe('connected');
    });

    // Isolation : un compte ou un numéro d'une autre organisation répond exactement comme un compte ou un numéro inconnu.
    it("compte d'une autre organisation et compte inconnu : même texte, même reason, pour chaque action", async () => {
      const created = await svc.create('acme', 7, metaInput());
      const unknown = created.id + 1000;
      const actions: Array<(clientId: string, id: number) => Promise<unknown>> = [
        (c, id) => svc.get(c, id),
        (c, id) => svc.rename(c, id, 8, 'Autre nom'),
        (c, id) => svc.replaceCredentials(c, id, 8, NEW_CREDENTIALS),
        (c, id) => svc.verify(c, id, 8),
        (c, id) => svc.refreshNumbers(c, id, 8),
        (c, id) => svc.disconnect(c, id, 8),
      ];
      for (const action of actions) {
        const foreign = await caught(action('beta', created.id));
        const absent = await caught(action('beta', unknown));
        expect([foreign.status, foreign.message, foreign.reason]).toEqual([404, 'Compte WhatsApp introuvable.', 'whatsapp_account.not_found']);
        expect([absent.status, absent.message, absent.reason]).toEqual([foreign.status, foreign.message, foreign.reason]);
      }
      const numberId = created.numbers[0]!.id;
      const foreignNumber = await caught(svc.setNumberTestFlag('acme', created.id, numberId + 1000, 7, true));
      expect([foreignNumber.status, foreignNumber.reason]).toEqual([404, 'whatsapp_account.number_not_found']);
    });
  });

  // revue 2b-2 M-2 (re-revue) : « Vérifier maintenant » et le rafraîchissement ne mettent en erreur que les secrets lus.
  describe('identifiants remplacés pendant une lecture chez le fournisseur', () => {
    async function replaceDuring(accountId: number): Promise<void> {
      const enc = encryptAccountSecrets({
        mode: 'meta_manual', access_token: 'EAAG-nouveau-jeton-0123456789', app_secret: 'nouveau-secret-0123456789',
        verify_token: 'verif', webhook_key: 'cle',
      });
      expect(await db.replaceWhatsAppAccountSecrets('acme', accountId, {
        ...enc, waba_id: '1111111111', meta_app_id: 'app-1', token_expiry: null, verified_at: new Date().toISOString(),
      })).toEqual({ ok: true });
    }

    // revue 2b-2 M-2
    it("« Vérifier maintenant » qui reçoit un 401 de l'ancien jeton après un remplacement : le compte reste connected", async () => {
      const created = await svc.create('acme', 7, metaInput());
      providers.verifyMeta.mockImplementationOnce(async () => { await replaceDuring(created.id); return refusedToken(); });
      await svc.verify('acme', created.id, 7);
      expect((await db.getWhatsAppAccount('acme', created.id))).toMatchObject({ state: 'connected', error_reason: null, error_detail: null });
    });

    // revue 2b-2 M-2
    it.each(['admin', 'événement'] as const)("rafraîchissement (%s) refusé pour l'ancien jeton après un remplacement : le compte reste connected", async (origin) => {
      const created = await svc.create('acme', 7, metaInput());
      providers.listMeta.mockImplementationOnce(async () => {
        await replaceDuring(created.id);
        return { numbers: [], skipped: { sandbox: 0, invalid_number: 0 }, error: { reason: 'token_invalid', message: 'Jeton refusé par Meta' } };
      });
      const refresh = origin === 'admin' ? svc.refreshNumbers('acme', created.id, 7, ADMIN_INVENTORY) : svc.refreshOnProviderEvent('acme', created.id);
      expect((await caught(refresh)).code).toBe('WA_VALIDATION_FAILED');
      expect((await db.getWhatsAppAccount('acme', created.id))).toMatchObject({ state: 'connected', error_reason: null, error_detail: null });
    });
  });
});
