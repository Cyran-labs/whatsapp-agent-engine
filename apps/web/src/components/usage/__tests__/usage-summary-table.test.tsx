import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import { UsageSummaryTable } from '../usage-summary-table';

const rows = [
  { bot_id: 'b1', name: 'Support', entity_id: 1, calls: 312, input_tokens: 184000, output_tokens: 39000, cost_usd: 1.84 },
  { bot_id: 'b2', name: 'Boutique', entity_id: 2, calls: 10, input_tokens: 5000, output_tokens: 1000, cost_usd: 0.1 },
];
const total = { calls: 322, input_tokens: 189000, output_tokens: 40000, cost_usd: 1.94 };
const names = new Map([[1, 'Service client'], [2, 'Boutique Lyon']]);
const wrap = (entityNames?: Map<number, string>) => render(<NextIntlClientProvider locale="fr" messages={messages}><UsageSummaryTable rows={rows} total={total} entityNames={entityNames} /></NextIntlClientProvider>);

test('une ligne par agent', () => { wrap(); expect(screen.getByText('Support')).toBeInTheDocument(); expect(screen.getByText('Boutique')).toBeInTheDocument(); });
test('ligne Total', () => { wrap(); expect(screen.getByText('Total')).toBeInTheDocument(); expect(screen.getByText(/1[.,]94/)).toBeInTheDocument(); });

test('sans entityNames : pas de colonne Entité', () => {
  wrap();
  expect(screen.queryByRole('columnheader', { name: 'Entité' })).not.toBeInTheDocument();
  expect(screen.queryByText('Service client')).not.toBeInTheDocument();
});
test('avec entityNames : colonne Entité, pastille par ligne, total sur deux colonnes', () => {
  wrap(names);
  expect(screen.getByRole('columnheader', { name: 'Entité' })).toBeInTheDocument();
  const support = screen.getByText('Support').closest('tr') as HTMLElement;
  expect(within(support).getByText('Service client')).toBeInTheDocument();
  const totalRow = screen.getByText('Total').closest('tr') as HTMLElement;
  expect(screen.getByText('Total')).toHaveAttribute('colspan', '2');
  expect(within(totalRow).getByText(/1[.,]94/)).toBeInTheDocument();
});
test('ligne dont l entité est inconnue : cellule Entité vide', () => {
  render(<NextIntlClientProvider locale="fr" messages={messages}><UsageSummaryTable rows={[{ ...rows[0], entity_id: null }]} total={total} entityNames={names} /></NextIntlClientProvider>);
  expect(screen.queryByText('Service client')).not.toBeInTheDocument();
});

// audit R-3
test('ligne indisponible : « indisponible », jamais 0 ni 0.00 $', () => {
  render(<NextIntlClientProvider locale="fr" messages={messages}><UsageSummaryTable rows={[{ bot_id: 'b3', name: 'Panne', entity_id: 1, unavailable: true }]} total={total} /></NextIntlClientProvider>);
  const row = screen.getByText('Panne').closest('tr') as HTMLElement;
  expect(within(row).getByText('indisponible')).toBeInTheDocument();
  expect(within(row).queryByText(/0[.,]00/)).not.toBeInTheDocument();
});
