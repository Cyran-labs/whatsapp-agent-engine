import { describe, expect, it } from 'vitest';
import { buildPricingRows } from '../../../scripts/seed-pricing.js';

describe('buildPricingRows', () => {
  it('contient les 3 modèles de la cascade avec leurs tarifs', () => {
    const rows = buildPricingRows();
    const haiku = rows.find((r) => r.model === 'claude-haiku-4-5-20251001');
    expect(haiku).toEqual({ model: 'claude-haiku-4-5-20251001', input_per_mtok: 1, output_per_mtok: 5, cache_read_per_mtok: 0.1, cache_write_per_mtok: 1.25, currency: 'USD' });
    const sonnet = rows.find((r) => r.model === 'claude-sonnet-4-20250514');
    expect(sonnet!.input_per_mtok).toBe(3);
    expect(sonnet!.output_per_mtok).toBe(15);
    expect(rows).toHaveLength(3);
  });
});
