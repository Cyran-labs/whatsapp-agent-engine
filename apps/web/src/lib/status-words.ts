import { NOT_RESPONDING_REASONS, isServingStatus, toBotPauseReason, type NotRespondingReason, type WhatsAppAccountStateView } from '@wabagent/contracts';

/** Clé du texte d'un motif d'Offline (`agentStatus.pauseReasons.*`, spec 6.1). */
export type OfflineReasonKey = 'manual' | 'number_removed' | 'number_unassigned' | 'unknown';

/**
 * Motif d'Offline lu de `status_reason` brut : absent ou nul, arrêt manuel ; motif de `BOT_PAUSE_REASONS` (lu par
 * `toBotPauseReason` des contrats), lui-même ; tout autre texte, `unknown` (« Arrêté »), jamais le code brut.
 */
export function offlineReasonKey(raw: string | null | undefined): OfflineReasonKey {
  if (raw == null) return 'manual';
  return toBotPauseReason(raw) ?? 'unknown';
}

/** Clé du texte de la mention « Ne répond pas » (`agents.notResponding.full.*`, spec 7.1). */
export type NotRespondingTextKey = Exclude<NotRespondingReason, 'account_not_connected'> | 'account_error' | 'account_disconnected';

/** Compte WhatsApp pas connecté : « non connecté » pour un compte déconnecté, « en erreur » sinon (spec 7.1). */
export function notRespondingTextKey(reason: NotRespondingReason, accountState: WhatsAppAccountStateView | null): NotRespondingTextKey {
  if (reason !== 'account_not_connected') return reason;
  return accountState === 'disconnected' ? 'account_disconnected' : 'account_error';
}

/**
 * Motif de mention reçu du moteur (ou relayé par le BFF) : un motif de `NOT_RESPONDING_REASONS`, sinon null. Un motif
 * inconnu des contrats n'est jamais affiché (relecture tâche 7, M-2) ; lu par `shownNotRespondingReason`.
 */
export function toNotRespondingReason(raw: unknown): NotRespondingReason | null {
  return typeof raw === 'string' && (NOT_RESPONDING_REASONS as readonly string[]).includes(raw) ? (raw as NotRespondingReason) : null;
}

/**
 * Mention « Ne répond pas » affichée pour un agent IA : seulement en Preview ou Online (point d'attention 4) et pour un
 * motif connu des contrats. Seule règle des lieux qui la montrent ou la comptent (`AgentStatusLine`, filtre et compteur
 * de la liste des agents IA) : la liste filtrée « Ne répond pas » compte exactement les mentions affichées.
 */
export function shownNotRespondingReason(status: string, raw: unknown): NotRespondingReason | null {
  return isServingStatus(status) ? toNotRespondingReason(raw) : null;
}
