import { render, screen, within } from '@testing-library/react';
import { vi, test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import { AccountCard } from '../account-card';
import { accountView, numberView } from './fixtures';

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

function renderCard(account = accountView(), onChanged = vi.fn()) {
  const view = render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AccountCard account={account} onChanged={onChanged} />
    </NextIntlClientProvider>,
  );
  return { ...view, onChanged };
}

test('en-tête : nom, mode, WABA, pastille « Connecté », aucun badge de test', () => {
  renderCard();
  expect(screen.getByRole('heading', { name: 'Boutique principale' })).toBeInTheDocument();
  expect(screen.getByText(/API Meta directe · raccordement manuel/)).toBeInTheDocument();
  expect(screen.getByText('104829371625544')).toBeInTheDocument();
  expect(screen.getByText('Connecté', { selector: 'header span' })).toBeInTheDocument();
  expect(screen.queryByText('Compte de test')).not.toBeInTheDocument();
});

test('compte CM.com : mode CM.com et aucune WABA', () => {
  renderCard(accountView({ mode: 'cm_com', waba_id: null, webhook: { path: '/webhook/cm-com/cle', url: null, verify_token: null } }));
  expect(screen.getByText('CM.com', { selector: 'header p' })).toBeInTheDocument();
  expect(screen.queryByText(/WABA/)).not.toBeInTheDocument();
});

test('compte en erreur : pastille « En erreur » ; compte de test : badge', () => {
  renderCard(accountView({ state: 'error', error_reason: 'other', is_test: true }));
  expect(screen.getByText('En erreur', { selector: 'header span' })).toBeInTheDocument();
  expect(screen.getByText('Compte de test')).toBeInTheDocument();
});

test('dernière vérification : « vérifié il y a … » ou « Jamais vérifié »', () => {
  const { unmount } = renderCard(accountView({ last_verified_at: new Date(Date.now() - 3 * 60_000).toISOString() }));
  expect(screen.getByText(/vérifié il y a 3 minutes/)).toBeInTheDocument();
  unmount();
  renderCard(accountView({ last_verified_at: null }));
  expect(screen.getByText('Jamais vérifié')).toBeInTheDocument();
});

test('numéros : numéro formaté, nom affiché, état Meta, qualité, « Libre » sans agent IA', () => {
  renderCard(accountView({ numbers: [numberView({ quality: 'YELLOW' }), numberView({ id: 2, phone_e164: '+15551649072', display_name: 'Numéro de test', quality: null })] }));
  const rows = screen.getAllByRole('row').slice(1);
  expect(rows).toHaveLength(2);
  expect(within(rows[0]!).getByText('+33 6 12 45 78 90')).toBeInTheDocument();
  expect(within(rows[0]!).getByText('Boutique Marais')).toBeInTheDocument();
  expect(within(rows[0]!).getByText('Connecté')).toBeInTheDocument();
  expect(within(rows[0]!).getByText('Moyenne')).toBeInTheDocument();
  expect(within(rows[0]!).getByText('Libre')).toBeInTheDocument();
  expect(within(rows[1]!).getByText('+1 555 164 9072')).toBeInTheDocument();
  expect(within(rows[1]!).getByText('Non évaluée')).toBeInTheDocument();
});

test('qualité : GREEN Élevée, RED Basse, valeur inconnue Non évaluée', () => {
  renderCard(accountView({ numbers: [numberView({ id: 1, quality: 'GREEN' }), numberView({ id: 2, quality: 'RED' }), numberView({ id: 3, quality: 'WHATEVER' })] }));
  expect(screen.getByText('Élevée')).toBeInTheDocument();
  expect(screen.getByText('Basse')).toBeInTheDocument();
  expect(screen.getByText('Non évaluée')).toBeInTheDocument();
});

test('agent IA branché : nom (lien vers sa page) et statut', () => {
  renderCard(accountView({ numbers: [numberView({ bot: { bot_id: 'conseil-marais', name: 'Conseil Marais', status: 'limited' } })] }));
  const link = screen.getByRole('link', { name: /Conseil Marais/ });
  expect(link).toHaveAttribute('href', '/agents/conseil-marais');
  expect(within(link).getByText('Accès limité')).toBeInTheDocument();
  expect(screen.queryByText('Libre')).not.toBeInTheDocument();
});

test('numéro retiré : « Retiré du fournisseur » en rouge, avec son agent IA', () => {
  renderCard(accountView({
    numbers: [numberView({ provider_state: 'removed', removed_at: '2026-11-01T10:00:00.000Z', bot: { bot_id: 'b1', name: 'Conseil Marais', status: 'paused' } })],
  }));
  const row = screen.getAllByRole('row')[1]!;
  const removed = within(row).getByText('Retiré du fournisseur');
  expect(removed.className).toMatch(/text-danger/);
  expect(within(row).getByText('Conseil Marais')).toBeInTheDocument();
  expect(within(row).getByText('En pause')).toBeInTheDocument();
});

test('compte sans numéro : message, pas de tableau', () => {
  renderCard(accountView({ numbers: [] }));
  expect(screen.getByText('Aucun numéro trouvé sur ce compte.')).toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});

test('aucun bouton d\'action tant que les menus n\'existent pas (tâche 4)', () => {
  renderCard(accountView({ numbers: [numberView({ bot: { bot_id: 'b1', name: 'A', status: 'draft' } })] }));
  expect(screen.queryByRole('button', { name: /⋯|Actions pour|Brancher|Débrancher/ })).not.toBeInTheDocument();
});

test('la boîte webhook et les bandeaux d\'alerte sont dans le bloc du compte', () => {
  renderCard(accountView({ alerts: [{ kind: 'token_expiring', at: new Date(Date.now() + 12 * 86_400_000).toISOString() }] }));
  expect(screen.getByText('Webhook du compte')).toBeInTheDocument();
  expect(screen.getByText(/Le jeton expire dans 12 jours/)).toBeInTheDocument();
});
