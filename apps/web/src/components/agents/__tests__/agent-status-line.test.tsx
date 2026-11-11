import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import type { NotRespondingReason, WhatsAppAccountStateView } from '@wabagent/contracts';
import messages from '../../../../messages/fr.json';
import en from '../../../../messages/en.json';
import { AgentStatusLine } from '../agent-status-line';

const INVITATION = 'Ajoutez un numéro à la Whitelist pour que cet agent IA réponde.';

function wrap(status: string, notResponding: string | null, accountState: WhatsAppAccountStateView | null = null, locale: 'fr' | 'en' = 'fr') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? messages : en}>
      <AgentStatusLine status={status} statusReason={null} notResponding={notResponding} accountState={accountState} />
    </NextIntlClientProvider>,
  );
}

/** Texte visible de la ligne, sans la bulle (cachée tant qu'elle n'est pas ouverte, et toujours hors de la pastille). */
function visibleText(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[role="tooltip"]').forEach((n) => n.remove());
  return clone.textContent ?? '';
}

// recette 3.4 : la mention « Ne répond pas » est un point rouge sur la pastille de statut, le motif en bulle
const DANGER: Array<[string, NotRespondingReason, WhatsAppAccountStateView | null, string]> = [
  ['active', 'account_not_connected', 'error', 'Ne répond pas : compte WhatsApp en erreur'],
  ['active', 'account_not_connected', 'disconnected', 'Ne répond pas : compte WhatsApp non connecté'],
  ['limited', 'no_number', null, 'Ne répond pas : aucun numéro'],
  ['active', 'number_removed', 'connected', 'Ne répond pas : numéro retiré'],
  ['limited', 'organization_suspended', 'connected', 'Ne répond pas : organisation suspendue'],
];

test.each(DANGER)('recette 3.4 : %s, %s (compte %s) : point rouge sur la pastille, bulle « %s » au focus', async (status, reason, state, motive) => {
  const { container } = wrap(status, reason, state);
  const dot = screen.getByRole('button', { name: 'Ne répond pas' });
  // le point est porté par la pastille (son conteneur), en rouge, avec un liseré de la surface
  const pill = screen.getByText(status === 'active' ? 'Online' : 'Preview');
  expect(pill.parentElement).toContainElement(dot);
  expect(dot).toHaveAttribute('data-mention', 'danger');
  expect(dot.querySelector('.bg-danger')).not.toBeNull();
  expect(dot.querySelector('.ring-surface')).not.toBeNull();
  // aucun texte « Ne répond pas » visible hors de la bulle : le nom du point n'est lu que par les lecteurs d'écran
  expect(visibleText(container)).not.toContain('Ne répond pas');
  expect(screen.queryByText('Whitelist vide')).not.toBeInTheDocument();
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  dot.focus();
  expect(await screen.findByRole('tooltip')).toHaveTextContent(motive);
  expect(dot).toHaveAccessibleDescription(motive);
});

// recette 3.5 : la Whitelist vide est un état, pas une erreur : étiquette neutre, aucune marque rouge
test('recette 3.5 : Preview à Whitelist vide, étiquette neutre « Whitelist vide », invitation en bulle, aucune classe danger', async () => {
  const { container } = wrap('limited', 'empty_allowlist', 'connected');
  const label = screen.getByRole('button', { name: 'Whitelist vide' });
  expect(label).toHaveAttribute('data-mention', 'neutral');
  expect(label.className).toContain('border-border-strong');
  expect(label.className).toContain('bg-surface');
  expect(label.className).toContain('text-muted');
  expect(container.innerHTML).not.toMatch(/danger/);
  expect(screen.queryByRole('button', { name: 'Ne répond pas' })).not.toBeInTheDocument();
  expect(visibleText(container)).not.toContain('Ne répond pas');
  // l'étiquette est à côté de la pastille, pas dessus
  expect(screen.getByText('Preview')).not.toContainElement(label);
  expect(label.closest('.relative')).toBeNull();
  label.focus();
  expect(await screen.findByRole('tooltip')).toHaveTextContent(INVITATION);
  expect(label).toHaveAccessibleDescription(INVITATION);
});

test('recette 3.5 : en anglais, « Empty Allowlist » et son invitation', async () => {
  wrap('limited', 'empty_allowlist', 'connected', 'en');
  const label = screen.getByRole('button', { name: 'Empty Allowlist' });
  label.focus();
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Add a number to the Allowlist so this AI agent answers.');
});

// point d'attention 4 : aucune marque hors Preview et Online, ni pour un motif inconnu des contrats
test.each([
  ['active', null],
  ['draft', 'no_number'],
  ['paused', 'no_number'],
  ['active', 'motif_futur'],
])('%s, mention %s : ni point ni étiquette', (status, raw) => {
  const { container } = wrap(status, raw);
  expect(container.querySelector('[data-mention]')).toBeNull();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
