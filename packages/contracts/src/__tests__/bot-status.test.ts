import { describe, expect, it } from 'vitest';
import { ASSIGN_NUMBER_REMOVED_MESSAGE, BOT_PAUSE_REASONS, decideActivation, decideAssign, decideTransition, isServingStatus, toBotPauseReason, toBotStatus, TRANSITION_MESSAGES, type AssignFacts, type BotStatus, type TransitionFacts } from '../index.js';

type NumberFacts = NonNullable<TransitionFacts['number']>;

function n(over: Partial<NumberFacts> = {}): NumberFacts {
  return { present: true, is_test: false, account_state: 'connected', ...over };
}

describe('decideTransition (spec §8.1)', () => {
  // audit 3.5
  it.each([
    ['limited', { from: 'draft', number: null, allowlistCount: 1 }, 'no_number'],
    ['limited', { from: 'draft', number: n({ present: false }), allowlistCount: 1 }, 'number_removed'],
    ['limited', { from: 'draft', number: n({ account_state: 'error' }), allowlistCount: 1 }, 'account_not_connected'],
    ['limited', { from: 'draft', number: n(), allowlistCount: 0 }, 'empty_allowlist'],
    ['active', { from: 'draft', number: n(), allowlistCount: 1 }, 'not_from_draft'],
    ['paused', { from: 'draft', number: n(), allowlistCount: 0 }, 'invalid_transition'],
  ])('refuse %s (%j) : %s', (to, facts, reason) => {
    expect(decideTransition(to as BotStatus, facts as TransitionFacts)).toEqual({ ok: false, reason });
  });

  it('active depuis draft sur un numéro de test', () => {
    expect(decideTransition('active', { from: 'draft', number: n({ is_test: true }), allowlistCount: 0 })).toEqual({ ok: true });
  });

  it('draft toujours permis', () => {
    for (const from of ['draft', 'limited', 'active', 'paused'] as const) {
      expect(decideTransition('draft', { from, number: null, allowlistCount: 0 })).toEqual({ ok: true });
      expect(decideTransition('draft', { from, number: n({ present: false, account_state: 'disconnected' }), allowlistCount: 0 })).toEqual({ ok: true });
    }
  });

  it('paused depuis limited ou active, sans condition sur le numéro', () => {
    expect(decideTransition('paused', { from: 'limited', number: null, allowlistCount: 0 })).toEqual({ ok: true });
    expect(decideTransition('paused', { from: 'active', number: n({ account_state: 'error' }), allowlistCount: 0 })).toEqual({ ok: true });
    expect(decideTransition('paused', { from: 'paused', number: n(), allowlistCount: 1 })).toEqual({ ok: false, reason: 'invalid_transition' });
  });

  it('active depuis limited, paused ou active ; la liste ne compte pas', () => {
    for (const from of ['limited', 'paused', 'active'] as const) {
      expect(decideTransition('active', { from, number: n(), allowlistCount: 0 })).toEqual({ ok: true });
    }
  });

  it('limited depuis tout statut si les conditions sont remplies', () => {
    for (const from of ['draft', 'limited', 'active', 'paused'] as const) {
      expect(decideTransition('limited', { from, number: n(), allowlistCount: 1 })).toEqual({ ok: true });
    }
  });

  it('active : numéro absent, retiré puis compte, avant l\'origine', () => {
    expect(decideTransition('active', { from: 'draft', number: null, allowlistCount: 0 })).toEqual({ ok: false, reason: 'no_number' });
    expect(decideTransition('active', { from: 'draft', number: n({ present: false, account_state: 'error' }), allowlistCount: 0 }))
      .toEqual({ ok: false, reason: 'number_removed' });
    expect(decideTransition('active', { from: 'limited', number: n({ account_state: 'disconnected' }), allowlistCount: 1 }))
      .toEqual({ ok: false, reason: 'account_not_connected' });
    expect(decideTransition('active', { from: 'draft', number: n({ is_test: true, account_state: 'error' }), allowlistCount: 0 }))
      .toEqual({ ok: false, reason: 'account_not_connected' });
  });

  // recette Q-10
  it("limited : la liste vide n'est refusée qu'à l'entrée, pas à un agent IA déjà en accès limité", () => {
    expect(decideTransition('limited', { from: 'limited', number: n(), allowlistCount: 0 })).toEqual({ ok: true });
    expect(decideTransition('limited', { from: 'draft', number: n(), allowlistCount: 0 })).toEqual({ ok: false, reason: 'empty_allowlist' });
    expect(decideTransition('limited', { from: 'paused', number: n(), allowlistCount: 0 })).toEqual({ ok: false, reason: 'empty_allowlist' });
    expect(decideTransition('limited', { from: 'active', number: n(), allowlistCount: 0 })).toEqual({ ok: false, reason: 'empty_allowlist' });
    // Le reste des contrôles s'applique toujours à un agent IA déjà en accès limité.
    expect(decideTransition('limited', { from: 'limited', number: null, allowlistCount: 0 })).toEqual({ ok: false, reason: 'no_number' });
    expect(decideTransition('limited', { from: 'limited', number: n({ account_state: 'error' }), allowlistCount: 0 }))
      .toEqual({ ok: false, reason: 'account_not_connected' });
  });

  it('limited : compte avant liste', () => {
    expect(decideTransition('limited', { from: 'draft', number: n({ account_state: 'error' }), allowlistCount: 0 }))
      .toEqual({ ok: false, reason: 'account_not_connected' });
  });

  it('messages des refus', () => {
    expect(TRANSITION_MESSAGES).toEqual({
      no_number: "Branchez un numéro WhatsApp avant d'activer l'agent IA.",
      number_removed: 'Le numéro de cet agent IA a été retiré chez le fournisseur.',
      account_not_connected: "Le compte WhatsApp de ce numéro n'est pas connecté.",
      empty_allowlist: "Ajoutez au moins un numéro à la liste d'accès limité.",
      not_from_draft: "Passez d'abord en accès limité : seul un numéro de test peut être ouvert à tous directement.",
      invalid_transition: 'Changement de statut impossible depuis le statut actuel.',
    });
  });
});

