import { vi, test, expect, beforeEach } from 'vitest';
const engineFetch = vi.fn();
vi.mock('@/lib/engine-fetch', () => ({ engineFetch: (...a: unknown[]) => engineFetch(...a), EngineError: class extends Error {} }));
beforeEach(() => { engineFetch.mockReset(); engineFetch.mockResolvedValue(null); });

test('agrège bots + metrics par agent', async () => {
  engineFetch.mockImplementation((path: string) => {
    if (path === '/bots') return Promise.resolve([{ bot_id: 'b1', name: 'A', slug: 'a', status: 'active', languages: ['fr'], default_language: 'fr', whatsapp_number: { id: 4, phone_e164: '+33612000047' }, allowlist: [], system_prompt: { fr: 'Tu es un assistant.' } }]);
    if (path === '/bots/b1/metrics') return Promise.resolve({ messages_total: 142, leads_total: 23, rdv_total: 0, conversations_total: 0 });
    return Promise.resolve(null);
  });
  const { GET } = await import('../summary/route');
  const res = await GET();
  const rows = await res.json();
  expect(rows[0]).toMatchObject({ bot_id: 'b1', messages_total: 142, leads_total: 23, personalized: true, number: '+33612000047' });
});

test('metrics en échec → métriques à 0, bot conservé', async () => {
  engineFetch.mockImplementation((path: string) => {
    if (path === '/bots') return Promise.resolve([{ bot_id: 'b1', name: 'A', slug: 'a', status: 'draft', languages: ['fr'], default_language: 'fr', whatsapp_number: null }]);
    if (path === '/bots/b1/metrics') return Promise.reject(new Error('boom'));
    return Promise.resolve(null);
  });
  const { GET } = await import('../summary/route');
  const rows = await (await GET()).json();
  expect(rows[0]).toMatchObject({ bot_id: 'b1', messages_total: 0, leads_total: 0, personalized: false, number: null });
});

test('personalized false si prompt vide', async () => {
  engineFetch.mockImplementation((path: string) => {
    if (path === '/bots') return Promise.resolve([
      { bot_id: 'b2', name: 'B', slug: 'b', status: 'draft', languages: ['fr'], default_language: 'fr', whatsapp_number: null, system_prompt: { fr: '   ' } },
    ]);
    if (path === '/bots/b2/metrics') return Promise.resolve({ messages_total: 0, leads_total: 0 });
    return Promise.resolve(null);
  });
  const { GET } = await import('../summary/route');
  const rows = await (await GET()).json();
  expect(rows[0]).toMatchObject({ bot_id: 'b2', personalized: false });
});

test('chaque ligne porte entity_id', async () => {
  engineFetch.mockImplementation((path: string) => {
    if (path === '/bots') return Promise.resolve([
      { bot_id: 'b1', name: 'A', slug: 'a', status: 'active', languages: ['fr'], default_language: 'fr', whatsapp_number: null, entity_id: 12 },
      { bot_id: 'b2', name: 'B', slug: 'b', status: 'draft', languages: ['fr'], default_language: 'fr', whatsapp_number: null, entity_id: 7 },
    ]);
    return Promise.resolve({ messages_total: 0, leads_total: 0 });
  });
  const { GET } = await import('../summary/route');
  const rows = await (await GET()).json();
  expect(rows.map((r: { bot_id: string; entity_id: number }) => [r.bot_id, r.entity_id])).toEqual([['b1', 12], ['b2', 7]]);
});
