import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import userEvent from '@testing-library/user-event';
import { test, expect, vi, beforeEach } from 'vitest';
import messages from '../../../../messages/fr.json';
import en from '../../../../messages/en.json';
import { NOT_READ, Overview } from '../overview';
import { CostCard } from '../cost-card';
import { botNumber, botView } from './fixtures';

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const session = vi.hoisted(() => ({ isAdmin: true, readOnly: false }));
vi.mock('@/components/providers/session-provider', () => ({ useSession: () => session }));

// Forme réelle de `GET /bots/:botId/health` (BotHealth du moteur).
const NUMBER = {
  id: 4, phone_e164: '+33612000047', display_name: 'Boutique', is_test: false, provider_state: 'present', quality: 'GREEN', delivery_failures: 0, last_delivery_error_code: null,
  account: { id: 1, name: 'Compte principal', mode: 'meta_manual', state: 'connected', error_reason: null, error_detail: null, error_cause: null },
} as const;

const data = {
  bot: botView({ status: 'active' }),
  health: {
    status: 'active',
    status_reason: null,
    languages: ['fr'],
    whatsapp: { number: NUMBER },
    crm: { configured: true, connector: 'hubspot', last_error: null, last_error_at: null },
    llm: { mode: 'platform', key_configured: false },
  },
  metrics: { leads_total: 23, rdv_total: 9, conversations_total: 40, messages_total: 142 },
  usage: {
    totals: { input_tokens: 184000, output_tokens: 39000, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: 1.84, calls: 312 },
    by_model: [],
    by_day: [{ day: '2026-06-01', cost_usd: 0.06, calls: 10 }],
  },
  recent: [{ phone: '+33', name: 'ML', last: 'Bonjour', qualified: true, when: '2026-11-09 20:09:02' }],
};

beforeEach(() => { session.isAdmin = true; session.readOnly = false; });

type Data = Parameters<typeof Overview>[0]['data'];
const wrap = (d: Data = data) =>
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <Overview data={d} botId="b1" onChanged={vi.fn()} onStale={vi.fn()} onRetryPanel={vi.fn()} />
    </NextIntlClientProvider>,
  );

test('admin : numéro en entier dans l\'encart Numéro, WhatsApp connecté quand son compte est connecté', () => {
  wrap();
  expect(screen.getByText('+33 6 12 00 00 47')).toBeInTheDocument();
  expect(screen.queryByText(/\+33612 •• •• 47/)).not.toBeInTheDocument();
  expect(screen.getAllByText('Connecté').length).toBeGreaterThanOrEqual(1);
});

test('membre non admin : numéro masqué', () => {
  session.isAdmin = false;
  wrap();
  expect(screen.getByText(/\+33612 •• •• 47/)).toBeInTheDocument();
  expect(screen.queryByText('+33 6 12 00 00 47')).not.toBeInTheDocument();
});

// nav 15.5 (amendement A-5)
test('carte Coût LLM : présente pour l\'admin, absente pour un non-admin, en chargement comme une fois lue', () => {
  wrap();
  expect(screen.getByText('Coût LLM')).toBeInTheDocument();
  cleanup();
  session.isAdmin = false;
  wrap();
  expect(screen.queryByText('Coût LLM')).not.toBeInTheDocument();
  cleanup();
  wrap(null);
  expect(screen.queryByText('Coût LLM')).not.toBeInTheDocument();
});

// revue tâche 2, mineur 2 : « non lu » n'est jamais lu comme « chargement » (squelette sans fin).
test('coûts non lus (NOT_READ) : ni carte ni squelette de coût, même pour une session admin', () => {
  wrap({ ...data, usage: NOT_READ });
  expect(screen.queryByText('Coût LLM')).not.toBeInTheDocument();
  // Garde de type : CostCard ne reçoit pas l'état « non lu ».
  // @ts-expect-error NOT_READ n'est pas un état de CostCard
  void (() => <CostCard usage={NOT_READ} onRetry={() => undefined} />);
});