// revue finale M-7, recette Q-10 : la règle propre à l'activation vit dans les contrats, appelée par les deux pilotes et le web
describe('decideActivation (activation avec numéro, recette Q-10)', () => {
  it.each(['draft', 'limited', 'paused'] as const)("accès limité avec une liste vide depuis %s : empty_allowlist (même depuis limited)", (from) => {
    expect(decideActivation('limited', { from, number: n(), allowlistCount: 0 })).toEqual({ ok: false, reason: 'empty_allowlist' });
  });

  it("témoin : decideTransition accepte limited vers limited à liste vide (changement de numéro), decideActivation non", () => {
    expect(decideTransition('limited', { from: 'limited', number: n(), allowlistCount: 0 })).toEqual({ ok: true });
    expect(decideActivation('limited', { from: 'limited', number: n(), allowlistCount: 0 })).toEqual({ ok: false, reason: 'empty_allowlist' });
  });

  it('reprend les refus de decideTransition, dans le même ordre (numéro, retrait, compte avant la liste)', () => {
    expect(decideActivation('limited', { from: 'draft', number: null, allowlistCount: 0 })).toEqual({ ok: false, reason: 'no_number' });
    expect(decideActivation('limited', { from: 'draft', number: n({ present: false }), allowlistCount: 0 })).toEqual({ ok: false, reason: 'number_removed' });
    expect(decideActivation('limited', { from: 'limited', number: n({ account_state: 'error' }), allowlistCount: 0 })).toEqual({ ok: false, reason: 'account_not_connected' });
    expect(decideActivation('active', { from: 'draft', number: n(), allowlistCount: 3 })).toEqual({ ok: false, reason: 'not_from_draft' });
  });

  it('accepte une liste non vide en accès limité, et ouvert à tous sur un numéro de test sans liste', () => {
    expect(decideActivation('limited', { from: 'draft', number: n(), allowlistCount: 1 })).toEqual({ ok: true });
    expect(decideActivation('limited', { from: 'limited', number: n(), allowlistCount: 2 })).toEqual({ ok: true });
    expect(decideActivation('active', { from: 'draft', number: n({ is_test: true }), allowlistCount: 0 })).toEqual({ ok: true });
    expect(decideActivation('active', { from: 'limited', number: n(), allowlistCount: 0 })).toEqual({ ok: true });
  });
});

