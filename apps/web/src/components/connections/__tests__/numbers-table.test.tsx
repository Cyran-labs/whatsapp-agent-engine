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

// Lot R2a, spec R2a §5.3, point 1 : colonne « Nom affiché », avec l'étiquette de la demande en cours.
test.each([
  ['in_review', 'Nouveau nom en revue'],
  ['rejected', 'Nouveau nom refusé'],
  ['approved_pending', 'Nouveau nom à appliquer'],
] as const)('colonne « Nom affiché » : demande %s, étiquette « %s », nom affiché inchangé', (status, label) => {
  const display_name_request = {
    requested_name: 'Boutique Marais Paris', status, rejection_reason: null, requested_at: null, approved_at: null, apply_before: null, apply_before_approx: false,
  };
  renderIntl(<NumbersTable account={accountView({ numbers: [numberView({ display_name_request })] })} onChanged={() => undefined} />);
  const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
  expect(headers.slice(0, 2)).toEqual(['Numéro', 'Nom affiché']);
  const row = screen.getAllByRole('row')[1]!;
  const cell = within(row).getAllByRole('cell')[1]!;
  expect(cell).toHaveTextContent('Boutique Marais');
  expect(cell).toHaveTextContent(label);
  expect(cell).not.toHaveTextContent('Boutique Marais Paris');
});

test('colonne « Nom affiché » : sans demande, le nom seul', () => {
  renderIntl(<NumbersTable account={accountView()} onChanged={() => undefined} />);
  const cell = within(screen.getAllByRole('row')[1]!).getAllByRole('cell')[1]!;
  expect(cell.textContent).toBe('Boutique Marais');
});
