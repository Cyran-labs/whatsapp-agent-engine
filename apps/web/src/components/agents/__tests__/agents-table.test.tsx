import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import { AgentsTable } from '../agents-table';
import type { AgentSummaryRow } from '@/lib/onboarding';

const rows: AgentSummaryRow[] = [
  { bot_id: 'b1', name: 'Support', slug: 'support', status: 'active', languages: ['fr'], default_language: 'fr', number: '+33612000047', connected: true, messages_total: 142, leads_total: 23, personalized: true, entity_id: 1 },
  { bot_id: 'b2', name: 'Boutique', slug: 'boutique', status: 'draft', languages: ['fr', 'en'], default_language: 'fr', number: null, connected: false, messages_total: 0, leads_total: 0, personalized: false, entity_id: 2 },
];
const wrap = (entityNames?: Map<number, string>) => render(<NextIntlClientProvider locale="fr" messages={messages}><AgentsTable rows={rows} entityNames={entityNames} /></NextIntlClientProvider>);

test('rend une ligne par agent + lien vers l espace agent', () => {
  wrap();
  expect(screen.getByText('Support')).toBeInTheDocument();
  expect(screen.getByText('Boutique')).toBeInTheDocument();
  expect(screen.getAllByRole('link').some((a) => a.getAttribute('href')?.includes('/agents/b1'))).toBe(true);
});
test('agent non connecté → mention non connecté', () => {
  wrap();
  expect(screen.getByText('non connecté')).toBeInTheDocument();
});
test('numéro branché affiché masqué au format E.164', () => {
  wrap();
  expect(screen.getByText('+33612 •• •• 47')).toBeInTheDocument();
  expect(screen.queryByText(/\+33612000047/)).not.toBeInTheDocument();
});
test('métriques affichées', () => { wrap(); expect(screen.getByText('142')).toBeInTheDocument(); expect(screen.getByText('23')).toBeInTheDocument(); });
test('agent non connecté → 0 message et 0 lead, jamais de tiret', () => {
  wrap();
  expect(screen.getAllByText('0')).toHaveLength(2);
  expect(document.body.textContent).not.toMatch(/[—–]/);
});

test('sans entityNames : pas de colonne Entité', () => {
  wrap();
  expect(screen.queryByRole('columnheader', { name: 'Entité' })).not.toBeInTheDocument();
});
test('avec entityNames : colonne Entité et pastille du nom par ligne', () => {
  wrap(new Map([[1, 'Service client'], [2, 'Boutique Lyon']]));
  expect(screen.getByRole('columnheader', { name: 'Entité' })).toBeInTheDocument();
  expect(screen.getByText('Service client')).toBeInTheDocument();
  expect(screen.getByText('Boutique Lyon')).toBeInTheDocument();
});
test('entité inconnue : cellule vide, pas de plantage', () => {
  wrap(new Map([[1, 'Service client']]));
  expect(screen.getByText('Service client')).toBeInTheDocument();
  expect(screen.queryByText('Boutique Lyon')).not.toBeInTheDocument();
});

// audit R-3
test('compteurs inconnus (lecture en échec) : « indisponible », jamais 0', () => {
  const unknown: AgentSummaryRow[] = [{ ...rows[0]!, messages_total: null, leads_total: null }];
  render(<NextIntlClientProvider locale="fr" messages={messages}><AgentsTable rows={unknown} /></NextIntlClientProvider>);
  expect(screen.getAllByText('indisponible')).toHaveLength(2);
  expect(screen.queryByText('0')).not.toBeInTheDocument();
});

// audit R-3 : l'inconnu passe par PartialValue (texte discret), un chiffre connu garde le format de la langue
test('compteur inconnu : valeur partielle discrète, compteur connu avec espace fine des milliers', () => {
  const mixed: AgentSummaryRow[] = [{ ...rows[0]!, messages_total: 12345, leads_total: null }];
  render(<NextIntlClientProvider locale="fr" messages={messages}><AgentsTable rows={mixed} /></NextIntlClientProvider>);
  expect(screen.getByText('indisponible')).toHaveClass('text-muted');
  expect(screen.getByText('12 345').textContent).toBe('12 345');
});

// tâche 15 : l'identifiant d'un agent IA est encodé dans le lien, jamais interprété comme un chemin
test("lien de l'agent IA : identifiant encodé", () => {
  render(<NextIntlClientProvider locale="fr" messages={messages}><AgentsTable rows={[{ ...rows[0]!, bot_id: 'a/b?c#d' }]} /></NextIntlClientProvider>);
  expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/fr/agents/a%2Fb%3Fc%23d']);
});
