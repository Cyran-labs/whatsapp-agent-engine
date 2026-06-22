/**
 * Enregistrement de l'usage LLM (tokens + coût réel à T) — fire-and-forget.
 *
 * Ne throw JAMAIS vers l'appelant et n'ajoute pas de latence bloquante : un échec
 * de metering ne doit jamais dégrader une réponse utilisateur. platform_key_id
 * n'est pas peuplé ici (attribution par clé du pool = ultérieure).
 */

import { getDatabase } from '../core/database/index.js';

export interface UsageEvent {
  clientId: string;
  botId: string | null;
  phone: string | null;
  callType: 'chat' | 'lead_extraction';
  mode: 'byo' | 'platform';
  model: string;
  usage: unknown;
  requestId?: string | null;
}

export function extractTokens(usage: unknown): { input: number; output: number; cacheRead: number; cacheCreation: number } {
  const u = (usage && typeof usage === 'object' ? usage : {}) as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === 'number' ? v : 0);
  return {
    input: n(u['input_tokens']),
    output: n(u['output_tokens']),
    cacheRead: n(u['cache_read_input_tokens']),
    cacheCreation: n(u['cache_creation_input_tokens']),
  };
}

export function computeCost(
  t: { input: number; output: number; cacheRead: number; cacheCreation: number },
  p: { input_per_mtok: number; output_per_mtok: number; cache_read_per_mtok: number; cache_write_per_mtok: number },
): number {
  const M = 1_000_000;
  return (t.input * p.input_per_mtok + t.output * p.output_per_mtok
    + t.cacheRead * p.cache_read_per_mtok + t.cacheCreation * p.cache_write_per_mtok) / M;
}

export async function recordUsage(ev: UsageEvent): Promise<void> {
  try {
    const db = getDatabase();
    const tokens = extractTokens(ev.usage);
    const pricing = await db.getLlmPricing(ev.model);
    let cost = 0;
    if (pricing) {
      cost = computeCost(tokens, pricing);
    } else {
      console.warn(`[Metering] No pricing for model ${ev.model} — cost recorded as 0`);
    }
    await db.insertLlmUsage({
      client_id: ev.clientId, bot_id: ev.botId, phone: ev.phone,
      call_type: ev.callType, mode: ev.mode, platform_key_id: null, model: ev.model,
      input_tokens: tokens.input, output_tokens: tokens.output,
      cache_read_tokens: tokens.cacheRead, cache_creation_tokens: tokens.cacheCreation,
      cost_usd: cost, pricing_version: pricing?.id ?? null,
      anthropic_request_id: ev.requestId ?? null,
    });
  } catch (err) {
    console.warn(`[Metering] record failed: ${(err as { message?: string }).message ?? 'unknown'}`);
  }
}
