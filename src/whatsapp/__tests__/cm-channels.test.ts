import { describe, expect, it } from 'vitest';
import { listCmNumbers, verifyCmAccount } from '../cm-channels.js';
import type { CmCredentials } from '../cm-channels.js';

const creds: CmCredentials = { account_id: '6c41cd06-021a-4cc7-b789-6fca0560095b', product_token: 'cm-product-token-SECRET-123' };
const BASE = `https://api.cm.com/channels/v1/accounts/${creds.account_id}`;

interface Call { url: string; headers: Record<string, string>; signal: AbortSignal | null | undefined }

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function profile(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'prof-1', metaId: '109573128361', phoneNumber: '0033612345678', name: 'Boutique Cyran', isSandbox: false,
    entityStatus: 'ACTIVE', metaQualityRating: { rating: 'GREEN', currentLimit: 'TIER_1K' }, ...over,
  };
}

interface Routes {
  channels?: unknown;
  channelsStatus?: number;
  profiles?: Record<string, unknown>;
  profilesStatus?: Record<string, number>;
  business?: Record<string, { status: number; body: unknown }>;
  timeout?: boolean;
  /** Pagination des profils : en-tête `x-cm-pagination-total` omis. */
  omitTotal?: boolean;
  /** Pagination des profils : total annoncé différent du nombre réel. */
  announcedTotal?: number;
  /** Pagination des profils : statut forcé pour la page qui commence à ce `skip`. */
  pageStatus?: Record<number, number>;
}

function cm(routes: Routes): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
    calls.push({ url, headers, signal: init?.signal });
    if (routes.timeout) throw new DOMException('timeout', 'TimeoutError');
    if (url === `${BASE}/channels`) {
      if (routes.channelsStatus === 401) return json(401, { status: 9, message: 'Authorization failed' });
      if (routes.channelsStatus) return json(routes.channelsStatus, { Message: 'Requested url could not be found.' });
      return json(200, routes.channels ?? {});
    }
    const prof = /\/whatsapp\/([^/]+)\/profiles\?includeMetaQualityRating=true(?:&skip=(\d+)&take=(\d+))?$/.exec(url);
    if (prof) {
      const status = routes.profilesStatus?.[prof[1]];
      if (status === 401) return json(401, { status: 9, message: 'Authorization failed' });
      if (status) return json(status, { Message: 'erreur' });
      const all = routes.profiles?.[prof[1]] ?? [];
      // Sans `take` explicite, CM.com ne renvoie qu'une page par défaut de 100 profils.
      const skip = prof[2] === undefined ? 0 : Number(prof[2]);
      const take = prof[3] === undefined ? 100 : Number(prof[3]);
      const forced = routes.pageStatus?.[skip];
      if (forced) return json(forced, { Message: 'erreur' });
      const page = Array.isArray(all) ? all.slice(skip, skip + take) : all;
      const res = json(200, page);
      if (routes.omitTotal !== true && Array.isArray(all)) res.headers.set('x-cm-pagination-total', String(routes.announcedTotal ?? all.length));
      return res;
    }
    const biz = /\/whatsapp\/([^/]+)\/businessaccount$/.exec(url);
    if (biz) {
      const r = routes.business?.[biz[1]];
      return r ? json(r.status, r.body) : json(404, { Message: 'Requested url could not be found.' });
    }
    return json(404, { Message: 'Requested url could not be found.' });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const channelsOne = { available: { whatsApp: { profiles: [{ id: 'c1', channelRequestId: 'CH-1' }] } } };

