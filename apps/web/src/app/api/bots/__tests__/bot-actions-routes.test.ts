import { test, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
const requestHeaders = new Map<string, string>();
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (k: string) => requestHeaders.get(k.toLowerCase()) ?? null }),
  cookies: async () => ({
    get: (k: string) => (store.has(k) ? { value: store.get(k) } : undefined),
    set: (k: string, v: string) => { store.set(k, v); },
    delete: (k: string) => { store.delete(k); },
  }),
}));

import { PUT as putNumber } from '../[botId]/number/route';
import { POST as unassignNumber } from '../[botId]/number/unassign/route';
import { PUT as putStatus } from '../[botId]/status/route';
import { PUT as putAllowlist } from '../[botId]/allowlist/route';
import { POST as activate } from '../[botId]/activate/route';
import { ACCESS_COOKIE, ORG_COOKIE } from '@/lib/session';
import { fakeAccess } from '@/lib/__tests__/fake-access';

const ENGINE = 'http://engine.test/api/admin/v1';

beforeEach(() => {
  process.env.ENGINE_API_URL = ENGINE;
  store.clear();
  requestHeaders.clear();
  store.set(ACCESS_COOKIE, fakeAccess(1));
  store.set(ORG_COOKIE, '1:c1');
  vi.restoreAllMocks();
});

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const req = (method: string, body?: unknown) =>
  new Request('http://web.test/api/bots/sales/x', { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const ctx = (botId: string) => ({ params: Promise.resolve({ botId }) });

function firstCall(fetchMock: ReturnType<typeof vi.fn>): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, init };
}

// revue 2b-3 M-1
test('PUT /api/bots/:botId/number relaie number_id et expected_bot_id ; identifiant absent ou non entier, détenteur attendu absent refusés sans appel', async () => {
  const fetchMock = vi.fn(async () => jsonRes({ bot_id: 'sales' }));
  vi.stubGlobal('fetch', fetchMock);
  const ok = await putNumber(req('PUT', { number_id: 8, expected_bot_id: 'ventes' }), ctx('sales'));
  expect(ok.status).toBe(200);
  const { url, init } = firstCall(fetchMock);
  expect(url).toBe(`${ENGINE}/bots/sales/number`);
  expect(init.method).toBe('PUT');
  expect(JSON.parse(String(init.body))).toEqual({ number_id: 8, expected_bot_id: 'ventes' });
  fetchMock.mockClear();
  for (const bad of [{}, { number_id: 'x', expected_bot_id: null }, { number_id: 0, expected_bot_id: null }, { number_id: 8 }, { number_id: 8, expected_bot_id: 3 }]) {
    expect((await putNumber(req('PUT', bad), ctx('sales'))).status).toBe(400);
  }
  expect(fetchMock).not.toHaveBeenCalled();
});

// revue finale 2b-3 I-2
test("POST /api/bots/:botId/number/unassign : expected_number_id relayé, vue de l'agent IA renvoyée ; absent ou invalide refusé sans appel", async () => {
  const fetchMock = vi.fn(async () => jsonRes({ bot_id: 'sales', status: 'draft', number: null }));
  vi.stubGlobal('fetch', fetchMock);
  for (const bad of [{}, { expected_number_id: null }, { expected_number_id: 0 }, { expected_number_id: '3' }, { expected_number_id: 1.5 }]) {
    const res = await unassignNumber(req('POST', bad), ctx('sales'));
    expect(res.status).toBe(400);
  }
  expect(fetchMock).not.toHaveBeenCalled();
  const res = await unassignNumber(req('POST', { expected_number_id: 4 }), ctx('sales'));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ bot_id: 'sales', status: 'draft', number: null });
  const { url, init } = firstCall(fetchMock);
  expect(url).toBe(`${ENGINE}/bots/sales/number/unassign`);
  expect(init.method).toBe('POST');
  expect(JSON.parse(String(init.body))).toEqual({ expected_number_id: 4 });
});

test('POST /api/bots/:botId/number/unassign : le 409 « numéro changé » du moteur est relayé avec son détail', async () => {
  const stale = 'Ce numéro a changé depuis votre lecture : vérifiez la liste.';
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ error: { code: 'CONFLICT', message: stale, details: [{ path: 'expected_bot_id', message: stale }] } }, 409)));
  const res = await unassignNumber(req('POST', { expected_number_id: 4 }), ctx('sales'));
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: { code: 'CONFLICT', details: [{ path: 'expected_bot_id' }] } });
});

