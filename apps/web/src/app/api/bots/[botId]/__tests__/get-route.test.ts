import { vi, test, expect, beforeEach } from 'vitest';

const engineFetch = vi.fn();
vi.mock('@/lib/engine-fetch', () => ({ engineFetch: (...a: unknown[]) => engineFetch(...a), EngineError: class extends Error {} }));

beforeEach(() => engineFetch.mockReset());

test('GET /api/bots/[botId] — proxie vers /bots/:id et renvoie le JSON', async () => {
  engineFetch.mockResolvedValue({ id: 'b1', name: 'Support', status: 'active' });
  const { GET } = await import('../route');
  const res = await GET(new Request('http://x'), { params: Promise.resolve({ botId: 'b1' }) });
  expect(engineFetch).toHaveBeenCalledWith('/bots/b1');
  expect(await res.json()).toEqual({ id: 'b1', name: 'Support', status: 'active' });
});
