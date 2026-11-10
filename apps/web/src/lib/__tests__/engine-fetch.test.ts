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

import { engineFetch } from '../engine-fetch';
import { ACCESS_COOKIE, REFRESH_COOKIE, ORG_COOKIE } from '../session';
import { fakeAccess } from './fake-access';

/** Jeton d'accès de l'utilisateur 1, propriétaire des cookies wab_org `1:<client_id>`. */
const ACCESS = fakeAccess(1);

beforeEach(() => {
  process.env.ENGINE_API_URL = 'http://engine.test/api/admin/v1';
  store.clear();
  requestHeaders.clear();
  store.set(ACCESS_COOKIE, ACCESS);
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
  expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ authorization: `Bearer ${ACCESS}` });
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
  await expect(engineFetch('/bots')).rejects.toMatchObject({ name: 'EngineError', code: 'UNAUTHORIZED', reason: 'session.expired' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

// audit R-10 : le 401 fabriqué par le BFF porte la clé, l'écran n'a pas à comparer des textes
test('401 sans cookie de renouvellement : EngineError « Session expirée. » avec la clé session.expired', async () => {
  store.delete(REFRESH_COOKIE);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'x' } }), { status: 401, headers: { 'content-type': 'application/json' } })));
  await expect(engineFetch('/bots')).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401, message: 'Session expirée.', reason: 'session.expired' });
});

function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('en-tête X-Organization-Id présent quand le cookie wab_org existe', async () => {
  store.set(ORG_COOKIE, '1:c2');
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => jsonRes({ ok: true }, 200));
  vi.stubGlobal('fetch', fetchMock);
  await engineFetch('/bots');
  expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ 'X-Organization-Id': 'c2' });
});

test('cookie wab_org d\'un autre utilisateur du navigateur : en-tête X-Organization-Id absent', async () => {
  store.set(ORG_COOKIE, '2:c2');
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => jsonRes({ ok: true }, 200));
  vi.stubGlobal('fetch', fetchMock);
  await engineFetch('/bots');
  expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('X-Organization-Id');
});

test('ancien cookie wab_org au format nu : traité comme absent', async () => {
  store.set(ORG_COOKIE, 'c2');
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => jsonRes({ ok: true }, 200));
  vi.stubGlobal('fetch', fetchMock);
  await engineFetch('/bots');
  expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('X-Organization-Id');
});

test('jeton d\'accès absent : organisation relue avec le jeton rafraîchi pour l\'appel rejoué', async () => {
  store.delete(ACCESS_COOKIE);
  store.set(ORG_COOKIE, '1:c2');
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()
    .mockResolvedValueOnce(jsonRes({ error: { code: 'UNAUTHORIZED', message: 'x' } }, 401))
    .mockResolvedValueOnce(jsonRes({ access_token: fakeAccess(1), refresh_token: 'refresh-2', user: {} }, 200))
    .mockResolvedValueOnce(jsonRes({ id: 2 }, 200));
  vi.stubGlobal('fetch', fetchMock);
  await engineFetch('/bots');
  expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('X-Organization-Id');
  expect(fetchMock.mock.calls[2][1].headers).toMatchObject({ 'X-Organization-Id': 'c2' });
});

test('en-tête X-Organization-Id absent sans cookie', async () => {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => jsonRes({ ok: true }, 200));
  vi.stubGlobal('fetch', fetchMock);
  await engineFetch('/bots');
  expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('X-Organization-Id');
});

test('l\'appel rejoué après refresh garde X-Organization-Id', async () => {
  const NEW_ACCESS = fakeAccess(1);
  store.set(ORG_COOKIE, '1:c2');
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()
    .mockResolvedValueOnce(jsonRes({ error: { code: 'UNAUTHORIZED', message: 'x' } }, 401))
    .mockResolvedValueOnce(jsonRes({ access_token: NEW_ACCESS, refresh_token: 'refresh-2', user: {} }, 200))
    .mockResolvedValueOnce(jsonRes({ id: 2 }, 200));
  vi.stubGlobal('fetch', fetchMock);
  await engineFetch('/bots');
  expect(fetchMock.mock.calls[2][1].headers).toMatchObject({
    authorization: `Bearer ${NEW_ACCESS}`,
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
  store.set(ORG_COOKIE, '1:c9');
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
  store.set(ORG_COOKIE, '1:c2');
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(jsonRes(FORBIDDEN_BODY, 403))
    .mockResolvedValueOnce(meRes(['c2'], 'suspended')));
  await expect(engineFetch('/bots')).rejects.toMatchObject({ status: 403 });
  expect(store.has(ORG_COOKIE)).toBe(false);
});

test('403 FORBIDDEN (refus de rôle) : /auth/me liste toujours l\'organisation, cookie conservé', async () => {
  store.set(ORG_COOKIE, '1:c2');
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(jsonRes(FORBIDDEN_BODY, 403))
    .mockResolvedValueOnce(meRes(['c1', 'c2'])));
  await expect(engineFetch('/bots')).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  expect(store.get(ORG_COOKIE)).toBe('1:c2');
});

