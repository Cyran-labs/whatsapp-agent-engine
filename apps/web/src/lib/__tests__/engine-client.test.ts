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
