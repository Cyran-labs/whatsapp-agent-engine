import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { test, expect, vi } from 'vitest';
import { NumbersTable } from '../numbers-table';
import { accountView, numberView } from './fixtures';
import { renderIntl } from './helpers';

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const bot = { bot_id: 'b1', name: 'Conseil Lyon', status: 'limited', status_reason: null, not_responding: null } as const;

// prototype 1, recette 3.4 : « Compte Lyon en erreur, agent IA Accès limité » : la ligne du numéro dit qu'il ne répond pas
test('agent IA Preview sur un compte en erreur : pastille Preview et point « Ne répond pas », motif du compte en bulle', async () => {
  const account = accountView({ state: 'error', numbers: [numberView({ bot: { ...bot, not_responding: 'account_not_connected' } })] });
  renderIntl(<NumbersTable account={account} onChanged={() => undefined} />);
  const row = screen.getByRole('row', { name: /Conseil Lyon/ });
  expect(within(row).getByText('Preview')).toBeInTheDocument();
  const mention = within(row).getByRole('button', { name: 'Ne répond pas' });
  expect(mention).toHaveAttribute('data-mention', 'danger');
  mention.focus();
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Ne répond pas : compte WhatsApp en erreur');
});

test('compte déconnecté : la bulle dit « non connecté »', async () => {
  const account = accountView({ state: 'disconnected', numbers: [numberView({ bot: { ...bot, not_responding: 'account_not_connected' } })] });
  renderIntl(<NumbersTable account={account} onChanged={() => undefined} />);
  screen.getByRole('button', { name: 'Ne répond pas' }).focus();
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Ne répond pas : compte WhatsApp non connecté');
});

test('agent IA Online qui répond : pastille seule', () => {
  renderIntl(<NumbersTable account={accountView({ numbers: [numberView({ bot: { ...bot, status: 'active' } })] })} onChanged={() => undefined} />);
  expect(screen.getByText('Online')).toBeInTheDocument();
  expect(document.querySelector('[data-mention]')).toBeNull();
});

// spec 6.1 : Offline toujours suivi de son motif, dans Connexions aussi
test('agent IA Offline : motif à côté de la pastille', () => {
  renderIntl(<NumbersTable account={accountView({ numbers: [numberView({ bot: { ...bot, status: 'paused', status_reason: 'number_removed' } })] })} onChanged={() => undefined} />);
  const row = screen.getByRole('row', { name: /Conseil Lyon/ });
  expect(within(row).getByText('Offline')).toBeInTheDocument();
  expect(within(row).getByText('Numéro retiré')).toBeInTheDocument();
});

// relecture tâche 7, M-2 : même garde que la liste et la colonne
test('motif de mention inconnu : ni mention ni texte technique', () => {
  const odd = { ...bot, status: 'active', not_responding: 'motif_futur' } as unknown as typeof bot;
  renderIntl(<NumbersTable account={accountView({ numbers: [numberView({ bot: odd })] })} onChanged={() => undefined} />);
  expect(screen.getByText('Online')).toBeInTheDocument();
  expect(document.querySelector('[data-mention]')).toBeNull();
  expect(document.body.textContent).not.toContain('motif_futur');
});

// décision du contrôleur (relecture tâche 10) : même règle que le menu pour le bouton « Libre · Brancher »
test('compte en erreur, numéro libre : bouton « Brancher » grisé, raison en bulle au focus, aucune fenêtre au clic', async () => {
  renderIntl(<NumbersTable account={accountView({ state: 'error', numbers: [numberView({})] })} onChanged={() => undefined} />);
  const button = screen.getByRole('button', { name: 'Brancher sur un agent IA' });
  expect(button).toHaveAttribute('aria-disabled', 'true');
  expect(button).toHaveAccessibleDescription("Le compte WhatsApp de ce numéro n'est pas connecté : un agent IA branché ici ne répondrait pas.");
  button.focus();
  expect(await screen.findByRole('tooltip')).toBeVisible();
  await userEvent.click(button);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('compte connecté, numéro libre : bouton « Brancher » actif, sans raison', () => {
  renderIntl(<NumbersTable account={accountView({ numbers: [numberView({})] })} onChanged={() => undefined} />);
  const button = screen.getByRole('button', { name: 'Brancher sur un agent IA' });
  expect(button).not.toHaveAttribute('aria-disabled');
  expect(button).not.toHaveAttribute('aria-describedby');
});
