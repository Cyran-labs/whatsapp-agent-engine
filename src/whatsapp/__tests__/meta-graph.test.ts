import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { appSecretProof, listMetaNumbers, verifyMetaManual } from '../meta-graph.js';
import type { MetaManualCredentials } from '../meta-graph.js';
import type { ProviderVerification } from '../provider-common.js';

const creds: MetaManualCredentials = {
  waba_id: '1122051030798254',
  access_token: 'EAAGsecretTOKENvalue1234567890',
  app_secret: 'appsecretvalueabcdef',
};

interface Call { method: string; url: URL; headers: Record<string, string>; signal: AbortSignal | null | undefined }

interface GraphOptions {
  subscribed?: boolean;
  expiresAt?: number | null;
  /** Code d'erreur renvoyé par le premier appel (étape jeton et accès). */
  tokenError?: 190;
  /** Erreur renvoyée par debug_token seulement. */
  debugError?: 'invalid' | 'other';
  appId?: string;
  debugIsValid?: boolean;
  wabaError?: 'secret' | 'subcode33' | 'other' | 'echo-token';
  subscribedAppsError?: boolean;
  numbers?: Array<Record<string, unknown>>;
  pages?: Array<{ data: Array<Record<string, unknown>>; next?: string }>;
  timeout?: boolean;
  postStatus?: number;
}

const NUMBER_A = {
  id: '1095731283613082', display_phone_number: '+1 555-141-2647', verified_name: 'Test Number',
  status: 'CONNECTED', quality_rating: 'GREEN', account_mode: 'LIVE',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function graph(options: GraphOptions = {}): { fetchImpl: typeof fetch; calls: Call[]; posts: () => Call[] } {
  const calls: Call[] = [];
  let pageIndex = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
    calls.push({ method: init?.method ?? 'GET', url, headers, signal: init?.signal });
    if (options.timeout) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const path = url.pathname;
    if (path.endsWith('/debug_token')) {
      if (options.debugError === 'invalid') return json(401, { error: { message: 'Invalid OAuth access token', type: 'OAuthException', code: 190 } });
      if (options.debugError === 'other') return json(500, { error: { message: 'boom', code: 2 } });
      const expires = options.expiresAt === undefined ? 0 : options.expiresAt;
      return json(200, { data: {
        app_id: options.appId ?? 'APP-1', type: 'SYSTEM_USER', is_valid: options.debugIsValid ?? true,
        ...(expires === null ? {} : { expires_at: expires }),
      } });
    }
    if (path.endsWith('/subscribed_apps')) {
      if ((init?.method ?? 'GET') === 'POST') return json(options.postStatus ?? 200, { success: true });
      if (options.subscribedAppsError) return json(500, { error: { message: 'subscribed_apps indisponible', code: 2 } });
      return json(200, { data: options.subscribed ? [{ whatsapp_business_api_data: { id: 'APP-1', name: 'WABAGENT Dev' } }] : [
        { whatsapp_business_api_data: { id: '2202427980234937', name: 'Autre app' } },
      ] });
    }
    if (path.endsWith('/phone_numbers')) {
      if (options.pages) {
        const page = options.pages[pageIndex++] ?? { data: [] };
        return json(200, { data: page.data, paging: page.next ? { cursors: { after: 'x' }, next: page.next } : { cursors: { after: 'x' } } });
      }
      return json(200, { data: options.numbers ?? [NUMBER_A], paging: { cursors: { after: 'x' } } });
    }
    if (options.tokenError === 190) return json(401, { error: { message: 'Authentication Error', type: 'OAuthException', code: 190 } });
    if (options.wabaError === 'secret') return json(400, { error: { message: 'Invalid appsecret_proof provided in the API argument', type: 'GraphMethodException', code: 100 } });
    if (options.wabaError === 'subcode33') return json(400, { error: { message: 'Unsupported get request', type: 'GraphMethodException', code: 100, error_subcode: 33 } });
    if (options.wabaError === 'other') return json(400, { error: { message: "Tried accessing nonexisting field (phone_numbers) on node type (WhatsAppBusinessPhoneNumber)", type: 'GraphMethodException', code: 100 } });
    if (options.wabaError === 'echo-token') return json(400, { error: { message: `Bad request for ${creds.access_token} with ${creds.app_secret} ${'x'.repeat(400)}`, code: 1 } });
    return json(200, { id: creds.waba_id, name: 'Test Messaging Account' });
  }) as typeof fetch;
  return { fetchImpl, calls, posts: () => calls.filter((c) => c.method === 'POST') };
}

function checkStatus(r: ProviderVerification, key: string): string | undefined {
  return r.checks.find((c) => c.key === key)?.status;
}

