import { test, expect, vi, beforeEach } from 'vitest';
import { PROFILE_PHOTO_MAX_BYTES } from '@wabagent/contracts';

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

import { GET as getProfile, PUT as putProfile } from '../[accountId]/numbers/[numberId]/profile/route';
import { POST as postPhoto } from '../[accountId]/numbers/[numberId]/profile/photo/route';
import { POST as requestName } from '../[accountId]/numbers/[numberId]/display-name/route';
import { POST as applyName } from '../[accountId]/numbers/[numberId]/display-name/apply/route';
import { ACCESS_COOKIE, ORG_COOKIE } from '@/lib/session';
import { fakeAccess } from '@/lib/__tests__/fake-access';

// Lot R2a, tâche 9 : relais du profil WhatsApp, de la photo et du nom d'affichage d'un numéro (spec R2a §6.4).

const ENGINE = 'http://engine.test/api/admin/v1';
const BASE = `${ENGINE}/whatsapp-accounts/4/numbers/8`;

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

const num = (accountId: string, numberId: string) => ({ params: Promise.resolve({ accountId, numberId }) });
const jsonReq = (method: string, body?: unknown) =>
  new Request('http://web.test/api/x', { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const binaryReq = (type: string, bytes: Uint8Array<ArrayBuffer>) =>
  new Request('http://web.test/api/x', { method: 'POST', headers: { 'content-type': type }, body: bytes });

function call(fetchMock: ReturnType<typeof vi.fn>, index = 0): { url: string; init: RequestInit & { headers: Record<string, string> } } {
  const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit & { headers: Record<string, string> }];
  return { url, init };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2]);
const profile = { about: 'Réponse rapide', description: '', address: '', email: '', websites: [], vertical: 'RETAIL', photo_url: null, read_at: '2026-11-17T10:00:00.000Z' };

test('GET profile : relayé sur le chemin exact du moteur, avec le jeton et l\'organisation', async () => {
  const fetchMock = vi.fn(async () => jsonRes(profile));
  vi.stubGlobal('fetch', fetchMock);
  const res = await getProfile(jsonReq('GET'), num('4', '8'));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(profile);
  expect(res.headers.get('cache-control')).toBe('private, no-store');
  const { url, init } = call(fetchMock);
  expect(url).toBe(`${BASE}/profile`);
  expect(init.method).toBe('GET');
  expect(init.headers['authorization']).toBe(`Bearer ${fakeAccess(1)}`);
  expect(init.headers['X-Organization-Id']).toBe('c1');
});

