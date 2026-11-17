// Profil WhatsApp, photo et nom d'affichage d'un numéro (lot R2a, tâche 5 ; spec R2a §5.2, §5.3, §6.2 à §6.4, §9).
// Les deux moteurs (SQLite par défaut, Postgres avec TEST_DATABASE_URL), sauf la recherche du code dans le fichier de la
// base, faite sur un fichier SQLite. Le faux Meta répond au vrai client Graph (`meta-profile.ts`) par son `fetchImpl` :
// les assertions portent sur ce qui part réellement (chemin, jeton, `appsecret_proof`, corps).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspect } from 'node:util';
import { createTestDatabase } from '../../../test-support/test-database.js';
import { createSqliteDriver } from '../../database/sqlite.js';
import type { Database } from '../../database/types.js';
import type { ProviderNumber } from '../../database/whatsapp-types.js';
import type { ProviderListing, ProviderVerification } from '../../../whatsapp/provider-common.js';
import { WhatsAppAccountService, type WhatsAppProviders } from '../whatsapp-account-service.js';
import { WhatsAppNumberProfileService } from '../whatsapp-number-profile-service.js';
import { invalidateAccountTransports } from '../../../transport/index.js';
import { appSecretProof } from '../../../whatsapp/meta-graph.js';
import { fakeMetaWebhooks } from '../../../test-support/meta-webhooks-fake.js';
import { AppError } from '../../../api/errors.js';
import type { DisplayNameRequestView } from '@wabagent/contracts';

const ACME_TOKEN = 'EAAG-acme-jeton-0123456789abcdef';
const ACME_SECRET = 'acme-secret-app-0123456789';
const OTHER_TOKEN = 'EAAG-autre-jeton-0123456789abcdef';
const OTHER_SECRET = 'autre-secret-app-0123456789';
const BETA_TOKEN = 'EAAG-beta-jeton-0123456789abcdef';
const BETA_SECRET = 'beta-secret-app-0123456789';
const CM_ACCOUNT = '0b9c8a52-4f1e-4d4c-9a39-2a3d5f7e9b10';
const CM_TOKEN = 'cm-product-token-0123456789';
const PIN = '482915';

const WABA_A = '1111111111';
const WABA_B = '3333333333';
const WABA_BETA = '4444444444';
const APPS: Record<string, string> = { [WABA_A]: 'app-acme', [WABA_B]: 'app-autre', [WABA_BETA]: 'app-beta' };

function num(i: number, over: Partial<ProviderNumber> = {}): ProviderNumber {
  return {
    provider_number_id: `pn-${i}`, phone_e164: `+3310000000${i}`, display_name: `Boutique ${i}`, meta_status: 'CONNECTED',
    quality: 'GREEN', is_test: false, cm_channel_id: null, name_request: null, pin_enabled: null, ...over,
  };
}

const NUMBERS: Record<string, ProviderNumber[]> = { [WABA_A]: [num(1), num(2)], [WABA_B]: [num(3)], [WABA_BETA]: [num(4)] };

function verified(wabaId: string, numbers: ProviderNumber[]): ProviderVerification {
  return {
    ok: true, checks: [{ key: 'token', status: 'ok' }], account_name: 'Nom chez Meta', waba_id: wabaId,
    meta_app_id: APPS[wabaId] ?? null, token_expiry: null, numbers, skipped: { sandbox: 0, invalid_number: 0 }, meta_health: null,
  };
}

function listing(numbers: ProviderNumber[]): ProviderListing {
  return { numbers, skipped: { sandbox: 0, invalid_number: 0 } };
}

