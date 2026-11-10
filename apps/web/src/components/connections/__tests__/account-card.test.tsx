import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import { AccountCard } from '../account-card';
import { accountView, numberView, webhookView } from './fixtures';
import { json, stubFetch } from './helpers';

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  stubFetch((call) => (call.url.endsWith('/webhook') ? json(webhookView()) : json({})));
});

function renderCard(account = accountView(), onChanged = vi.fn()) {
  const view = render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AccountCard account={account} onChanged={onChanged} onRemoved={vi.fn()} refreshKey={1} />
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
  renderCard(accountView({ mode: 'cm_com', waba_id: null }));
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
  renderCard(accountView({ numbers: [numberView({ bot: { bot_id: 'conseil-marais', name: 'Conseil Marais', status: 'limited', status_reason: null, not_responding: null } })] }));
  const link = screen.getByRole('link', { name: /Conseil Marais/ });
  expect(link).toHaveAttribute('href', '/agents/conseil-marais');
  expect(within(link).getByText('Accès limité')).toBeInTheDocument();
  expect(screen.queryByText('Libre')).not.toBeInTheDocument();
});

test('numéro retiré : « Retiré du fournisseur » en rouge, avec son agent IA', () => {
  renderCard(accountView({
    numbers: [numberView({ provider_state: 'removed', removed_at: '2026-11-01T10:00:00.000Z', bot: { bot_id: 'b1', name: 'Conseil Marais', status: 'paused', status_reason: null, not_responding: null } })],
  }));
  const row = screen.getAllByRole('row')[1]!;
  const removed = within(row).getByText('Retiré du fournisseur');
  expect(removed.className).toMatch(/text-danger/);
  expect(within(row).getByText('Conseil Marais')).toBeInTheDocument();
  expect(within(row).getByText('Désactivé')).toBeInTheDocument();
});

// revue finale 2b-3 I-3 : un numéro retiré chez le fournisseur ne propose ni « Brancher », ni badge de test
test('numéro retiré et libre : ni « Libre », ni « Brancher sur un agent IA », ni badge « Numéro de test »', () => {
  renderCard(accountView({
    numbers: [numberView({ provider_state: 'removed', removed_at: '2026-11-01T10:00:00.000Z', is_test: true })],
  }));
  const row = screen.getAllByRole('row')[1]!;
  expect(within(row).getByText('Retiré du fournisseur')).toBeInTheDocument();
  expect(within(row).queryByText('Libre')).not.toBeInTheDocument();
  expect(within(row).queryByRole('button', { name: 'Brancher sur un agent IA' })).not.toBeInTheDocument();
  expect(within(row).queryByText('Numéro de test')).not.toBeInTheDocument();
});

test('numéro de test : badge « Numéro de test » dans sa ligne seulement, et bandeau du compte', () => {
  renderCard(accountView({ numbers: [numberView({ id: 1 }), numberView({ id: 2, phone_e164: '+15551649072', is_test: true })] }));
  const rows = screen.getAllByRole('row').slice(1);
  expect(within(rows[0]!).queryByText('Numéro de test')).not.toBeInTheDocument();
  expect(within(rows[1]!).getByText('Numéro de test')).toBeInTheDocument();
  expect(screen.getByText('Numéro de test Meta :')).toBeInTheDocument();
  // Le compte n'est pas de test (tous ses numéros ne le sont pas) : pas de badge « Compte de test ».
  expect(screen.queryByText('Compte de test')).not.toBeInTheDocument();
});

test('compte sans numéro : message, pas de tableau', () => {
  renderCard(accountView({ numbers: [] }));
  expect(screen.getByText('Aucun numéro trouvé sur ce compte.')).toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});

test('menus branchés : un menu pour le compte, un menu par numéro, dans leurs emplacements', () => {
  const { container } = renderCard(
    accountView({ numbers: [numberView(), numberView({ id: 2, phone_e164: '+33184801234', display_name: 'Boutique SAV' })] }),
  );
  const header = container.querySelector('header')!;
  expect(within(header).getByRole('button', { name: 'Gérer (Boutique principale)' })).toBeInTheDocument();
  const cells = container.querySelectorAll('td[data-slot="number-actions"]');
  expect(cells).toHaveLength(2);
  expect(within(cells[0] as HTMLElement).getByRole('button', { name: 'Gérer (+33 6 12 45 78 90)' })).toBeInTheDocument();
  expect(within(cells[1] as HTMLElement).getByRole('button', { name: 'Gérer (+33 1 84 80 12 34)' })).toBeInTheDocument();
});

