import { test, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
vi.mock('next/headers', () => ({
  headers: async () => ({ get: () => null }),
  cookies: async () => ({
    get: (k: string) => (store.has(k) ? { value: store.get(k) } : undefined),
    set: (k: string, v: string) => { store.set(k, v); },
    delete: (k: string) => { store.delete(k); },
  }),
}));

import { POST as login } from '../login/route';
import { POST as refresh } from '../refresh/route';
import { POST as logout } from '../logout/route';
import { GET as me } from '../me/route';
import { POST as chooseOrg } from '../org/route';
import { POST as changePassword } from '../change-password/route';
import { POST as invitationInfo } from '../invitations/info/route';
import { POST as acceptInvitation } from '../invitations/accept/route';
import { POST as acceptInvite } from '../accept-invite/route';
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
  expect(res.headers.get('cache-control')).toBe('private, no-store');
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
  expect(res.headers.get('cache-control')).toBe('private, no-store');
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
  store.set(ORG_COOKIE, '1:disparue');
  vi.stubGlobal('fetch', vi.fn(async () => meResponse(ORGS)));
  const res = await me();
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(res.headers.get('cache-control')).toBe('private, no-store');
  expect(json.active_client_id).toBe('c1');
  expect(json.user.organizations).toHaveLength(2);
  expect(store.get(ORG_COOKIE)).toBe('1:c1');
});

test('me : cookie valide conservé', async () => {
  store.set(ACCESS_COOKIE, 'a');
  store.set(ORG_COOKIE, '1:c2');
  vi.stubGlobal('fetch', vi.fn(async () => meResponse(ORGS)));
  const json = await (await me()).json();
  expect(json.active_client_id).toBe('c2');
  expect(store.get(ORG_COOKIE)).toBe('1:c2');
});

test('me : cookie posé par un autre compte du navigateur, ignoré et remplacé par celui de l\'utilisateur', async () => {
  store.set(ACCESS_COOKIE, 'a');
  store.set(ORG_COOKIE, '2:c2');
  vi.stubGlobal('fetch', vi.fn(async () => meResponse(ORGS)));
  const json = await (await me()).json();
  expect(json.active_client_id).toBe('c1');
  expect(store.get(ORG_COOKIE)).toBe('1:c1');
});

test('me : ancien cookie au format nu, traité comme absent', async () => {
  store.set(ACCESS_COOKIE, 'a');
  store.set(ORG_COOKIE, 'c2');
  vi.stubGlobal('fetch', vi.fn(async () => meResponse(ORGS)));
  const json = await (await me()).json();
  expect(json.active_client_id).toBe('c1');
  expect(store.get(ORG_COOKIE)).toBe('1:c1');
});

test('me : aucune organisation, active_client_id null et cookie effacé', async () => {
  store.set(ACCESS_COOKIE, 'a');
  store.set(ORG_COOKIE, '1:c2');
  vi.stubGlobal('fetch', vi.fn(async () => meResponse([])));
  const json = await (await me()).json();
  expect(json.active_client_id).toBeNull();
  expect(store.has(ORG_COOKIE)).toBe(false);
});

// recette 3.1 : moteur arrêté, /api/auth/me répond 503 ENGINE_UNREACHABLE, jamais 500, sans toucher aux cookies
test('me : moteur injoignable, 503 ENGINE_UNREACHABLE et cookies inchangés', async () => {
  store.set(ACCESS_COOKIE, 'a');
  store.set(REFRESH_COOKIE, 'r');
  store.set(ORG_COOKIE, '1:c2');
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new TypeError('fetch failed');
  }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const res = await me();
  expect(res.status).toBe(503);
  expect((await res.json()).error).toMatchObject({ code: 'ENGINE_UNREACHABLE', message: 'Le moteur ne répond pas.' });
  expect(store.get(ACCESS_COOKIE)).toBe('a');
  expect(store.get(REFRESH_COOKIE)).toBe('r');
  expect(store.get(ORG_COOKIE)).toBe('1:c2');
});

