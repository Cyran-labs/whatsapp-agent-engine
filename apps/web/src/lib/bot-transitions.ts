import { decideTransition, type BotNumberSummary, type BotStatus, type TransitionRefusal } from '@wabagent/contracts';

/** Ce que la machine d'états lit d'un agent IA : son statut, son numéro branché et sa Whitelist. */
export interface BotFacts {
  status: BotStatus;
  whatsapp_number: BotNumberSummary | null;
  allowlist: string[];
}

/** Raison d'une action indisponible : un refus de la machine d'états, hors changement impossible (non proposé). */
export type ActionReason = Exclude<TransitionRefusal, 'invalid_transition'>;

export interface BotAction {
  target: BotStatus;
  /**
   * Libellé (spec 6.1) : `limit` « Passer en Preview » depuis Draft, `limitAccess` « Limiter à la Whitelist » (décision de
   * François A11) depuis Online, `resume` « Repasser en Preview » et `reopen` « Repasser Online » depuis Offline, `open`
   * « Passer Online » depuis Preview ou Draft, `deactivate` « Passer Offline » pour arrêter.
   */
  key: 'limit' | 'limitAccess' | 'resume' | 'open' | 'reopen' | 'deactivate';
  enabled: boolean;
  reason: ActionReason | null;
}

/**
 * Cibles proposées à l'écran. Jamais `draft` (recette Q-1, décision C-1 A) : une seule façon d'arrêter un agent IA,
 * « Passer Offline » (`paused`). Le moteur garde la transition vers `draft` par l'API ; un agent IA en service qui perd son
 * numéro passe en `paused` avec un motif (`BOT_PAUSE_REASONS`, décision de François A9), jamais en `draft`.
 */
const TARGETS: readonly BotStatus[] = ['limited', 'active', 'paused'];

function keyFor(from: BotStatus, target: BotStatus): BotAction['key'] {
  if (target === 'limited') return from === 'paused' ? 'resume' : from === 'active' ? 'limitAccess' : 'limit';
  if (target === 'active') return from === 'paused' ? 'reopen' : 'open';
  return 'deactivate';
}

/**
 * Actions de statut proposées à l'admin, avec la raison de chaque action indisponible. Aucune règle n'est réécrite
 * ici : chaque cible passe par `decideTransition` des contrats, la même fonction que le moteur appelle pour décider.
 * Un changement impossible depuis le statut actuel (Draft vers Offline) n'est pas proposé. La règle propre à
 * l'activation avec numéro (au moins une entrée pour entrer en Preview, même depuis Preview) est `decideActivation` des
 * contrats, lue par l'étape Activer de l'assistant ; ces actions ne vont jamais de Preview vers Preview,
 * `decideTransition` suffit ici.
 */
export function availableActions(bot: BotFacts): BotAction[] {
  const number = bot.whatsapp_number;
  const facts = {
    from: bot.status,
    number: number && { present: number.provider_state === 'present', is_test: number.is_test, account_state: number.account.state },
    allowlistCount: bot.allowlist.length,
  };
  return TARGETS.filter((target) => target !== bot.status).flatMap((target): BotAction[] => {
    const decision = decideTransition(target, facts);
    const key = keyFor(bot.status, target);
    if (decision.ok) return [{ target, key, enabled: true, reason: null }];
    if (decision.reason === 'invalid_transition') return [];
    return [{ target, key, enabled: false, reason: decision.reason }];
  });
}
