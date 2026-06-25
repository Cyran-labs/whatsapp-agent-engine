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
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../session';

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
