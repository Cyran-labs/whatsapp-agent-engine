import {
  decideAssign,
  toBotStatus,
  type AssignDecision,
  type WhatsAppAccountStateView,
  type WhatsAppNumberView,
} from '@wabagent/contracts';

/**
 * Refus d'un branchement qu'un écran peut annoncer avant l'envoi. `not_found` (numéro d'une autre organisation) et
 * `holder_changed` (détenteur changé depuis la lecture) ne se décident qu'au moment de l'écriture : l'écran lit ses
 * listes dans l'organisation ouverte et compare le détenteur qu'il vient de lire, ils n'arrivent donc jamais ici.
 */
export type AssignRefusalReason = Exclude<Extract<AssignDecision, { ok: false }>['reason'], 'not_found' | 'holder_changed'>;

/**
 * Décision d'écran d'un branchement (spec en-tête 5, recette 3.7, choix C-14) : `decideAssign` des contrats, la même que
 * les deux pilotes du moteur, avec les faits que l'écran a lus. Détenteur attendu = détenteur lu, aucun numéro actuel,
 * `allowlistCount` 0 (sans effet : un agent IA en service garde son statut, `decideTransition` part de lui), statut en
 * service contrôlé. Un agent IA Draft ou Offline se branche donc sur le numéro d'un compte en erreur ou retiré ; un
 * agent IA Preview ou Online y est refusé (`account_not_connected`). Le moteur décide de nouveau à l'écriture.
 */
export function assignRefusal(
  bot: { bot_id: string; status: string },
  number: WhatsAppNumberView,
  accountState: WhatsAppAccountStateView,
): AssignRefusalReason | null {
  const holder = number.bot?.bot_id ?? null;
  const decision = decideAssign({
    bot: { bot_id: bot.bot_id, status: toBotStatus(bot.status) },
    number: { id: number.id, present: number.provider_state === 'present', is_test: number.is_test, bot_id: holder, account_state: accountState },
    currentNumberId: null,
    allowlistCount: 0,
    expectedHolder: { kind: 'expected', bot_id: holder },
    checkServingStatus: true,
  });
  if (decision.ok) return null;
  const { reason } = decision;
  // Jamais atteint avec les faits ci-dessus ; le moteur rendrait son propre refus à l'écriture.
  if (reason === 'not_found' || reason === 'holder_changed') return null;
  return reason;
}

/**
 * Agent IA Draft quelconque (aucun identifiant réel) : l'entrée « Brancher sur un agent IA » de Connexions est ouverte
 * si un agent IA Draft pouvait prendre le numéro ; la fenêtre décide ensuite pour chaque agent IA (recette 3.7).
 */
export const ANY_DRAFT_BOT = { bot_id: '', status: 'draft' } as const;

/**
 * Clé du texte d'écran d'un refus de branchement, dans `errors.reasons` : le texte des contrats traduit
 * (`TRANSITION_MESSAGES` ; pour un numéro retiré, `ASSIGN_NUMBER_REMOVED_MESSAGE`, le numéro choisi est en cause).
 */
export function assignRefusalKey(reason: AssignRefusalReason): string {
  return reason === 'number_removed' ? 'errors.reasons.assign.number_removed' : `errors.reasons.transition.${reason}`;
}
