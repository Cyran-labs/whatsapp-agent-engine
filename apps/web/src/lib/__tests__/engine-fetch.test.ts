import { test, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (k: string) => (store.has(k) ? { value: store.get(k) } : undefined),
    set: (k: string, v: string) => { store.set(k, v); },
    delete: (k: string) => { store.delete(k); },
  }),
}));

import { engineFetch } from '../engine-fetch';
import { ACCESS_COOKIE, REFRESH_COOKIE, ORG_COOKIE } from '../session';

beforeEach(() => {
  process.env.ENGINE_API_URL = 'http://engine.test/api/admin/v1';
  store.clear();
  store.set(ACCESS_COOKIE, 'old-access');
  store.set(REFRESH_COOKIE, 'refresh-1');
  vi.restoreAllMocks();
});

test('appel authentifié ok : passe le Bearer, retourne le JSON', async () => {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async (_url, _init) =>
    new Response(JSON.stringify({ id: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const out = await engineFetch<{ id: number }>('/auth/me');
  expect(out).toEqual({ id: 1 });
  expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ authorization: 'Bearer old-access' });
});

test('401 → refresh → rejoue avec le nouveau token et met à jour les cookies', async () => {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()
    // 1er appel protégé → 401
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'x', request_id: 'r' } }), { status: 401, headers: { 'content-type': 'application/json' } }))
    // refresh → 200 nouveaux tokens
    .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'new-access', refresh_token: 'refresh-2', user: {} }), { status: 200, headers: { 'content-type': 'application/json' } }))
    // rejoue → 200
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: 2 }), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);

  const out = await engineFetch<{ id: number }>('/bots');
  expect(out).toEqual({ id: 2 });
  expect(store.get(ACCESS_COOKIE)).toBe('new-access');
  expect(store.get(REFRESH_COOKIE)).toBe('refresh-2');
  expect(fetchMock.mock.calls[2][1].headers).toMatchObject({ authorization: 'Bearer new-access' });
});

test('401 puis refresh échoue → EngineError UNAUTHORIZED', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'x', request_id: 'r' } }), { status: 401, headers: { 'content-type': 'application/json' } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'no', request_id: 'r' } }), { status: 401, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(engineFetch('/bots')).rejects.toMatchObject({ name: 'EngineError', code: 'UNAUTHORIZED' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('en-tête X-Organization-Id présent quand le cookie wab_org existe', async () => {
  store.set(ORG_COOKIE, 'c2');
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => jsonRes({ ok: true }, 200));
  vi.stubGlobal('fetch', fetchMock);
  await engineFetch('/bots');
  expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ 'X-Organization-Id': 'c2' });
});

test('en-tête X-Organization-Id absent sans cookie', async () => {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => jsonRes({ ok: true }, 200));
  vi.stubGlobal('fetch', fetchMock);
  await engineFetch('/bots');
  expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('X-Organization-Id');
});

test('l\'appel rejoué après refresh garde X-Organization-Id', async () => {
  store.set(ORG_COOKIE, 'c2');
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()
    .mockResolvedValueOnce(jsonRes({ error: { code: 'UNAUTHORIZED', message: 'x' } }, 401))
    .mockResolvedValueOnce(jsonRes({ access_token: 'new-access', refresh_token: 'refresh-2', user: {} }, 200))
    .mockResolvedValueOnce(jsonRes({ id: 2 }, 200));
  vi.stubGlobal('fetch', fetchMock);
  await engineFetch('/bots');
  expect(fetchMock.mock.calls[2][1].headers).toMatchObject({
    authorization: 'Bearer new-access',
    'X-Organization-Id': 'c2',
  });
});

function meRes(orgIds: string[], status?: string): Response {
  return jsonRes({
    id: 1, email: 'x@example.com', role: 'client_admin', status: 'active',
    organizations: orgIds.map((client_id) => ({ client_id, name: client_id, role: 'advisor', read_only: false, ...(status ? { status } : {}) })),
  }, 200);
}

const FORBIDDEN_BODY = { error: { code: 'FORBIDDEN', message: 'Accès refusé.' } };

test('403 FORBIDDEN (non membre) : /auth/me ne liste plus l\'organisation, cookie effacé, erreur relancée', async () => {
  store.set(ORG_COOKIE, 'c9');
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()
    .mockResolvedValueOnce(jsonRes(FORBIDDEN_BODY, 403))
    .mockResolvedValueOnce(meRes(['c1']));
  vi.stubGlobal('fetch', fetchMock);
  await expect(engineFetch('/bots')).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403, message: 'Accès refusé.' });
  expect(store.has(ORG_COOKIE)).toBe(false);
  expect(fetchMock.mock.calls[1][0]).toContain('/auth/me');
  expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty('X-Organization-Id');
});

test('403 FORBIDDEN (organisation devenue non ouvrable) : cookie effacé', async () => {
  store.set(ORG_COOKIE, 'c2');
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(jsonRes(FORBIDDEN_BODY, 403))
    .mockResolvedValueOnce(meRes(['c2'], 'suspended')));
  await expect(engineFetch('/bots')).rejects.toMatchObject({ status: 403 });
  expect(store.has(ORG_COOKIE)).toBe(false);
});

test('403 FORBIDDEN (refus de rôle) : /auth/me liste toujours l\'organisation, cookie conservé', async () => {
  store.set(ORG_COOKIE, 'c2');
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(jsonRes(FORBIDDEN_BODY, 403))
    .mockResolvedValueOnce(meRes(['c1', 'c2'])));
  await expect(engineFetch('/bots')).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  expect(store.get(ORG_COOKIE)).toBe('c2');
});

test('403 FORBIDDEN, vérification /auth/me en échec : cookie conservé, erreur d\'origine relancée', async () => {
  store.set(ORG_COOKIE, 'c2');
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(jsonRes(FORBIDDEN_BODY, 403))
    .mockResolvedValueOnce(jsonRes({ error: { code: 'INTERNAL', message: 'boom' } }, 500)));
  await expect(engineFetch('/bots')).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403, message: 'Accès refusé.' });
  expect(store.get(ORG_COOKIE)).toBe('c2');
});

test('400 organisation à préciser : cookie effacé, erreur relancée', async () => {
  store.set(ORG_COOKIE, 'c9');
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Organisation à préciser.',
      details: [{ path: 'X-Organization-Id', message: 'Organisation à préciser.' }],
    },
  }, 400)));
  await expect(engineFetch('/bots')).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  expect(store.has(ORG_COOKIE)).toBe(false);
});

test('400 de validation ordinaire : cookie conservé', async () => {
  store.set(ORG_COOKIE, 'c2');
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes({
    error: { code: 'VALIDATION_ERROR', message: 'Données invalides.', details: [{ path: 'name', message: 'Requis.' }] },
  }, 400)));
  await expect(engineFetch('/bots')).rejects.toMatchObject({ status: 400 });
  expect(store.get(ORG_COOKIE)).toBe('c2');
});

test('403 « Organisation suspendue. » : cookie conservé', async () => {
  store.set(ORG_COOKIE, 'c2');
  const fetchMock = vi.fn(async () => jsonRes({ error: { code: 'FORBIDDEN', message: 'Organisation suspendue.' } }, 403));
  vi.stubGlobal('fetch', fetchMock);
  await expect(engineFetch('/bots')).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Organisation suspendue.' });
  expect(store.get(ORG_COOKIE)).toBe('c2');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
