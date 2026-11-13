import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WhatsAppAccountRecord, WhatsAppNumberRecord } from '../../core/database/whatsapp-types.js';
import {
  decryptAccountSecrets, encryptAccountSecrets, getTransportForNumber, invalidateAccountTransports,
} from '../index.js';
import type { AccountSecrets } from '../index.js';
import { CM_SEND_URL } from '../cm-com.js';
import { encryptJson } from '../../core/credentials/crypto.js';

const META_SECRETS: AccountSecrets = { mode: 'meta_manual', access_token: 'TOKEN_A', app_secret: 'APP_A', verify_token: 'VT_A', webhook_key: 'KEY_A' };
const CM_SECRETS: AccountSecrets = { mode: 'cm_com', product_token: 'PRODUIT_A', webhook_key: 'KEY_CM' };

function account(secrets: AccountSecrets, overrides: Partial<WhatsAppAccountRecord> = {}): WhatsAppAccountRecord {
  const enc = encryptAccountSecrets(secrets);
  return {
    id: 1, client_id: 'acme', name: 'Compte', mode: secrets.mode, provider_account_id: 'waba-1', waba_id: 'waba-1', meta_app_id: null,
    ...enc, webhook_key_hash: null, state: 'connected', error_reason: null, error_detail: null, error_provider_text: null, last_verified_at: null,
    token_expiry: null, last_signature_ok_at: null, alerts: [], webhook_state: null, meta_health: null,
    created_at: '2026-11-08T00:00:00Z', updated_at: '2026-11-08T00:00:00Z',
    ...overrides,
  };
}

function number(overrides: Partial<WhatsAppNumberRecord> = {}): WhatsAppNumberRecord {
  return {
    id: 10, account_id: 1, client_id: 'acme', phone_e164: '+33612345678', provider_number_id: 'PNID_A', cm_channel_id: null,
    display_name: 'Numéro', meta_status: null, quality: null, is_test: false, bot_id: null, provider_state: 'present',
    removed_at: null, delivery_failures: 0, last_delivery_error_code: null, last_delivery_error_at: null,
    created_at: '2026-11-08T00:00:00Z', updated_at: '2026-11-08T00:00:00Z', ...overrides,
  };
}

interface Sent { url: string; headers: Record<string, string>; body: Record<string, unknown>; }
let sent: Sent[];

beforeEach(() => {
  vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '0'.repeat(64));
  sent = [];
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });
    return { ok: true, status: 200, text: async () => '{}' } as unknown as Response;
  }));
});

