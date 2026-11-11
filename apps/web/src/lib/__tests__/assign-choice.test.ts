import { describe, expect, test } from 'vitest';
import { BOT_STATUSES, decideAssign, type WhatsAppAccountStateView, type WhatsAppNumberView } from '@wabagent/contracts';
import { assignRefusal } from '../assign-choice';

const ACCOUNT_STATES: readonly WhatsAppAccountStateView[] = ['connected', 'error', 'disconnected'];

function numberOf(over: Partial<WhatsAppNumberView> = {}): WhatsAppNumberView {
  return {
    id: 7,
    phone_e164: '+33612457890',
    display_name: 'Boutique Marais',
    meta_status: 'CONNECTED',
    quality: 'GREEN',
    is_test: false,
    provider_state: 'present',
    removed_at: null,
    delivery_failures: 0,
    last_delivery_error_code: null,
    bot: null,
    ...over,
  };
}

const OTHER_HOLDER = { bot_id: 'other', name: 'Autre agent IA', status: 'active', status_reason: null, not_responding: null };

// entête 5 : la décision d'écran est celle des contrats, pas une règle recopiée
describe('assignRefusal égale decideAssign sur la matrice des faits (entête 5)', () => {
  for (const status of BOT_STATUSES) {
    for (const accountState of ACCOUNT_STATES) {
      for (const provider_state of ['present', 'removed'] as const) {
        for (const holder of [null, OTHER_HOLDER]) {
          for (const is_test of [false, true]) {
            test(`${status}, compte ${accountState}, numéro ${provider_state}, ${holder ? 'tenu par un autre agent IA' : 'libre'}${is_test ? ', de test' : ''}`, () => {
              const bot = { bot_id: 'target', status };
              const number = numberOf({ provider_state, bot: holder, is_test });
              const decision = decideAssign({
                bot,
                number: { id: number.id, present: provider_state === 'present', is_test, bot_id: holder?.bot_id ?? null, account_state: accountState },
                currentNumberId: null,
                allowlistCount: 0,
                expectedHolder: { kind: 'expected', bot_id: holder?.bot_id ?? null },
                checkServingStatus: true,
              });
              expect(assignRefusal(bot, number, accountState)).toBe(decision.ok ? null : decision.reason);
            });
          }
        }
      }
    }
  }

  test('numéro déjà tenu par l\'agent IA lui-même : jamais refusé, comme decideAssign', () => {
    const number = numberOf({ bot: { ...OTHER_HOLDER, bot_id: 'target' } });
    for (const accountState of ACCOUNT_STATES) expect(assignRefusal({ bot_id: 'target', status: 'active' }, number, accountState)).toBeNull();
  });
});

// recette 3.7, Ruling P17 : Draft et Offline se branchent sur un compte en erreur ou retiré, Preview et Online non
describe('compte en erreur ou retiré (recette 3.7)', () => {
  for (const accountState of ['error', 'disconnected'] as const) {
    test(`compte ${accountState} : Draft et Offline acceptés, Preview et Online refusés account_not_connected`, () => {
      const number = numberOf();
      expect(assignRefusal({ bot_id: 'b', status: 'draft' }, number, accountState)).toBeNull();
      expect(assignRefusal({ bot_id: 'b', status: 'paused' }, number, accountState)).toBeNull();
      expect(assignRefusal({ bot_id: 'b', status: 'limited' }, number, accountState)).toBe('account_not_connected');
      expect(assignRefusal({ bot_id: 'b', status: 'active' }, number, accountState)).toBe('account_not_connected');
    });
  }

  test('compte connecté : tous les statuts acceptés ; numéro retiré : toujours number_removed', () => {
    for (const status of BOT_STATUSES) {
      expect(assignRefusal({ bot_id: 'b', status }, numberOf(), 'connected')).toBeNull();
      expect(assignRefusal({ bot_id: 'b', status }, numberOf({ provider_state: 'removed' }), 'connected')).toBe('number_removed');
    }
  });

  test('statut inconnu : traité comme Draft (toBotStatus), accepté sur un compte en erreur', () => {
    expect(assignRefusal({ bot_id: 'b', status: 'archived' }, numberOf(), 'error')).toBeNull();
  });
});
