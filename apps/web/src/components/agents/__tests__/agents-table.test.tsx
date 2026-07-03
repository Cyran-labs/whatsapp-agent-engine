import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import { AgentsTable } from '../agents-table';
import type { AgentSummaryRow } from '@/lib/onboarding';

const rows: AgentSummaryRow[] = [
  { bot_id: 'b1', name: 'Support', slug: 'support', status: 'active', languages: ['fr'], default_language: 'fr', numbers: ['+33612000047'], messages_total: 142, leads_total: 23, personalized: true },
  { bot_id: 'b2', name: 'Boutique', slug: 'boutique', status: 'draft', languages: ['fr', 'en'], default_language: 'fr', numbers: [], messages_total: 0, leads_total: 0, personalized: false },
];
const wrap = () => render(<NextIntlClientProvider locale="fr" messages={messages}><AgentsTable rows={rows} /></NextIntlClientProvider>);

test('rend une ligne par agent + lien vers l espace agent', () => {
  wrap();
  expect(screen.getByText('Support')).toBeInTheDocument();
  expect(screen.getByText('Boutique')).toBeInTheDocument();
  expect(screen.getAllByRole('link').some((a) => a.getAttribute('href')?.includes('/agents/b1'))).toBe(true);
});
test('agent non connecté → mention non connecté', () => {
  wrap();
  expect(screen.getByText('— non connecté')).toBeInTheDocument();
});
test('métriques affichées', () => { wrap(); expect(screen.getByText('142')).toBeInTheDocument(); expect(screen.getByText('23')).toBeInTheDocument(); });
