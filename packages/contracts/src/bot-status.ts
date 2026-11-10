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

/**
 * Motifs d'une pause automatique (`bots.status_reason`), écrits par le moteur seul ; source unique des deux pilotes,
 * du web et du faux moteur.
 * - `number_removed` : le numéro de l'agent IA a été retiré chez le fournisseur (spec §7.4) ;
 * - `number_unassigned` : l'agent IA a perdu son numéro, débranché ou branché sur un autre agent IA (spec §7.5,
 *   décision de François du 10 nov. 2026, audit des décisions A9).
 * Seul un agent IA `limited` ou `active` est mis en pause ; un agent IA en brouillon ou désactivé garde son statut.
 */
export const BOT_PAUSE_REASONS = ['number_removed', 'number_unassigned'] as const;
export type BotPauseReason = (typeof BOT_PAUSE_REASONS)[number];

/** Motif lu en base ou dans une vue : un motif inconnu (ou absent) donne null, il n'est jamais affiché tel quel. */
export function toBotPauseReason(raw: string | null | undefined): BotPauseReason | null {
  return raw != null && (BOT_PAUSE_REASONS as readonly string[]).includes(raw) ? (raw as BotPauseReason) : null;
}

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
 * Décide l'activation d'un agent IA sur un numéro (`POST /bots/:id/activate` : brancher, enregistrer la liste, changer
 * le statut), faits lus après le branchement et l'écriture de la liste. Mêmes refus que `decideTransition`, dans le
 * même ordre, plus une règle propre à l'activation : entrer en accès limité exige au moins une entrée, même depuis
 * `limited` (recette Q-10). Appelée par les deux pilotes dans leur transaction et par l'étape Activer de l'assistant,
 * qui annonce le refus avant l'envoi ; le refus du moteur reste affiché s'il survient.
 */
export function decideActivation(to: 'limited' | 'active', f: TransitionFacts): TransitionDecision {
  const decision = decideTransition(to, f);
  if (!decision.ok) return decision;
  if (to === 'limited' && f.allowlistCount === 0) return { ok: false, reason: 'empty_allowlist' };
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
 * `previous_bot_id` : l'agent IA qui perd le numéro (le pilote le met en pause, motif `number_unassigned`, s'il était
 * en service) ; `previous_number_id` : le numéro que l'agent IA cible quitte.
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

/**
 * Motifs de la mention « Ne répond pas » (spec navigation §7.1), dans l'ordre des contrôles de `checkRoute`
 * (`src/core/router.ts`) : la première condition vraie donne le motif.
 */
export const NOT_RESPONDING_REASONS = ['no_number', 'number_removed', 'account_not_connected', 'organization_suspended', 'empty_allowlist'] as const;
export type NotRespondingReason = (typeof NOT_RESPONDING_REASONS)[number];

/** Faits d'un agent IA, lus dans son organisation. `account_state` est l'état affiché du compte (signatures rejetées comprises). */
export interface RespondingFacts {
  /** Statut brut lu en base, lu par `toBotStatus`. */
  status: string;
  /** Numéro branché (présent ou retiré) et état affiché de son compte, null si aucun. */
  number: { present: boolean; account_state: WhatsAppAccountState } | null;
  organizationActive: boolean;
  allowlistCount: number;
}

/**
 * Mention « Ne répond pas » : un agent IA Preview (`limited`) ou Online (`active`) dont le moteur refuserait tout
 * message entrant, quel que soit le contact. Null pour un agent IA qui répond à au moins un contact, et pour un agent
 * IA Draft ou Offline (statut inconnu compris), dont la pastille dit déjà qu'il ne répond pas. Une lecture : la machine
 * d'états n'en dépend pas.
 */
export function decideResponding(f: RespondingFacts): NotRespondingReason | null {
  const status = toBotStatus(f.status);
  if (status !== 'limited' && status !== 'active') return null;
  if (f.number === null) return 'no_number';
  if (!f.number.present) return 'number_removed';
  if (f.number.account_state !== 'connected') return 'account_not_connected';
  if (!f.organizationActive) return 'organization_suspended';
  if (status === 'limited' && f.allowlistCount === 0) return 'empty_allowlist';
  return null;
}