test('identifiants non numériques : 404 sans appel au moteur, sur les quatre routes', async () => {
  const fetchMock = vi.fn(async () => jsonRes({}));
  vi.stubGlobal('fetch', fetchMock);
  expect((await getProfile(jsonReq('GET'), num('x', '8'))).status).toBe(404);
  expect((await putProfile(jsonReq('PUT', { about: 'a' }), num('4', 'y'))).status).toBe(404);
  expect((await postPhoto(binaryReq('image/png', PNG), num('4', '8a'))).status).toBe(404);
  expect((await requestName(jsonReq('POST', { new_display_name: 'Nom' }), num('a', '8'))).status).toBe(404);
  expect((await applyName(jsonReq('POST', { pin: '123456' }), num('4', '-1'))).status).toBe(404);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('PUT profile : champs modifiés relayés tels quels, champ vidé compris ; infos vides refusées sans appel', async () => {
  const fetchMock = vi.fn(async () => jsonRes(profile));
  vi.stubGlobal('fetch', fetchMock);
  const res = await putProfile(jsonReq('PUT', { description: '', websites: ['https://exemple.fr'] }), num('4', '8'));
  expect(res.status).toBe(200);
  const { url, init } = call(fetchMock);
  expect(url).toBe(`${BASE}/profile`);
  expect(init.method).toBe('PUT');
  expect(JSON.parse(init.body as string)).toEqual({ description: '', websites: ['https://exemple.fr'] });

  const refused = await putProfile(jsonReq('PUT', { about: '' }), num('4', '8'));
  expect(refused.status).toBe(400);
  const body = (await refused.json()) as { error: { code: string; details: { path: string }[] } };
  expect(body.error.code).toBe('VALIDATION_ERROR');
  expect(body.error.details[0]!.path).toBe('about');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('BFF photo : gif refusé sans appel au moteur, refus photo_invalid au format standard', async () => {
  const fetchMock = vi.fn(async () => jsonRes(profile));
  vi.stubGlobal('fetch', fetchMock);
  const res = await postPhoto(binaryReq('image/gif', GIF), num('4', '8'));
  expect(res.status).toBe(400);
  expect(res.headers.get('cache-control')).toBe('private, no-store');
  const body = (await res.json()) as { error: { code: string; reason: string; details: { path: string }[] } };
  expect(body.error.code).toBe('VALIDATION_ERROR');
  expect(body.error.reason).toBe('whatsapp_account.photo_invalid');
  expect(body.error.details[0]!.path).toBe('photo');
  expect(fetchMock).not.toHaveBeenCalled();
});

test('BFF photo : fichier au-delà de 5 Mo ou vide refusé sans appel au moteur', async () => {
  const fetchMock = vi.fn(async () => jsonRes(profile));
  vi.stubGlobal('fetch', fetchMock);
  const big = new Uint8Array(PROFILE_PHOTO_MAX_BYTES + 1);
  big.set(PNG);
  const tooBig = await postPhoto(binaryReq('image/png', big), num('4', '8'));
  expect(tooBig.status).toBe(400);
  expect(((await tooBig.json()) as { error: { reason: string } }).error.reason).toBe('whatsapp_account.photo_invalid');
  const empty = await postPhoto(binaryReq('image/jpeg', new Uint8Array(0)), num('4', '8'));
  expect(empty.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('BFF photo : PNG relayé sans être lu en JSON, octets et type intacts, profil relu renvoyé', async () => {
  const fetchMock = vi.fn(async () => jsonRes({ ...profile, photo_url: 'https://pps.whatsapp.net/p.jpg' }));
  vi.stubGlobal('fetch', fetchMock);
  const exact = new Uint8Array(PROFILE_PHOTO_MAX_BYTES);
  exact.set(PNG);
  const res = await postPhoto(binaryReq('image/png', exact), num('4', '8'));
  expect(res.status).toBe(200);
  expect(((await res.json()) as { photo_url: string }).photo_url).toBe('https://pps.whatsapp.net/p.jpg');
  const { url, init } = call(fetchMock);
  expect(url).toBe(`${BASE}/profile/photo`);
  expect(init.method).toBe('POST');
  expect(init.headers['content-type']).toBe('image/png');
  expect(init.headers['authorization']).toBe(`Bearer ${fakeAccess(1)}`);
  const sent = new Uint8Array(init.body as Uint8Array);
  expect(sent.byteLength).toBe(PROFILE_PHOTO_MAX_BYTES);
  expect([...sent.slice(0, PNG.length)]).toEqual([...PNG]);
});

test('BFF photo : refus du moteur relayé tel quel (photo trop petite pour Meta)', async () => {
  const refusal = { error: { code: 'WA_VALIDATION_FAILED', message: 'Photo refusée.', reason: 'whatsapp_account.photo_invalid', details: [{ path: 'photo', message: 'Photo refusée.' }] } };
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes(refusal, 422)));
  const res = await postPhoto(binaryReq('image/jpeg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), num('4', '8'));
  expect(res.status).toBe(422);
  expect(((await res.json()) as { error: { reason: string } }).error.reason).toBe('whatsapp_account.photo_invalid');
});

test('POST display-name : demande relayée ; nom vide refusé sans appel', async () => {
  const fetchMock = vi.fn(async () => jsonRes({ id: 8 }));
  vi.stubGlobal('fetch', fetchMock);
  const res = await requestName(jsonReq('POST', { new_display_name: 'Boutique Marais' }), num('4', '8'));
  expect(res.status).toBe(200);
  const { url, init } = call(fetchMock);
  expect(url).toBe(`${BASE}/display-name`);
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body as string)).toEqual({ new_display_name: 'Boutique Marais' });
  expect((await requestName(jsonReq('POST', { new_display_name: '  ' }), num('4', '8'))).status).toBe(400);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('POST display-name/apply : code relayé ; code qui n\'a pas 6 chiffres refusé sans appel, jamais recopié', async () => {
  const fetchMock = vi.fn(async () => jsonRes({ id: 8 }));
  vi.stubGlobal('fetch', fetchMock);
  const res = await applyName(jsonReq('POST', { pin: '123456' }), num('4', '8'));
  expect(res.status).toBe(200);
  const { url, init } = call(fetchMock);
  expect(url).toBe(`${BASE}/display-name/apply`);
  expect(JSON.parse(init.body as string)).toEqual({ pin: '123456' });

  const refused = await applyName(jsonReq('POST', { pin: '12a45' }), num('4', '8'));
  expect(refused.status).toBe(400);
  expect(await refused.text()).not.toContain('12a45');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
