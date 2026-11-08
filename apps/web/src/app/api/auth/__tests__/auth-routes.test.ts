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
import { GET as me } from '../me/route';
import { POST as chooseOrg } from '../org/route';
import { POST as changePassword } from '../change-password/route';
import { ACCESS_COOKIE, REFRESH_COOKIE, ORG_COOKIE } from '@/lib/session';

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

const ORGS = [
  { client_id: 'c1', name: 'Maison Lumière', role: 'admin', read_only: false },
  { client_id: 'c2', name: 'Atelier', role: 'manager', read_only: true },
];

function meResponse(organizations: unknown[]): Response {
  return new Response(
    JSON.stringify({ id: 1, email: 'x@example.com', role: 'client_admin', client_id: 'c1', status: 'active', organizations }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function orgReq(body: unknown): Request {
  return new Request('http://web.test/api/auth/org', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('me : cookie périmé, repli sur la première organisation et cookie posé', async () => {
  store.set(ACCESS_COOKIE, 'a');
  store.set(ORG_COOKIE, 'disparue');
  vi.stubGlobal('fetch', vi.fn(async () => meResponse(ORGS)));
  const res = await me();
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.active_client_id).toBe('c1');
  expect(json.user.organizations).toHaveLength(2);
  expect(store.get(ORG_COOKIE)).toBe('c1');
});

test('me : cookie valide conservé', async () => {
  store.set(ACCESS_COOKIE, 'a');
  store.set(ORG_COOKIE, 'c2');
  vi.stubGlobal('fetch', vi.fn(async () => meResponse(ORGS)));
  const json = await (await me()).json();
  expect(json.active_client_id).toBe('c2');
  expect(store.get(ORG_COOKIE)).toBe('c2');
});

test('me : aucune organisation, active_client_id null et cookie effacé', async () => {
  store.set(ACCESS_COOKIE, 'a');
  store.set(ORG_COOKIE, 'c2');
  vi.stubGlobal('fetch', vi.fn(async () => meResponse([])));
  const json = await (await me()).json();
  expect(json.active_client_id).toBeNull();
  expect(store.has(ORG_COOKIE)).toBe(false);
});

test('org : accepte une organisation listée et pose le cookie', async () => {
  store.set(ACCESS_COOKIE, 'a');
  vi.stubGlobal('fetch', vi.fn(async () => meResponse(ORGS)));
  const res = await chooseOrg(orgReq({ client_id: 'c2' }));
  expect(res.status).toBe(204);
  expect(store.get(ORG_COOKIE)).toBe('c2');
});

test('org : refuse une organisation non listée (403) sans poser le cookie', async () => {
  store.set(ACCESS_COOKIE, 'a');
  vi.stubGlobal('fetch', vi.fn(async () => meResponse(ORGS)));
  const res = await chooseOrg(orgReq({ client_id: 'autre' }));
  expect(res.status).toBe(403);
  expect((await res.json()).error.code).toBe('FORBIDDEN');
  expect(store.has(ORG_COOKIE)).toBe(false);
});

test('org : refuse une organisation suspendue (403)', async () => {
  store.set(ACCESS_COOKIE, 'a');
  vi.stubGlobal('fetch', vi.fn(async () => meResponse([{ ...ORGS[0], status: 'suspended' }])));
  const res = await chooseOrg(orgReq({ client_id: 'c1' }));
  expect(res.status).toBe(403);
  expect(store.has(ORG_COOKIE)).toBe(false);
});

test('org : corps invalide, 400 sans appeler l\'engine', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const res = await chooseOrg(orgReq({ client_id: '' }));
  expect(res.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

function changePasswordReq(body: unknown): Request {
  return new Request('http://web.test/api/auth/change-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('change-password OK : pose les nouveaux cookies, 204 sans tokens', async () => {
  store.set(ACCESS_COOKIE, 'ancien-a');
  store.set(REFRESH_COOKIE, 'ancien-r');
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ access_token: 'new-a', refresh_token: 'new-r', user: { id: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const res = await changePassword(changePasswordReq({ current_password: 'ancien-mdp-12', new_password: 'nouveau-mdp-123' }));
  expect(res.status).toBe(204);
  expect(store.get(ACCESS_COOKIE)).toBe('new-a');
  expect(store.get(REFRESH_COOKIE)).toBe('new-r');
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('http://engine.test/api/admin/v1/auth/change-password');
  expect(JSON.parse(init.body as string)).toEqual({ current_password: 'ancien-mdp-12', new_password: 'nouveau-mdp-123' });
});

test('change-password : 401 moteur (mot de passe actuel incorrect) propagé tel quel', async () => {
  store.set(ACCESS_COOKIE, 'a');
  store.set(REFRESH_COOKIE, 'r');
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    String(url).endsWith('/auth/refresh')
      ? new Response(JSON.stringify({ access_token: 'a2', refresh_token: 'r2', user: { id: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Mot de passe actuel incorrect.', request_id: 'r' } }), { status: 401, headers: { 'content-type': 'application/json' } }),
  ));
  const res = await changePassword(changePasswordReq({ current_password: 'mauvais-mdp-12', new_password: 'nouveau-mdp-123' }));
  expect(res.status).toBe(401);
  expect((await res.json()).error.message).toBe('Mot de passe actuel incorrect.');
});

test('change-password : nouveau mot de passe trop court, 400 sans appeler l\'engine', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const res = await changePassword(changePasswordReq({ current_password: 'ancien-mdp-12', new_password: '123456789' }));
  expect(res.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('change-password : mot de passe actuel vide, 400 avec le message du contrat', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const res = await changePassword(changePasswordReq({ current_password: '', new_password: 'nouveau-mdp-123' }));
  expect(res.status).toBe(400);
  expect((await res.json()).error.message).toBe('Mot de passe actuel requis.');
  expect(fetchMock).not.toHaveBeenCalled();
});

test('change-password : corps non JSON, 400 sans appeler l\'engine', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const res = await changePassword(
    new Request('http://web.test/api/auth/change-password', { method: 'POST', body: 'pas du json' }),
  );
  expect(res.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});
