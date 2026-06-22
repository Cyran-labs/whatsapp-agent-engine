import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteDriver } from '../../core/database/sqlite.js';
import { __setDatabaseForTests, getDatabase } from '../../core/database/index.js';
import { computeCost, extractTokens, recordUsage } from '../usage-recorder.js';

describe('computeCost', () => {
  it('somme input/output/cache au prorata du million de tokens', () => {
    const c = computeCost({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheCreation: 1_000_000 },
      { input_per_mtok: 3, output_per_mtok: 15, cache_read_per_mtok: 0.3, cache_write_per_mtok: 3.75 });
    expect(c).toBeCloseTo(3 + 15 + 0.3 + 3.75, 6);
  });
});

describe('extractTokens', () => {
  it('mappe les champs usage du SDK', () => {
    expect(extractTokens({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 }))
      .toEqual({ input: 10, output: 5, cacheRead: 2, cacheCreation: 1 });
  });
  it('défaut 0 sur champs absents / usage non-objet', () => {
    expect(extractTokens(null)).toEqual({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
  });
});

describe('recordUsage', () => {
  beforeEach(() => { __setDatabaseForTests(createSqliteDriver(':memory:')); });

  it('insère une ligne avec coût calculé depuis le tarif courant', async () => {
    await getDatabase().upsertLlmPricing({ model: 'm', input_per_mtok: 3, output_per_mtok: 15, cache_read_per_mtok: 0.3, cache_write_per_mtok: 3.75, currency: 'USD' });
    await recordUsage({ clientId: 'acme', botId: 'immo', phone: '33611', callType: 'chat', mode: 'platform',
      model: 'm', usage: { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    const rows = await getDatabase().listLlmUsage('acme');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cost_usd).toBeCloseTo(3, 6);
    expect(rows[0]!.model).toBe('m');
    expect(rows[0]!.call_type).toBe('chat');
  });

  it('tarif inconnu -> coût 0 mais ligne quand même enregistrée', async () => {
    await recordUsage({ clientId: 'acme', botId: null, phone: null, callType: 'chat', mode: 'byo',
      model: 'unknown', usage: { input_tokens: 100, output_tokens: 50 } });
    const rows = await getDatabase().listLlmUsage('acme');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cost_usd).toBe(0);
    expect(rows[0]!.input_tokens).toBe(100);
  });

  it('ne throw jamais (DB en échec avalé)', async () => {
    __setDatabaseForTests({ getLlmPricing: async () => { throw new Error('db down'); } } as never);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(recordUsage({ clientId: 'x', botId: null, phone: null, callType: 'chat', mode: 'byo', model: 'm', usage: {} })).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