test('org : accepte une organisation listée et pose le cookie', async () => {
  store.set(ACCESS_COOKIE, 'a');
  vi.stubGlobal('fetch', vi.fn(async () => meResponse(ORGS)));
  const res = await chooseOrg(orgReq({ client_id: 'c2' }));
  expect(res.status).toBe(204);
  expect(store.get(ORG_COOKIE)).toBe('1:c2');
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

test('change-password : 400 moteur (mot de passe actuel incorrect) propagé tel quel, sans refresh ni nouveaux cookies', async () => {
  store.set(ACCESS_COOKIE, 'a');
  store.set(REFRESH_COOKIE, 'r');
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Mot de passe actuel incorrect.',
        details: [{ path: 'current_password', message: 'Mot de passe actuel incorrect.' }],
        request_id: 'r',
      },
    }), { status: 400, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const res = await changePassword(changePasswordReq({ current_password: 'mauvais-mdp-12', new_password: 'nouveau-mdp-123' }));
  expect(res.status).toBe(400);
  expect((await res.json()).error).toEqual({
    code: 'VALIDATION_ERROR',
    message: 'Mot de passe actuel incorrect.',
    details: [{ path: 'current_password', message: 'Mot de passe actuel incorrect.' }],
    request_id: 'r', // audit R-14 : la référence du moteur est relayée
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(store.get(ACCESS_COOKIE)).toBe('a');
  expect(store.get(REFRESH_COOKIE)).toBe('r');
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

function jsonReq(path: string, body: unknown): Request {
  return new Request(`http://web.test/api/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const INFO = {
  organization_name: 'Maison Lumière',
  requires_account_creation: false,
  email_hint: 'c•••••@maison-lumiere.fr',
  grants_summary: { scope: 'organization', role: 'admin', read_only: false },
};

test('invitations/info : public, relaie la réponse du moteur sans jeton d\'accès', async () => {
  store.set(ACCESS_COOKIE, 'a');
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(INFO), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  const res = await invitationInfo(jsonReq('invitations/info', { token: 'tok-1' }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(INFO);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('http://engine.test/api/admin/v1/auth/invitations/info');
  expect(JSON.parse(init.body as string)).toEqual({ token: 'tok-1' });
  expect((init.headers as Record<string, string>).authorization).toBeUndefined();
});

test('invitations/info : 401 générique du moteur propagé', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Invitation invalide ou expirée.', request_id: 'r' } }), { status: 401, headers: { 'content-type': 'application/json' } }),
  ));
  const res = await invitationInfo(jsonReq('invitations/info', { token: 'x' }));
  expect(res.status).toBe(401);
  expect((await res.json()).error.message).toBe('Invitation invalide ou expirée.');
});

test('invitations/info : jeton vide ou corps non JSON, 400 sans appeler le moteur', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  expect((await invitationInfo(jsonReq('invitations/info', { token: '' }))).status).toBe(400);
  expect((await invitationInfo(new Request('http://web.test/api/auth/invitations/info', { method: 'POST', body: 'pas du json' }))).status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

/** Faux moteur : /auth/me répond dans l'ordre de la liste, l'acceptation répond `accept`. */
function stubEngine(opts: { me: unknown[][]; accept: Response; acceptPath: string }) {
  const meQueue = [...opts.me];
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith('/auth/me')) return meResponse(meQueue.length > 1 ? meQueue.shift()! : meQueue[0]);
    if (String(url).endsWith(opts.acceptPath)) return opts.accept.clone();
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const ORG_A = { client_id: 'c1', name: 'Maison Lumière', role: 'admin', read_only: false };
const ORG_B = { client_id: 'c3', name: 'Atelier Nord', role: 'advisor', read_only: false };

test('invitations/accept : pose wab_org sur l\'organisation apparue et la renvoie', async () => {
  store.set(ACCESS_COOKIE, 'a');
  store.set(ORG_COOKIE, '1:c1');
  stubEngine({
    me: [[ORG_A], [ORG_A, ORG_B]],
    acceptPath: '/auth/invitations/accept',
    accept: new Response(JSON.stringify({ organizations: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  const res = await acceptInvitation(jsonReq('invitations/accept', { token: 'tok-1' }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ client_id: 'c3', organization_name: 'Atelier Nord' });
  expect(store.get(ORG_COOKIE)).toBe('1:c3');
});

test('invitations/accept : échec moteur 401, cookie wab_org inchangé', async () => {
  store.set(ACCESS_COOKIE, 'a');
  store.set(ORG_COOKIE, '1:c1');
  stubEngine({
    me: [[ORG_A]],
    acceptPath: '/auth/invitations/accept',
    accept: new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Invitation invalide ou expirée.', request_id: 'r' } }), { status: 401, headers: { 'content-type': 'application/json' } }),
  });
  const res = await acceptInvitation(jsonReq('invitations/accept', { token: 'tok-1' }));
  expect(res.status).toBe(401);
  expect(store.get(ORG_COOKIE)).toBe('1:c1');
});

test('invitations/accept : aucune organisation nouvelle, cookie conservé et nom de l\'invitation renvoyé', async () => {
  store.set(ACCESS_COOKIE, 'a');
  store.set(ORG_COOKIE, '1:c1');
  stubEngine({
    me: [[ORG_A]],
    acceptPath: '/auth/invitations/accept',
    accept: new Response(JSON.stringify({ organizations: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  const res = await acceptInvitation(jsonReq('invitations/accept', { token: 'tok-1', organization_name: 'Maison Lumière' }));
  expect(await res.json()).toEqual({ client_id: null, organization_name: 'Maison Lumière' });
  expect(store.get(ORG_COOKIE)).toBe('1:c1');
});

test('invitations/accept : jeton absent, 400 sans appeler le moteur', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  expect((await acceptInvitation(jsonReq('invitations/accept', {}))).status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

function newAccountEngine(orgs: unknown[]) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/auth/accept-invite')) {
      return new Response(JSON.stringify({ access_token: 'new-a', refresh_token: 'new-r', user: { id: 7 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url).endsWith('/auth/me')) {
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer new-a');
      return meResponse(orgs);
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

test('accept-invite (compte neuf) : session posée, wab_org sur l\'organisation du nom de l\'invitation', async () => {
  newAccountEngine([ORG_A, ORG_B]);
  const res = await acceptInvite(jsonReq('accept-invite', { token: 'tok-1', password: 'motdepasse12', organization_name: 'Atelier Nord' }));
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json).toEqual({ user: { id: 7 }, client_id: 'c3', organization_name: 'Atelier Nord' });
  expect(store.get(ACCESS_COOKIE)).toBe('new-a');
  expect(store.get(REFRESH_COOKIE)).toBe('new-r');
  expect(store.get(ORG_COOKIE)).toBe('1:c3');
});

test('accept-invite (compte neuf) : nom inconnu, repli sur la première organisation', async () => {
  newAccountEngine([ORG_A, ORG_B]);
  const res = await acceptInvite(jsonReq('accept-invite', { token: 'tok-1', password: 'motdepasse12' }));
  expect(await res.json()).toMatchObject({ client_id: 'c1', organization_name: 'Maison Lumière' });
  expect(store.get(ORG_COOKIE)).toBe('1:c1');
});

test('accept-invite (compte neuf) : lecture des organisations impossible, la session reste posée', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    String(url).endsWith('/auth/accept-invite')
      ? new Response(JSON.stringify({ access_token: 'new-a', refresh_token: 'new-r', user: { id: 7 } }), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response(null, { status: 500 }),
  ));
  const res = await acceptInvite(jsonReq('accept-invite', { token: 'tok-1', password: 'motdepasse12', organization_name: 'Atelier Nord' }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ user: { id: 7 }, client_id: null, organization_name: 'Atelier Nord' });
  expect(store.get(ACCESS_COOKIE)).toBe('new-a');
  expect(store.has(ORG_COOKIE)).toBe(false);
});

test('accept-invite : corps non JSON, 400 sans appeler le moteur', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const res = await acceptInvite(new Request('http://web.test/api/auth/accept-invite', { method: 'POST', body: 'pas du json' }));
  expect(res.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('invitations/accept : session expirée (refus du renouvellement), 401 « Session expirée. » et aucune acceptation', async () => {
  store.set(ACCESS_COOKIE, 'a');
  store.set(REFRESH_COOKIE, 'r');
  const fetchMock = vi.fn(async (_url: string) =>
    new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Jeton expiré.', request_id: 'r' } }), { status: 401, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const res = await acceptInvitation(jsonReq('invitations/accept', { token: 'tok-1' }));
  expect(res.status).toBe(401);
  const body = await res.json();
  expect(body.error.message).toBe('Session expirée.');
  expect(body.error.reason).toBe('session.expired'); // audit R-10
  expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/auth/invitations/accept'))).toBe(false);
});

// audit R-10 : le 401 fabriqué par le BFF porte la clé de session
test('refresh sans cookie de renouvellement : 401 « Session expirée. » avec la clé session.expired, sans appeler le moteur', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const res = await refresh();
  expect(res.status).toBe(401);
  const body = await res.json();
  expect(body.error.message).toBe('Session expirée.');
  expect(body.error.reason).toBe('session.expired');
  expect(fetchMock).not.toHaveBeenCalled();
});
