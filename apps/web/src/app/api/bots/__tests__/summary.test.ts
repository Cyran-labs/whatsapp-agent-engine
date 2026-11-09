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

const FULL = { id: 4, phone_e164: '+33612000047', display_name: 'Boutique', is_test: false, quality: null };
function rawBot(number: unknown) {
  return { bot_id: 'b1', name: 'A', slug: 'a', status: 'draft', languages: ['fr'], default_language: 'fr', whatsapp_number: number, entity_id: 1 };
}
async function connectedFor(number: unknown): Promise<boolean> {
  engineFetch.mockImplementation((path: string) => Promise.resolve(path === '/bots' ? [rawBot(number)] : { messages_total: 0, leads_total: 0 }));
  const { GET } = await import('../summary/route');
  const rows = await (await GET()).json();
  return rows[0].connected;
}

test('connected : numéro présent sur un compte connecté', async () => {
  expect(await connectedFor({ ...FULL, provider_state: 'present', account: { state: 'connected' } })).toBe(true);
});

test('connected : numéro retiré sur un compte connecté', async () => {
  expect(await connectedFor({ ...FULL, provider_state: 'removed', account: { state: 'connected' } })).toBe(false);
});

test('connected : numéro présent sur un compte en erreur', async () => {
  expect(await connectedFor({ ...FULL, provider_state: 'present', account: { state: 'error' } })).toBe(false);
});

test('connected : aucun numéro', async () => {
  expect(await connectedFor(null)).toBe(false);
});
