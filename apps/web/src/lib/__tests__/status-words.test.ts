import { test, expect } from 'vitest';
import { BOT_PAUSE_REASONS, NOT_RESPONDING_REASONS } from '@wabagent/contracts';
import { notRespondingTextKey, offlineReasonKey, toNotRespondingReason } from '../status-words';

// spec 6.1 : motif d'Offline, jamais le code brut
test('motif d\'Offline : absent ou nul = arrêt manuel', () => {
  expect(offlineReasonKey(null)).toBe('manual');
  expect(offlineReasonKey(undefined)).toBe('manual');
});

test('motif d\'Offline : chaque motif de BOT_PAUSE_REASONS est le sien', () => {
  for (const reason of BOT_PAUSE_REASONS) expect(offlineReasonKey(reason)).toBe(reason);
});

test('motif d\'Offline : texte inconnu (ou vide) = unknown, jamais le code brut', () => {
  expect(offlineReasonKey('archived_by_script')).toBe('unknown');
  expect(offlineReasonKey('')).toBe('unknown');
  expect(offlineReasonKey('manual')).toBe('unknown');
});

// spec 7.1 : « en erreur » sauf un compte déconnecté
test('texte de la mention : un texte par motif, compte en erreur ou non connecté selon l\'état affiché', () => {
  expect(notRespondingTextKey('account_not_connected', 'error')).toBe('account_error');
  expect(notRespondingTextKey('account_not_connected', 'disconnected')).toBe('account_disconnected');
  expect(notRespondingTextKey('account_not_connected', null)).toBe('account_error');
  expect(notRespondingTextKey('account_not_connected', 'connected')).toBe('account_error');
  for (const reason of NOT_RESPONDING_REASONS.filter((r) => r !== 'account_not_connected')) {
    expect(notRespondingTextKey(reason, 'disconnected')).toBe(reason);
  }
});

// relecture tâche 7, M-2 : un motif de mention inconnu des contrats n'est jamais affiché
test('motif de mention : ceux des contrats passent, tout le reste donne null', () => {
  for (const reason of NOT_RESPONDING_REASONS) expect(toNotRespondingReason(reason)).toBe(reason);
  for (const raw of ['motif_futur', '', null, undefined, 3, {}]) expect(toNotRespondingReason(raw)).toBeNull();
});