test('PUT /api/bots/:botId/status : statut inconnu refusé sans appel, statut valide relayé', async () => {
  const fetchMock = vi.fn(async () => jsonRes({ bot_id: 'sales', status: 'paused' }));
  vi.stubGlobal('fetch', fetchMock);
  const bad = await putStatus(req('PUT', { status: 'deleted' }), ctx('sales'));
  expect(bad.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
  const ok = await putStatus(req('PUT', { status: 'paused' }), ctx('sales'));
  expect(ok.status).toBe(200);
  const { url, init } = firstCall(fetchMock);
  expect(url).toBe(`${ENGINE}/bots/sales/status`);
  expect(init.method).toBe('PUT');
  expect(JSON.parse(String(init.body))).toEqual({ status: 'paused' });
});

test("PUT /api/bots/:botId/allowlist : plus de 20 entrées refusées en 400 sans appel au moteur", async () => {
  const fetchMock = vi.fn(async () => jsonRes({ bot_id: 'sales' }));
  vi.stubGlobal('fetch', fetchMock);
  const entries = Array.from({ length: 21 }, (_, i) => `+3361245${String(i).padStart(4, '0')}`);
  const bad = await putAllowlist(req('PUT', { entries }), ctx('sales'));
  expect(bad.status).toBe(400);
  expect((await bad.json()).error.code).toBe('VALIDATION_ERROR');
  expect(fetchMock).not.toHaveBeenCalled();

  const ok = await putAllowlist(req('PUT', { entries: entries.slice(0, 20) }), ctx('sales'));
  expect(ok.status).toBe(200);
  const { url, init } = firstCall(fetchMock);
  expect(url).toBe(`${ENGINE}/bots/sales/allowlist`);
  expect(init.method).toBe('PUT');
  expect(JSON.parse(String(init.body)).entries).toHaveLength(20);
});

// revue 2b-3 M-1
test('POST /api/bots/:botId/activate : number_id ou expected_bot_id manquant refusé sans appel, corps valide relayé', async () => {
  const fetchMock = vi.fn(async () => jsonRes({ bot_id: 'sales', status: 'limited' }));
  vi.stubGlobal('fetch', fetchMock);
  const bad = await activate(req('POST', { status: 'limited', allowlist: [] }), ctx('sales'));
  expect(bad.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
  const noHolder = await activate(req('POST', { number_id: 8, status: 'limited', allowlist: [] }), ctx('sales'));
  expect(noHolder.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
  const ok = await activate(req('POST', { number_id: 8, expected_bot_id: null, status: 'limited', allowlist: ['+33612457890'] }), ctx('sales'));
  expect(ok.status).toBe(200);
  const { url, init } = firstCall(fetchMock);
  expect(url).toBe(`${ENGINE}/bots/sales/activate`);
  expect(init.method).toBe('POST');
  expect(JSON.parse(String(init.body))).toEqual({ number_id: 8, expected_bot_id: null, status: 'limited', allowlist: ['+33612457890'] });
});

test("botId texte (identifiant d'agent IA) : encodé dans le chemin, jamais traité comme numérique", async () => {
  const fetchMock = vi.fn(async () => jsonRes({ bot_id: 'ventes-paris' }));
  vi.stubGlobal('fetch', fetchMock);
  const res = await putStatus(req('PUT', { status: 'active' }), ctx('ventes-paris'));
  expect(res.status).toBe(200);
  expect(firstCall(fetchMock).url).toBe(`${ENGINE}/bots/ventes-paris/status`);
  fetchMock.mockClear();
  await putStatus(req('PUT', { status: 'active' }), ctx('a/../b'));
  expect(firstCall(fetchMock).url).toBe(`${ENGINE}/bots/a%2F..%2Fb/status`);
});

test('refus du moteur relayé tel quel (409 compte non connecté, 422 par champ)', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ error: { code: 'CONFLICT', message: "Le compte WhatsApp de ce numéro n'est pas connecté." } }, 409)));
  const conflict = await activate(req('POST', { number_id: 8, expected_bot_id: null, status: 'limited', allowlist: [] }), ctx('sales'));
  expect(conflict.status).toBe(409);
  expect((await conflict.json()).error.message).toBe("Le compte WhatsApp de ce numéro n'est pas connecté.");

  const details = [{ path: 'entries.2', message: 'Numéro invalide.' }];
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ error: { code: 'VALIDATION_ERROR', message: 'Liste invalide.', details } }, 422)));
  const invalid = await putAllowlist(req('PUT', { entries: ['a', 'b', 'c'] }), ctx('sales'));
  expect(invalid.status).toBe(422);
  expect((await invalid.json()).error.details).toEqual(details);
});

test('organisation affichée différente du cookie : 409 ORG_CHANGED sans appel au moteur', async () => {
  store.set(ORG_COOKIE, '1:c2');
  requestHeaders.set('x-wab-org', 'c1');
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const results = [
    await putNumber(req('PUT', { number_id: 8, expected_bot_id: null }), ctx('sales')),
    await unassignNumber(req('POST', { expected_number_id: 8 }), ctx('sales')),
    await putAllowlist(req('PUT', { entries: [] }), ctx('sales')),
    await activate(req('POST', { number_id: 8, expected_bot_id: null, status: 'limited', allowlist: [] }), ctx('sales')),
  ];
  for (const res of results) {
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('ORG_CHANGED');
  }
  expect(fetchMock).not.toHaveBeenCalled();
});
