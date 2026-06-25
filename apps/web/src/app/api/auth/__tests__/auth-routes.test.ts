import { test, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (k: string) => (store.has(k) ? { value: store.get(k) } : undefined),
    set: (k: string, v: string) => { store.set(k, v); },
    delete: (k: string) => { store.delete(k); },
  }),
}));

import { POST as login } from '../login/route';
import { POST as logout } from '../logout/route';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/session';

beforeEach(() => {
  process.env.ENGINE_API_URL = 'http://engine.test/api/admin/v1';
  store.clear();
  vi.restoreAllMocks();
});

function req(body: unknown): Request {
  return new Request('http://web.test/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('login OK : pose les cookies, renvoie user sans tokens', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', user: { id: 1, email: 'x@example.com', role: 'client_admin', client_id: 'c1', status: 'active' } }), { status: 200, headers: { 'content-type': 'application/json' } }),
  ));
  const res = await login(req({ email: 'x@example.com', password: 'motdepasse12' }));
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.user.email).toBe('x@example.com');
  expect(json.access_token).toBeUndefined();
  expect(store.get(ACCESS_COOKIE)).toBe('a');
  expect(store.get(REFRESH_COOKIE)).toBe('r');
});

test('login : validation locale → 400 sans appeler l\'engine', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const res = await login(req({ email: 'pas-un-email', password: '' }));
  expect(res.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('login : 401 engine → 401 propagé', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Identifiants invalides.', request_id: 'r' } }), { status: 401, headers: { 'content-type': 'application/json' } }),
  ));
  const res = await login(req({ email: 'x@example.com', password: 'motdepasse12' }));
  expect(res.status).toBe(401);
});

test('logout : efface les cookies', async () => {
  store.set(ACCESS_COOKIE, 'a');
  store.set(REFRESH_COOKIE, 'r');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
  const res = await logout(new Request('http://web.test/api/auth/logout', { method: 'POST' }));
  expect(res.status).toBe(204);
  expect(store.has(ACCESS_COOKIE)).toBe(false);
  expect(store.has(REFRESH_COOKIE)).toBe(false);
});