const approvedRequest = (name = 'Maison Acme'): DisplayNameRequestView => ({
  requested_name: name, status: 'approved_pending', rejection_reason: null, requested_at: '2026-11-10T10:00:00.000Z',
  approved_at: '2026-11-11T10:00:00.000Z', apply_before: '2026-11-25T10:00:00.000Z', apply_before_approx: true,
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);

interface Call { method: string; path: string; query: Record<string, string>; headers: Record<string, string>; body: unknown; raw: string }
type Responder = (call: Call) => Response | undefined | Promise<Response | undefined>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function metaError(status: number, error: Record<string, unknown>): Response {
  return json(status, { error: { type: 'OAuthException', fbtrace_id: 'trace', ...error } });
}

interface StoredProfile { about: string; description: string; address: string; email: string; websites: string[]; vertical: string; photo: string | null }

/**
 * Faux Meta Graph : profil par numéro (relu tel qu'écrit), envoi de photo, demande de nom, réenregistrement. `respond`
 * répond en premier quand il rend une réponse.
 */
function fakeGraph() {
  const calls: Call[] = [];
  const profiles = new Map<string, StoredProfile>();
  let respond: Responder = () => undefined;
  const profileOf = (pn: string): StoredProfile => {
    const existing = profiles.get(pn);
    if (existing) return existing;
    const created: StoredProfile = { about: 'Bonjour', description: 'Boutique', address: '1 rue de la Paix', email: 'contact@example.com', websites: [], vertical: 'RETAIL', photo: null };
    profiles.set(pn, created);
    return created;
  };
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
    let raw = '';
    let body: unknown = null;
    if (typeof init?.body === 'string') {
      raw = init.body;
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    } else if (init?.body instanceof Uint8Array) {
      raw = Buffer.from(init.body).toString('latin1');
      body = init.body;
    }
    const call: Call = {
      method: init?.method ?? 'GET', path: url.pathname.replace(/^\/v[\d.]+/, ''), query: Object.fromEntries(url.searchParams), headers, body, raw,
    };
    calls.push(call);
    const custom = await respond(call);
    if (custom !== undefined) return custom;
    const profileMatch = /^\/(pn-\d+)\/whatsapp_business_profile$/.exec(call.path);
    if (profileMatch && call.method === 'GET') {
      const p = profileOf(profileMatch[1]!);
      return json(200, { data: [{
        about: p.about, description: p.description, address: p.address, email: p.email, websites: p.websites, vertical: p.vertical,
        ...(p.photo !== null ? { profile_picture_url: p.photo } : {}), messaging_product: 'whatsapp',
      }] });
    }
    if (profileMatch && call.method === 'POST') {
      const p = profileOf(profileMatch[1]!);
      const written = body as Record<string, unknown>;
      for (const key of ['about', 'description', 'address', 'email', 'vertical'] as const) {
        if (typeof written[key] === 'string') p[key] = written[key];
      }
      if (Array.isArray(written['websites'])) p.websites = written['websites'] as string[];
      if (typeof written['profile_picture_handle'] === 'string') p.photo = 'https://pps.whatsapp.net/v/nouvelle.jpg';
      return json(200, { success: true });
    }
    if (/^\/app-[a-z]+\/uploads$/.test(call.path)) return json(200, { id: 'upload:MTphdHRhY2htZW50OjEyMzQ1Njc4OTA=?sig=ARZsigValue0123' });
    if (call.path.startsWith('/upload:')) return json(200, { h: '4::aW1hZ2UvanBlZw==:handle' });
    return json(200, { success: true });
  }) as typeof fetch;
  return {
    fetchImpl, calls, profiles,
    respondWith(r: Responder) { respond = r; },
  };
}

async function caught(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error('aucune erreur levée');
}

/** Tout ce que la console a reçu pendant le test, tel quel. */
function captureConsole(): { text: () => string } {
  const seen: string[] = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { seen.push(args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 8 }))).join(' ')); });
  }
  return { text: () => seen.join('\n') };
}

interface Fixture {
  db: Database;
  accounts: WhatsAppAccountService;
  providers: WhatsAppProviders;
  graph: ReturnType<typeof fakeGraph>;
  svc: WhatsAppNumberProfileService;
  /** Compte A et B d'acme (identifiants distincts), compte de beta. */
  a: number; b: number; beta: number;
  /** Numéros : pn-1 et pn-2 sur A, pn-3 sur B, pn-4 sur beta. */
  n1: number; n2: number; n3: number; n4: number;
}

async function setup(db: Database): Promise<Fixture> {
  await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
  await db.upsertClient({ client_id: 'beta', name: 'Beta', status: 'active' });
  const providers: WhatsAppProviders = {
    verifyMeta: vi.fn(async (c) => verified(c.waba_id, NUMBERS[c.waba_id] ?? [])),
    listMeta: vi.fn(async (c) => listing(NUMBERS[c.waba_id] ?? [])),
    verifyCm: vi.fn(async () => ({ ...verified('2222222222', [num(5)]), meta_app_id: null })),
    listCm: vi.fn(async () => listing([num(5)])),
    metaWebhooks: fakeMetaWebhooks(),
    readMetaBusiness: vi.fn(async () => ({ ok: false as const, failure: { kind: 'other' as const, message: 'Portefeuille non simulé' } })),
  };
  const accounts = new WhatsAppAccountService({ db, providers });
  const a = await accounts.create('acme', 7, { mode: 'meta_manual', name: 'Compte A', waba_id: WABA_A, access_token: ACME_TOKEN, app_secret: ACME_SECRET });
  const b = await accounts.create('acme', 7, { mode: 'meta_manual', name: 'Compte B', waba_id: WABA_B, access_token: OTHER_TOKEN, app_secret: OTHER_SECRET });
  const beta = await accounts.create('beta', 8, { mode: 'meta_manual', name: 'Compte Beta', waba_id: WABA_BETA, access_token: BETA_TOKEN, app_secret: BETA_SECRET });
  const idOf = async (clientId: string, accountId: number, pn: string): Promise<number> =>
    (await db.listWhatsAppNumbers(clientId, accountId)).find((n) => n.provider_number_id === pn)!.id;
  const graph = fakeGraph();
  const svc = new WhatsAppNumberProfileService({ db, accounts, graph: { fetchImpl: graph.fetchImpl } });
  return {
    db, accounts, providers, graph, svc, a: a.id, b: b.id, beta: beta.id,
    n1: await idOf('acme', a.id, 'pn-1'), n2: await idOf('acme', a.id, 'pn-2'), n3: await idOf('acme', b.id, 'pn-3'), n4: await idOf('beta', beta.id, 'pn-4'),
  };
}

