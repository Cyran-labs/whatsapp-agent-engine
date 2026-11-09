export interface UsageRowAvailable {
  bot_id: string;
  name: string;
  entity_id: number | null;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

/** Lecture d'usage en échec pour cet agent IA : aucun chiffre (jamais 0), la ligne reste visible. */
export interface UsageRowUnavailable {
  bot_id: string;
  name: string;
  entity_id: number | null;
  unavailable: true;
}

export type UsageRow = UsageRowAvailable | UsageRowUnavailable;

export function isUsageAvailable(row: UsageRow): row is UsageRowAvailable {
  return !('unavailable' in row);
}

export interface UsageTotal {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface UsageSummary {
  rows: UsageRow[];
  /** Total des seules lignes disponibles. */
  total: UsageTotal;
  /** Vrai si au moins une ligne est indisponible : le total est alors partiel. */
  partial: boolean;
}

export function sumUsage(rows: UsageRow[]): UsageTotal {
  return rows.filter(isUsageAvailable).reduce<UsageTotal>(
    (a, r) => ({
      calls: a.calls + r.calls,
      input_tokens: a.input_tokens + r.input_tokens,
      output_tokens: a.output_tokens + r.output_tokens,
      cost_usd: a.cost_usd + r.cost_usd,
    }),
    { calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 },
  );
}
