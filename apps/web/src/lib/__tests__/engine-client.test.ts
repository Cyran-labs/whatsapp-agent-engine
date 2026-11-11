import { test, expect, vi, beforeEach } from 'vitest';
import { engineCall, EngineError } from '../engine-client';

beforeEach(() => {
  process.env.ENGINE_API_URL = 'http://engine.test/api/admin/v1';
  vi.restoreAllMocks();
});

test('retourne le JSON sur 200', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }),
  ));
  const out = await engineCall<{ ok: boolean }>('/ping');
  expect(out).toEqual({ ok: true });
});

test('corps non-JSON sur 500 → EngineError INTERNAL', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response('<html>oops</html>', { status: 500, headers: { 'content-type': 'text/html' } }),
  ));
  await expect(engineCall('/ping')).rejects.toMatchObject({
    name: 'EngineError',
    code: 'INTERNAL',
    status: 500,
  } satisfies Partial<EngineError>);
});

test('lève EngineError typée sur erreur engine', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(
      JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Non authentifié.', request_id: 'r1' } }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    ),
  ));
  await expect(engineCall('/auth/me')).rejects.toMatchObject({
    name: 'EngineError',
    code: 'UNAUTHORIZED',
    status: 401,
  } satisfies Partial<EngineError>);
});

test('l\'appel au moteur est toujours en cache: no-store, même si l\'appelant demande autre chose', async () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  await engineCall('/ping');
  await engineCall('/ping', { method: 'POST', cache: 'force-cache' });
  expect(fetchMock.mock.calls.map((c) => c[1]?.cache)).toEqual(['no-store', 'no-store']);
});

// audit R-14
test('EngineError reprend reason et request_id du moteur', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(
      JSON.stringify({ error: { code: 'CONFLICT', message: 'Ce numéro a changé.', reason: 'assign.holder_changed', request_id: 'req-9' } }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    ),
  ));
  await expect(engineCall('/x')).rejects.toMatchObject({ code: 'CONFLICT', reason: 'assign.holder_changed', requestId: 'req-9' });
});

// audit R-14
test('une clé de refus inconnue du contrat est ignorée, la référence est gardée', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(
      JSON.stringify({ error: { code: 'CONFLICT', message: 'Refusé.', reason: 'inventee.cle', request_id: 'req-9' } }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    ),
  ));
  const err = await engineCall('/x').catch((e: unknown) => e);
  expect(err).toBeInstanceOf(EngineError);
  expect((err as EngineError).reason).toBeUndefined();
  expect((err as EngineError).requestId).toBe('req-9');
});

// audit R-14
test('corps moteur illisible : message français dédié, plus « Erreur engine. »', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>oops</html>', { status: 502 })));
  await expect(engineCall('/x')).rejects.toMatchObject({ code: 'INTERNAL', status: 502, message: 'Le moteur a renvoyé une réponse illisible.' });
});

// recette 3.1 : moteur arrêté (port fermé), `fetch` rejeté sans réponse HTTP : refus typé 503, jamais une erreur inattendue
test('fetch rejeté (moteur injoignable) : EngineError ENGINE_UNREACHABLE 503, journal sans adresse ni jeton', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new TypeError('fetch failed');
  }));
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const call = engineCall('/auth/me', { headers: { authorization: 'Bearer secret-jeton' } });
  await expect(call).rejects.toBeInstanceOf(EngineError);
  await expect(call).rejects.toMatchObject({
    code: 'ENGINE_UNREACHABLE',
    message: 'Le moteur ne répond pas.',
    status: 503,
  } satisfies Partial<EngineError>);
  expect(log).toHaveBeenCalledWith('[BFF] moteur injoignable');
  const logged = JSON.stringify(log.mock.calls);
  expect(logged).not.toContain('engine.test');
  expect(logged).not.toContain('secret-jeton');
});
