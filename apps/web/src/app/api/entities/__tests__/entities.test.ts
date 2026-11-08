import { test, expect, vi, beforeEach } from 'vitest';

const engineFetch = vi.fn();
vi.mock('@/lib/engine-fetch', () => ({ engineFetch: (...a: unknown[]) => engineFetch(...a), EngineError: class extends Error {} }));
beforeEach(() => { engineFetch.mockReset(); engineFetch.mockResolvedValue([]); });

import { GET } from '../route';

test('GET /api/entities relaie la liste des entités actives', async () => {
  engineFetch.mockResolvedValue([{ id: 1, name: 'Service client', status: 'active', bots: 2, members: 3 }]);
  const res = await GET(new Request('http://web.test/api/entities'));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([{ id: 1, name: 'Service client', status: 'active', bots: 2, members: 3 }]);
  expect(engineFetch).toHaveBeenCalledWith('/entities', { method: 'GET' });
});

test('GET /api/entities?include_archived=true relaie le paramètre', async () => {
  await GET(new Request('http://web.test/api/entities?include_archived=true'));
  expect(engineFetch).toHaveBeenCalledWith('/entities?include_archived=true', { method: 'GET' });
});

test('GET /api/entities ignore une valeur de include_archived autre que true', async () => {
  await GET(new Request('http://web.test/api/entities?include_archived=1'));
  expect(engineFetch).toHaveBeenCalledWith('/entities', { method: 'GET' });
});
