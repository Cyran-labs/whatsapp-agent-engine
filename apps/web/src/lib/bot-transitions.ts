import { decideTransition, type BotNumberSummary, type BotStatus, type TransitionRefusal } from '@wabagent/contracts';

/** Ce que la machine d'états lit d'un agent IA : son statut, son numéro branché et sa liste d'accès limité. */
export interface BotFacts {
  status: BotStatus;
  whatsapp_number: BotNumberSummary | null;
  allowlist: string[];
}

/** Raison d'une action indisponible : un refus de la machine d'états, hors changement impossible (non proposé). */
export type ActionReason = Exclude<TransitionRefusal, 'invalid_transition'>;

export interface BotAction {
  target: BotStatus;
  /** Libellé : `limit` se lit « Activer » depuis le brouillon et « Revenir » depuis actif, `resume` depuis la pause. */
  key: 'limit' | 'open' | 'pause' | 'resume' | 'draft';
  enabled: boolean;
  reason: ActionReason | null;
}

const TARGETS: readonly BotStatus[] = ['limited', 'active', 'paused', 'draft'];

function keyFor(from: BotStatus, target: BotStatus): BotAction['key'] {
  if (target === 'limited') return from === 'paused' ? 'resume' : 'limit';
  if (target === 'active') return 'open';
  return target === 'paused' ? 'pause' : 'draft';
}

/**
 * Actions de statut proposées à l'admin, avec la raison de chaque action indisponible. Aucune règle n'est réécrite
 * ici : chaque cible passe par `decideTransition` des contrats, la même fonction que le moteur appelle pour décider.
 * Un changement impossible depuis le statut actuel (brouillon vers pause) n'est pas proposé.
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
