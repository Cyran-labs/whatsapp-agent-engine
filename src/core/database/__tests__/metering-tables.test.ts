import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../sqlite.js';
import type { Database, LlmUsageInput } from '../types.js';

function usage(over: Partial<LlmUsageInput> = {}): LlmUsageInput {
  return {
    client_id: 'acme', bot_id: 'sales', phone: '33611', call_type: 'chat', mode: 'platform',
    platform_key_id: null, model: 'claude-haiku-4-5-20251001',
    input_tokens: 1000, output_tokens: 200, cache_read_tokens: 0, cache_creation_tokens: 0,
    cost_usd: 0.002, pricing_version: 1, anthropic_request_id: 'req_1', ...over,
  };
}

describe('metering tables (sqlite)', () => {
  let db: Database;
  beforeEach(() => { db = createSqliteDriver(':memory:'); });
  afterEach(async () => { await db.close(); });

  it('upsertLlmPricing versionne : getLlmPricing renvoie le tarif courant', async () => {
    await db.upsertLlmPricing({ model: 'm', input_per_mtok: 3, output_per_mtok: 15, cache_read_per_mtok: 0.3, cache_write_per_mtok: 3.75, currency: 'USD' });
    await db.upsertLlmPricing({ model: 'm', input_per_mtok: 4, output_per_mtok: 16, cache_read_per_mtok: 0.4, cache_write_per_mtok: 5, currency: 'USD' });
    const cur = await db.getLlmPricing('m');
    expect(cur!.input_per_mtok).toBe(4);
    expect(cur!.effective_to).toBeNull();
  });

  it('getLlmPricing renvoie undefined pour un modele inconnu', async () => {
    expect(await db.getLlmPricing('nope')).toBeUndefined();
  });

  it('insertLlmUsage append + listLlmUsage par client', async () => {
    await db.insertLlmUsage(usage());
    await db.insertLlmUsage(usage({ model: 'claude-sonnet-4-20250514', cost_usd: 0.05 }));
    await db.insertLlmUsage(usage({ client_id: 'other' }));
    const rows = await db.listLlmUsage('acme');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).toBeGreaterThan(0);
    expect(rows[0]!.created_at).toBeTruthy();
    expect(rows.map((r) => r.cost_usd).sort()).toEqual([0.002, 0.05]);
  });
});
