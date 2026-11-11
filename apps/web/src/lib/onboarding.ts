import type { NotRespondingReason, WhatsAppAccountStateView } from '@wabagent/contracts';

export interface AgentSummaryRow {
  bot_id: string;
  name: string;
  slug: string;
  status: string;
  /** Motif brut d'une pause automatique (lu par `toBotPauseReason`), null sinon. */
  status_reason: string | null;
  /** Mention « Ne répond pas » calculée par le moteur (`decideResponding`), jamais recalculée par le web. */
  not_responding: NotRespondingReason | null;
  /** État affiché du compte WhatsApp du numéro branché, null sans numéro (texte « en erreur » ou « non connecté »). */
  account_state: WhatsAppAccountStateView | null;
  languages: string[];
  default_language: string;
  /** Numéro branché (E.164), null sans numéro. */
  number: string | null;
  /** Vrai si le numéro est présent chez le fournisseur et son compte WhatsApp connecté (`isNumberConnected`). */
  connected: boolean;
  /** Null si la lecture des métriques a échoué : un chiffre inconnu n'est jamais 0. */
  messages_total: number | null;
  leads_total: number | null;
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

/**
 * Destination de « Brancher un numéro » dans la Mise en route (prototype 8) : la page du premier agent IA Draft sans
 * numéro, dans l'ordre de la liste, où le bouton de branchement existe ; sans tel agent IA, Connexions, comme avant.
 */
export function connectTarget(rows: Array<Pick<AgentSummaryRow, 'bot_id' | 'status' | 'number'>>): string {
  const draft = rows.find((r) => r.status === 'draft' && r.number === null);
  return draft ? `/agents/${encodeURIComponent(draft.bot_id)}` : '/organisation/connexions';
}
