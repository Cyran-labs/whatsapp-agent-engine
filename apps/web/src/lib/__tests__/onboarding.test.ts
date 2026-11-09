import { test, expect } from 'vitest';
import { deriveChecklist, isNumberConnected, type BotSummary } from '../onboarding';

function bot(over: Partial<BotSummary> = {}): BotSummary {
  return { bot_id: 'b', name: 'B', status: 'draft', default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'x' }, whatsapp_number: null, ...over };
}

test('checklist vide', () => {
  expect(deriveChecklist([])).toEqual({ created: false, personalized: false, connected: false, active: false });
});

test('checklist : agent draft personnalise', () => {
  expect(deriveChecklist([bot()])).toMatchObject({ created: true, personalized: true, active: false });
});

test('checklist : agent actif', () => {
  expect(deriveChecklist([bot({ status: 'active' })])).toMatchObject({ created: true, active: true });
});

test('checklist : agent sans prompt pour la langue par defaut', () => {
  expect(deriveChecklist([bot({ system_prompt: {} })])).toMatchObject({ created: true, personalized: false });
});

type NumberFacts = NonNullable<BotSummary['whatsapp_number']>;
const number = (over: Partial<Omit<NumberFacts, 'account'>> & { state?: NumberFacts['account']['state'] } = {}): NumberFacts => ({
  provider_state: 'present',
  account: { state: over.state ?? 'connected' },
  ...(over.provider_state ? { provider_state: over.provider_state } : {}),
});

test('connected : aucun numéro branché', () => {
  expect(isNumberConnected(null)).toBe(false);
  expect(deriveChecklist([bot()]).connected).toBe(false);
});

test('connected : numéro présent sur un compte connecté', () => {
  expect(isNumberConnected(number())).toBe(true);
  expect(deriveChecklist([bot({ whatsapp_number: number() })]).connected).toBe(true);
});

test('connected : numéro retiré chez le fournisseur sur un compte connecté', () => {
  expect(isNumberConnected(number({ provider_state: 'removed' }))).toBe(false);
  expect(deriveChecklist([bot({ whatsapp_number: number({ provider_state: 'removed' }) })]).connected).toBe(false);
});

test('connected : numéro présent sur un compte en erreur ou déconnecté', () => {
  expect(isNumberConnected(number({ state: 'error' }))).toBe(false);
  expect(isNumberConnected(number({ state: 'disconnected' }))).toBe(false);
});

test('connected : un seul agent IA suffit', () => {
  expect(deriveChecklist([bot(), bot({ bot_id: 'c', whatsapp_number: number() })]).connected).toBe(true);
});
