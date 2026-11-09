import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect, vi, beforeEach } from 'vitest';
import messages from '../../../../messages/fr.json';
import { Overview } from '../overview';

const session = vi.hoisted(() => ({ isAdmin: true, readOnly: false }));
vi.mock('@/components/providers/session-provider', () => ({ useSession: () => session }));

// Forme réelle de `GET /bots/:botId/health` (BotHealth du moteur).
const NUMBER = {
  id: 4, phone_e164: '+33612000047', display_name: 'Boutique', is_test: false, provider_state: 'present', quality: 'GREEN',
  account: { id: 1, name: 'Compte principal', mode: 'meta_manual', state: 'connected', error_reason: null },
} as const;

const data = {
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
  recent: [{ phone: '+33', name: 'ML', last: 'Bonjour', qualified: true, when: '2 min' }],
};

beforeEach(() => { session.isAdmin = true; session.readOnly = false; });

type Data = Parameters<typeof Overview>[0]['data'];
const wrap = (d: Data = data) =>
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <Overview data={d} botId="b1" />
    </NextIntlClientProvider>,
  );

test('numéro branché affiché masqué, WhatsApp connecté quand son compte est connecté', () => {
  wrap();
  expect(screen.getByText(/\+33612 •• •• 47/)).toBeInTheDocument();
  expect(screen.queryByText(/\+33612000047/)).not.toBeInTheDocument();
  expect(screen.getByText('Connecté')).toBeInTheDocument();
});

test('sans numéro branché : la page se rend, WhatsApp non connecté', () => {
  wrap({ ...data, health: { ...data.health, whatsapp: { number: null } } });
  expect(screen.getByText('Santé')).toBeInTheDocument();
  expect(screen.queryByText(/\+33612000047/)).not.toBeInTheDocument();
  expect(screen.getAllByText('Non connecté').length).toBeGreaterThanOrEqual(1);
});

test("compte du numéro en erreur (signatures rejetées) : WhatsApp non connecté", () => {
  const number = { ...NUMBER, account: { ...NUMBER.account, state: 'error' as const, error_reason: 'signature_rejected' as const } };
  wrap({ ...data, health: { ...data.health, whatsapp: { number } } });
  expect(screen.getAllByText('Non connecté').length).toBeGreaterThanOrEqual(1);
  expect(screen.queryByText('Connecté')).not.toBeInTheDocument();
});

test('santé + stats rendues', () => {
  wrap();
  expect(screen.getByText('Santé')).toBeInTheDocument();
  expect(screen.getByText('142')).toBeInTheDocument();
  expect(screen.getByText('23')).toBeInTheDocument();
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

test('admin : Simuler et Mettre en pause présents', () => {
  wrap();
  expect(screen.getByRole('button', { name: /Simuler/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Mettre en pause/ })).toBeDisabled();
});

test('lecture seule : ni Simuler ni raccourci du simulateur', () => {
  session.readOnly = true;
  wrap();
  expect(screen.queryByRole('button', { name: /Simuler/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Tester dans le simulateur/ })).not.toBeInTheDocument();
});

test('non admin : pas de bouton de pause, Simuler reste', () => {
  session.isAdmin = false;
  wrap();
  expect(screen.queryByRole('button', { name: /Mettre en pause/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Simuler/ })).toBeInTheDocument();
});
