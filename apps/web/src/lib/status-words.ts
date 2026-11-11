import { toBotPauseReason, type NotRespondingReason, type WhatsAppAccountStateView } from '@wabagent/contracts';

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
