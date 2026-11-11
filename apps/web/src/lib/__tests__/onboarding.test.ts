import { describe, test, expect } from 'vitest';
import { connectTarget, deriveChecklist, isNumberConnected, type NumberConnection } from '../onboarding';

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

// prototype 8 : « Brancher un numéro » de la Mise en route mène au premier agent IA Draft sans numéro
describe('connectTarget', () => {
  const r = (bot_id: string, status: string, number: string | null) => ({ bot_id, status, number });
  test('premier agent IA Draft sans numéro, dans l ordre de la liste, identifiant encodé', () => {
    expect(connectTarget([r('a', 'active', '+33612000047'), r('b/c', 'draft', null), r('d', 'draft', null)])).toBe('/agents/b%2Fc');
  });
  test('Draft avec numéro, Offline ou Preview sans numéro : ignorés', () => {
    expect(connectTarget([r('a', 'draft', '+33612000047'), r('b', 'paused', null), r('c', 'limited', null), r('d', 'draft', null)])).toBe('/agents/d');
  });
  test('aucun agent IA Draft sans numéro : Connexions, comme avant', () => {
    expect(connectTarget([r('a', 'draft', '+33612000047'), r('b', 'paused', null)])).toBe('/organisation/connexions');
    expect(connectTarget([])).toBe('/organisation/connexions');
  });
});
