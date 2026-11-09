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

import { GET as listAccounts, POST as createAccount } from '../route';
import { GET as getAccount, PATCH as renameAccount } from '../[accountId]/route';
import { PUT as replaceCredentials } from '../[accountId]/credentials/route';
import { POST as verifyAccount } from '../[accountId]/verify/route';
import { POST as refreshNumbers } from '../[accountId]/refresh-numbers/route';
import { POST as disconnectAccount } from '../[accountId]/disconnect/route';
import { PATCH as setTestFlag } from '../[accountId]/numbers/[numberId]/route';
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

const metaBody = { mode: 'meta_manual', name: 'Boutique', waba_id: '123456789012345', access_token: 'EAAB'.padEnd(40, 'x'), app_secret: 'a'.repeat(32) };
const req = (method: string, body?: unknown) =>
  new Request('http://web.test/api/whatsapp-accounts', { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const acc = (accountId: string) => ({ params: Promise.resolve({ accountId }) });
const num = (accountId: string, numberId: string) => ({ params: Promise.resolve({ accountId, numberId }) });

function firstCall(fetchMock: ReturnType<typeof vi.fn>): { url: string; init: RequestInit & { headers: Record<string, string> } } {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
  return { url, init };
}

test("GET /api/whatsapp-accounts relaie la liste du moteur avec le jeton et l'organisation", async () => {
  const fetchMock = vi.fn(async () => jsonRes([{ id: 1, name: 'Boutique' }]));
  vi.stubGlobal('fetch', fetchMock);
  const res = await listAccounts();
  expect(res.status).toBe(200);
  expect((await res.json())[0].id).toBe(1);
  const { url, init } = firstCall(fetchMock);
  expect(url).toBe(`${ENGINE}/whatsapp-accounts`);
  expect(init.headers['authorization']).toBe(`Bearer ${fakeAccess(1)}`);
  expect(init.headers['X-Organization-Id']).toBe('c1');
});

test('GET /api/whatsapp-accounts/:accountId relaie le compte', async () => {
  const fetchMock = vi.fn(async () => jsonRes({ id: 4 }));
  vi.stubGlobal('fetch', fetchMock);
  const res = await getAccount(req('GET'), acc('4'));
  expect(res.status).toBe(200);
  expect(firstCall(fetchMock).url).toBe(`${ENGINE}/whatsapp-accounts/4`);
});

test('POST /api/whatsapp-accounts : corps invalide refusé en 400 sans appel au moteur', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const res = await createAccount(req('POST', { ...metaBody, waba_id: 'abc' }));
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error.code).toBe('VALIDATION_ERROR');
  expect(body.error.details[0].path).toBe('waba_id');
  expect(fetchMock).not.toHaveBeenCalled();
});

test('POST /api/whatsapp-accounts : corps valide relayé, 201 et vue du compte renvoyés', async () => {
  const fetchMock = vi.fn(async () => jsonRes({ id: 9, name: 'Boutique', state: 'connected', checks: [], inventory: { added: 1 } }, 201));
  vi.stubGlobal('fetch', fetchMock);
  const res = await createAccount(req('POST', metaBody));
  expect(res.status).toBe(201);
  expect((await res.json()).id).toBe(9);
  const { url, init } = firstCall(fetchMock);
  expect(url).toBe(`${ENGINE}/whatsapp-accounts`);
  expect(init.method).toBe('POST');
  expect(JSON.parse(String(init.body))).toEqual(metaBody);
});

