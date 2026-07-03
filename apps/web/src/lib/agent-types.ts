export interface BotHealth {
  status: string;
  numbers: string[];
  languages: string[];
  whatsapp: { validated: boolean; validated_at: string | null; error: string | null };
  crm: { configured: boolean; connector: string | null; last_error: string | null; last_error_at: string | null };
  llm: { mode: string; key_configured: boolean };
}

export interface BotMetrics {
  leads_total: number;
  rdv_total: number;
  conversations_total: number;
  messages_total: number;
}

export interface UsageData {
  totals: {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    cost_usd: number;
    calls: number;
  };
  by_model: Array<{ model: string; calls: number; cost_usd: number; input_tokens: number; output_tokens: number }>;
  by_day: Array<{ day: string; cost_usd: number; calls: number }>;
}
