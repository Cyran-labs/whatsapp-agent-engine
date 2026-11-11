import { act, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import type { NotRespondingReason, WhatsAppAccountStateView } from '@wabagent/contracts';
import messages from '../../../../messages/fr.json';
import { NotRespondingMention } from '../not-responding-mention';
import { MENTION_STYLE } from '../status-style';

const wrap = (reason: NotRespondingReason, accountState: WhatsAppAccountStateView | null, variant: 'short' | 'full') =>
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

// spec 7.3 : texte court rouge, le motif en bulle au survol et au focus
test.each(CASES)('short, %s (compte %s) : « Ne répond pas », bulle « %s » au focus', async (reason, state, text) => {
  wrap(reason, state, 'short');
  const mention = screen.getByText('Ne répond pas');
  expect(mention.className).toContain(MENTION_STYLE.pill);
  expect(mention).toHaveAttribute('tabindex', '0');
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  mention.focus();
  const bubble = await screen.findByRole('tooltip');
  expect(bubble).toHaveTextContent(text);
  expect(mention).toHaveAccessibleDescription(text);
});

test('short : la bulle se ferme quand le focus part, et ne se dit pas « à venir »', async () => {
  wrap('empty_allowlist', 'connected', 'short');
  const mention = screen.getByText('Ne répond pas');
  mention.focus();
  await screen.findByRole('tooltip');
  act(() => mention.blur());
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  expect(mention).not.toHaveAttribute('aria-disabled');
});