describe('WhatsAppNumberProfileService', () => {
  let db: Database;
  let f: Fixture;

  beforeEach(async () => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '0'.repeat(64));
    vi.stubEnv('PUBLIC_BASE_URL', 'https://moteur.example.test');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    db = await createTestDatabase();
    f = await setup(db);
    f.graph.calls.length = 0;
  });

  afterEach(async () => {
    for (let id = 1; id <= 10; id++) invalidateAccountTransports(id);
    await db.close();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /** Les cinq opérations, sur un compte et un numéro donnés. */
  function allOperations(accountId: number, numberId: number): Array<[string, () => Promise<unknown>]> {
    return [
      ['getProfile', () => f.svc.getProfile('acme', accountId, numberId)],
      ['updateProfile', () => f.svc.updateProfile('acme', accountId, numberId, 7, { about: 'Nouveau' })],
      ['updatePhoto', () => f.svc.updatePhoto('acme', accountId, numberId, 7, { bytes: JPEG, type: 'image/jpeg' })],
      ['requestDisplayName', () => f.svc.requestDisplayName('acme', accountId, numberId, 7, 'Maison Acme')],
      ['applyDisplayName', () => f.svc.applyDisplayName('acme', accountId, numberId, 7, PIN)],
    ];
  }

  describe('isolation et cible', () => {
    // spec R2a §9.2
    it("profil : numéro d'un autre compte de la même organisation, 404 sans appel", async () => {
      await db.setWhatsAppNumberNameRequest('acme', f.b, f.n3, approvedRequest());
      for (const [name, run] of allOperations(f.a, f.n3)) {
        const err = await caught(run());
        expect(err.status, name).toBe(404);
        expect(err.reason, name).toBe('whatsapp_account.number_not_found');
      }
      expect(f.graph.calls).toEqual([]);
    });

    // spec R2a §9.1 (cas du service ; la suite d'isolation porte les routes)
    it("profil : compte ou numéro d'une autre organisation, 404 sans appel, même texte qu'un inconnu", async () => {
      for (const [name, run] of allOperations(f.beta, f.n4)) {
        const err = await caught(run());
        expect(err.status, name).toBe(404);
        expect(err.reason, name).toBe('whatsapp_account.not_found');
        expect(err.message).toBe((await caught(f.svc.getProfile('acme', 999, f.n1))).message);
      }
      for (const [name, run] of allOperations(f.a, f.n4)) {
        expect((await caught(run())).reason, name).toBe('whatsapp_account.number_not_found');
      }
      expect(f.graph.calls).toEqual([]);
    });

    // spec R2a §9.3
    it('profil : jeton et appsecret_proof du compte du numéro', async () => {
      for (const [name, run] of allOperations(f.b, f.n3)) {
        // La demande de nom écrit une demande en revue : le nom est approuvé avant l'application.
        if (name === 'applyDisplayName') await db.setWhatsAppNumberNameRequest('acme', f.b, f.n3, approvedRequest());
        await expect(run(), name).resolves.toBeDefined();
      }
      const proofB = appSecretProof(OTHER_TOKEN, OTHER_SECRET);
      expect(f.graph.calls.length).toBeGreaterThanOrEqual(8);
      for (const call of f.graph.calls) {
        const text = JSON.stringify(call);
        expect(text).not.toContain(ACME_TOKEN);
        expect(text).not.toContain(ACME_SECRET);
        expect(text).not.toContain(appSecretProof(ACME_TOKEN, ACME_SECRET));
        if (call.path.startsWith('/upload:')) {
          // Envoi du fichier : la session porte sa signature, le jeton part en `OAuth` (essai R2a §4).
          expect(call.headers['authorization']).toBe(`OAuth ${OTHER_TOKEN}`);
        } else {
          expect(call.headers['authorization']).toBe(`Bearer ${OTHER_TOKEN}`);
          expect(call.query['appsecret_proof']).toBe(proofB);
          expect(call.path === '/app-autre/uploads' || call.path.startsWith('/pn-3')).toBe(true);
        }
      }
      // Le numéro du compte A part avec le jeton du compte A.
      f.graph.calls.length = 0;
      await f.svc.getProfile('acme', f.a, f.n1);
      expect(f.graph.calls[0]).toMatchObject({ path: '/pn-1/whatsapp_business_profile', query: { appsecret_proof: appSecretProof(ACME_TOKEN, ACME_SECRET) } });
      expect(f.graph.calls[0]!.headers['authorization']).toBe(`Bearer ${ACME_TOKEN}`);
    });

    it('compte CM.com : profile_unsupported sans appel', async () => {
      const cm = await f.accounts.create('acme', 7, { mode: 'cm_com', name: 'CM', account_id: CM_ACCOUNT, product_token: CM_TOKEN });
      const n5 = cm.numbers[0]!.id;
      for (const [name, run] of allOperations(cm.id, n5)) {
        const err = await caught(run());
        expect(err.reason, name).toBe('whatsapp_account.profile_unsupported');
        expect(err.message).toBe('Le profil WhatsApp ne se règle pas depuis WABAGENT pour ce compte.');
      }
      expect(f.graph.calls).toEqual([]);
    });

    it('profil : numéro retiré entre lecture et écriture', async () => {
      await f.svc.getProfile('acme', f.a, f.n2);
      // Retiré chez Meta pendant que la fenêtre est ouverte : Meta répond « objet inexistant » (code 100, sous-code 33)
      // sur le chemin du numéro, jamais présenté comme une WABA introuvable.
      f.graph.respondWith((c) => (c.method === 'POST' ? metaError(400, { code: 100, error_subcode: 33, message: 'Unsupported post request.' }) : undefined));
      const atMeta = await caught(f.svc.updateProfile('acme', f.a, f.n2, 7, { about: 'Nouveau' }));
      expect(atMeta.reason).toBe('whatsapp_account.number_removed');
      expect(atMeta.message).toBe('Ce numéro a été retiré chez Meta.');
      expect(atMeta.message).not.toMatch(/WABA/);

      // Retiré à la relecture des numéros : refus sans aucun appel.
      f.graph.respondWith(() => undefined);
      vi.mocked(f.providers.listMeta).mockResolvedValueOnce(listing([num(1)]));
      await f.accounts.refreshNumbers('acme', f.a, 7);
      f.graph.calls.length = 0;
      for (const [name, run] of allOperations(f.a, f.n2)) {
        expect((await caught(run())).reason, name).toBe('whatsapp_account.number_removed');
      }
      expect(f.graph.calls).toEqual([]);
    });
  });

  describe('profil', () => {
    it('profil : un champ vidé est envoyé vide', async () => {
      await f.svc.updateProfile('acme', f.a, f.n1, 7, { description: '', websites: [] });
      const post = f.graph.calls.find((c) => c.method === 'POST')!;
      expect(post.path).toBe('/pn-1/whatsapp_business_profile');
      expect(post.body).toEqual({ messaging_product: 'whatsapp', description: '', websites: [] });
    });

    it('profil : enregistré puis relu, la réponse est la version relue', async () => {
      const saved = await f.svc.updateProfile('acme', f.a, f.n1, 7, { about: 'Ouvert du lundi au samedi', email: 'bonjour@acme.test' });
      expect(f.graph.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
        'POST /pn-1/whatsapp_business_profile', 'GET /pn-1/whatsapp_business_profile',
      ]);
      expect(saved).toMatchObject({ about: 'Ouvert du lundi au samedi', email: 'bonjour@acme.test', description: 'Boutique' });
      // Meta corrige à sa façon : la réponse est ce que Meta a gardé, pas ce qui a été envoyé.
      f.graph.respondWith((c) => {
        if (c.method === 'POST') { f.graph.profiles.get('pn-1')!.about = 'Version de Meta'; return json(200, { success: true }); }
        return undefined;
      });
      expect((await f.svc.updateProfile('acme', f.a, f.n1, 7, { about: 'Envoyé' })).about).toBe('Version de Meta');
    });

    it("profil : trace d'audit sans contenu", async () => {
      await f.svc.updateProfile('acme', f.a, f.n1, 7, { about: 'Infos-secrètes-XYZ', email: 'cache@acme.test', address: '9 rue Cachée' });
      const rows = (await db.listAuditLog('acme')).filter((r) => r.action === 'whatsapp_number.profile_updated');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actor_user_id: 7, metadata: { number_id: f.n1, ok: true } });
      const text = JSON.stringify(rows);
      for (const content of ['Infos-secrètes-XYZ', 'cache@acme.test', '9 rue Cachée']) expect(text).not.toContain(content);
    });

    it('profil : champ refusé par Meta, nommé dans le détail avec le texte de Meta', async () => {
      f.graph.respondWith((c) => (c.method === 'POST'
        ? metaError(400, { code: 100, message: 'Param description must be at most 512 characters long.' })
        : undefined));
      const err = await caught(f.svc.updateProfile('acme', f.a, f.n1, 7, { description: 'Texte' }));
      expect(err.status).toBe(422);
      expect(err.details).toEqual([{
        path: 'description', message: 'Meta a renvoyé une erreur', provider_text: 'Param description must be at most 512 characters long.',
      }]);
      const row = (await db.listAuditLog('acme')).find((r) => r.action === 'whatsapp_number.profile_updated')!;
      expect(row.metadata).toEqual({ number_id: f.n1, ok: false, reason: 'provider_refused' });
    });

    // Ruling R-17
    it('profil : enregistré mais relecture en échec, profile_saved_unread et audit ok', async () => {
      f.graph.respondWith((c) => (c.method === 'GET' ? metaError(503, { code: 2, message: 'Service temporarily unavailable' }) : undefined));
      const err = await caught(f.svc.updateProfile('acme', f.a, f.n1, 7, { about: 'Nouveau' }));
      expect(err.status).toBe(422);
      expect(err.reason).toBe('whatsapp_account.profile_saved_unread');
      expect(err.message).toBe('Profil enregistré chez Meta, mais sa relecture a échoué. Rouvrez la fenêtre dans un moment pour le vérifier.');
      expect(f.graph.profiles.get('pn-1')!.about).toBe('Nouveau');
      const row = (await db.listAuditLog('acme')).find((r) => r.action === 'whatsapp_number.profile_updated')!;
      expect(row.metadata).toEqual({ number_id: f.n1, ok: true });
      // Sans écriture (corps vide), une relecture en échec reste le refus de la lecture.
      expect((await caught(f.svc.updateProfile('acme', f.a, f.n1, 7, {}))).reason).toBe('whatsapp_account.meta_unavailable');
    });

    it('profil : panne passagère de Meta, meta_unavailable', async () => {
      f.graph.respondWith(() => metaError(503, { code: 2, message: 'Service temporarily unavailable' }));
      const err = await caught(f.svc.getProfile('acme', f.a, f.n1));
      expect(err.reason).toBe('whatsapp_account.meta_unavailable');
    });

    it('profil : jeton refusé, le compte passe en erreur et la raison dit de remplacer les identifiants', async () => {
      f.graph.respondWith(() => metaError(401, { code: 190, message: 'Invalid OAuth access token.' }));
      const err = await caught(f.svc.getProfile('acme', f.a, f.n1));
      expect(err.reason).toBe('whatsapp_account.listing_token_invalid');
      expect((await db.getWhatsAppAccount('acme', f.a))!).toMatchObject({ state: 'error', error_reason: 'token_invalid' });
    });
  });

  describe('photo', () => {
    it('photo : JPEG envoyé, handle posé, profil relu', async () => {
      const profile = await f.svc.updatePhoto('acme', f.a, f.n1, 7, { bytes: JPEG, type: 'image/jpeg' });
      expect(f.graph.calls.map((c) => `${c.method} ${c.path.startsWith('/upload:') ? '/upload:<session>' : c.path}`)).toEqual([
        'POST /app-acme/uploads', 'POST /upload:<session>', 'POST /pn-1/whatsapp_business_profile', 'GET /pn-1/whatsapp_business_profile',
      ]);
      expect(f.graph.calls[0]!.query).toMatchObject({ file_length: String(JPEG.length), file_type: 'image/jpeg' });
      expect(profile.photo_url).toBe('https://pps.whatsapp.net/v/nouvelle.jpg');
      const row = (await db.listAuditLog('acme')).find((r) => r.action === 'whatsapp_number.photo_updated')!;
      expect(row.metadata).toEqual({ number_id: f.n1, ok: true });
    });

    it.each([
      ['type gif', { bytes: GIF, type: 'image/gif' }],
      ['octets gif déclarés png', { bytes: GIF, type: 'image/png' }],
      ['octets jpeg déclarés png', { bytes: JPEG, type: 'image/png' }],
      ['vide', { bytes: new Uint8Array(0), type: 'image/jpeg' }],
      ['plus de 5 Mo', { bytes: new Uint8Array(5 * 1024 * 1024 + 1).fill(0xff), type: 'image/jpeg' }],
    ])('photo : %s refusée en photo_invalid sans appel', async (_name, file) => {
      const err = await caught(f.svc.updatePhoto('acme', f.a, f.n1, 7, file));
      expect(err.reason).toBe('whatsapp_account.photo_invalid');
      expect(err.message).toBe('Photo refusée : JPEG ou PNG, 5 Mo au plus, 192 × 192 pixels au minimum.');
      expect(f.graph.calls).toEqual([]);
    });

    it('photo : PNG accepté', async () => {
      await f.svc.updatePhoto('acme', f.a, f.n1, 7, { bytes: PNG, type: 'image/png' });
      expect(f.graph.calls[0]!.query).toMatchObject({ file_type: 'image/png' });
    });

    // Ruling R-17
    it('photo : posée mais relecture en échec, profile_saved_unread et audit ok', async () => {
      f.graph.respondWith((c) => (c.method === 'GET' ? metaError(503, { code: 2, message: 'Service temporarily unavailable' }) : undefined));
      const err = await caught(f.svc.updatePhoto('acme', f.a, f.n1, 7, { bytes: JPEG, type: 'image/jpeg' }));
      expect(err.reason).toBe('whatsapp_account.profile_saved_unread');
      expect(f.graph.profiles.get('pn-1')!.photo).not.toBeNull();
      const row = (await db.listAuditLog('acme')).find((r) => r.action === 'whatsapp_number.photo_updated')!;
      expect(row.metadata).toEqual({ number_id: f.n1, ok: true });
    });

    // Ruling R-17 : 100/33 hors du chemin du numéro n'est pas un numéro retiré.
    it.each([
      ["ouverture de la session (/<app>/uploads)", (c: Call) => /\/uploads$/.test(c.path)],
      ["envoi du fichier dans la session", (c: Call) => c.path.startsWith('/upload:')],
    ])('photo : objet inexistant (100/33) à l\'%s, refus générique et non number_removed', async (_name, at) => {
      f.graph.respondWith((c) => (at(c) ? metaError(400, { code: 100, error_subcode: 33, message: 'Unsupported post request.' }) : undefined));
      const err = await caught(f.svc.updatePhoto('acme', f.a, f.n1, 7, { bytes: JPEG, type: 'image/jpeg' }));
      expect(err.status).toBe(422);
      expect(err.reason).toBeUndefined();
      expect(err.message).toBe('Meta a renvoyé une erreur');
      expect(err.message).not.toMatch(/retiré|WABA/);
      expect(err.details).toEqual([{ path: 'photo', message: 'Meta a renvoyé une erreur' }]);
    });

    it('photo : objet inexistant (100/33) à la pose sur le numéro, number_removed', async () => {
      f.graph.respondWith((c) => (c.path === '/pn-1/whatsapp_business_profile' && c.method === 'POST'
        ? metaError(400, { code: 100, error_subcode: 33, message: 'Unsupported post request.' })
        : undefined));
      expect((await caught(f.svc.updatePhoto('acme', f.a, f.n1, 7, { bytes: JPEG, type: 'image/jpeg' }))).reason).toBe('whatsapp_account.number_removed');
    });

    it('photo : trop petite pour Meta (3441013), photo_invalid', async () => {
      f.graph.respondWith((c) => (c.path === '/pn-1/whatsapp_business_profile' && c.method === 'POST'
        ? metaError(400, { code: 1, error_subcode: 3441013, message: 'Image too small' })
        : undefined));
      const err = await caught(f.svc.updatePhoto('acme', f.a, f.n1, 7, { bytes: JPEG, type: 'image/jpeg' }));
      expect(err.reason).toBe('whatsapp_account.photo_invalid');
      const row = (await db.listAuditLog('acme')).find((r) => r.action === 'whatsapp_number.photo_updated')!;
      expect(row.metadata).toEqual({ number_id: f.n1, ok: false, reason: 'whatsapp_account.photo_invalid' });
    });
  });

  describe('nom d\'affichage', () => {
    it('demande de nom : envoyée à Meta, demande en revue écrite et gardée par la relecture des numéros', async () => {
      const before = Date.now();
      const view = await f.svc.requestDisplayName('acme', f.a, f.n1, 7, '  Maison Acme  ');
      const post = f.graph.calls.find((c) => c.method === 'POST')!;
      expect(post).toMatchObject({ path: '/pn-1', body: { new_display_name: 'Maison Acme' } });
      expect(view.id).toBe(f.n1);
      expect(view.display_name).toBe('Boutique 1');
      expect(view.display_name_request).toMatchObject({
        requested_name: 'Maison Acme', status: 'in_review', rejection_reason: null, approved_at: null, apply_before: null, apply_before_approx: false,
      });
      expect(Date.parse(view.display_name_request!.requested_at!)).toBeGreaterThanOrEqual(before - 1000);
      // Relecture des numéros faite par la demande, puis une seconde : la demande reste (applyInventory n'y touche pas).
      expect(f.providers.listMeta).toHaveBeenCalled();
      await f.accounts.refreshNumbers('acme', f.a, 7);
      expect((await db.getWhatsAppNumber('acme', f.n1))!.name_request).toMatchObject({ status: 'in_review', requested_name: 'Maison Acme' });
      const row = (await db.listAuditLog('acme')).find((r) => r.action === 'whatsapp_number.name_requested')!;
      expect(row.metadata).toEqual({ number_id: f.n1, ok: true });
      expect(JSON.stringify(row)).not.toContain('Maison Acme');
    });

    // Ruling R-14 : aucune raison name_change_limit (aucun code de Meta connu) ; le refus de Meta, la limite des
    // 10 changements comprise, est restitué de façon générique avec le texte de Meta.
    it('demande de nom : refus de Meta (limite des 10 changements comprise) restitué avec le texte de Meta, rien écrit', async () => {
      f.graph.respondWith((c) => (c.method === 'POST'
        ? metaError(400, { code: 100, message: 'You have reached the maximum number of display name changes.' })
        : undefined));
      const err = await caught(f.svc.requestDisplayName('acme', f.a, f.n1, 7, 'Maison Acme'));
      expect(err.status).toBe(422);
      expect(err.reason).toBeUndefined();
      expect(err.details).toEqual([{
        path: 'new_display_name', message: 'Meta a renvoyé une erreur', provider_text: 'You have reached the maximum number of display name changes.',
      }]);
      expect((await db.getWhatsAppNumber('acme', f.n1))!.name_request).toBeNull();
      const row = (await db.listAuditLog('acme')).find((r) => r.action === 'whatsapp_number.name_requested')!;
      expect(row.metadata).toEqual({ number_id: f.n1, ok: false, reason: 'provider_refused' });
    });

    it('apply : réussi, nom affiché écrit, demande effacée, numéros relus', async () => {
      await db.setWhatsAppNumberNameRequest('acme', f.a, f.n1, approvedRequest('Maison Acme'));
      // Après le réenregistrement, Meta donne le nouveau nom dans verified_name (spec R2a §13.1).
      vi.mocked(f.providers.listMeta).mockResolvedValue(listing([num(1, { display_name: 'Maison Acme' }), num(2)]));
      const view = await f.svc.applyDisplayName('acme', f.a, f.n1, 7, PIN);
      const post = f.graph.calls.find((c) => c.method === 'POST')!;
      expect(post).toMatchObject({ path: '/pn-1/register', body: { messaging_product: 'whatsapp', pin: PIN } });
      expect(view).toMatchObject({ id: f.n1, display_name: 'Maison Acme', display_name_request: null });
      expect(f.providers.listMeta).toHaveBeenCalled();
      const row = (await db.listAuditLog('acme')).find((r) => r.action === 'whatsapp_number.name_applied')!;
      expect(row.metadata).toEqual({ number_id: f.n1, ok: true });
    });

    it('apply : sans demande approuvée, no_display_name_request sans appel', async () => {
      expect((await caught(f.svc.applyDisplayName('acme', f.a, f.n1, 7, PIN))).reason).toBe('whatsapp_account.no_display_name_request');
      await db.setWhatsAppNumberNameRequest('acme', f.a, f.n1, { ...approvedRequest(), status: 'in_review', approved_at: null, apply_before: null, apply_before_approx: false });
      expect((await caught(f.svc.applyDisplayName('acme', f.a, f.n1, 7, PIN))).reason).toBe('whatsapp_account.no_display_name_request');
      expect(f.graph.calls).toEqual([]);
    });

    it.each(['48291', '4829155', 'abcdef', ' 482915', ''])('apply : code mal formé %j refusé avant tout appel', async (pin) => {
      await db.setWhatsAppNumberNameRequest('acme', f.a, f.n1, approvedRequest());
      const err = await caught(f.svc.applyDisplayName('acme', f.a, f.n1, 7, pin)).catch((e: unknown) => e);
      expect(JSON.stringify(err)).not.toContain(PIN);
      expect(f.graph.calls).toEqual([]);
    });

    it('apply : code refusé, pin_rejected', async () => {
      await db.setWhatsAppNumberNameRequest('acme', f.a, f.n1, approvedRequest());
      f.graph.respondWith((c) => (c.path === '/pn-1/register' ? metaError(400, { code: 133005, message: 'Two step verification PIN Mismatch' }) : undefined));
      const err = await caught(f.svc.applyDisplayName('acme', f.a, f.n1, 7, PIN));
      expect(err.reason).toBe('whatsapp_account.pin_rejected');
      expect(err.message).toBe('Code de vérification en deux étapes refusé par Meta. Vérifiez-le ou changez-le dans WhatsApp Manager.');
      // La demande reste : l'administrateur peut corriger le code.
      expect((await db.getWhatsAppNumber('acme', f.n1))!.name_request).toMatchObject({ status: 'approved_pending' });
      const row = (await db.listAuditLog('acme')).find((r) => r.action === 'whatsapp_number.name_applied')!;
      expect(row.metadata).toEqual({ number_id: f.n1, ok: false, reason: 'whatsapp_account.pin_rejected' });
    });

    it('apply : deux appels simultanés, un seul POST register', async () => {
      await db.setWhatsAppNumberNameRequest('acme', f.a, f.n1, approvedRequest());
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      f.graph.respondWith(async (c) => {
        if (c.path !== '/pn-1/register') return undefined;
        await gate;
        return json(200, { success: true });
      });
      const first = f.svc.applyDisplayName('acme', f.a, f.n1, 7, PIN);
      await vi.waitFor(() => expect(f.graph.calls.filter((c) => c.path === '/pn-1/register')).toHaveLength(1));
      const second = await caught(f.svc.applyDisplayName('acme', f.a, f.n1, 7, PIN));
      expect(second.status).toBe(409);
      expect(second.reason).toBe('whatsapp_account.name_apply_in_progress');
      // Un autre numéro n'est pas bloqué par ce verrou.
      await db.setWhatsAppNumberNameRequest('acme', f.a, f.n2, approvedRequest('Autre nom'));
      await expect(f.svc.applyDisplayName('acme', f.a, f.n2, 7, PIN)).resolves.toMatchObject({ id: f.n2 });
      release();
      await expect(first).resolves.toMatchObject({ id: f.n1 });
      expect(f.graph.calls.filter((c) => c.path === '/pn-1/register')).toHaveLength(1);
      // Verrou relâché : un nouvel appel n'est plus refusé pour « en cours » (plus de demande à appliquer).
      expect((await caught(f.svc.applyDisplayName('acme', f.a, f.n1, 7, PIN))).reason).toBe('whatsapp_account.no_display_name_request');
    });

    it('apply : verrou relâché après un échec', async () => {
      await db.setWhatsAppNumberNameRequest('acme', f.a, f.n1, approvedRequest());
      f.graph.respondWith((c) => (c.path === '/pn-1/register' ? metaError(400, { code: 133005, message: 'PIN Mismatch' }) : undefined));
      await caught(f.svc.applyDisplayName('acme', f.a, f.n1, 7, PIN));
      f.graph.respondWith(() => undefined);
      await expect(f.svc.applyDisplayName('acme', f.a, f.n1, 7, PIN)).resolves.toMatchObject({ display_name_request: null });
    });

    it('apply : délai dépassé, demande effacée et name_apply_expired', async () => {
      // Le client Graph ne reconnaît aucun code d'expiration (ruling R-13) : `expired` est simulé ici.
      const svc = new WhatsAppNumberProfileService({
        db, accounts: f.accounts, graph: { fetchImpl: f.graph.fetchImpl },
        meta: { registerNumber: async () => ({ ok: false, failure: { kind: 'other', message: 'Meta a renvoyé une erreur' }, pinRejected: false, expired: true }) },
      });
      await db.setWhatsAppNumberNameRequest('acme', f.a, f.n1, approvedRequest());
      const err = await caught(svc.applyDisplayName('acme', f.a, f.n1, 7, PIN));
      expect(err.reason).toBe('whatsapp_account.name_apply_expired');
      expect(err.message).toBe('Le délai pour appliquer ce nom est dépassé. Demandez de nouveau ce nom.');
      expect((await db.getWhatsAppNumber('acme', f.n1))!.name_request).toBeNull();
      expect((await db.getWhatsAppNumber('acme', f.n1))!.display_name).toBe('Boutique 1');
    });

    // spec R2a §9.4
    it('apply : code absent des lignes en base, de la trace d\'audit, des journaux et des réponses (deux moteurs)', async () => {
      const logs = captureConsole();
      await db.setWhatsAppNumberNameRequest('acme', f.a, f.n1, approvedRequest());
      await db.setWhatsAppNumberNameRequest('acme', f.a, f.n2, approvedRequest());
      // Échec : Meta recopie le code dans son message.
      f.graph.respondWith((c) => (c.path === '/pn-2/register' ? metaError(400, { code: 100, message: `Invalid parameter pin ${PIN}` }) : undefined));
      const failed = await caught(f.svc.applyDisplayName('acme', f.a, f.n2, 7, PIN));
      const ok = await f.svc.applyDisplayName('acme', f.a, f.n1, 7, PIN);
      const rows = [
        ...(await db.listAuditLog('acme')), ...(await db.listWhatsAppNumbers('acme')), ...(await db.listWhatsAppAccounts('acme')),
      ];
      for (const text of [JSON.stringify(rows), logs.text(), JSON.stringify(ok), JSON.stringify({ m: failed.message, d: failed.details })]) {
        expect(text).not.toContain(PIN);
      }
    });
  });
});