test('403 FORBIDDEN, vérification /auth/me en échec : cookie conservé, erreur d\'origine relancée', async () => {
  store.set(ORG_COOKIE, '1:c2');
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(jsonRes(FORBIDDEN_BODY, 403))
    .mockResolvedValueOnce(jsonRes({ error: { code: 'INTERNAL', message: 'boom' } }, 500)));
  await expect(engineFetch('/bots')).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403, message: 'Accès refusé.' });
  expect(store.get(ORG_COOKIE)).toBe('1:c2');
});

test('400 organisation à préciser : cookie effacé, erreur relancée', async () => {
  store.set(ORG_COOKIE, '1:c9');
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
  store.set(ORG_COOKIE, '1:c2');
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes({
    error: { code: 'VALIDATION_ERROR', message: 'Données invalides.', details: [{ path: 'name', message: 'Requis.' }] },
  }, 400)));
  await expect(engineFetch('/bots')).rejects.toMatchObject({ status: 400 });
  expect(store.get(ORG_COOKIE)).toBe('1:c2');
});

test('403 « Organisation suspendue. » : cookie conservé', async () => {
  store.set(ORG_COOKIE, '1:c2');
  const fetchMock = vi.fn(async () => jsonRes({ error: { code: 'FORBIDDEN', message: 'Organisation suspendue.' } }, 403));
  vi.stubGlobal('fetch', fetchMock);
  await expect(engineFetch('/bots')).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Organisation suspendue.' });
  expect(store.get(ORG_COOKIE)).toBe('1:c2');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

// revue finale M-9 : la suspension se reconnaît par sa clé, le texte n'est qu'un repli
test('403 de suspension reconnu par sa clé seule (autre texte) : cookie conservé, aucune relecture de /auth/me', async () => {
  store.set(ORG_COOKIE, '1:c2');
  const fetchMock = vi.fn(async () => jsonRes({ error: { code: 'FORBIDDEN', message: 'Cette organisation est suspendue.', reason: 'session.organization_suspended' } }, 403));
  vi.stubGlobal('fetch', fetchMock);
  await expect(engineFetch('/bots')).rejects.toMatchObject({ code: 'FORBIDDEN', reason: 'session.organization_suspended' });
  expect(store.get(ORG_COOKIE)).toBe('1:c2');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('404 « Organisation introuvable. » (organisation supprimée, super admin) : cookie effacé, erreur relancée', async () => {
  store.set(ORG_COOKIE, '1:c9');
  const fetchMock = vi.fn(async () => jsonRes({ error: { code: 'NOT_FOUND', message: 'Organisation introuvable.' } }, 404));
  vi.stubGlobal('fetch', fetchMock);
  await expect(engineFetch('/bots')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404, message: 'Organisation introuvable.' });
  expect(store.has(ORG_COOKIE)).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('404 ordinaire (ressource introuvable) : cookie conservé', async () => {
  store.set(ORG_COOKIE, '1:c2');
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ error: { code: 'NOT_FOUND', message: 'Agent IA introuvable.' } }, 404)));
  await expect(engineFetch('/bots/x')).rejects.toMatchObject({ status: 404 });
  expect(store.get(ORG_COOKIE)).toBe('1:c2');
});

test('en-tête X-Wab-Org égal au cookie wab_org : appel normal', async () => {
  store.set(ORG_COOKIE, '1:c2');
  requestHeaders.set('x-wab-org', 'c2');
  const fetchMock = vi.fn(async () => jsonRes({ ok: true }, 200));
  vi.stubGlobal('fetch', fetchMock);
  await expect(engineFetch('/bots')).resolves.toEqual({ ok: true });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('en-tête X-Wab-Org différent du cookie (autre onglet) : 409 ORG_CHANGED sans appeler le moteur', async () => {
  store.set(ORG_COOKIE, '1:c2');
  requestHeaders.set('x-wab-org', 'c1');
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  await expect(engineFetch('/bots')).rejects.toMatchObject({
    name: 'EngineError',
    code: 'ORG_CHANGED',
    status: 409,
    message: 'Organisation changée dans un autre onglet.',
  });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(store.get(ORG_COOKIE)).toBe('1:c2');
});

test('en-tête X-Wab-Org présent, cookie effacé entre-temps : 409 ORG_CHANGED', async () => {
  requestHeaders.set('x-wab-org', 'c1');
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  await expect(engineFetch('/bots')).rejects.toMatchObject({ code: 'ORG_CHANGED', status: 409 });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('sans en-tête X-Wab-Org (routes d\'auth, /api/auth/me) : pas de comparaison', async () => {
  store.set(ORG_COOKIE, '1:c2');
  const fetchMock = vi.fn(async () => jsonRes({ ok: true }, 200));
  vi.stubGlobal('fetch', fetchMock);
  await expect(engineFetch('/auth/me')).resolves.toEqual({ ok: true });
});