test('PATCH /api/whatsapp-accounts/:accountId : renommage relayé, nom vide refusé sans appel', async () => {
  const fetchMock = vi.fn(async () => jsonRes({ id: 4, name: 'Nouveau' }));
  vi.stubGlobal('fetch', fetchMock);
  const ok = await renameAccount(req('PATCH', { name: 'Nouveau' }), acc('4'));
  expect(ok.status).toBe(200);
  expect(firstCall(fetchMock).init.method).toBe('PATCH');
  fetchMock.mockClear();
  const bad = await renameAccount(req('PATCH', { name: '  ' }), acc('4'));
  expect(bad.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('PUT credentials : identifiants invalides refusés en 400, valides relayés', async () => {
  const fetchMock = vi.fn(async () => jsonRes({ id: 4 }));
  vi.stubGlobal('fetch', fetchMock);
  const bad = await replaceCredentials(req('PUT', { mode: 'meta_manual', waba_id: 'abc' }), acc('4'));
  expect(bad.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
  const { name: _name, ...credentials } = metaBody;
  const ok = await replaceCredentials(req('PUT', credentials), acc('4'));
  expect(ok.status).toBe(200);
  const { url, init } = firstCall(fetchMock);
  expect(url).toBe(`${ENGINE}/whatsapp-accounts/4/credentials`);
  expect(init.method).toBe('PUT');
  expect(JSON.parse(String(init.body))).toEqual(credentials);
});

test('PATCH numbers/:numberId : is_test relayé, booléen manquant refusé', async () => {
  const fetchMock = vi.fn(async () => jsonRes({ id: 8, is_test: true }));
  vi.stubGlobal('fetch', fetchMock);
  const ok = await setTestFlag(req('PATCH', { is_test: true }), num('4', '8'));
  expect(ok.status).toBe(200);
  const { url, init } = firstCall(fetchMock);
  expect(url).toBe(`${ENGINE}/whatsapp-accounts/4/numbers/8`);
  expect(init.method).toBe('PATCH');
  fetchMock.mockClear();
  const bad = await setTestFlag(req('PATCH', {}), num('4', '8'));
  expect(bad.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

test.each(['abc', '3a', '../users', '-1'])('identifiant non numérique « %s » (accountId, numberId) : 404 sans appel au moteur', async (bad) => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const results = await Promise.all([
    getAccount(req('GET'), acc(bad)),
    renameAccount(req('PATCH', { name: 'A' }), acc(bad)),
    replaceCredentials(req('PUT', {}), acc(bad)),
    verifyAccount(req('POST'), acc(bad)),
    refreshNumbers(req('POST'), acc(bad)),
    disconnectAccount(req('POST'), acc(bad)),
    setTestFlag(req('PATCH', { is_test: true }), num(bad, '8')),
    setTestFlag(req('PATCH', { is_test: true }), num('4', bad)),
  ]);
  for (const res of results) {
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  }
  expect(fetchMock).not.toHaveBeenCalled();
});

test('refus du moteur relayé tel quel : 409 CONFLICT avec son message, 422 WA_VALIDATION_FAILED avec details', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ error: { code: 'CONFLICT', message: 'Ce compte WhatsApp existe déjà.' } }, 409)));
  const conflict = await createAccount(req('POST', metaBody));
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toEqual({ error: { code: 'CONFLICT', message: 'Ce compte WhatsApp existe déjà.' } });

  const details = [{ path: 'access_token', message: 'Jeton refusé par Meta.' }];
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ error: { code: 'WA_VALIDATION_FAILED', message: 'Vérification impossible.', details } }, 422)));
  const invalid = await createAccount(req('POST', metaBody));
  expect(invalid.status).toBe(422);
  const body = await invalid.json();
  expect(body.error.code).toBe('WA_VALIDATION_FAILED');
  expect(body.error.details).toEqual(details);
});

test('POST disconnect, verify, refresh-numbers : méthode et chemin exacts, corps vide', async () => {
  const cases: [string, typeof verifyAccount, string, Response][] = [
    ['verify', verifyAccount, '/whatsapp-accounts/4/verify', jsonRes({ id: 4, checks: [] })],
    ['refresh-numbers', refreshNumbers, '/whatsapp-accounts/4/refresh-numbers', jsonRes({ id: 4, inventory: {} })],
    ['disconnect', disconnectAccount, '/whatsapp-accounts/4/disconnect', new Response(null, { status: 204 })],
  ];
  for (const [, handler, path, response] of cases) {
    const fetchMock = vi.fn(async () => response.clone());
    vi.stubGlobal('fetch', fetchMock);
    const res = await handler(req('POST'), acc('4'));
    expect(res.status).toBe(response.status);
    const { url, init } = firstCall(fetchMock);
    expect(url).toBe(`${ENGINE}${path}`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  }
});

test('organisation affichée différente du cookie : 409 ORG_CHANGED sans appel au moteur', async () => {
  store.set(ORG_COOKIE, '1:c2');
  requestHeaders.set('x-wab-org', 'c1');
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const results = [
    await listAccounts(),
    await createAccount(req('POST', metaBody)),
    await disconnectAccount(req('POST'), acc('4')),
  ];
  for (const res of results) {
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('ORG_CHANGED');
  }
  expect(fetchMock).not.toHaveBeenCalled();
});
