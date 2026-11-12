import { vi, test, expect, beforeEach } from 'vitest';
import { EngineError } from '@/lib/engine-client';
import type { Me } from '@/lib/organizations';
const engineFetch = vi.fn();
const ADMIN_ME: Me = { id: 1, email: 'a@x.test', role: 'member', status: 'active', organizations: [{ client_id: 'c1', name: 'C1', role: 'admin', read_only: false }] };
// Session lue par la route avant toute lecture (`/auth/me` et cookie d'organisation) : admin de c1 par défaut.
const session = vi.hoisted(() => ({ me: null as unknown, org: undefined as string | undefined }));
vi.mock('@/lib/engine-fetch', () => ({
  engineFetch: (...a: unknown[]) => (a[0] === '/auth/me' ? Promise.resolve(session.me) : engineFetch(...a)),
  EngineError: class extends Error {},
}));
vi.mock('@/lib/session', () => ({ readOrg: async () => session.org }));
beforeEach(() => {
  vi.unstubAllEnvs(); engineFetch.mockReset(); engineFetch.mockResolvedValue(null);
  session.me = ADMIN_ME; session.org = 'c1';
});

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

// audit R-3
test('usage en échec : ligne « unavailable », partial vrai, jamais 0', async () => {
  engineFetch.mockImplementation((path: string) => {
    if (path === '/bots') return Promise.resolve([{ bot_id: 'b1', name: 'A', entity_id: 7 }]);
    if (path.startsWith('/bots/b1/usage')) return Promise.reject(new Error('boom'));
    return Promise.resolve(null);
  });
  const { GET } = await import('../summary/route');
  const body = await (await GET(new Request('http://x/api/usage/summary'))).json();
  expect(body.rows).toEqual([{ bot_id: 'b1', name: 'A', entity_id: 7, unavailable: true }]);
  expect(body.rows[0]).not.toHaveProperty('calls');
  expect(body.rows[0]).not.toHaveProperty('cost_usd');
  expect(body.partial).toBe(true);
});

// audit R-3
test('une lecture en échec sur deux : total des seules lignes disponibles, partial vrai', async () => {
  engineFetch.mockImplementation((path: string) => {
    if (path === '/bots') return Promise.resolve([{ bot_id: 'b1', name: 'A' }, { bot_id: 'b2', name: 'B' }]);
    if (path.startsWith('/bots/b1/usage')) return Promise.reject(new Error('boom'));
    return Promise.resolve({ totals: { calls: 5, input_tokens: 50, output_tokens: 10, cost_usd: 0.5 } });
  });
  const { GET } = await import('../summary/route');
  const body = await (await GET(new Request('http://x/api/usage/summary'))).json();
  expect(body.partial).toBe(true);
  expect(body.total).toEqual({ calls: 5, input_tokens: 50, output_tokens: 10, cost_usd: 0.5 });
  expect(body.rows.map((r: { bot_id: string; unavailable?: true }) => [r.bot_id, r.unavailable === true])).toEqual([['b1', true], ['b2', false]]);
});

