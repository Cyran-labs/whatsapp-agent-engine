import { vi, test, expect, beforeEach } from 'vitest';
const engineFetch = vi.fn();
vi.mock('@/lib/engine-fetch', () => ({ engineFetch: (...a: unknown[]) => engineFetch(...a), EngineError: class extends Error {} }));
beforeEach(() => { engineFetch.mockReset(); engineFetch.mockResolvedValue(null); });

test('agrège bots + metrics par agent', async () => {
  engineFetch.mockImplementation((path: string) => {
    if (path === '/bots') return Promise.resolve([{ bot_id: 'b1', name: 'A', slug: 'a', status: 'active', languages: ['fr'], default_language: 'fr', whatsapp_number: { id: 4, phone_e164: '+33612000047', provider_state: 'present', account: { state: 'connected' } }, allowlist: [], system_prompt: { fr: 'Tu es un assistant.' } }]);
    if (path === '/bots/b1/metrics') return Promise.resolve({ messages_total: 142, leads_total: 23, rdv_total: 0, conversations_total: 0 });
    return Promise.resolve(null);
  });
  const { GET } = await import('../summary/route');
  const res = await GET();
  const rows = await res.json();
  expect(rows[0]).toMatchObject({ bot_id: 'b1', messages_total: 142, leads_total: 23, personalized: true, number: '+33612000047' });
});

// audit R-3
test('metrics en échec : compteurs null (inconnus), jamais 0, agent IA conservé', async () => {
  engineFetch.mockImplementation((path: string) => {
    if (path === '/bots') return Promise.resolve([{ bot_id: 'b1', name: 'A', slug: 'a', status: 'draft', languages: ['fr'], default_language: 'fr', whatsapp_number: null }]);
    if (path === '/bots/b1/metrics') return Promise.reject(new Error('boom'));
    return Promise.resolve(null);
  });
  const { GET } = await import('../summary/route');
  const rows = await (await GET()).json();
  expect(rows[0]).toMatchObject({ bot_id: 'b1', messages_total: null, leads_total: null, personalized: false, number: null });
});

// audit R-3
test('metrics sans compteur dans la réponse : null, pas 0', async () => {
  engineFetch.mockImplementation((path: string) => {
    if (path === '/bots') return Promise.resolve([{ bot_id: 'b1', name: 'A', slug: 'a', status: 'draft', languages: ['fr'], default_language: 'fr', whatsapp_number: null }]);
    return Promise.resolve({});
  });
  const { GET } = await import('../summary/route');
  const rows = await (await GET()).json();
  expect(rows[0]).toMatchObject({ messages_total: null, leads_total: null });
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

// revue 2b-3 (défense en profondeur) : l'identifiant d'agent IA renvoyé par le moteur est encodé dans le chemin des métriques
test('un identifiant d\'agent IA contenant « / » est encodé dans le chemin des métriques', async () => {
  engineFetch.mockImplementation((path: string) => {
    if (path === '/bots') return Promise.resolve([{ bot_id: 'a/../b', name: 'A', slug: 'a', status: 'draft', languages: ['fr'], default_language: 'fr', whatsapp_number: null, entity_id: 1 }]);
    return Promise.resolve({ messages_total: 3, leads_total: 1 });
  });
  const { GET } = await import('../summary/route');
  const rows = await (await GET()).json();
  expect(engineFetch).toHaveBeenCalledWith('/bots/a%2F..%2Fb/metrics');
  expect(engineFetch).not.toHaveBeenCalledWith('/bots/a/../b/metrics');
  expect(rows[0]).toMatchObject({ bot_id: 'a/../b', messages_total: 3 });
});

// nav 15.1 : le BFF relaie la mention et le motif calculés par le moteur, sans les recalculer.
test("relaie status_reason, not_responding et l'état du compte du numéro branché", async () => {
  engineFetch.mockImplementation((path: string) => {
    if (path === '/bots') return Promise.resolve([
      { ...rawBot({ ...FULL, provider_state: 'present', account: { state: 'error' } }), status: 'limited', status_reason: null, not_responding: 'account_not_connected' },
      { ...rawBot({ ...FULL, provider_state: 'removed', account: { state: 'connected' } }), bot_id: 'b2', status: 'paused', status_reason: 'number_removed', not_responding: null },
      { ...rawBot(null), bot_id: 'b3', status: 'active', status_reason: null, not_responding: 'no_number' },
    ]);
    return Promise.resolve({ messages_total: 0, leads_total: 0 });
  });
  const { GET } = await import('../summary/route');
  const rows = await (await GET()).json();
  expect(rows.map((r: { bot_id: string; status_reason: string | null; not_responding: string | null; account_state: string | null }) =>
    [r.bot_id, r.status_reason, r.not_responding, r.account_state])).toEqual([
    ['b1', null, 'account_not_connected', 'error'],
    ['b2', 'number_removed', null, 'connected'],
    ['b3', null, 'no_number', null],
  ]);
});

test('champs absents de la réponse du moteur : null, jamais undefined', async () => {
  engineFetch.mockImplementation((path: string) => Promise.resolve(path === '/bots' ? [rawBot(null)] : { messages_total: 0, leads_total: 0 }));
  const { GET } = await import('../summary/route');
  const rows = await (await GET()).json();
  expect(rows[0]).toMatchObject({ status_reason: null, not_responding: null, account_state: null });
});

// revue tâche 1, M-3 : un numéro sans `account` dans la réponse du moteur ne fait pas tomber toute la liste.
test('numéro sans account : account_state null, liste conservée', async () => {
  engineFetch.mockImplementation((path: string) => Promise.resolve(path === '/bots' ? [rawBot({ id: 4, phone_e164: '+33612000047' })] : { messages_total: 0, leads_total: 0 }));
  const { GET } = await import('../summary/route');
  const res = await GET();
  expect(res.status).toBe(200);
  const rows = await res.json();
  expect(rows[0]).toMatchObject({ bot_id: 'b1', number: '+33612000047', account_state: null, connected: false });
});