describe('verifyCmAccount (spec §7.2)', () => {
  it('profils sandbox comptés et non inventoriés ; WABA lue dans businessaccount du canal', async () => {
    const g = cm({
      channels: channelsOne,
      profiles: { 'CH-1': [
        profile(),
        profile({ id: 'prof-2', metaId: 'META-SB', phoneNumber: '0033699999999', isSandbox: true }),
      ] },
      business: { 'CH-1': { status: 200, body: { facebookId: '1492111938931225', metaName: 'Cyran SAS' } } },
    });
    const r = await verifyCmAccount(creds, { fetchImpl: g.fetchImpl });
    expect(r).toMatchObject({ ok: true, waba_id: '1492111938931225', account_name: 'Cyran SAS', meta_app_id: null, token_expiry: null, skipped: { sandbox: 1, invalid_number: 0 } });
    expect(r.ok && r.numbers).toEqual([{
      provider_number_id: '109573128361', phone_e164: '+33612345678', display_name: 'Boutique Cyran',
      meta_status: null, quality: 'GREEN', is_test: false, cm_channel_id: 'CH-1',
    }]);
    expect(r.checks.find((c) => c.key === 'cm_account')?.status).toBe('ok');
    expect(r.checks.find((c) => c.key === 'cm_channels')?.status).toBe('ok');
    expect(g.calls.map((c) => c.url)).toContain(`${BASE}/whatsapp/CH-1/businessaccount`);
  });

  it('en-tête X-CM-PRODUCTTOKEN sur chaque appel, délai de 10 s, jeton jamais dans l\'URL', async () => {
    const g = cm({ channels: channelsOne, profiles: { 'CH-1': [profile()] } });
    await verifyCmAccount(creds, { fetchImpl: g.fetchImpl });
    expect(g.calls.length).toBe(3);
    for (const c of g.calls) {
      expect(c.headers['x-cm-producttoken']).toBe(creds.product_token);
      expect(c.signal).toBeInstanceOf(AbortSignal);
      expect(c.url).not.toContain(creds.product_token);
    }
  });

  it('productToken refusé (401) : token_invalid, message sans le jeton', async () => {
    const r = await verifyCmAccount(creds, { fetchImpl: cm({ channelsStatus: 401 }).fetchImpl });
    expect(r).toMatchObject({ ok: false, error_reason: 'token_invalid' });
    expect(JSON.stringify(r)).not.toContain(creds.product_token);
    expect(r.checks.find((c) => c.key === 'cm_account')?.status).toBe('failed');
  });

  it('productToken refusé à la lecture des profils : token_invalid', async () => {
    const r = await verifyCmAccount(creds, { fetchImpl: cm({ channels: channelsOne, profilesStatus: { 'CH-1': 401 } }).fetchImpl });
    expect(r).toMatchObject({ ok: false, error_reason: 'token_invalid' });
  });

  it('403 : classé other, pas token_invalid', async () => {
    const r = await verifyCmAccount(creds, { fetchImpl: cm({ channelsStatus: 403 }).fetchImpl });
    expect(r).toMatchObject({ ok: false, error_reason: 'other' });
    expect(r.checks.find((c) => c.key === 'cm_account')?.status).toBe('failed');
  });

  it('businessaccount : continue sur les canaux suivants tant qu\'aucun facebookId n\'est lu', async () => {
    const g = cm({
      channels: { available: { whatsApp: { profiles: [{ channelRequestId: 'CH-1' }, { channelRequestId: 'CH-2' }, { channelRequestId: 'CH-3' }] } } },
      profiles: { 'CH-1': [profile()] },
      business: {
        'CH-1': { status: 200, body: { metaName: 'Sans identifiant' } },
        'CH-2': { status: 200, body: { facebookId: null } },
        'CH-3': { status: 200, body: { facebookId: '555', metaName: 'Troisième' } },
      },
    });
    const r = await verifyCmAccount(creds, { fetchImpl: g.fetchImpl });
    expect(r).toMatchObject({ ok: true, waba_id: '555', account_name: 'Troisième' });
    expect(g.calls.filter((c) => c.url.endsWith('/businessaccount'))).toHaveLength(3);
  });

  it('name, metaName et account_name bornés à 200 caractères', async () => {
    const g = cm({
      channels: channelsOne,
      profiles: { 'CH-1': [profile({ name: 'N'.repeat(500) })] },
      business: { 'CH-1': { status: 200, body: { facebookId: '1', metaName: 'M'.repeat(500) } } },
    });
    const r = await verifyCmAccount(creds, { fetchImpl: g.fetchImpl });
    expect(r.ok && r.account_name).toHaveLength(200);
    expect(r.ok && r.numbers[0].display_name).toHaveLength(200);
  });

  it('compte inconnu (404) : other', async () => {
    const r = await verifyCmAccount(creds, { fetchImpl: cm({ channelsStatus: 404 }).fetchImpl });
    expect(r).toMatchObject({ ok: false, error_reason: 'other' });
    expect(r.checks.find((c) => c.key === 'cm_account')?.status).toBe('failed');
  });

  it('profils en erreur autre : other, check cm_channels en échec', async () => {
    const r = await verifyCmAccount(creds, { fetchImpl: cm({ channels: channelsOne, profilesStatus: { 'CH-1': 500 } }).fetchImpl });
    expect(r).toMatchObject({ ok: false, error_reason: 'other' });
    expect(r.checks.find((c) => c.key === 'cm_channels')?.status).toBe('failed');
  });

  it('businessaccount en 404 : la vérification réussit, waba_id nul, nom = accountId', async () => {
    const g = cm({ channels: channelsOne, profiles: { 'CH-1': [profile()] } });
    const r = await verifyCmAccount(creds, { fetchImpl: g.fetchImpl });
    expect(r).toMatchObject({ ok: true, waba_id: null, account_name: creds.account_id });
    expect(r.ok && r.numbers).toHaveLength(1);
  });

  it('plusieurs canaux : tous lus, businessaccount du premier qui répond, numéros cumulés', async () => {
    const g = cm({
      channels: { available: { whatsApp: { profiles: [{ channelRequestId: 'CH-1' }, { channelRequestId: 'CH-2' }] } } },
      profiles: {
        'CH-1': [profile()],
        'CH-2': [profile({ id: 'prof-9', metaId: null, phoneNumber: '0033788888888', name: 'Second' })],
      },
      business: { 'CH-2': { status: 200, body: { facebookId: 777, metaName: 'Second BM' } } },
    });
    const r = await verifyCmAccount(creds, { fetchImpl: g.fetchImpl });
    expect(r).toMatchObject({ ok: true, waba_id: '777', account_name: 'Second BM' });
    expect(r.ok && r.numbers.map((n) => [n.provider_number_id, n.cm_channel_id])).toEqual([['109573128361', 'CH-1'], ['cm:prof-9', 'CH-2']]);
  });

  it('profils non actifs écartés sans erreur ni compte ; numéro invalide compté', async () => {
    const g = cm({ channels: channelsOne, profiles: { 'CH-1': [
      profile(),
      profile({ id: 'p2', metaId: 'M2', entityStatus: 'DELETED' }),
      profile({ id: 'p3', metaId: 'M3', entityStatus: 'PENDING' }),
      profile({ id: 'p4', metaId: 'M4', phoneNumber: '0612' }),
    ] } });
    const r = await verifyCmAccount(creds, { fetchImpl: g.fetchImpl });
    expect(r.ok && r.numbers).toHaveLength(1);
    expect(r.ok && r.skipped).toEqual({ sandbox: 0, invalid_number: 1 });
  });

  it('aucun canal WhatsApp (available.whatsApp absent ou null) : liste vide, pas d\'erreur', async () => {
    for (const channels of [{}, { available: {} }, { available: { whatsApp: null } }, { available: { whatsApp: { profiles: null } } }]) {
      const r = await verifyCmAccount(creds, { fetchImpl: cm({ channels }).fetchImpl });
      expect(r).toMatchObject({ ok: true, numbers: [], waba_id: null, skipped: { sandbox: 0, invalid_number: 0 } });
    }
  });

  it('délai dépassé : other, message « CM.com ne répond pas »', async () => {
    const r = await verifyCmAccount(creds, { fetchImpl: cm({ timeout: true }).fetchImpl });
    expect(r).toMatchObject({ ok: false, error_reason: 'other', message: 'CM.com ne répond pas' });
  });

  // revue 2b-2 M-1
  it('délai dépassé, erreur réseau, réponse 5xx : transient ; 401, 403, 404 : sans transient', async () => {
    const timeout = await verifyCmAccount(creds, { fetchImpl: cm({ timeout: true }).fetchImpl });
    const network = await verifyCmAccount(creds, { fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch });
    const server = await verifyCmAccount(creds, { fetchImpl: cm({ channelsStatus: 502 }).fetchImpl });
    const profiles = await verifyCmAccount(creds, { fetchImpl: cm({ channels: channelsOne, profilesStatus: { 'CH-1': 500 } }).fetchImpl });
    for (const r of [timeout, network, server, profiles]) expect(r).toMatchObject({ ok: false, error_reason: 'other', transient: true });
    // revue 2b-2 M-1 : limite de débit
    expect(await verifyCmAccount(creds, { fetchImpl: cm({ channelsStatus: 429 }).fetchImpl })).toMatchObject({ ok: false, transient: true });
    for (const status of [401, 403, 404]) {
      const r = await verifyCmAccount(creds, { fetchImpl: cm({ channelsStatus: status }).fetchImpl });
      expect([status, r.ok, 'transient' in r]).toEqual([status, false, false]);
    }
  });

  it('un même profil déclaré deux fois n\'est inventorié qu\'une fois', async () => {
    const g = cm({ channels: { available: { whatsApp: { profiles: [{ channelRequestId: 'CH-1' }, { channelRequestId: 'CH-2' }] } } },
      profiles: { 'CH-1': [profile()], 'CH-2': [profile()] } });
    const r = await verifyCmAccount(creds, { fetchImpl: g.fetchImpl });
    expect(r.ok && r.numbers).toHaveLength(1);
  });
});

