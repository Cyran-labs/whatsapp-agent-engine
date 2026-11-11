import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import { AgentsTable } from '../agents-table';
import type { AgentSummaryRow } from '@/lib/onboarding';

const rows: AgentSummaryRow[] = [
  { bot_id: 'b1', name: 'Support', slug: 'support', status: 'active', languages: ['fr'], default_language: 'fr', number: '+33612000047', connected: true, status_reason: null, not_responding: null, account_state: 'connected', messages_total: 142, leads_total: 23, personalized: true, entity_id: 1 },
  { bot_id: 'b2', name: 'Boutique', slug: 'boutique', status: 'draft', languages: ['fr', 'en'], default_language: 'fr', number: null, connected: false, status_reason: null, not_responding: null, account_state: null, messages_total: 0, leads_total: 0, personalized: false, entity_id: 2 },
];
const wrap = (entityNames?: Map<number, string>) => render(<NextIntlClientProvider locale="fr" messages={messages}><AgentsTable rows={rows} entityNames={entityNames} /></NextIntlClientProvider>);

test('rend une ligne par agent + lien vers l espace agent', () => {
  wrap();
  expect(screen.getByText('Support')).toBeInTheDocument();
  expect(screen.getByText('Boutique')).toBeInTheDocument();
  expect(screen.getAllByRole('link').some((a) => a.getAttribute('href')?.includes('/agents/b1'))).toBe(true);
});
test('agent sans numéro → mention « Aucun numéro »', () => {
  wrap();
  expect(screen.getByText('Aucun numéro')).toBeInTheDocument();
});
// prototype 15, spec 8 : le numéro de l'agent IA est celui de la société, en entier pour tous, au format d'affichage
test('numéro branché affiché en entier par formatPhone, jamais masqué', () => {
  wrap();
  expect(screen.getByText('+33 6 12 00 00 47')).toBeInTheDocument();
  expect(document.body.textContent).not.toContain('••');
});
test('métriques affichées', () => { wrap(); expect(screen.getByText('142')).toBeInTheDocument(); expect(screen.getByText('23')).toBeInTheDocument(); });
// recette 10 nov. 2026 : un agent IA débranché affichait 0 message et 0 lead alors que ses compteurs existent.
test('agent sans numéro : ses vrais compteurs sont affichés, pas 0', () => {
  const noNumber: AgentSummaryRow[] = [{ ...rows[1]!, messages_total: 9, leads_total: 1 }];
  render(<NextIntlClientProvider locale="fr" messages={messages}><AgentsTable rows={noNumber} /></NextIntlClientProvider>);
  expect(screen.getByText('Aucun numéro')).toBeInTheDocument();
  const cells = screen.getAllByRole('cell');
  expect(cells.some((c) => c.textContent === '9')).toBe(true);
  expect(cells.some((c) => c.textContent === '1')).toBe(true);
  expect(screen.queryByText('0')).not.toBeInTheDocument();
});
test('agent sans numéro dont les compteurs valent vraiment 0 : 0 affiché, jamais de tiret', () => {
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

// prototype 1 : un agent IA Preview muet porte « Ne répond pas » à côté de sa pastille, le motif en bulle
test('Preview qui ne répond pas : pastille Preview et mention « Ne répond pas » dans la colonne Statut', async () => {
  const muted: AgentSummaryRow[] = [{ ...rows[0]!, status: 'limited', not_responding: 'account_not_connected', account_state: 'error' }];
  render(<NextIntlClientProvider locale="fr" messages={messages}><AgentsTable rows={muted} /></NextIntlClientProvider>);
  const cell = screen.getByText('Preview').closest('td')!;
  const mention = screen.getByText('Ne répond pas');
  expect(cell).toContainElement(mention);
  mention.focus();
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Ne répond pas : compte WhatsApp en erreur');
});

test('agent IA qui répond : pas de mention', () => {
  wrap();
  expect(screen.getByText('Online')).toBeInTheDocument();
  expect(screen.queryByText('Ne répond pas')).not.toBeInTheDocument();
});

// spec 6.1 : Offline toujours suivi de son motif
test('Offline : motif à côté de la pastille, jamais le code brut', () => {
  const offline: AgentSummaryRow[] = [
    { ...rows[0]!, bot_id: 'p1', status: 'paused', status_reason: 'number_unassigned' },
    { ...rows[0]!, bot_id: 'p2', name: 'Manuel', status: 'paused', status_reason: null },
  ];
  render(<NextIntlClientProvider locale="fr" messages={messages}><AgentsTable rows={offline} /></NextIntlClientProvider>);
  const [first, second] = screen.getAllByText('Offline').map((p) => p.closest('td')!);
  expect(first).toHaveTextContent('Numéro débranché');
  expect(second).toHaveTextContent('Arrêté par un administrateur');
  expect(document.body.textContent).not.toContain('number_unassigned');
});

// relecture tâche 7, M-2 : un motif inconnu relayé par le BFF n'affiche ni mention ni clé de traduction
test('motif de mention inconnu : ni mention ni texte technique', () => {
  const odd = [{ ...rows[0]!, not_responding: 'motif_futur' }] as unknown as AgentSummaryRow[];
  render(<NextIntlClientProvider locale="fr" messages={messages}><AgentsTable rows={odd} /></NextIntlClientProvider>);
  expect(screen.getByText('Online')).toBeInTheDocument();
  expect(screen.queryByText('Ne répond pas')).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain('motif_futur');
});
