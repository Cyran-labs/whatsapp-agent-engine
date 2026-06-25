import { test, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (k: string) => (store.has(k) ? { value: store.get(k) } : undefined),
    set: (k: string, v: string) => { store.set(k, v); },
    delete: (k: string) => { store.delete(k); },
  }),
}));

import { GET as listBots, POST as createBot } from '../route';
import { PATCH as patchBot } from '../[botId]/route';
import { POST as simulate } from '../[botId]/simulate/route';
import { ACCESS_COOKIE } from '@/lib/session';

beforeEach(() => {
  process.env.ENGINE_API_URL = 'http://engine.test/api/admin/v1';
  store.clear();
  store.set(ACCESS_COOKIE, 'access-1');
  vi.restoreAllMocks();
});

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('GET /api/bots renvoie la liste', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes([{ bot_id: 'a', name: 'A' }])));
  const res = await listBots();
  expect(res.status).toBe(200);
  expect((await res.json())[0].bot_id).toBe('a');
});

test('POST /api/bots : validation locale → 400 sans appel engine', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const res = await createBot(new Request('http://web.test/api/bots', { method: 'POST', body: JSON.stringify({ name: '' }) }));
  expect(res.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('POST /api/bots OK → 201', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ bot_id: 'sales', name: 'Ventes' }, 201)));
  const body = { bot_id: 'sales', name: 'Ventes', transport: 'meta-cloud', welcome: { enabled: false, message: {} }, personality: { fr: { role: 'Conseiller' } } };
  const res = await createBot(new Request('http://web.test/api/bots', { method: 'POST', body: JSON.stringify(body) }));
  expect(res.status).toBe(201);
  expect((await res.json()).bot_id).toBe('sales');
});

test('PATCH /api/bots/:id OK', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ bot_id: 'sales', name: 'Ventes 2' })));
  const res = await patchBot(new Request('http://web.test/api/bots/sales', { method: 'PATCH', body: JSON.stringify({ name: 'Ventes 2' }) }), { params: Promise.resolve({ botId: 'sales' }) });
  expect(res.status).toBe(200);
});

test('POST simulate OK', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ session_id: 's1', reply: 'Bonjour', model: 'haiku' })));
  const res = await simulate(new Request('http://web.test/api/bots/sales/simulate', { method: 'POST', body: JSON.stringify({ message: 'salut', use_bot_config: false }) }), { params: Promise.resolve({ botId: 'sales' }) });
  expect((await res.json()).reply).toBe('Bonjour');
});
