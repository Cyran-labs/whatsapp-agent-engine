/**
 * Seed des tarifs Anthropic courants (USD / million de tokens) dans llm_pricing.
 * Idempotent (upsertLlmPricing versionne). Exécuter : npx tsx scripts/seed-pricing.ts
 */

import 'dotenv/config';
import { initDatabase, getDatabase } from '../src/core/database/index.js';
import type { LlmPricingInput } from '../src/core/database/types.js';

export function buildPricingRows(): LlmPricingInput[] {
  const row = (model: string, input: number, output: number, cacheRead: number, cacheWrite: number): LlmPricingInput => ({
    model, input_per_mtok: input, output_per_mtok: output, cache_read_per_mtok: cacheRead, cache_write_per_mtok: cacheWrite, currency: 'USD',
  });
  return [
    // Modèles courants : page Pricing d'Anthropic relevée le 9 nov. 2026 (écriture en cache = durée de 5 minutes).
    row('claude-sonnet-5-5', 2, 10, 0.1, 2.5),
    row('claude-sonnet-5', 2, 10, 0.2, 2.5),
    // Haiku 5.5 : palier des prompts de 100 000 jetons au plus (au-delà : 0,50 / 2,50 $).
    row('claude-haiku-5-5', 0.1, 0.5, 0.01, 0.125),
    // Anciens modèles, conservés pour le coût de l'historique d'usage.
    row('claude-sonnet-4-20250514', 3, 15, 0.3, 3.75),
    row('claude-sonnet-4-5-20250929', 3, 15, 0.3, 3.75),
    row('claude-haiku-4-5-20251001', 1, 5, 0.1, 1.25),
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
