// Machine d'états des agents IA (spec §8.1) et décisions de branchement d'un numéro (spec §7.5, choix 8).
// Fonctions pures : les pilotes lisent les faits dans leur transaction, appellent ces fonctions, appliquent le résultat.

import type { WhatsAppAccountStateView } from './whatsapp.js';

/** Statuts d'un agent IA. Source unique : le moteur, le web et le schéma `SetBotStatusInput` en dérivent. */
export const BOT_STATUSES = ['draft', 'limited', 'active', 'paused'] as const;
export type BotStatus = (typeof BOT_STATUSES)[number];
export type WhatsAppAccountState = WhatsAppAccountStateView;

export interface TransitionFacts {
  from: BotStatus;
  /** Numéro branché sur l'agent IA (présent ou retiré), null si aucun. */
  number: { present: boolean; is_test: boolean; account_state: WhatsAppAccountState } | null;
  allowlistCount: number;
}

export type TransitionRefusal =
  | 'no_number'
  | 'number_removed'
  | 'account_not_connected'
  | 'empty_allowlist'
  | 'not_from_draft'
  | 'invalid_transition';

export type TransitionDecision = { ok: true } | { ok: false; reason: TransitionRefusal };

export const TRANSITION_MESSAGES: Record<TransitionRefusal, string> = {
  no_number: "Branchez un numéro WhatsApp avant d'activer l'agent IA.",
  number_removed: 'Le numéro de cet agent IA a été retiré chez le fournisseur.',
  account_not_connected: "Le compte WhatsApp de ce numéro n'est pas connecté.",
  empty_allowlist: "Ajoutez au moins un numéro à la liste d'accès limité.",
  not_from_draft: "Passez d'abord en accès limité : seul un numéro de test peut être ouvert à tous directement.",
  invalid_transition: 'Changement de statut impossible depuis le statut actuel.',
};

/**
 * Refus d'un branchement ou d'une activation sur un numéro retiré chez le fournisseur : le numéro choisi est en cause,
 * pas le numéro actuel de l'agent IA (texte de `TRANSITION_MESSAGES.number_removed`), revue finale 2b-3 I-3.
 */
export const ASSIGN_NUMBER_REMOVED_MESSAGE = 'Ce numéro a été retiré chez le fournisseur.';

/** Statut lu en base. Une valeur inconnue compte comme `draft` (le statut qui ne sert personne). */
export function toBotStatus(raw: string): BotStatus {
  return (BOT_STATUSES as readonly string[]).includes(raw) ? (raw as BotStatus) : 'draft';
}

/** Un agent IA `limited` ou `active` répond à des contacts. */
export function isServingStatus(status: string): boolean {
  return status === 'limited' || status === 'active';
}

/**
 * Décide un changement de statut. Ordre des contrôles : numéro absent, retiré, compte, liste, origine.
 * La liste non vide n'est exigée que pour entrer en `limited` (`from` différent de `limited`).
 * `draft` est toujours permis ; `paused` seulement depuis `limited` ou `active`.
 */
export function decideTransition(to: BotStatus, f: TransitionFacts): TransitionDecision {
  if (to === 'draft') return { ok: true };
  if (to === 'paused') {
    return isServingStatus(f.from) ? { ok: true } : { ok: false, reason: 'invalid_transition' };
  }
  if (to !== 'limited' && to !== 'active') return { ok: false, reason: 'invalid_transition' };

  if (f.number === null) return { ok: false, reason: 'no_number' };
  if (!f.number.present) return { ok: false, reason: 'number_removed' };
  if (f.number.account_state !== 'connected') return { ok: false, reason: 'account_not_connected' };
  if (to === 'limited') {
    // Entrer en accès limité exige une entrée ; un agent IA déjà en accès limité peut avoir vidé sa liste (il ne répond
    // alors à personne) et le reste (changement de numéro) : amendement du 9 nov. 2026, spec §8.1.
    if (f.from === 'limited') return { ok: true };
    return f.allowlistCount > 0 ? { ok: true } : { ok: false, reason: 'empty_allowlist' };
  }
  if (f.from === 'draft' && !f.number.is_test) return { ok: false, reason: 'not_from_draft' };
  return { ok: true };
}

/**
 * Détenteur du numéro tel que l'écran l'a lu (`bot_id: null` : libre). Différent du détenteur lu dans la transaction :
 * refus `holder_changed` (revue 2b-3 M-1). `unchecked` : aucun contrôle ; aucun appelant de production ne l'utilise
 * (l'API d'administration impose toujours `expected`), il sert aux tests et à l'amorçage de données.
 */
export type ExpectedHolder = { kind: 'expected'; bot_id: string | null } | { kind: 'unchecked' };

/** Faits lus dans la transaction d'un branchement. */
export interface AssignFacts {
  bot: { bot_id: string; status: BotStatus } | null;
  /** Numéro demandé, lu dans l'organisation de l'agent IA (absent s'il appartient à une autre). */
  number: { id: number; present: boolean; is_test: boolean; bot_id: string | null; account_state: WhatsAppAccountState } | null;
  /** Numéro actuellement branché sur l'agent IA cible (présent ou retiré). */
  currentNumberId: number | null;
  allowlistCount: number;
  /** Détenteur attendu du numéro, ou absence de contrôle (revue 2b-3 M-1). Toujours explicite. */
  expectedHolder: ExpectedHolder;
  /** Faux dans `activateWithNumber` : la transition finale y est contrôlée après le branchement. */
  checkServingStatus: boolean;
}

/** Refus propre au branchement : le numéro a changé de détenteur depuis la lecture de l'écran (revue 2b-3 M-1). */
export const HOLDER_CHANGED_MESSAGE = 'Ce numéro a changé depuis votre lecture : vérifiez la liste.';
/** Chemin du détail d'erreur 409 qui désigne ce refus (les écrans relisent alors leur liste). */
export const HOLDER_CHANGED_PATH = 'expected_bot_id';

export type AssignDecision =
  | { ok: false; reason: 'not_found' | 'holder_changed' | TransitionRefusal }
  | { ok: true; changed: false; previous_bot_id: null; previous_number_id: number }
  | { ok: true; changed: true; previous_bot_id: string | null; previous_number_id: number | null };

/**
 * Décide un branchement (spec §7.5). Un numéro retiré ne se branche jamais. Un agent IA `limited` ou `active`
 * ne prend un numéro que si la machine d'états accepte son statut actuel sur ce numéro (choix 8).
 * `previous_bot_id` : l'agent IA qui perd le numéro ; `previous_number_id` : le numéro que l'agent IA cible quitte.
 */
export function decideAssign(f: AssignFacts): AssignDecision {
  if (f.bot === null || f.number === null) return { ok: false, reason: 'not_found' };
  if (!f.number.present) return { ok: false, reason: 'number_removed' };
  if (f.number.bot_id === f.bot.bot_id) {
    return { ok: true, changed: false, previous_bot_id: null, previous_number_id: f.number.id };
  }
  if (f.expectedHolder.kind === 'expected' && f.expectedHolder.bot_id !== f.number.bot_id) return { ok: false, reason: 'holder_changed' };
  if (f.checkServingStatus && isServingStatus(f.bot.status)) {
    const decision = decideTransition(f.bot.status, {
      from: f.bot.status,
      number: { present: true, is_test: f.number.is_test, account_state: f.number.account_state },
      allowlistCount: f.allowlistCount,
    });
    if (!decision.ok) return decision;
  }
  return { ok: true, changed: true, previous_bot_id: f.number.bot_id, previous_number_id: f.currentNumberId };
}