test('toutes les lectures réussies : partial faux', async () => {
  engineFetch.mockImplementation((path: string) => {
    if (path === '/bots') return Promise.resolve([{ bot_id: 'b1', name: 'A' }]);
    return Promise.resolve({ totals: { calls: 1, input_tokens: 1, output_tokens: 1, cost_usd: 0.1 } });
  });
  const { GET } = await import('../summary/route');
  expect((await (await GET(new Request('http://x/api/usage/summary'))).json()).partial).toBe(false);
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

// revue 2b-3 (défense en profondeur)
test('un identifiant d\'agent IA contenant « / » est encodé dans le chemin de l\'usage', async () => {
  engineFetch.mockImplementation((path: string) => {
    if (path === '/bots') return Promise.resolve([{ bot_id: 'a/../b', name: 'A' }]);
    return Promise.resolve({ totals: { calls: 1, input_tokens: 1, output_tokens: 1, cost_usd: 0.1 } });
  });
  const { GET } = await import('../summary/route');
  await GET(new Request('http://x/api/usage/summary'));
  expect(engineFetch.mock.calls.map(([path]) => path as string).filter((p) => p !== '/bots')).toEqual(['/bots/a%2F..%2Fb/usage']);
});

// recette Q-2 : le taux de la plateforme est lu côté serveur et ajouté à la réponse
test('usd_eur_rate : taux et date valides ajoutés à la réponse', async () => {
  vi.stubEnv('USD_EUR_RATE', '0.92');
  vi.stubEnv('USD_EUR_RATE_DATE', '2026-11-09');
  engineFetch.mockImplementation((path: string) => Promise.resolve(path === '/bots' ? [] : null));
  const { GET } = await import('../summary/route');
  expect((await (await GET(new Request('http://x/api/usage/summary'))).json()).usd_eur_rate).toEqual({ rate: 0.92, date: '2026-11-09' });
  vi.unstubAllEnvs();
});

// recette Q-2 (point d'attention 4 : taux absent, 0, -1, abc)
test.each([
  ['absent', undefined],
  ['0', '0'],
  ['-1', '-1'],
  ['abc', 'abc'],
])('usd_eur_rate : taux %s donne null, jamais un nombre inutilisable', async (_name, value) => {
  vi.stubEnv('USD_EUR_RATE', value);
  vi.stubEnv('USD_EUR_RATE_DATE', '2026-11-09');
  engineFetch.mockImplementation((path: string) => Promise.resolve(path === '/bots' ? [] : null));
  const { GET } = await import('../summary/route');
  const body = await (await GET(new Request('http://x/api/usage/summary'))).json();
  expect(body.usd_eur_rate).toBeNull();
  vi.unstubAllEnvs();
});

// nav 15.5 : un refus des coûts n'est jamais une ligne « indisponible ».
test('moteur qui refuse (403) la deuxième ligne : réponse 403 entière, sans ligne ni total', async () => {
  engineFetch.mockImplementation((path: string) => {
    if (path === '/bots') return Promise.resolve([{ bot_id: 'b1', name: 'A' }, { bot_id: 'b2', name: 'B' }]);
    if (path.startsWith('/bots/b1/usage')) return Promise.resolve({ totals: { calls: 5, input_tokens: 50, output_tokens: 10, cost_usd: 0.5 } });
    return Promise.reject(new EngineError('FORBIDDEN', 'Accès refusé.', 403, undefined, undefined, 'req-1'));
  });
  const { GET } = await import('../summary/route');
  const res = await GET(new Request('http://x/api/usage/summary'));
  expect(res.status).toBe(403);
  const body = await res.json();
  expect(body).toEqual({ error: { code: 'FORBIDDEN', message: 'Accès refusé.', request_id: 'req-1' } });
  expect(JSON.stringify(body)).not.toMatch(/rows|total|cost_usd|0\.5/);
});

// nav 15.5 : seul le 403 traverse, une autre erreur du moteur garde la ligne « indisponible ».
test('moteur en erreur (500) sur une ligne : la ligne reste « unavailable », réponse 200', async () => {
  engineFetch.mockImplementation((path: string) => {
    if (path === '/bots') return Promise.resolve([{ bot_id: 'b1', name: 'A' }]);
    return Promise.reject(new EngineError('INTERNAL', 'Erreur interne.', 500));
  });
  const { GET } = await import('../summary/route');
  const res = await GET(new Request('http://x/api/usage/summary'));
  expect(res.status).toBe(200);
  expect((await res.json()).rows).toEqual([{ bot_id: 'b1', name: 'A', entity_id: null, unavailable: true }]);
});

// nav 15.5 : le refus part du rôle de la session, avant toute lecture, même sans agent IA à lire.
test.each([
  ['conseiller', 'advisor', false],
  ['manager', 'manager', false],
  ['super manager', 'super_manager', false],
  ['super manager en lecture seule', 'super_manager', true],
] as const)('%s de l\'organisation active : 403 sans aucune lecture du moteur, même sans agent IA', async (_who, role, readOnly) => {
  session.me = { ...ADMIN_ME, organizations: [{ client_id: 'c1', name: 'C1', role: 'admin', read_only: false }, { client_id: 'c2', name: 'C2', role, read_only: readOnly }] };
  session.org = 'c2';
  engineFetch.mockImplementation((path: string) => Promise.resolve(path === '/bots' ? [] : null));
  const { GET } = await import('../summary/route');
  const res = await GET(new Request('http://x/api/usage/summary'));
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'Accès refusé.' } });
  expect(engineFetch).not.toHaveBeenCalled();
});

// nav 15.5 : admin d'une organisation et conseiller d'une autre, la décision suit l'organisation du cookie.
test('admin de l\'organisation active (conseiller ailleurs) : la lecture se fait', async () => {
  session.me = { ...ADMIN_ME, organizations: [{ client_id: 'c2', name: 'C2', role: 'advisor', read_only: false }, { client_id: 'c1', name: 'C1', role: 'admin', read_only: false }] };
  session.org = 'c1';
  engineFetch.mockImplementation((path: string) => Promise.resolve(path === '/bots' ? [] : null));
  const { GET } = await import('../summary/route');
  const res = await GET(new Request('http://x/api/usage/summary'));
  expect(res.status).toBe(200);
  expect(engineFetch).toHaveBeenCalledWith('/bots');
});

// nav 15.5 : sans cookie, une seule organisation est celle que le moteur prend.
test('sans cookie, conseiller de sa seule organisation : 403 sans lecture', async () => {
  session.me = { ...ADMIN_ME, organizations: [{ client_id: 'c1', name: 'C1', role: 'advisor', read_only: false }] };
  session.org = undefined;
  const { GET } = await import('../summary/route');
  expect((await GET(new Request('http://x/api/usage/summary'))).status).toBe(403);
  expect(engineFetch).not.toHaveBeenCalled();
});

// Organisation active indéterminée (plusieurs organisations, aucun cookie) : le moteur décide, la route ne devine pas.
test('organisation active indéterminée : la décision revient au moteur', async () => {
  session.me = { ...ADMIN_ME, organizations: [{ client_id: 'c1', name: 'C1', role: 'advisor', read_only: false }, { client_id: 'c2', name: 'C2', role: 'admin', read_only: false }] };
  session.org = undefined;
  engineFetch.mockImplementation((path: string) => Promise.resolve(path === '/bots' ? [] : null));
  const { GET } = await import('../summary/route');
  await GET(new Request('http://x/api/usage/summary'));
  expect(engineFetch).toHaveBeenCalledWith('/bots');
});
