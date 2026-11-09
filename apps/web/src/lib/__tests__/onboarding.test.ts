import { test, expect } from 'vitest';
import { deriveChecklist, isNumberConnected, type NumberConnection } from '../onboarding';

type Row = Parameters<typeof deriveChecklist>[0][number];
const row = (over: Partial<Row> = {}): Row => ({ status: 'draft', personalized: true, connected: false, ...over });

test('checklist vide', () => {
  expect(deriveChecklist([])).toEqual({ created: false, personalized: false, connected: false, active: false });
});

test('checklist : agent IA en brouillon personnalisé', () => {
  expect(deriveChecklist([row()])).toEqual({ created: true, personalized: true, connected: false, active: false });
});

test('checklist : agent IA non personnalisé', () => {
  expect(deriveChecklist([row({ personalized: false })])).toMatchObject({ created: true, personalized: false });
});

test('checklist : agent IA actif ou en accès limité est en service, brouillon et pause non', () => {
  expect(deriveChecklist([row({ status: 'active' })]).active).toBe(true);
  expect(deriveChecklist([row({ status: 'limited' })]).active).toBe(true);
  expect(deriveChecklist([row({ status: 'draft' })]).active).toBe(false);
  expect(deriveChecklist([row({ status: 'paused' })]).active).toBe(false);
});

test('checklist : un seul agent IA connecté suffit', () => {
  expect(deriveChecklist([row(), row({ connected: true })]).connected).toBe(true);
  expect(deriveChecklist([row(), row()]).connected).toBe(false);
});

const number = (provider_state: NumberConnection['provider_state'], state: NumberConnection['account']['state']): NumberConnection => ({
  provider_state,
  account: { state },
});

test('connected : aucun numéro branché', () => {
  expect(isNumberConnected(null)).toBe(false);
});

test('connected : numéro présent sur un compte connecté', () => {
  expect(isNumberConnected(number('present', 'connected'))).toBe(true);
});

test('connected : numéro retiré chez le fournisseur sur un compte connecté', () => {
  expect(isNumberConnected(number('removed', 'connected'))).toBe(false);
});

test('connected : numéro présent sur un compte en erreur ou déconnecté', () => {
  expect(isNumberConnected(number('present', 'error'))).toBe(false);
  expect(isNumberConnected(number('present', 'disconnected'))).toBe(false);
});
