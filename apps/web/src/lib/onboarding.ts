import type { WhatsAppAccountStateView } from '@wabagent/contracts';

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

/** Ce que le moteur dit du numéro d'un agent IA et de son compte (`BotNumberSummary`). */
export interface NumberConnection {
  provider_state: 'present' | 'removed';
  account: { state: WhatsAppAccountStateView };
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

/**
 * Mise en route de l'organisation, une seule règle pour la page d'accueil : un agent IA en accès limité est en service
 * comme un agent IA actif ; WhatsApp est connecté quand l'un d'eux a un numéro connecté (`connected`, calculé par le BFF).
 */
export function deriveChecklist(rows: Array<Pick<AgentSummaryRow, 'status' | 'personalized' | 'connected'>>): ChecklistState {
  return {
    created: rows.length > 0,
    personalized: rows.some((r) => r.personalized),
    connected: rows.some((r) => r.connected),
    active: rows.some((r) => r.status === 'active' || r.status === 'limited'),
  };
}
