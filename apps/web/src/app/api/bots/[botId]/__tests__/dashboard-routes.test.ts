import { vi, test, expect, beforeEach } from 'vitest';

const engineFetch = vi.fn();
vi.mock('@/lib/engine-fetch', () => ({ engineFetch: (...a: unknown[]) => engineFetch(...a), EngineError: class extends Error {} }));

beforeEach(() => engineFetch.mockReset());

test('health proxy', async () => {
  engineFetch.mockResolvedValue({ status: 'active' });
  const { GET } = await import('../health/route');
  const res = await GET(new Request('http://x'), { params: Promise.resolve({ botId: 'b1' }) });
  expect(engineFetch).toHaveBeenCalledWith('/bots/b1/health');
  expect(await res.json()).toEqual({ status: 'active' });
});

test('usage propage le query since', async () => {
  engineFetch.mockResolvedValue({ totals: {} });
  const { GET } = await import('../usage/route');
  await GET(new Request('http://x/api/bots/b1/usage?since=2026-06-01'), { params: Promise.resolve({ botId: 'b1' }) });
  expect(engineFetch).toHaveBeenCalledWith('/bots/b1/usage?since=2026-06-01');
});

test('leads propage page_size + search', async () => {
  engineFetch.mockResolvedValue({ leads: [] });
  const { GET } = await import('../leads/route');
  await GET(new Request('http://x/api/bots/b1/leads?page=1&page_size=3&search=jean'), { params: Promise.resolve({ botId: 'b1' }) });
  expect(engineFetch).toHaveBeenCalledWith('/bots/b1/leads?page=1&page_size=3&search=jean');
});
