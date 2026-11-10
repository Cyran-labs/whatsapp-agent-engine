import { vi, test, expect, beforeEach, afterEach } from 'vitest';

const engineFetch = vi.fn();
vi.mock('@/lib/engine-fetch', () => ({ engineFetch: (...a: unknown[]) => engineFetch(...a), EngineError: class extends Error {} }));

const USAGE = {
  totals: { input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: 0.5, calls: 2 },
  by_model: [],
  by_day: [],
};

beforeEach(() => {
  engineFetch.mockReset();
  engineFetch.mockResolvedValue(USAGE);
  vi.unstubAllEnvs();
});
afterEach(() => { vi.unstubAllEnvs(); });

async function read(): Promise<Record<string, unknown>> {
  const { GET } = await import('../[botId]/usage/route');
  return (await GET(new Request('http://x/api/bots/b1/usage?since=2026-10-01'), { params: Promise.resolve({ botId: 'b1' }) })).json();
}

// recette Q-2
test('usage d\'un agent IA : la réponse du moteur reste intacte et reçoit usd_eur_rate', async () => {
  vi.stubEnv('USD_EUR_RATE', '0.92');
  vi.stubEnv('USD_EUR_RATE_DATE', '2026-11-09');
  const body = await read();
  expect(body).toEqual({ ...USAGE, usd_eur_rate: { rate: 0.92, date: '2026-11-09' } });
  expect(engineFetch).toHaveBeenCalledWith('/bots/b1/usage?since=2026-10-01');
});

// recette Q-2 (point d'attention 4 : taux absent, 0, -1, abc)
test.each([
  ['absent', undefined],
  ['0', '0'],
  ['-1', '-1'],
  ['abc', 'abc'],
])('taux %s : usd_eur_rate nul', async (_name, value) => {
  vi.stubEnv('USD_EUR_RATE', value);
  vi.stubEnv('USD_EUR_RATE_DATE', '2026-11-09');
  expect((await read()).usd_eur_rate).toBeNull();
});

test('date du taux absente : usd_eur_rate nul', async () => {
  vi.stubEnv('USD_EUR_RATE', '0.92');
  vi.stubEnv('USD_EUR_RATE_DATE', undefined);
  expect((await read()).usd_eur_rate).toBeNull();
});
