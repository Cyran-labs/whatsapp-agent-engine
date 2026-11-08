import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect, vi, beforeEach } from 'vitest';
import messages from '../../../../messages/fr.json';
import { Overview } from '../overview';

const session = vi.hoisted(() => ({ isAdmin: true, readOnly: false }));
vi.mock('@/components/providers/session-provider', () => ({ useSession: () => session }));

const data = {
  health: {
    status: 'active',
    numbers: ['+33'],
    languages: ['fr'],
    whatsapp: { validated: true, validated_at: null, error: null },
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

const wrap = () =>
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <Overview data={data} botId="b1" />
    </NextIntlClientProvider>,
  );

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