describe('appSecretProof', () => {
  it('est le HMAC-SHA256 hexadécimal du jeton avec le secret de l\'app', () => {
    const expected = createHmac('sha256', 'secret').update('token').digest('hex');
    expect(appSecretProof('token', 'secret')).toBe(expected);
    expect(appSecretProof('token', 'secret')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('verifyMetaManual (spec §7.1)', () => {
  it('vérification complète : abonnement existant, numéros inventoriés, expiration lue', async () => {
    const g = graph({ subscribed: true, expiresAt: 0 });
    const r = await verifyMetaManual(creds, { fetchImpl: g.fetchImpl });
    expect(r).toMatchObject({ ok: true, meta_app_id: 'APP-1', token_expiry: 'never', account_name: 'Test Messaging Account', waba_id: creds.waba_id });
    // Tâche 0 d : account_mode ne désigne pas le numéro de test, is_test vaut toujours false chez Meta.
    expect(r.ok && r.numbers[0]).toMatchObject({
      provider_number_id: '1095731283613082', phone_e164: '+15551412647', is_test: false,
      display_name: 'Test Number', meta_status: 'CONNECTED', quality: 'GREEN', cm_channel_id: null,
    });
    expect(checkStatus(r, 'subscription')).toBe('ok');
    expect(checkStatus(r, 'token')).toBe('ok');
    expect(checkStatus(r, 'waba_access')).toBe('ok');
    expect(checkStatus(r, 'app_secret')).toBe('ok');
    expect(checkStatus(r, 'token_expiry')).toBe('ok');
    expect(checkStatus(r, 'numbers')).toBe('ok');
    expect(g.posts()).toHaveLength(0);
    expect(r.ok && r.skipped).toEqual({ sandbox: 0, invalid_number: 0 });
  });

  it("abonnement absent : POST subscribed_apps envoyé une fois, check 'created', sans override_callback_uri", async () => {
    const g = graph({ subscribed: false });
    const r = await verifyMetaManual(creds, { fetchImpl: g.fetchImpl });
    expect(r.ok).toBe(true);
    expect(checkStatus(r, 'subscription')).toBe('created');
    expect(g.posts()).toHaveLength(1);
    expect(g.posts()[0].url.pathname).toBe(`/v26.0/${creds.waba_id}/subscribed_apps`);
    expect(g.posts()[0].url.search).not.toContain('override_callback_uri');
  });

  it('meta_app_id illisible (debug_token en échec autre que le jeton) : expiration nulle, abonnement créé', async () => {
    const g = graph({ debugError: 'other' });
    const r = await verifyMetaManual(creds, { fetchImpl: g.fetchImpl });
    expect(r).toMatchObject({ ok: true, meta_app_id: null, token_expiry: null });
    expect(checkStatus(r, 'token_expiry')).toBe('pending');
    expect(checkStatus(r, 'subscription')).toBe('created');
    expect(g.posts()).toHaveLength(1);
  });

  it('expiration datée : ISO ; expires_at absent : null', async () => {
    const dated = await verifyMetaManual(creds, { fetchImpl: graph({ subscribed: true, expiresAt: 1_800_000_000 }).fetchImpl });
    expect(dated.ok && dated.token_expiry).toBe(new Date(1_800_000_000_000).toISOString());
    const unreadable = await verifyMetaManual(creds, { fetchImpl: graph({ subscribed: true, expiresAt: null }).fetchImpl });
    expect(unreadable.ok && unreadable.token_expiry).toBeNull();
  });

  it('jeton refusé (190) : token_invalid, aucun POST, message sans le jeton', async () => {
    const g = graph({ tokenError: 190 });
    const r = await verifyMetaManual(creds, { fetchImpl: g.fetchImpl });
    expect(r).toMatchObject({ ok: false, error_reason: 'token_invalid' });
    expect(JSON.stringify(r)).not.toContain(creds.access_token);
    expect(JSON.stringify(r)).not.toContain(creds.app_secret);
    expect(JSON.stringify(r)).not.toContain(appSecretProof(creds.access_token, creds.app_secret));
    expect(g.posts()).toHaveLength(0);
    expect(checkStatus(r, 'token')).toBe('failed');
  });

  it('jeton refusé à debug_token : token_invalid, aucun POST', async () => {
    const g = graph({ debugError: 'invalid' });
    const r = await verifyMetaManual(creds, { fetchImpl: g.fetchImpl });
    expect(r).toMatchObject({ ok: false, error_reason: 'token_invalid' });
    expect(g.posts()).toHaveLength(0);
  });

  it('jeton déclaré invalide par debug_token (is_valid false) : token_invalid', async () => {
    const r = await verifyMetaManual(creds, { fetchImpl: graph({ debugIsValid: false }).fetchImpl });
    expect(r).toMatchObject({ ok: false, error_reason: 'token_invalid' });
  });

  it("secret de l'app refusé (400, code 100, appsecret_proof) : check app_secret en échec, raison other", async () => {
    const g = graph({ wabaError: 'secret' });
    const r = await verifyMetaManual(creds, { fetchImpl: g.fetchImpl });
    expect(r).toMatchObject({ ok: false, error_reason: 'other', message: "Secret de l'app refusé" });
    expect(checkStatus(r, 'app_secret')).toBe('failed');
    expect(g.posts()).toHaveLength(0);
  });

  it('WABA introuvable ou non partagée (code 100, sous-code 33) : check waba_access en échec, raison other', async () => {
    const g = graph({ wabaError: 'subcode33' });
    const r = await verifyMetaManual(creds, { fetchImpl: g.fetchImpl });
    expect(r).toMatchObject({ ok: false, error_reason: 'other', message: 'Identifiant de compte introuvable ou non partagé avec le jeton' });
    expect(checkStatus(r, 'waba_access')).toBe('failed');
    expect(g.posts()).toHaveLength(0);
  });

  it('code 100 sans appsecret_proof ni sous-code 33 : ce n\'est pas une erreur de secret', async () => {
    const r = await verifyMetaManual(creds, { fetchImpl: graph({ wabaError: 'other' }).fetchImpl });
    expect(r).toMatchObject({ ok: false, error_reason: 'other' });
    expect(checkStatus(r, 'app_secret')).not.toBe('failed');
  });

  it('message du fournisseur qui répète jeton et secret : masqué, au plus 200 caractères', async () => {
    const r = await verifyMetaManual(creds, { fetchImpl: graph({ wabaError: 'echo-token' }).fetchImpl });
    expect(r.ok).toBe(false);
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain(creds.access_token);
    expect(serialized).not.toContain(creds.app_secret);
    if (!r.ok) {
      expect(r.message).toContain('[masqué]');
      expect(r.message.length).toBeLessThanOrEqual(200);
      for (const c of r.checks) expect((c.detail ?? '').length).toBeLessThanOrEqual(200);
    }
  });

  it('abonnements illisibles : échec other, aucun POST', async () => {
    const g = graph({ subscribedAppsError: true });
    const r = await verifyMetaManual(creds, { fetchImpl: g.fetchImpl });
    expect(r).toMatchObject({ ok: false, error_reason: 'other' });
    expect(checkStatus(r, 'subscription')).toBe('failed');
    expect(g.posts()).toHaveLength(0);
  });

  it('POST subscribed_apps refusé : échec, check subscription en échec', async () => {
    const r = await verifyMetaManual(creds, { fetchImpl: graph({ subscribed: false, postStatus: 400 }).fetchImpl });
    expect(r).toMatchObject({ ok: false, error_reason: 'other' });
    expect(checkStatus(r, 'subscription')).toBe('failed');
  });

  it('appsecret_proof envoyé sur chaque appel Graph et égal au HMAC du jeton', async () => {
    const g = graph({ subscribed: false });
    await verifyMetaManual(creds, { fetchImpl: g.fetchImpl });
    const expected = appSecretProof(creds.access_token, creds.app_secret);
    expect(g.calls.length).toBeGreaterThanOrEqual(5);
    for (const call of g.calls) {
      expect(call.url.searchParams.get('appsecret_proof')).toBe(expected);
      expect(call.headers['authorization']).toBe(`Bearer ${creds.access_token}`);
      expect(call.url.hostname).toBe('graph.facebook.com');
      // Le jeton ne passe jamais dans l'URL, sauf input_token de debug_token.
      if (!call.url.pathname.endsWith('/debug_token')) expect(call.url.href).not.toContain(creds.access_token);
    }
  });

  it('chaque appel porte un délai de 10 s (AbortSignal)', async () => {
    const g = graph({ subscribed: true });
    await verifyMetaManual(creds, { fetchImpl: g.fetchImpl });
    for (const call of g.calls) expect(call.signal).toBeInstanceOf(AbortSignal);
  });

  it('délai dépassé : other, message « Meta ne répond pas »', async () => {
    const r = await verifyMetaManual(creds, { fetchImpl: graph({ timeout: true }).fetchImpl });
    expect(r).toMatchObject({ ok: false, error_reason: 'other', message: 'Meta ne répond pas' });
  });

  it('AbortError simulé : même classement', async () => {
    const fetchImpl = (async () => { throw new DOMException('aborted', 'AbortError'); }) as typeof fetch;
    const r = await verifyMetaManual(creds, { fetchImpl });
    expect(r).toMatchObject({ ok: false, error_reason: 'other', message: 'Meta ne répond pas' });
  });

  it('erreur réseau : other, message sans détail de l\'erreur', async () => {
    const fetchImpl = (async () => { throw new TypeError(`fetch failed ${creds.access_token}`); }) as typeof fetch;
    const r = await verifyMetaManual(creds, { fetchImpl });
    expect(r).toMatchObject({ ok: false, error_reason: 'other' });
    expect(JSON.stringify(r)).not.toContain(creds.access_token);
  });
});

describe('listMetaNumbers (spec §7.4)', () => {
  it('numéros affichés avec espaces et tirets normalisés en E.164 ; invalide écarté et compté', async () => {
    const g = graph({ numbers: [
      NUMBER_A,
      { id: '2', display_phone_number: '+33 6 12 34 56 78', verified_name: 'Boutique', status: 'CONNECTED', quality_rating: 'YELLOW' },
      { id: '3', display_phone_number: '06 12 34 56 78', verified_name: 'National', status: 'CONNECTED', quality_rating: 'GREEN' },
      { id: '4', verified_name: 'Sans numéro' },
    ] });
    const r = await listMetaNumbers(creds, { fetchImpl: g.fetchImpl });
    expect(r.error).toBeUndefined();
    expect(r.numbers.map((n) => n.phone_e164)).toEqual(['+15551412647', '+33612345678']);
    expect(r.numbers[1]).toMatchObject({ provider_number_id: '2', display_name: 'Boutique', quality: 'YELLOW', meta_status: 'CONNECTED', is_test: false });
    expect(r.skipped).toEqual({ sandbox: 0, invalid_number: 2 });
  });

  it('numéro de test : is_test reste false même avec account_mode LIVE ou SANDBOX', async () => {
    const g = graph({ numbers: [{ ...NUMBER_A, account_mode: 'SANDBOX' }] });
    const r = await listMetaNumbers(creds, { fetchImpl: g.fetchImpl });
    expect(r.numbers[0].is_test).toBe(false);
  });

  it('pagination : paging.next suivi tant qu\'il est présent, 100 par page', async () => {
    const next = 'https://graph.facebook.com/v26.0/1122051030798254/phone_numbers?limit=100&after=CURSOR&access_token=x';
    const g = graph({ pages: [
      { data: [NUMBER_A], next },
      { data: [{ id: '2', display_phone_number: '+33 6 12 34 56 78', verified_name: 'B', status: 'CONNECTED', quality_rating: 'GREEN' }] },
    ] });
    const r = await listMetaNumbers(creds, { fetchImpl: g.fetchImpl });
    expect(r.numbers).toHaveLength(2);
    const lists = g.calls.filter((c) => c.url.pathname.endsWith('/phone_numbers'));
    expect(lists).toHaveLength(2);
    expect(lists[0].url.searchParams.get('limit')).toBe('100');
    expect(lists[1].url.searchParams.get('after')).toBe('CURSOR');
    expect(lists[1].url.searchParams.get('appsecret_proof')).toBe(appSecretProof(creds.access_token, creds.app_secret));
  });

  it('sans paging.next : un seul appel', async () => {
    const g = graph();
    await listMetaNumbers(creds, { fetchImpl: g.fetchImpl });
    expect(g.calls.filter((c) => c.url.pathname.endsWith('/phone_numbers'))).toHaveLength(1);
  });

  it('paging.next vers un autre hôte : refusé, le jeton n\'est pas envoyé ailleurs', async () => {
    const g = graph({ pages: [{ data: [NUMBER_A], next: 'https://evil.example.com/steal?after=x' }] });
    const r = await listMetaNumbers(creds, { fetchImpl: g.fetchImpl });
    expect(r.error).toMatchObject({ reason: 'other' });
    expect(g.calls.every((c) => c.url.hostname === 'graph.facebook.com')).toBe(true);
  });

  it('jeton refusé : error token_invalid, aucun numéro', async () => {
    const fetchImpl = (async () => json(401, { error: { message: 'Authentication Error', code: 190 } })) as typeof fetch;
    const r = await listMetaNumbers(creds, { fetchImpl });
    expect(r.error).toMatchObject({ reason: 'token_invalid' });
    expect(r.numbers).toEqual([]);
  });

  it('vérification : un numéro sans affichage valide est compté dans skipped.invalid_number', async () => {
    const g = graph({ subscribed: true, numbers: [NUMBER_A, { id: '9', display_phone_number: 'abc', verified_name: 'X' }] });
    const r = await verifyMetaManual(creds, { fetchImpl: g.fetchImpl });
    expect(r.ok && r.numbers).toHaveLength(1);
    expect(r.ok && r.skipped.invalid_number).toBe(1);
  });
});
