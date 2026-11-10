import { describe, expect, test } from 'vitest';
import { decideTransition, TRANSITION_MESSAGES, type BotNumberSummary, type BotStatus } from '@wabagent/contracts';
import { availableActions, type BotFacts } from '../bot-transitions';
import fr from '../../../messages/fr.json';
import en from '../../../messages/en.json';

function number(over: { present?: boolean; is_test?: boolean; account_state?: BotNumberSummary['account']['state'] } = {}): BotNumberSummary {
  return {
    id: 4,
    phone_e164: '+33612000047',
    display_name: 'Boutique',
    is_test: over.is_test ?? false,
    provider_state: over.present === false ? 'removed' : 'present',
    quality: null,
    delivery_failures: 0,
    last_delivery_error_code: null,
    account: { id: 1, name: 'Compte', mode: 'meta_manual', state: over.account_state ?? 'connected', error_reason: null, error_detail: null, error_cause: null },
  };
}

function bot(status: BotStatus, over: Partial<BotFacts> = {}): BotFacts {
  return { status, whatsapp_number: number(), allowlist: ['+33611111111'], ...over };
}

const summary = (b: BotFacts) => availableActions(b).map((a) => `${a.key}:${a.target}:${a.enabled ? 'ok' : a.reason}`);

describe('availableActions (spec 2b §8.1, décision C-1 A)', () => {
  test('brouillon : activer en accès limité, ouvrir à tous refusé hors numéro de test', () => {
    expect(summary(bot('draft'))).toEqual(['limit:limited:ok', 'open:active:not_from_draft']);
  });

  test('brouillon sur un numéro de test : ouvrir à tous permis', () => {
    expect(summary(bot('draft', { whatsapp_number: number({ is_test: true }) }))).toEqual(['limit:limited:ok', 'open:active:ok']);
  });

  test('accès limité : ouvrir à tous, désactiver', () => {
    expect(summary(bot('limited'))).toEqual(['open:active:ok', 'deactivate:paused:ok']);
  });

  test('ouvert à tous : revenir en accès limité, désactiver', () => {
    expect(summary(bot('active'))).toEqual(['backToLimited:limited:ok', 'deactivate:paused:ok']);
  });

  test('désactivé : réactiver en accès limité, réactiver pour tous', () => {
    expect(summary(bot('paused'))).toEqual(['resume:limited:ok', 'reopen:active:ok']);
  });

  // recette Q-1 : une seule façon d'arrêter un agent IA, aucune action n'envoie `draft` depuis l'écran
  test('recette Q-1 : aucune action ne vise le brouillon, quel que soit le statut', () => {
    const statuses: BotStatus[] = ['draft', 'limited', 'active', 'paused'];
    for (const status of statuses) {
      for (const action of availableActions(bot(status))) {
        expect(action.target).not.toBe('draft');
        expect(action.key).not.toMatch(/draft/i);
      }
    }
  });

  // recette Q-10 : la liste vidée d'un agent IA déjà en accès limité n'est pas jugée ici (le moteur décide)
  test('recette Q-10 : un agent IA en accès limité à liste vide garde ses actions (ouvrir à tous, désactiver)', () => {
    expect(summary(bot('limited', { allowlist: [] }))).toEqual(['open:active:ok', 'deactivate:paused:ok']);
  });

  test('liste vide : entrer en accès limité est indisponible (empty_allowlist), ouvrir à tous reste jugé par la machine', () => {
    expect(summary(bot('draft', { allowlist: [] }))).toEqual(['limit:limited:empty_allowlist', 'open:active:not_from_draft']);
    expect(summary(bot('paused', { allowlist: [] }))).toEqual(['resume:limited:empty_allowlist', 'reopen:active:ok']);
  });

  test('aucun numéro : limited et active indisponibles (no_number), la désactivation jamais bloquée', () => {
    expect(summary(bot('draft', { whatsapp_number: null }))).toEqual(['limit:limited:no_number', 'open:active:no_number']);
    expect(summary(bot('paused', { whatsapp_number: null }))).toEqual(['resume:limited:no_number', 'reopen:active:no_number']);
  });

  test('numéro retiré chez le fournisseur : limited et active indisponibles (number_removed)', () => {
    expect(summary(bot('paused', { whatsapp_number: number({ present: false }) }))).toEqual([
      'resume:limited:number_removed', 'reopen:active:number_removed',
    ]);
  });

  test('compte en erreur ou déconnecté : limited et active indisponibles (account_not_connected), désactivation permise', () => {
    for (const account_state of ['error', 'disconnected'] as const) {
      expect(summary(bot('active', { whatsapp_number: number({ account_state }) }))).toEqual([
        'backToLimited:limited:account_not_connected', 'deactivate:paused:ok',
      ]);
    }
  });

  test('chaque action reprend la décision des contrats, sans règle réécrite', () => {
    const statuses: BotStatus[] = ['draft', 'limited', 'active', 'paused'];
    const numbers = [null, number(), number({ is_test: true }), number({ present: false }), number({ account_state: 'error' })];
    for (const status of statuses) {
      for (const whatsapp_number of numbers) {
        for (const allowlist of [[], ['+33611111111']]) {
          const facts = bot(status, { whatsapp_number, allowlist });
          for (const action of availableActions(facts)) {
            const decision = decideTransition(action.target, {
              from: status,
              number: whatsapp_number && { present: whatsapp_number.provider_state === 'present', is_test: whatsapp_number.is_test, account_state: whatsapp_number.account.state },
              allowlistCount: allowlist.length,
            });
            expect(action.enabled).toBe(decision.ok);
            expect(action.reason).toBe(decision.ok ? null : decision.reason);
          }
        }
      }
    }
  });
});

describe('textes des raisons', () => {
  const reasons = Object.keys(TRANSITION_MESSAGES).filter((r) => r !== 'invalid_transition');

  test('le français reprend mot pour mot les phrases du moteur', () => {
    for (const reason of reasons) {
      expect((fr.agentStatus.reasons as Record<string, string>)[reason]).toBe(TRANSITION_MESSAGES[reason as keyof typeof TRANSITION_MESSAGES]);
    }
  });

  test('l\'anglais a une phrase pour chaque raison', () => {
    for (const reason of reasons) expect((en.agentStatus.reasons as Record<string, string>)[reason]).toBeTruthy();
  });
});
