export interface AgentSummaryRow {
  bot_id: string;
  name: string;
  slug: string;
  status: string;
  languages: string[];
  default_language: string;
  /** Numéro branché (E.164), null sans numéro. */
  number: string | null;
  /** Vrai si le numéro est présent chez le fournisseur et son compte WhatsApp connecté (`isNumberConnected`). */
  connected: boolean;
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
  whatsapp_number: NumberConnection | null;
}

/** Ce que le moteur dit du numéro d'un agent IA et de son compte (`BotNumberSummary`). */
export interface NumberConnection {
  provider_state: 'present' | 'removed';
  account: { state: 'connected' | 'error' | 'disconnected' };
}

/**
 * WhatsApp est connecté pour un agent IA quand son numéro est présent chez le fournisseur et que le compte
 * du numéro est connecté (un compte en erreur ou déconnecté, un numéro retiré, ne répondent pas).
 */
export function isNumberConnected(number: NumberConnection | null): boolean {
  return number !== null && number.provider_state === 'present' && number.account.state === 'connected';
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
  const connected = bots.some((b) => isNumberConnected(b.whatsapp_number));
  return { created, personalized, connected, active };
}
