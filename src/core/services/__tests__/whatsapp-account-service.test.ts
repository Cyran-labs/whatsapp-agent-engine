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

// Les deux moteurs (SQLite par défaut, Postgres avec TEST_DATABASE_URL). Clients fournisseurs simulés.

const ACME_TOKEN = 'EAAG-acme-jeton-0123456789abcdef';
const ACME_SECRET = 'acme-secret-app-0123456789';
const BETA_TOKEN = 'EAAG-beta-jeton-0123456789abcdef';
const BETA_SECRET = 'beta-secret-app-0123456789';
const CM_ACCOUNT = '0b9c8a52-4f1e-4d4c-9a39-2a3d5f7e9b10';
const CM_TOKEN = 'cm-product-token-0123456789';

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
    numbers: [num(1)], skipped: { sandbox: 0, invalid_number: 0 }, ...over,
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
  let providers: { [K in keyof WhatsAppProviders]: ReturnType<typeof vi.fn<WhatsAppProviders[K]>> };
  let svc: WhatsAppAccountService;

  beforeEach(async () => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '0'.repeat(64));
    vi.stubEnv('PUBLIC_BASE_URL', '');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    db = await createTestDatabase();
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.upsertClient({ client_id: 'beta', name: 'Beta', status: 'active' });
    providers = {
      verifyMeta: vi.fn<WhatsAppProviders['verifyMeta']>(async () => verified()),
      listMeta: vi.fn<WhatsAppProviders['listMeta']>(async () => listing([num(1)])),
      verifyCm: vi.fn<WhatsAppProviders['verifyCm']>(async () => verified({ meta_app_id: null, waba_id: '2222222222' })),
      listCm: vi.fn<WhatsAppProviders['listCm']>(async () => listing([num(1)])),
    };
    svc = new WhatsAppAccountService({ db, providers });
  });

  afterEach(async () => {
    resetSignatureMonitor();
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
      expect(created.webhook.path.startsWith('/webhook/meta/')).toBe(true);
      const key = created.webhook.path.slice('/webhook/meta/'.length);
      expect(hashWebhookKey(key)).toBe(record.webhook_key_hash);
      expect(created.webhook.url).toBeNull();
      expect(created.webhook.verify_token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      expect(created.numbers.map((n) => [n.phone_e164, n.bot])).toEqual([['+33100000001', null]]);
      expect(created.checks.map((c) => c.key)).toEqual(['token', 'waba_access', 'app_secret']);
      expect(providers.verifyMeta).toHaveBeenCalledWith(
        { waba_id: '1111111111', access_token: ACME_TOKEN, app_secret: ACME_SECRET }, { beforeWrite: expect.any(Function) },
      );

      const secrets = decryptAccountSecrets(record);
      expect(secrets).toEqual({
        mode: 'meta_manual', access_token: ACME_TOKEN, app_secret: ACME_SECRET, verify_token: created.webhook.verify_token, webhook_key: key,
      });
      expect(record.meta_app_id).toBe('app-1');
      // La vue porte l'identifiant public de l'app Meta (lien vers l'app dans le back-office).
      expect(created.meta_app_id).toBe('app-1');
      expect((await svc.get('acme', created.id)).meta_app_id).toBe('app-1');

      const audits = await db.listAuditLog('acme');
      expect(audits.map((a) => [a.action, a.metadata])).toEqual([['whatsapp_account.create', { mode: 'meta_manual', numbers: 1, refused: 0 }]]);
      const auditText = JSON.stringify(audits);
      for (const secret of [ACME_TOKEN, ACME_SECRET, key, created.webhook.verify_token!, record.webhook_key_hash!]) {
        expect(auditText).not.toContain(secret);
      }
    });

    it("CM.com : URL cm-com, pas de jeton de vérification, WABA lue à titre indicatif", async () => {
      const created = await svc.create('acme', 7, { mode: 'cm_com', name: 'CM', account_id: CM_ACCOUNT, product_token: CM_TOKEN });
      expect(JSON.stringify(created)).not.toContain(CM_TOKEN);
      expect(created).toMatchObject({ mode: 'cm_com', provider_account_id: CM_ACCOUNT, waba_id: '2222222222' });
      expect(created.webhook.path.startsWith('/webhook/cm-com/')).toBe(true);
      expect(created.webhook.verify_token).toBeNull();
      expect(created.meta_app_id).toBeNull();
      expect(providers.verifyCm).toHaveBeenCalledWith({ account_id: CM_ACCOUNT, product_token: CM_TOKEN });
    });

    it("l'URL complète est préfixée par PUBLIC_BASE_URL quand il est défini", async () => {
      vi.stubEnv('PUBLIC_BASE_URL', 'https://moteur.example.test');
      const created = await svc.create('acme', 7, metaInput());
      expect(created.webhook.url).toBe(`https://moteur.example.test${created.webhook.path}`);
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
      const number = (await db.listWhatsAppNumbers('acme', created.id))[0]!;
      await getTransportForNumber(account1, number)!.sendText('33600000001', 'Bonjour');

      const replaced = await svc.replaceCredentials('acme', created.id, 7, {
        mode: 'meta_manual', waba_id: '1111111111', access_token: 'EAAG-nouveau-jeton-0123456789', app_secret: 'nouveau-secret-0123456789',
      });
      // Clé d'URL et jeton conservés ; la réponse ne les porte pas (revue 2b-3 M-2), la lecture dédiée les rend.
      expect(replaced).not.toHaveProperty('webhook');
      expect(await svc.getWebhook('acme', created.id)).toEqual(created.webhook);
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
        providers.verifyMeta.mockImplementationOnce((c, hooks) => verifyMetaManual(c, { ...hooks, fetchImpl: g.fetchImpl }));
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
        providers.verifyMeta.mockImplementationOnce((c, hooks) => verifyMetaManual(c, { ...hooks, fetchImpl: g.fetchImpl }));
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
        providers.verifyMeta.mockImplementationOnce((c, hooks) => verifyMetaManual(c, { ...hooks, fetchImpl: g.fetchImpl }));
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
      expect(await svc.getWebhook('acme', created.id)).toEqual({ path: '', url: null, verify_token: null });
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
     * Graph simulé pour le vrai client Meta : jeton refusé (190) pour BAD_TOKEN, sinon lectures réussies, app non
     * abonnée (le POST subscribed_apps serait l'unique écriture). Les POST reçus sont relevés.
     */
    function fakeGraph(): { posts: string[]; fetchImpl: typeof fetch } {
      const posts: string[] = [];
      const reply = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status });
      const fetchImpl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        const token = new Headers(init?.headers).get('Authorization')?.replace('Bearer ', '') ?? '';
        if (token === BAD_TOKEN) return reply(401, { error: { message: 'Invalid OAuth access token', code: 190 } });
        if ((init?.method ?? 'GET') === 'POST') { posts.push(url.pathname); return reply(200, { success: true }); }
        if (url.pathname.endsWith('/debug_token')) return reply(200, { data: { app_id: token === ACME_TOKEN ? 'app-1' : 'app-beta', is_valid: true, expires_at: 0 } });
        if (url.pathname.endsWith('/subscribed_apps')) return reply(200, { data: [] });
        if (url.pathname.endsWith('/phone_numbers')) return reply(200, { data: [] });
        return reply(200, { id: 'waba', name: 'Compte' });
      }) as typeof fetch;
      return { posts, fetchImpl };
    }

    function useRealMetaClient(): string[] {
      const graph = fakeGraph();
      providers.verifyMeta.mockImplementation((c, hooks) => verifyMetaManual(c, { fetchImpl: graph.fetchImpl, ...hooks }));
      return graph.posts;
    }

    // revue 2b-2 I-1
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
    it("jeton refusé : même réponse 422 sur la WABA tenue par acme que sur une WABA libre ; WABA libre et identifiants valides : un POST", async () => {
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
      expect((await svc.create('beta', 8, { ...betaOnAcmeWaba, waba_id: '5555555555' })).state).toBe('connected');
      expect(posts).toEqual(['/v26.0/5555555555/subscribed_apps']);
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
    });

    // revue 2b-2 M-5
    it("double raccordement simultané de la même WABA dans une organisation : un seul compte, l'autre 409 « déjà raccordé »", async () => {
      bothVerificationsInFlight(() => 'app-1');
      const results = await Promise.allSettled([svc.create('acme', 7, metaInput()), svc.create('acme', 7, metaInput({ name: 'Doublon' }))]);
      expect(providers.verifyMeta).toHaveBeenCalledTimes(2);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected.map((r) => [(r.reason as AppError).status, (r.reason as AppError).message])).toEqual([[409, 'Ce compte WhatsApp est déjà raccordé.']]);
      expect(await db.listWhatsAppAccounts('acme')).toHaveLength(1);
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