afterEach(() => {
  invalidateAccountTransports(1);
  invalidateAccountTransports(2);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('encryptAccountSecrets / decryptAccountSecrets', () => {
  it('aller-retour pour Meta et CM.com', () => {
    expect(decryptAccountSecrets(account(META_SECRETS))).toEqual(META_SECRETS);
    expect(decryptAccountSecrets(account(CM_SECRETS))).toEqual(CM_SECRETS);
  });

  it("le contenu chiffré ne laisse paraître aucun secret en clair", () => {
    const { secret_encrypted } = encryptAccountSecrets(META_SECRETS);
    for (const s of ['TOKEN_A', 'APP_A', 'VT_A', 'KEY_A']) expect(secret_encrypted).not.toContain(s);
  });

  it.each([
    ['contenu vide', ''],
    ['contenu illisible', 'pas-du-base64-chiffre'],
  ])('%s : null, sans exception', (_label, secret_encrypted) => {
    expect(decryptAccountSecrets(account(META_SECRETS, { secret_encrypted }))).toBeNull();
  });

  it('version de clé inconnue : null, sans exception', () => {
    expect(decryptAccountSecrets(account(META_SECRETS, { key_version: 99 }))).toBeNull();
  });

  it.each([
    ['meta sans app_secret', { mode: 'meta_manual', access_token: 'a', verify_token: 'v', webhook_key: 'k' }],
    ['meta avec jeton vide', { mode: 'meta_manual', access_token: '  ', app_secret: 's', verify_token: 'v', webhook_key: 'k' }],
    ['meta sans clé de webhook', { mode: 'meta_manual', access_token: 'a', app_secret: 's', verify_token: 'v' }],
    ['cm sans productToken', { mode: 'cm_com', webhook_key: 'k' }],
    ['cm avec productToken non texte', { mode: 'cm_com', product_token: 12, webhook_key: 'k' }],
    ['mode inconnu', { mode: 'autre', product_token: 'p', webhook_key: 'k' }],
    ['objet vide', {}],
    ['null', null],
    ['tableau', []],
  ])('secrets incomplets (%s) : null, sans exception', (_label, value) => {
    const enc = encryptJson(value);
    const rec = account(META_SECRETS, { secret_encrypted: enc.secret, key_version: enc.keyVersion, mode: (value as { mode?: string } | null)?.mode === 'cm_com' ? 'cm_com' : 'meta_manual' });
    expect(decryptAccountSecrets(rec)).toBeNull();
  });

  it('mode des secrets différent du mode du compte : null', () => {
    expect(decryptAccountSecrets(account(META_SECRETS, { mode: 'cm_com' }))).toBeNull();
  });

  it('un échec de déchiffrement ne journalise aucun secret', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    decryptAccountSecrets(account(META_SECRETS, { key_version: 99 }));
    const logged = JSON.stringify([...err.mock.calls, ...warn.mock.calls]);
    for (const s of ['TOKEN_A', 'APP_A', 'VT_A', 'KEY_A']) expect(logged).not.toContain(s);
  });
});

describe('getTransportForNumber', () => {
  it("Meta : l'URL porte le provider_number_id du numéro, Authorization le jeton du compte", async () => {
    const t = getTransportForNumber(account(META_SECRETS), number());
    expect(t).not.toBeNull();
    expect(t!.id).toBe('meta-cloud');
    expect(t!.senderId).toBe('PNID_A');
    await t!.sendText('33600000001', 'bonjour');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toContain('/PNID_A/messages');
    expect(sent[0]!.headers['Authorization']).toBe('Bearer TOKEN_A');
  });

  it("Meta : le transport ne porte pas la vérification de signature (voir verifyMetaSignature)", () => {
    const t = getTransportForNumber(account(META_SECRETS), number());
    expect('verifyWebhookSignature' in t!).toBe(false);
  });

  it("CM.com : productToken du compte, expéditeur = numéro E.164 en chiffres", async () => {
    const t = getTransportForNumber(account(CM_SECRETS, { id: 2 }), number({ account_id: 2, provider_number_id: 'cm:profil' }));
    expect(t).not.toBeNull();
    expect(t!.id).toBe('cm-com');
    expect(t!.senderId).toBe('33612345678');
    await t!.sendText('33600000001', 'bonjour');
    expect(sent[0]!.url).toBe(CM_SEND_URL);
    expect(sent[0]!.headers['X-CM-PRODUCTTOKEN']).toBe('PRODUIT_A');
    const msg = (sent[0]!.body['messages'] as { msg: Array<Record<string, unknown>> }).msg[0]!;
    expect(msg['from']).toBe('33612345678');
  });

  // audit 1.5
  it("numéro d'un autre compte : null", () => {
    expect(getTransportForNumber(account(META_SECRETS), number({ account_id: 2 }))).toBeNull();
  });

  // audit 1.5
  it("numéro d'une autre organisation : null", () => {
    expect(getTransportForNumber(account(META_SECRETS), number({ client_id: 'beta' }))).toBeNull();
  });

  // audit 1.5
  it("un numéro refusé n'est jamais servi par le cache d'un appel précédent valide", () => {
    const acc = account(META_SECRETS);
    expect(getTransportForNumber(acc, number())).not.toBeNull();
    expect(getTransportForNumber(acc, number({ client_id: 'beta' }))).toBeNull();
    expect(getTransportForNumber(acc, number({ account_id: 2 }))).toBeNull();
  });

  it('compte déconnecté : null, même si un transport était en cache', () => {
    const acc = account(META_SECRETS);
    expect(getTransportForNumber(acc, number())).not.toBeNull();
    expect(getTransportForNumber({ ...acc, state: 'disconnected' }, number())).toBeNull();
  });

  it('compte en erreur : transport conservé (seule la déconnexion le retire)', () => {
    expect(getTransportForNumber(account(META_SECRETS, { state: 'error', error_reason: 'token_invalid' }), number())).not.toBeNull();
  });

  it('secrets incomplets ou illisibles : null, sans exception', () => {
    expect(getTransportForNumber(account(META_SECRETS, { secret_encrypted: '' }), number())).toBeNull();
    expect(getTransportForNumber(account(META_SECRETS, { key_version: 99 }), number())).toBeNull();
  });

  it('aucun repli sur META_* ni CM_* de la plateforme', () => {
    vi.stubEnv('META_ACCESS_TOKEN', 'env-tok'); vi.stubEnv('META_PHONE_NUMBER_ID', 'env-pid'); vi.stubEnv('CM_PRODUCT_TOKEN', 'env-cm');
    expect(getTransportForNumber(account(META_SECRETS, { secret_encrypted: '' }), number())).toBeNull();
  });

  it("transport en cache pour un même compte et un même numéro", () => {
    const acc = account(META_SECRETS);
    expect(getTransportForNumber(acc, number())).toBe(getTransportForNumber(acc, number()));
  });

  it('deux numéros d\'un même compte : deux transports, chacun sur son identifiant', async () => {
    const acc = account(META_SECRETS);
    const a = getTransportForNumber(acc, number())!;
    const b = getTransportForNumber(acc, number({ id: 11, provider_number_id: 'PNID_B', phone_e164: '+33611111111' }))!;
    expect(a).not.toBe(b);
    expect(a.senderId).toBe('PNID_A');
    expect(b.senderId).toBe('PNID_B');
  });

  it("deux comptes d'organisations différentes : jetons jamais mélangés", async () => {
    const accB = account({ ...META_SECRETS, access_token: 'TOKEN_B' }, { id: 2, client_id: 'beta' });
    const ta = getTransportForNumber(account(META_SECRETS), number())!;
    const tb = getTransportForNumber(accB, number({ id: 20, account_id: 2, client_id: 'beta', provider_number_id: 'PNID_B' }))!;
    await ta.sendText('33600000001', 'a');
    await tb.sendText('33600000001', 'b');
    expect(sent[0]!.headers['Authorization']).toBe('Bearer TOKEN_A');
    expect(sent[0]!.url).toContain('/PNID_A/');
    expect(sent[1]!.headers['Authorization']).toBe('Bearer TOKEN_B');
    expect(sent[1]!.url).toContain('/PNID_B/');
  });
});

describe('transport en cache dont les entrées changent (sans invalidation)', () => {
  it('nouveau secret_encrypted (nouveau jeton) : le nouveau jeton est envoyé', async () => {
    await getTransportForNumber(account(META_SECRETS), number())!.sendText('33600000001', 'un');
    expect(sent[0]!.headers['Authorization']).toBe('Bearer TOKEN_A');
    await getTransportForNumber(account({ ...META_SECRETS, access_token: 'TOKEN_NEW' }), number())!.sendText('33600000001', 'deux');
    expect(sent[1]!.headers['Authorization']).toBe('Bearer TOKEN_NEW');
  });

  it('même compte et même numéro, entrées identiques : transport en cache conservé', () => {
    const acc = account(META_SECRETS);
    expect(getTransportForNumber(acc, number())).toBe(getTransportForNumber({ ...acc, updated_at: '2027-01-01T00:00:00Z' }, number({ updated_at: '2027-01-01T00:00:00Z' })));
  });

  it('nouvelle version de clé : transport reconstruit (le contenu est relu avec la version du compte)', () => {
    const acc = account(META_SECRETS);
    const first = getTransportForNumber(acc, number())!;
    expect(getTransportForNumber({ ...acc, key_version: 99 }, number())).toBeNull();
    expect(getTransportForNumber(acc, number())).not.toBe(first);
  });

  it('provider_number_id changé : envoi vers le nouvel identifiant', async () => {
    const acc = account(META_SECRETS);
    await getTransportForNumber(acc, number())!.sendText('33600000001', 'un');
    await getTransportForNumber(acc, number({ provider_number_id: 'PNID_NEW' }))!.sendText('33600000001', 'deux');
    expect(sent[0]!.url).toContain('/PNID_A/');
    expect(sent[1]!.url).toContain('/PNID_NEW/');
  });

  it('phone_e164 changé (CM.com) : nouvel expéditeur', async () => {
    const acc = account(CM_SECRETS);
    await getTransportForNumber(acc, number())!.sendText('33600000001', 'un');
    const t = getTransportForNumber(acc, number({ phone_e164: '+33699999999' }))!;
    expect(t.senderId).toBe('33699999999');
    await t.sendText('33600000001', 'deux');
    const msg = (sent[1]!.body['messages'] as { msg: Array<Record<string, unknown>> }).msg[0]!;
    expect(msg['from']).toBe('33699999999');
  });

  it("secrets devenus illisibles : plus de transport, l'ancien n'est pas resservi", () => {
    const acc = account(META_SECRETS);
    expect(getTransportForNumber(acc, number())).not.toBeNull();
    expect(getTransportForNumber({ ...acc, secret_encrypted: '' }, number())).toBeNull();
    expect(getTransportForNumber({ ...acc, secret_encrypted: '' }, number())).toBeNull();
  });
});

describe('numéro retiré chez le fournisseur', () => {
  it('provider_state removed : null, et le transport mis en cache avant le retrait n\'est plus servi', () => {
    const acc = account(META_SECRETS);
    const before = getTransportForNumber(acc, number());
    expect(before).not.toBeNull();
    expect(getTransportForNumber(acc, number({ provider_state: 'removed', removed_at: '2026-11-08T00:00:00Z' }))).toBeNull();
    // Le numéro revient : un transport neuf, pas celui d'avant le retrait.
    const after = getTransportForNumber(acc, number());
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });

  it('numéro retiré dès la première demande : null', () => {
    expect(getTransportForNumber(account(META_SECRETS), number({ provider_state: 'removed' }))).toBeNull();
  });
});

describe('invalidateAccountTransports', () => {
  it('oublie les transports du compte : un transport neuf est construit', () => {
    const acc = account(META_SECRETS);
    const first = getTransportForNumber(acc, number());
    expect(getTransportForNumber(acc, number())).toBe(first);
    invalidateAccountTransports(1);
    expect(getTransportForNumber(acc, number())).not.toBe(first);
  });

  it("n'invalide que le compte visé", () => {
    const acc1 = account(META_SECRETS);
    const acc2 = account(META_SECRETS, { id: 2 });
    const num2 = number({ id: 30, account_id: 2 });
    const t1 = getTransportForNumber(acc1, number());
    const t2 = getTransportForNumber(acc2, num2);
    invalidateAccountTransports(1);
    expect(getTransportForNumber(acc1, number())).not.toBe(t1);
    expect(getTransportForNumber(acc2, num2)).toBe(t2);
  });
});
