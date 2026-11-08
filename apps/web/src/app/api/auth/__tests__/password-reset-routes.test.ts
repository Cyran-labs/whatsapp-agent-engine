import { test, expect, vi, beforeEach } from 'vitest';
import { POST as forgotPassword } from '../forgot-password/route';
import { POST as resetPassword } from '../reset-password/route';

beforeEach(() => {
  process.env.ENGINE_API_URL = 'http://engine.test/api/admin/v1';
  vi.restoreAllMocks();
});

function jsonReq(name: string, body: unknown): Request {
  return new Request(`http://web.test/api/auth/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function engineError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message, request_id: 'r' } }), { status, headers: { 'content-type': 'application/json' } });
}

test('forgot-password : transmet l\'adresse au moteur sans session et répond 204', async () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  const res = await forgotPassword(jsonReq('forgot-password', { email: 'claire@maison-lumiere.fr' }));
  expect(res.status).toBe(204);
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toBe('http://engine.test/api/admin/v1/auth/forgot-password');
  expect(init?.body).toBe(JSON.stringify({ email: 'claire@maison-lumiere.fr' }));
  expect(new Headers(init?.headers).has('authorization')).toBe(false);
});

test('forgot-password : transmet invite au moteur quand il est présent', async () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  const res = await forgotPassword(jsonReq('forgot-password', { email: 'claire@maison-lumiere.fr', invite: 'jeton-invitation' }));
  expect(res.status).toBe(204);
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ email: 'claire@maison-lumiere.fr', invite: 'jeton-invitation' });
});

test('forgot-password : un refus 4xx du moteur reste un 204', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => engineError(404, 'NOT_FOUND', 'Compte introuvable.')));
  const res = await forgotPassword(jsonReq('forgot-password', { email: 'inconnu@example.com' }));
  expect(res.status).toBe(204);
});

test('forgot-password : 429 propagé (seule différence, sans lien avec le compte)', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => engineError(429, 'RATE_LIMITED', 'Trop de tentatives.')));
  const res = await forgotPassword(jsonReq('forgot-password', { email: 'x@example.com' }));
  expect(res.status).toBe(429);
  expect((await res.json()).error.code).toBe('RATE_LIMITED');
});

test('forgot-password : 5xx du moteur propagé', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => engineError(500, 'INTERNAL', 'Erreur engine.')));
  const res = await forgotPassword(jsonReq('forgot-password', { email: 'x@example.com' }));
  expect(res.status).toBe(500);
});

test('forgot-password : adresse invalide, 400 sans appeler le moteur', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const res = await forgotPassword(jsonReq('forgot-password', { email: 'pas-un-email' }));
  expect(res.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('reset-password : 204 en cas de succès', async () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  const res = await resetPassword(jsonReq('reset-password', { token: 'rtok', password: 'motdepasse12' }));
  expect(res.status).toBe(204);
  expect(String(fetchMock.mock.calls[0][0])).toBe('http://engine.test/api/admin/v1/auth/reset-password');
  expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has('authorization')).toBe(false);
});

test('reset-password : 401 du moteur propagé avec son message', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => engineError(401, 'UNAUTHORIZED', 'Lien de réinitialisation invalide ou expiré.')));
  const res = await resetPassword(jsonReq('reset-password', { token: 'rtok', password: 'motdepasse12' }));
  expect(res.status).toBe(401);
  expect((await res.json()).error.message).toBe('Lien de réinitialisation invalide ou expiré.');
});

test('reset-password : mot de passe de 9 caractères, 400 sans appeler le moteur', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const res = await resetPassword(jsonReq('reset-password', { token: 'rtok', password: '123456789' }));
  expect(res.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});
