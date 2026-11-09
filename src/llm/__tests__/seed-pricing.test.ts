import { describe, expect, it } from 'vitest';
import { buildPricingRows } from '../../../scripts/seed-pricing.js';
import { CALLABLE_MODELS } from '../models.js';

describe('buildPricingRows', () => {
  it('tarifs officiels des modèles courants (page Pricing d\'Anthropic, relevée le 9 nov. 2026)', () => {
    const rows = buildPricingRows();
    const row = (model: string) => rows.find((r) => r.model === model);
    expect(row('claude-sonnet-5-5')).toEqual({ model: 'claude-sonnet-5-5', input_per_mtok: 2, output_per_mtok: 10, cache_read_per_mtok: 0.1, cache_write_per_mtok: 2.5, currency: 'USD' });
    expect(row('claude-sonnet-5')).toEqual({ model: 'claude-sonnet-5', input_per_mtok: 2, output_per_mtok: 10, cache_read_per_mtok: 0.2, cache_write_per_mtok: 2.5, currency: 'USD' });
    // Haiku 5.5 : palier des prompts de 100 000 jetons au plus (les prompts du moteur en sont très loin).
    expect(row('claude-haiku-5-5')).toEqual({ model: 'claude-haiku-5-5', input_per_mtok: 0.1, output_per_mtok: 0.5, cache_read_per_mtok: 0.01, cache_write_per_mtok: 0.125, currency: 'USD' });
  });

  it('tout modèle que le moteur peut appeler a un tarif (sinon le coût serait enregistré à 0 sans alerte)', () => {
    const priced = new Set(buildPricingRows().map((r) => r.model));
    for (const model of CALLABLE_MODELS) expect(priced.has(model), model).toBe(true);
  });

  it('les tarifs des anciens modèles restent, pour l\'historique des coûts', () => {
    const models = buildPricingRows().map((r) => r.model);
    expect(models).toEqual(expect.arrayContaining(['claude-sonnet-4-20250514', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001']));
    expect(new Set(models).size).toBe(models.length);
  });
});
