import { vi, test, expect, beforeEach } from 'vitest';
const engineFetch = vi.fn();
vi.mock('@/lib/engine-fetch', () => ({ engineFetch: (...a: unknown[]) => engineFetch(...a), EngineError: class extends Error {} }));
beforeEach(() => { engineFetch.mockReset(); engineFetch.mockResolvedValue(null); });

test('agrège bots + metrics par agent', async () => {
  engineFetch.mockImplementation((path: string) => {
    if (path === '/bots') return Promise.resolve([{ bot_id: 'b1', name: 'A', slug: 'a', status: 'active', languages: ['fr'], default_language: 'fr', numbers: ['+33'] }]);
    if (path === '/bots/b1/metrics') return Promise.resolve({ messages_total: 142, leads_total: 23, rdv_total: 0, conversations_total: 0 });
    return Promise.resolve(null);
  });
  const { GET } = await import('../summary/route');
  const res = await GET();
  const rows = await res.json();
  expect(rows[0]).toMatchObject({ bot_id: 'b1', messages_total: 142, leads_total: 23 });
});

test('metrics en échec → métriques à 0, bot conservé', async () => {
  engineFetch.mockImplementation((path: string) => {
    if (path === '/bots') return Promise.resolve([{ bot_id: 'b1', name: 'A', slug: 'a', status: 'draft', languages: ['fr'], default_language: 'fr', numbers: [] }]);
    if (path === '/bots/b1/metrics') return Promise.reject(new Error('boom'));
    return Promise.resolve(null);
  });
  const { GET } = await import('../summary/route');
  const rows = await (await GET()).json();
  expect(rows[0]).toMatchObject({ bot_id: 'b1', messages_total: 0, leads_total: 0 });
});
