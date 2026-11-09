export interface AgentSummaryRow {
  bot_id: string;
  name: string;
  slug: string;
  status: string;
  languages: string[];
  default_language: string;
  /** Numéro branché (E.164), null sans numéro. */
  number: string | null;
  messages_total: number;
  leads_total: number;
  personalized: boolean;
  entity_id: number;
}

export interface BotSummary {
  bot_id: string;
  name: string;
  status: string;
  default_language: string;
  languages: string[];
  system_prompt: Record<string, string>;
}

export interface ChecklistState {
  created: boolean;
  personalized: boolean;
  connected: boolean;
  active: boolean;
}

export function deriveChecklist(bots: BotSummary[]): ChecklistState {
  const created = bots.length > 0;
  const personalized = bots.some((b) => (b.system_prompt?.[b.default_language] ?? '').trim().length > 0);
  const active = bots.some((b) => b.status === 'active');
  // connected : etat du transport WhatsApp (surface du Plan 7), non lu ici (apercu verrouille).
  const connected = false;
  return { created, personalized, connected, active };
}