test('sans numéro branché : la page se rend, WhatsApp non connecté', () => {
  wrap({ ...data, bot: botView({ whatsapp_number: null }), health: { ...data.health, whatsapp: { number: null } } });
  expect(screen.getByText('Santé')).toBeInTheDocument();
  expect(screen.queryByText(/\+33 6 12 00 00 47/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Brancher un numéro' })).toBeInTheDocument();
  expect(screen.getAllByText('Non connecté').length).toBeGreaterThanOrEqual(1);
});

test("compte du numéro en erreur (signatures rejetées) : WhatsApp non connecté", () => {
  const number = { ...NUMBER, account: { ...NUMBER.account, state: 'error' as const, error_reason: 'signature_rejected' as const } };
  wrap({ ...data, bot: botView({ whatsapp_number: botNumber({ account_state: 'error' }) }), health: { ...data.health, whatsapp: { number } } });
  expect(screen.getAllByText('Non connecté').length).toBeGreaterThanOrEqual(1);
  // La santé dit « Non connecté » ; l'état du compte, « En erreur », est dans l'encart du numéro.
  expect(screen.getByText('En erreur')).toBeInTheDocument();
});

test('santé + stats rendues', () => {
  wrap();
  expect(screen.getByText('Santé')).toBeInTheDocument();
  expect(screen.getByText('142')).toBeInTheDocument();
  expect(screen.getByText('23')).toBeInTheDocument();
});

// recette 10 nov. 2026 (décision de François) : la santé dit d'abord que l'agent IA est arrêté, la santé technique reste dessous
test.each([
  ['paused', 'Désactivé', 'Agent IA désactivé : il ne répond pas.'],
  ['draft', 'Brouillon', 'Agent IA en brouillon : il ne répond pas encore.'],
] as const)('santé d\'un agent IA %s : %s dit qu\'il ne répond pas, sans « tout est opérationnel », comptes et numéro visibles', (status, _pill, sentence) => {
  wrap({ ...data, bot: botView({ status }), health: { ...data.health, status } });
  const panel = screen.getByText('Santé').closest('div')!;
  expect(within(panel).getByText(sentence)).toBeInTheDocument();
  expect(screen.queryByText('tout est opérationnel')).not.toBeInTheDocument();
  // la santé technique reste visible en dessous de la phrase
  expect(within(panel).getByText('WhatsApp')).toBeInTheDocument();
  expect(within(panel).getByText('CRM')).toBeInTheDocument();
  expect(panel.textContent!.indexOf(sentence)).toBeLessThan(panel.textContent!.indexOf('WhatsApp'));
});

test('santé : accès limité et ouvert à tous gardent « tout est opérationnel », sans phrase d\'arrêt', () => {
  for (const status of ['limited', 'active'] as const) {
    wrap({ ...data, bot: botView({ status }), health: { ...data.health, status } });
    expect(screen.getByText('tout est opérationnel')).toBeInTheDocument();
    expect(screen.queryByText(/ne répond pas/)).not.toBeInTheDocument();
    cleanup();
  }
});

test('santé d\'un agent IA désactivé en anglais', () => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <Overview data={{ ...data, bot: botView({ status: 'paused' }), health: { ...data.health, status: 'paused' } }} botId="b1" onChanged={vi.fn()} onStale={vi.fn()} onRetryPanel={vi.fn()} />
    </NextIntlClientProvider>,
  );
  expect(screen.getByText('AI agent deactivated: it does not reply.')).toBeInTheDocument();
  expect(screen.queryByText('all systems operational')).not.toBeInTheDocument();
});

test('coût LLM affiché', () => {
  wrap();
  // Les données de test font coïncider total (1.84) et perDay (1.84/1 jour = 1.84).
  // On vérifie qu'au moins un élément affiche la valeur.
  expect(screen.getAllByText(/1[.,]84/).length).toBeGreaterThanOrEqual(1);
});

test('dernières conversations', () => {
  wrap();
  expect(screen.getByText(/Bonjour/)).toBeInTheDocument();
});

test('admin : Simuler présent, et « Désactiver » vient de l\'encart Statut (actif, donc actionnable)', () => {
  wrap();
  expect(screen.getByRole('button', { name: /Simuler/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Désactiver' })).toBeEnabled();
});

test('aucun bouton désactivé sans raison visible', () => {
  // Brouillon sans liste d'accès : les actions refusées par la machine d'états disent leur raison.
  wrap({ ...data, bot: botView({ status: 'draft', allowlist: [] }) });
  for (const button of screen.getAllByRole('button')) {
    if (!(button as HTMLButtonElement).disabled) continue;
    expect(button, button.textContent ?? '').toHaveAccessibleDescription(/.+/);
  }
});

test('tuile « Rendez-vous » (rdv_total) et étiquette « Infos collectées » des conversations récentes', () => {
  wrap();
  expect(screen.getByText('Rendez-vous')).toBeInTheDocument();
  expect(screen.getByText('9')).toBeInTheDocument();
  expect(screen.getByText('Infos collectées')).toBeInTheDocument();
  expect(screen.queryByText('Qualifiés')).not.toBeInTheDocument();
  expect(screen.queryByText('qualifié')).not.toBeInTheDocument();
});

test('encarts Statut, Numéro WhatsApp et Accès limité présents', () => {
  wrap();
  expect(screen.getByRole('heading', { name: 'Statut' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Numéro WhatsApp' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Accès limité' })).toBeInTheDocument();
});

test('chargement : les trois encarts gardent leur titre, en squelette', () => {
  const { container } = wrap(null);
  for (const title of ['Statut', 'Numéro WhatsApp', 'Accès limité']) expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
  expect(container.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(8);
});

test('lecture seule : ni Simuler ni raccourci du simulateur, ni bouton de statut, de numéro ou de liste', () => {
  session.readOnly = true;
  wrap();
  expect(screen.queryByRole('button', { name: /Simuler/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Tester dans le simulateur/ })).not.toBeInTheDocument();
  for (const name of ['Désactiver', 'Changer de numéro', 'Débrancher', 'Enregistrer']) {
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  }
  // L'admin garde le numéro en entier.
  expect(screen.getByText('+33 6 12 00 00 47')).toBeInTheDocument();
});

test('non admin : aucun bouton de statut ni de numéro, Simuler reste', () => {
  session.isAdmin = false;
  wrap();
  expect(screen.queryByRole('button', { name: 'Désactiver' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Changer de numéro' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Simuler/ })).toBeInTheDocument();
});

// recette Q-10 : « Ajouter un numéro » ramène le curseur sur le champ d'ajout de l'encart Accès limité
test('recette Q-10 : accès limité à liste vide, « Ajouter un numéro » met le focus sur le champ d\'ajout', async () => {
  wrap({ ...data, bot: botView({ status: 'limited', allowlist: [] }) });
  await userEvent.click(screen.getByRole('button', { name: 'Ajouter un numéro' }));
  expect(screen.getByLabelText('Numéro à autoriser')).toHaveFocus();
});