// spec R2a §9.4 : recherche du code dans les octets du fichier de la base (SQLite), après réussite et après échec.
describe('code de vérification en deux étapes absent du fichier de la base', () => {
  let dir: string;
  let db: Database;
  let closed: boolean;

  beforeEach(() => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '0'.repeat(64));
    vi.stubEnv('PUBLIC_BASE_URL', 'https://moteur.example.test');
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wab-pin-'));
    db = createSqliteDriver(path.join(dir, 'pin.db'));
    closed = false;
  });

  afterEach(async () => {
    for (let id = 1; id <= 10; id++) invalidateAccountTransports(id);
    if (!closed) await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('apply : code absent de la base, des journaux capturés, de la réponse et de la trace d\'audit, en réussite et en échec', async () => {
    const logs = captureConsole();
    const f = await setup(db);
    await db.setWhatsAppNumberNameRequest('acme', f.a, f.n1, approvedRequest());
    await db.setWhatsAppNumberNameRequest('acme', f.a, f.n2, approvedRequest());
    f.graph.respondWith((c) => {
      if (c.path === '/pn-2/register') return metaError(400, { code: 133005, message: `PIN ${PIN} mismatch` });
      return undefined;
    });
    const failed = await caught(f.svc.applyDisplayName('acme', f.a, f.n2, 7, PIN));
    expect(failed.reason).toBe('whatsapp_account.pin_rejected');
    const ok = await f.svc.applyDisplayName('acme', f.a, f.n1, 7, PIN);
    expect(f.graph.calls.filter((c) => c.path.endsWith('/register'))).toHaveLength(2);

    const audit = await db.listAuditLog('acme');
    expect(audit.map((r) => r.action)).toEqual(expect.arrayContaining(['whatsapp_number.name_applied']));
    await db.close();
    closed = true;
    const files = fs.readdirSync(dir).map((name) => fs.readFileSync(path.join(dir, name)));
    expect(files.length).toBeGreaterThan(0);
    for (const bytes of files) expect(bytes.includes(Buffer.from(PIN))).toBe(false);
    for (const text of [JSON.stringify(audit), logs.text(), JSON.stringify(ok), JSON.stringify({ m: failed.message, d: failed.details })]) {
      expect(text).not.toContain(PIN);
    }
  });
});
