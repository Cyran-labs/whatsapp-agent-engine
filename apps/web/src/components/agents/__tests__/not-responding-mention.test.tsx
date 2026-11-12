import { act, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import type { NotRespondingReason, WhatsAppAccountStateView } from '@wabagent/contracts';
import messages from '../../../../messages/fr.json';
import { NotRespondingMention } from '../not-responding-mention';
import { NEUTRAL_MARK } from '../status-style';

const wrap = (reason: NotRespondingReason, accountState: WhatsAppAccountStateView | null, variant: 'mark' | 'full') =>
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <NotRespondingMention reason={reason} accountState={accountState} variant={variant} />
    </NextIntlClientProvider>,
  );

// spec 7.1 : un texte par motif ; compte « en erreur » sauf un compte déconnecté
const CASES: Array<[NotRespondingReason, WhatsAppAccountStateView | null, string]> = [
  ['no_number', null, 'Ne répond pas : aucun numéro'],
  ['number_removed', 'connected', 'Ne répond pas : numéro retiré'],
  ['account_not_connected', 'error', 'Ne répond pas : compte WhatsApp en erreur'],
  ['account_not_connected', 'disconnected', 'Ne répond pas : compte WhatsApp non connecté'],
  ['organization_suspended', 'connected', 'Ne répond pas : organisation suspendue'],
  ['empty_allowlist', 'connected', 'Ne répond pas : Whitelist vide'],
];

test.each(CASES)('full, %s (compte %s) → « %s »', (reason, state, text) => {
  const { container } = wrap(reason, state, 'full');
  expect(container.textContent).toBe(text);
});

const DANGER_CASES = CASES.filter(([reason]) => reason !== 'empty_allowlist');

// recette 3.4 : point rouge sans texte visible, le motif en bulle au survol et au focus
test.each(DANGER_CASES)('mark, %s (compte %s) : point rouge nommé « Ne répond pas », bulle « %s » au focus', async (reason, state, text) => {
  const { container } = wrap(reason, state, 'mark');
  // relecture tâche 7, M-4 : un rôle annoncé, un bouton nommé « Ne répond pas » dont la description est le motif
  const mention = screen.getByRole('button', { name: 'Ne répond pas' });
  expect(mention).toHaveAttribute('type', 'button');
  expect(mention).toHaveAttribute('data-mention', 'danger');
  expect(mention.textContent).toBe('');
  expect(mention.querySelector('.bg-danger')).not.toBeNull();
  expect(container.querySelector('.bg-danger-soft')).toBeNull();
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  mention.focus();
  const bubble = await screen.findByRole('tooltip');
  expect(bubble).toHaveTextContent(text);
  expect(mention).toHaveAccessibleDescription(text);
});

// recette 3.5 : Whitelist vide, étiquette neutre et invitation, jamais de rouge
test('mark, empty_allowlist : étiquette neutre « Whitelist vide », invitation en bulle', async () => {
  const { container } = wrap('empty_allowlist', 'connected', 'mark');
  const label = screen.getByRole('button', { name: 'Whitelist vide' });
  expect(label).toHaveAttribute('data-mention', 'neutral');
  expect(label.className).toContain(NEUTRAL_MARK);
  expect(container.innerHTML).not.toMatch(/danger/);
  label.focus();
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Ajoutez un numéro à la Whitelist pour que cet agent IA réponde.');
});

test('mark : la bulle se ferme quand le focus part, et ne se dit pas « à venir »', async () => {
  wrap('no_number', null, 'mark');
  const mention = screen.getByRole('button', { name: 'Ne répond pas' });
  mention.focus();
  await screen.findByRole('tooltip');
  act(() => mention.blur());
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  expect(mention).not.toHaveAttribute('aria-disabled');
});

// relecture tâche 7, M-4 : le bouton n'a aucun autre effet que la bulle ; un clic ne soumet rien et l'ouvre
test('mark : bouton sans autre effet, la bulle s\'ouvre au clic (focus) et se ferme par Échap', async () => {
  const { default: userEvent } = await import('@testing-library/user-event');
  wrap('no_number', null, 'mark');
  const mention = screen.getByRole('button', { name: 'Ne répond pas' });
  await userEvent.click(mention);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Ne répond pas : aucun numéro');
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});
