import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { test, expect, vi } from 'vitest';
import { NumbersTable } from '../numbers-table';
import { accountView, numberView } from './fixtures';
import { json, renderIntl, stubFetch } from './helpers';

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

// recette 3.7 (remplace la décision du contrôleur de la relecture tâche 10) : même règle que le menu, un agent IA
// Draft ou Offline se branche sur un numéro d'un compte en erreur ; la fenêtre grise Preview et Online
test('compte en erreur, numéro libre : bouton « Brancher » actif, sans raison, il ouvre la fenêtre de choix', async () => {
  stubFetch(() => json([]));
  renderIntl(<NumbersTable account={accountView({ state: 'error', numbers: [numberView({})] })} onChanged={() => undefined} />);
  const button = screen.getByRole('button', { name: 'Brancher sur un agent IA' });
  expect(button).not.toHaveAttribute('aria-disabled');
  expect(button).not.toHaveAttribute('aria-describedby');
  await userEvent.click(button);
  expect(await screen.findByRole('dialog', { name: 'Brancher le numéro sur un agent IA' })).toBeInTheDocument();
});

test('compte connecté, numéro libre : bouton « Brancher » actif, sans raison', () => {
  renderIntl(<NumbersTable account={accountView({ numbers: [numberView({})] })} onChanged={() => undefined} />);
  const button = screen.getByRole('button', { name: 'Brancher sur un agent IA' });
  expect(button).not.toHaveAttribute('aria-disabled');
  expect(button).not.toHaveAttribute('aria-describedby');
});
