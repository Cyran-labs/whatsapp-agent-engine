/**
 * Seed des tarifs Anthropic courants (USD / million de tokens) dans llm_pricing.
 * Idempotent (upsertLlmPricing versionne). Exécuter : npx tsx scripts/seed-pricing.ts
 */

import 'dotenv/config';
import { initDatabase, getDatabase } from '../src/core/database/index.js';
import type { LlmPricingInput } from '../src/core/database/types.js';

export function buildPricingRows(): LlmPricingInput[] {
  const sonnet = (model: string): LlmPricingInput => ({
    model, input_per_mtok: 3, output_per_mtok: 15, cache_read_per_mtok: 0.3, cache_write_per_mtok: 3.75, currency: 'USD',
  });
  return [
    sonnet('claude-sonnet-4-20250514'),
    sonnet('claude-sonnet-4-5-20250929'),
    { model: 'claude-haiku-4-5-20251001', input_per_mtok: 1, output_per_mtok: 5, cache_read_per_mtok: 0.1, cache_write_per_mtok: 1.25, currency: 'USD' },
  ];
}

async function main(): Promise<void> {
  await initDatabase();
  const db = getDatabase();
  for (const row of buildPricingRows()) {
    await db.upsertLlmPricing(row);
    console.log(`[SeedPricing] ${row.model} (in=${row.input_per_mtok} out=${row.output_per_mtok})`);
  }
  console.log(`[SeedPricing] ${buildPricingRows().length} tarif(s) à jour.`);
  await db.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error('[SeedPricing] échec:', err); process.exit(1); });
}