describe('listCmNumbers (spec §7.4)', () => {
  it('même inventaire, sans appel businessaccount', async () => {
    const g = cm({ channels: channelsOne, profiles: { 'CH-1': [profile(), profile({ id: 'sb', metaId: 'S', isSandbox: true })] } });
    const r = await listCmNumbers(creds, { fetchImpl: g.fetchImpl });
    expect(r.error).toBeUndefined();
    expect(r.numbers).toHaveLength(1);
    expect(r.skipped).toEqual({ sandbox: 1, invalid_number: 0 });
    expect(g.calls.some((c) => c.url.endsWith('/businessaccount'))).toBe(false);
  });

  it('productToken refusé : error token_invalid', async () => {
    const r = await listCmNumbers(creds, { fetchImpl: cm({ channelsStatus: 401 }).fetchImpl });
    expect(r.error).toMatchObject({ reason: 'token_invalid' });
    expect(r.numbers).toEqual([]);
  });
});

describe('listCmNumbers : inventaire paginé', () => {
  const many = (n: number): Record<string, unknown>[] =>
    Array.from({ length: n }, (_, i) => profile({ id: `p${i}`, metaId: `M${i}`, phoneNumber: `00336${String(10000000 + i)}` }));
  const profileCalls = (calls: Call[]): string[] => calls.filter((c) => c.url.includes('/profiles?')).map((c) => c.url.split('profiles?')[1]);

  it('250 profils sur 3 pages : take 100 explicite, skip croissant, tous les numéros lus', async () => {
    const g = cm({ channels: channelsOne, profiles: { 'CH-1': many(250) } });
    const r = await listCmNumbers(creds, { fetchImpl: g.fetchImpl });
    expect(r.error).toBeUndefined();
    expect(r.numbers).toHaveLength(250);
    expect(profileCalls(g.calls)).toEqual([
      'includeMetaQualityRating=true&skip=0&take=100',
      'includeMetaQualityRating=true&skip=100&take=100',
      'includeMetaQualityRating=true&skip=200&take=100',
    ]);
  });

  it('en-tête de total absent : une page plus courte que take termine', async () => {
    const g = cm({ channels: channelsOne, profiles: { 'CH-1': many(250) }, omitTotal: true });
    const r = await listCmNumbers(creds, { fetchImpl: g.fetchImpl });
    expect(r.error).toBeUndefined();
    expect(r.numbers).toHaveLength(250);
    expect(profileCalls(g.calls)).toHaveLength(3);
  });

  it('en-tête absent et dernière page pleine : une page de plus (vide) termine', async () => {
    const g = cm({ channels: channelsOne, profiles: { 'CH-1': many(200) }, omitTotal: true });
    const r = await listCmNumbers(creds, { fetchImpl: g.fetchImpl });
    expect(r.error).toBeUndefined();
    expect(r.numbers).toHaveLength(200);
    expect(profileCalls(g.calls)).toHaveLength(3);
  });

  it('page 2 en 500 : la lecture échoue (transitoire), aucune liste partielle', async () => {
    const g = cm({ channels: channelsOne, profiles: { 'CH-1': many(250) }, pageStatus: { 100: 500 } });
    const r = await listCmNumbers(creds, { fetchImpl: g.fetchImpl });
    expect(r.error).toMatchObject({ reason: 'other', transient: true });
    expect(r.numbers).toEqual([]);
  });

  it('total annoncé non atteint (page courte) : la lecture échoue, aucune liste partielle', async () => {
    const g = cm({ channels: channelsOne, profiles: { 'CH-1': many(250) }, announcedTotal: 400 });
    const r = await listCmNumbers(creds, { fetchImpl: g.fetchImpl });
    expect(r.error).toMatchObject({ reason: 'other', transient: true });
    expect(r.numbers).toEqual([]);
  });

  it('plafond de 50 pages atteint sans fin : la lecture échoue, aucune liste partielle', async () => {
    const g = cm({ channels: channelsOne, profiles: { 'CH-1': many(5100) }, omitTotal: true });
    const r = await listCmNumbers(creds, { fetchImpl: g.fetchImpl });
    expect(r.error).toMatchObject({ reason: 'other' });
    expect(r.numbers).toEqual([]);
    expect(profileCalls(g.calls)).toHaveLength(50);
  });

  it('verifyCmAccount lit aussi toutes les pages, et refuse une liste partielle', async () => {
    const ok = await verifyCmAccount(creds, { fetchImpl: cm({ channels: channelsOne, profiles: { 'CH-1': many(250) } }).fetchImpl });
    expect(ok.ok && ok.numbers).toHaveLength(250);
    const ko = await verifyCmAccount(creds, { fetchImpl: cm({ channels: channelsOne, profiles: { 'CH-1': many(250) }, pageStatus: { 200: 503 } }).fetchImpl });
    expect(ko).toMatchObject({ ok: false, transient: true });
  });
});