// recette Q-6
test('« Gérer ▾ » est un bouton visible (texte) sur le compte et sur chaque numéro, « Brancher » un bouton direct sur le numéro libre', () => {
  renderCard(accountView({ numbers: [numberView(), numberView({ id: 2, phone_e164: '+33184801234', bot: { bot_id: 'b1', name: 'Conseil', status: 'draft', status_reason: null, not_responding: null } })] }));
  const triggers = screen.getAllByRole('button', { name: /^Gérer \(/ });
  expect(triggers).toHaveLength(3);
  for (const trigger of triggers) expect(trigger).toHaveTextContent('Gérer');
  expect(screen.queryByText('⋯')).not.toBeInTheDocument();
  const free = screen.getAllByRole('row')[1]!;
  const direct = within(free).getByRole('button', { name: 'Brancher sur un agent IA' });
  expect(direct).toBeVisible();
  expect(direct).toHaveTextContent('Brancher');
  expect(direct).not.toHaveAttribute('aria-haspopup');
});

// audit R-6
test('échecs de remise : pastille « 3 échecs de remise », sens du code 131047 et lien vers WhatsApp Manager', () => {
  renderCard(accountView({ numbers: [numberView({ delivery_failures: 3, last_delivery_error_code: 131047 })] }));
  const row = screen.getAllByRole('row')[1]!;
  expect(within(row).getByText('3 échecs de remise')).toBeInTheDocument();
  expect(within(row).getByText(/Plus de 24 heures depuis la dernière réponse du contact/)).toBeInTheDocument();
  expect(within(row).getByRole('link', { name: 'Voir dans WhatsApp Manager ↗' })).toHaveAttribute(
    'href',
    'https://business.facebook.com/wa/manage/phone-numbers/?waba_id=104829371625544',
  );
});

// audit R-6
test('échecs de remise : un seul échec au singulier, code inconnu « Code Meta 131999 » avec le lien, aucun échec : rien', () => {
  renderCard(accountView({
    numbers: [
      numberView({ id: 1, delivery_failures: 1, last_delivery_error_code: 131999 }),
      numberView({ id: 2, phone_e164: '+33184801234', delivery_failures: 0, last_delivery_error_code: null }),
    ],
  }));
  const [first, second] = screen.getAllByRole('row').slice(1);
  expect(within(first!).getByText('1 échec de remise')).toBeInTheDocument();
  expect(within(first!).getByText('Code Meta 131999')).toBeInTheDocument();
  expect(within(first!).getByRole('link', { name: 'Voir dans WhatsApp Manager ↗' })).toBeInTheDocument();
  expect(within(second!).queryByText(/échec/)).not.toBeInTheDocument();
});

// audit R-6
test.each([
  [131026, /n'a peut-être pas WhatsApp/],
  [131042, /moyen de paiement/],
  [131056, /Trop de messages envoyés en peu de temps/],
  [130472, /expérience Meta/],
])('échecs de remise : le code %i a son texte', (code, text) => {
  renderCard(accountView({ numbers: [numberView({ delivery_failures: 2, last_delivery_error_code: code })] }));
  expect(within(screen.getAllByRole('row')[1]!).getByText(text)).toBeInTheDocument();
});

// audit R-6
test('échecs de remise sans code connu : le nombre seul, sans « Code Meta », compte CM.com sans lien', () => {
  renderCard(accountView({ mode: 'cm_com', waba_id: null, numbers: [numberView({ delivery_failures: 2, last_delivery_error_code: null })] }));
  const row = screen.getAllByRole('row')[1]!;
  expect(within(row).getByText('2 échecs de remise')).toBeInTheDocument();
  expect(within(row).queryByText(/Code Meta/)).not.toBeInTheDocument();
  expect(within(row).queryByRole('link')).not.toBeInTheDocument();
});

// recette Q-8
test('compte retiré de WABAGENT : la boîte webhook n\'est pas montée et la route du webhook n\'est pas lue', async () => {
  const calls = stubFetch(() => json(webhookView()));
  renderCard(accountView({ state: 'disconnected', numbers: [] }));
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByText('Webhook du compte')).not.toBeInTheDocument();
  expect(calls.filter((c) => c.url.endsWith('/webhook'))).toEqual([]);
});

test('numéro libre : le lien « Brancher sur un agent IA » ouvre la fenêtre de choix', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
  renderCard(accountView({ numbers: [numberView()] }));
  const row = screen.getAllByRole('row')[1]!;
  await userEvent.click(within(row).getByRole('button', { name: 'Brancher sur un agent IA' }));
  expect(screen.getByRole('dialog', { name: 'Brancher le numéro sur un agent IA' })).toBeInTheDocument();
});

test('numéro branché : pas de lien « Brancher » dans la colonne de l\'agent IA', () => {
  renderCard(accountView({ numbers: [numberView({ bot: { bot_id: 'b1', name: 'Conseil', status: 'draft', status_reason: null, not_responding: null } })] }));
  const row = screen.getAllByRole('row')[1]!;
  expect(within(row).queryByRole('button', { name: 'Brancher sur un agent IA' })).not.toBeInTheDocument();
});

// revue 2b-3 M-2
test('la boîte webhook (lue sur la route dédiée du compte) et les bandeaux d\'alerte sont dans le bloc du compte', async () => {
  const calls = stubFetch((call) => (call.url === '/api/whatsapp-accounts/1/webhook' ? json(webhookView()) : json({})));
  renderCard(accountView({ alerts: [{ kind: 'token_expiring', at: new Date(Date.now() + 12 * 86_400_000).toISOString() }] }));
  expect(await screen.findByText('Webhook du compte')).toBeInTheDocument();
  expect(calls.map((c) => c.url)).toEqual(['/api/whatsapp-accounts/1/webhook']);
  expect(screen.getByText(/Le jeton expire dans 12 jours/)).toBeInTheDocument();
});
