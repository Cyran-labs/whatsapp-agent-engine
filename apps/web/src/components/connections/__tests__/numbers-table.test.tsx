import { screen, within } from '@testing-library/react';
import { test, expect, vi } from 'vitest';
import { NumbersTable } from '../numbers-table';
import { accountView, numberView } from './fixtures';
import { renderIntl } from './helpers';

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const bot = { bot_id: 'b1', name: 'Conseil Lyon', status: 'limited', status_reason: null, not_responding: null } as const;

// prototype 1 : « Compte Lyon en erreur, agent IA Accès limité » : la ligne du numéro dit qu'il ne répond pas
test('agent IA Preview sur un compte en erreur : pastille Preview et mention « Ne répond pas », motif du compte en bulle', async () => {
  const account = accountView({ state: 'error', numbers: [numberView({ bot: { ...bot, not_responding: 'account_not_connected' } })] });
  renderIntl(<NumbersTable account={account} onChanged={() => undefined} />);
  const row = screen.getByRole('row', { name: /Conseil Lyon/ });
  expect(within(row).getByText('Preview')).toBeInTheDocument();
  const mention = within(row).getByText('Ne répond pas');
  mention.focus();
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Ne répond pas : compte WhatsApp en erreur');
});

test('compte déconnecté : la bulle dit « non connecté »', async () => {
  const account = accountView({ state: 'disconnected', numbers: [numberView({ bot: { ...bot, not_responding: 'account_not_connected' } })] });
  renderIntl(<NumbersTable account={account} onChanged={() => undefined} />);
  screen.getByText('Ne répond pas').focus();
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Ne répond pas : compte WhatsApp non connecté');
});

test('agent IA Online qui répond : pastille seule', () => {
  renderIntl(<NumbersTable account={accountView({ numbers: [numberView({ bot: { ...bot, status: 'active' } })] })} onChanged={() => undefined} />);
  expect(screen.getByText('Online')).toBeInTheDocument();
  expect(screen.queryByText('Ne répond pas')).not.toBeInTheDocument();
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
  expect(screen.queryByText('Ne répond pas')).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain('motif_futur');
});