describe('decideAssign (spec §7.5, choix 8)', () => {
  function facts(over: Partial<AssignFacts> = {}): AssignFacts {
    return {
      bot: { bot_id: 'A2', status: 'draft' },
      number: { id: 7, present: true, is_test: false, bot_id: 'A1', account_state: 'connected' },
      currentNumberId: 3, allowlistCount: 0, checkServingStatus: true, expectedHolder: { kind: 'unchecked' }, ...over,
    };
  }

  // audit 1.1
  it('agent IA ou numéro introuvable : not_found', () => {
    expect(decideAssign(facts({ bot: null }))).toEqual({ ok: false, reason: 'not_found' });
    expect(decideAssign(facts({ number: null }))).toEqual({ ok: false, reason: 'not_found' });
  });

  it('un numéro retiré ne se branche jamais, même sur un brouillon', () => {
    expect(decideAssign(facts({ number: { id: 7, present: false, is_test: false, bot_id: null, account_state: 'connected' } })))
      .toEqual({ ok: false, reason: 'number_removed' });
  });

  it('même numéro : rien ne change', () => {
    expect(decideAssign(facts({ number: { id: 7, present: true, is_test: false, bot_id: 'A2', account_state: 'connected' }, currentNumberId: 7 })))
      .toEqual({ ok: true, changed: false, previous_bot_id: null, previous_number_id: 7 });
  });

  // revue 2b-3 M-1
  it('détenteur attendu différent du détenteur réel : holder_changed ; identique ou non fourni : décision normale', () => {
    expect(decideAssign(facts({ expectedHolder: { kind: 'expected', bot_id: null } }))).toEqual({ ok: false, reason: 'holder_changed' });
    expect(decideAssign(facts({ expectedHolder: { kind: 'expected', bot_id: 'A3' } }))).toEqual({ ok: false, reason: 'holder_changed' });
    const free = { id: 7, present: true, is_test: false, bot_id: null, account_state: 'connected' as const };
    expect(decideAssign(facts({ number: free, expectedHolder: { kind: 'expected', bot_id: 'A1' } }))).toEqual({ ok: false, reason: 'holder_changed' });
    expect(decideAssign(facts({ expectedHolder: { kind: 'expected', bot_id: 'A1' } }))).toMatchObject({ ok: true, changed: true, previous_bot_id: 'A1' });
    expect(decideAssign(facts({ number: free, expectedHolder: { kind: 'expected', bot_id: null } }))).toMatchObject({ ok: true, changed: true });
    expect(decideAssign(facts())).toMatchObject({ ok: true, changed: true });
    // Déjà tenu par l'agent IA cible : rien à écrire, pas de refus.
    expect(decideAssign(facts({ number: { ...free, bot_id: 'A2' }, currentNumberId: 7, expectedHolder: { kind: 'expected', bot_id: null } })))
      .toEqual({ ok: true, changed: false, previous_bot_id: null, previous_number_id: 7 });
  });

  it("brouillon : branché quel que soit l'état du compte, avec l'ancien détenteur et l'ancien numéro", () => {
    expect(decideAssign(facts({ number: { id: 7, present: true, is_test: false, bot_id: 'A1', account_state: 'error' } })))
      .toEqual({ ok: true, changed: true, previous_bot_id: 'A1', previous_number_id: 3 });
  });

  it("agent IA actif ou limité : la machine d'états décide sur le nouveau numéro", () => {
    const err = { id: 7, present: true, is_test: false, bot_id: null, account_state: 'error' as const };
    expect(decideAssign(facts({ bot: { bot_id: 'A2', status: 'active' }, number: err }))).toEqual({ ok: false, reason: 'account_not_connected' });
    // recette Q-10 : un agent IA qui reste en accès limité, liste vide comprise, change de numéro sans refus.
    expect(decideAssign(facts({ bot: { bot_id: 'A2', status: 'limited' }, allowlistCount: 0 }))).toMatchObject({ ok: true, changed: true });
    expect(decideAssign(facts({ bot: { bot_id: 'A2', status: 'limited' }, allowlistCount: 2 }))).toMatchObject({ ok: true, changed: true });
    expect(decideAssign(facts({ bot: { bot_id: 'A2', status: 'paused' }, number: err }))).toMatchObject({ ok: true, changed: true });
    // activateWithNumber contrôle la transition finale à la place.
    expect(decideAssign(facts({ bot: { bot_id: 'A2', status: 'active' }, number: err, checkServingStatus: false }))).toMatchObject({ ok: true });
  });
});

// revue finale 2b-3 I-3 : le refus de branchement d'un numéro retiré a son texte, distinct de celui des transitions
describe('refus de branchement sur un numéro retiré', () => {
  it('texte propre au branchement, différent du texte de transition', () => {
    expect(ASSIGN_NUMBER_REMOVED_MESSAGE).toBe('Ce numéro a été retiré chez le fournisseur.');
    expect(ASSIGN_NUMBER_REMOVED_MESSAGE).not.toBe(TRANSITION_MESSAGES.number_removed);
  });
});

describe('isServingStatus et toBotStatus', () => {
  it('limited et active servent des contacts, pas draft, paused ni un statut inconnu', () => {
    expect(isServingStatus('limited')).toBe(true);
    expect(isServingStatus('active')).toBe(true);
    expect(isServingStatus('draft')).toBe(false);
    expect(isServingStatus('paused')).toBe(false);
    expect(isServingStatus('autre')).toBe(false);
  });

  it('un statut lu en base inconnu compte comme draft', () => {
    expect(toBotStatus('paused')).toBe('paused');
    expect(toBotStatus('autre')).toBe('draft');
  });
});

// décision François A9
describe('motifs de pause automatique', () => {
  it('deux motifs, lus tels quels ; un motif inconnu ou absent donne null', () => {
    expect(BOT_PAUSE_REASONS).toEqual(['number_removed', 'number_unassigned']);
    expect(toBotPauseReason('number_removed')).toBe('number_removed');
    expect(toBotPauseReason('number_unassigned')).toBe('number_unassigned');
    expect(toBotPauseReason('motif_futur')).toBeNull();
    expect(toBotPauseReason(null)).toBeNull();
    expect(toBotPauseReason(undefined)).toBeNull();
  });
});
