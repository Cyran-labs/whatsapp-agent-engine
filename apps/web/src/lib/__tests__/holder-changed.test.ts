import { expect, test } from 'vitest';
import type { MutationFailure } from '../api-fetch';
import { isHolderChanged } from '../holder-changed';

const failure = (over: Partial<MutationFailure>): MutationFailure => ({
  error: 'Ce numéro a changé depuis votre lecture : vérifiez la liste.', status: 409, details: [], orgChanged: false, reason: null, requestId: null, ...over,
});

test('409 portant seulement la clé assign.holder_changed (sans chemin de détail) : numéro changé', () => {
  expect(isHolderChanged(failure({ reason: 'assign.holder_changed' }))).toBe(true);
});

test('409 portant seulement le chemin expected_bot_id (sans clé) : numéro changé', () => {
  expect(isHolderChanged(failure({ details: [{ path: 'expected_bot_id', message: 'x' }] }))).toBe(true);
});

test('autre refus 409, ou même clé avec un autre statut : pas un numéro changé', () => {
  expect(isHolderChanged(failure({ reason: 'assign.number_removed' }))).toBe(false);
  expect(isHolderChanged(failure({ reason: 'assign.holder_changed', status: 500 }))).toBe(false);
});
