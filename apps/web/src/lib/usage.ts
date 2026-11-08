export interface UsageRow {
  bot_id: string;
  name: string;
  entity_id: number | null;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface UsageTotal {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface UsageSummary {
  rows: UsageRow[];
  total: UsageTotal;
}

export function sumUsage(rows: UsageRow[]): UsageTotal {
  return rows.reduce<UsageTotal>(
    (a, r) => ({
      calls: a.calls + r.calls,
      input_tokens: a.input_tokens + r.input_tokens,
      output_tokens: a.output_tokens + r.output_tokens,
      cost_usd: a.cost_usd + r.cost_usd,
    }),
    { calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 },
  );
}
