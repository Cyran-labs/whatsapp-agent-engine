import { vi, test, expect, beforeEach } from 'vitest';
const engineFetch = vi.fn();
vi.mock('@/lib/engine-fetch', () => ({ engineFetch: (...a: unknown[]) => engineFetch(...a), EngineError: class extends Error {} }));
beforeEach(() => { engineFetch.mockReset(); engineFetch.mockResolvedValue(null); });

test('agrège usage par agent + total', async () => {
  engineFetch.mockImplementation((path: string) => {
    if (path === '/bots') return Promise.resolve([{ bot_id: 'b1', name: 'A' }, { bot_id: 'b2', name: 'B' }]);
    if (typeof path === 'string' && path.startsWith('/bots/b1/usage')) return Promise.resolve({ totals: { calls: 10, input_tokens: 100, output_tokens: 20, cost_usd: 1 } });
    if (typeof path === 'string' && path.startsWith('/bots/b2/usage')) return Promise.resolve({ totals: { calls: 5, input_tokens: 50, output_tokens: 10, cost_usd: 0.5 } });
    return Promise.resolve(null);
  });
  const { GET } = await import('../summary/route');
  const body = await (await GET(new Request('http://x/api/usage/summary'))).json();
  expect(body.total).toMatchObject({ calls: 15, cost_usd: 1.5 });
  expect(body.rows).toHaveLength(2);
});

test('usage en échec → 0, bot conservé', async () => {
  engineFetch.mockImplementation((path: string) => {
    if (path === '/bots') return Promise.resolve([{ bot_id: 'b1', name: 'A' }]);
    if (path.startsWith('/bots/b1/usage')) return Promise.reject(new Error('boom'));
    return Promise.resolve(null);
  });
  const { GET } = await import('../summary/route');
  const body = await (await GET(new Request('http://x/api/usage/summary'))).json();
  expect(body.rows[0]).toMatchObject({ bot_id: 'b1', calls: 0, cost_usd: 0 });
  expect(body.total).toMatchObject({ calls: 0, cost_usd: 0 });
});

test('chaque ligne porte entity_id du bot, null si le moteur n en renvoie pas', async () => {
  engineFetch.mockImplementation((path: string) => {
    if (path === '/bots') return Promise.resolve([{ bot_id: 'b1', name: 'A', entity_id: 7 }, { bot_id: 'b2', name: 'B' }]);
    return Promise.resolve({ totals: { calls: 1, input_tokens: 1, output_tokens: 1, cost_usd: 0.1 } });
  });
  const { GET } = await import('../summary/route');
  const body = await (await GET(new Request('http://x/api/usage/summary'))).json();
  expect(body.rows.map((r: { bot_id: string; entity_id: number | null }) => [r.bot_id, r.entity_id])).toEqual([['b1', 7], ['b2', null]]);
});
