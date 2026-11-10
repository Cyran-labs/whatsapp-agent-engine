import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import type { UsageRow } from '@/lib/usage';
import messages from '../../../../messages/fr.json';
import messagesEn from '../../../../messages/en.json';
import { UsageSummaryTable } from '../usage-summary-table';

const rows = [
  { bot_id: 'b1', name: 'Support', entity_id: 1, calls: 312, input_tokens: 184000, output_tokens: 39000, cost_usd: 1.84 },
  { bot_id: 'b2', name: 'Boutique', entity_id: 2, calls: 10, input_tokens: 5000, output_tokens: 1000, cost_usd: 0.1 },
];
const total = { calls: 322, input_tokens: 189000, output_tokens: 40000, cost_usd: 1.94 };
const names = new Map([[1, 'Service client'], [2, 'Boutique Lyon']]);
const wrap = (entityNames?: Map<number, string>) => render(<NextIntlClientProvider locale="fr" messages={messages}><UsageSummaryTable rows={rows} total={total} partial={false} entityNames={entityNames} /></NextIntlClientProvider>);

test('une ligne par agent', () => { wrap(); expect(screen.getByText('Support')).toBeInTheDocument(); expect(screen.getByText('Boutique')).toBeInTheDocument(); });
test('ligne Total', () => { wrap(); expect(screen.getByText('Total')).toBeInTheDocument(); expect(screen.getByText('1,94 $')).toBeInTheDocument(); });

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
  render(<NextIntlClientProvider locale="fr" messages={messages}><UsageSummaryTable rows={[{ ...rows[0], entity_id: null }]} total={total} partial={false} entityNames={names} /></NextIntlClientProvider>);
  expect(screen.queryByText('Service client')).not.toBeInTheDocument();
});

// audit R-3
test('ligne indisponible : « indisponible », jamais 0 ni 0.00 $', () => {
  render(<NextIntlClientProvider locale="fr" messages={messages}><UsageSummaryTable rows={[{ bot_id: 'b3', name: 'Panne', entity_id: 1, unavailable: true }]} total={total} partial /></NextIntlClientProvider>);
  const row = screen.getByText('Panne').closest('tr') as HTMLElement;
  expect(within(row).getByText('indisponible')).toBeInTheDocument();
  expect(within(row).queryByText(/0[.,]00/)).not.toBeInTheDocument();
});

const RATE = { rate: 0.92, date: '2026-11-09' };
const wrapWith = (props: { rows?: UsageRow[]; partial?: boolean; rate?: { rate: number; date: string } | null; locale?: 'fr' | 'en' }) => {
  const locale = props.locale ?? 'fr';
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? messages : messagesEn}>
      <UsageSummaryTable rows={props.rows ?? rows} total={total} partial={props.partial ?? false} rate={props.rate} />
    </NextIntlClientProvider>,
  );
};

// audit R-3
test('total partiel : le total s\'intitule « Total partiel » et la ligne indisponible dit « indisponible »', () => {
  wrapWith({ rows: [rows[0], { bot_id: 'b3', name: 'Panne', entity_id: 1, unavailable: true }], partial: true });
  expect(screen.getByText('Total partiel')).toBeInTheDocument();
  expect(screen.queryByText('Total')).not.toBeInTheDocument();
  const row = screen.getByText('Panne').closest('tr') as HTMLElement;
  expect(within(row).getByText('indisponible')).toHaveClass('text-muted');
});

// audit R-3
test('total partiel en anglais', () => {
  wrapWith({ rows: [{ bot_id: 'b3', name: 'Panne', entity_id: 1, unavailable: true }], partial: true, locale: 'en' });
  expect(screen.getByText('Partial total')).toBeInTheDocument();
  expect(screen.getByText('unavailable')).toBeInTheDocument();
});

// audit R-3
test('total complet : « Total » sans « partiel »', () => {
  wrapWith({});
  expect(screen.getByText('Total')).toBeInTheDocument();
  expect(screen.queryByText(/partiel/i)).not.toBeInTheDocument();
});

// recette Q-2
test('avec un taux : dollars exacts, équivalent en euros et note du taux', () => {
  wrapWith({ rate: RATE });
  const totalRow = screen.getByText('Total').closest('tr') as HTMLElement;
  expect(within(totalRow).getByText('1,94 $')).toBeInTheDocument();
  expect(within(totalRow).getByText('≈ 1,78 €')).toBeInTheDocument();
  expect(screen.getByText('Anthropic facture en dollars ; équivalent en euros au taux de 0,92 du 9 novembre 2026.')).toBeInTheDocument();
});

// recette Q-2
test('sans taux : dollars seuls, note « Anthropic facture en dollars. », aucun euro', () => {
  const { container } = wrapWith({ rate: null });
  expect(screen.getByText('Anthropic facture en dollars.')).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/€|NaN/);
});

// recette Q-2 (point d'attention 4 : taux reçu illisible)
test.each([0, -1, Number.NaN])('taux %s reçu : dollars seuls, jamais NaN ni 0,00 €', (rate) => {
  const { container } = wrapWith({ rate: { rate, date: '2026-11-09' } });
  expect(screen.getByText('Anthropic facture en dollars.')).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/€|NaN/);
});

test('nombres : espace fine des milliers en français, virgule en anglais', () => {
  wrapWith({});
  const cell = screen.getByText('184 000');
  expect(cell.textContent).toBe('184\u202f000');
  cleanup();
  wrapWith({ locale: 'en' });
  expect(screen.getByText('184,000')).toBeInTheDocument();
  expect(screen.getAllByText('$1.84').length).toBeGreaterThan(0);
});

// tâche 15 : l'identifiant d'un agent IA est encodé dans le lien, jamais interprété comme un chemin
test("lien de l'usage d'un agent IA : identifiant encodé", () => {
  render(<NextIntlClientProvider locale="fr" messages={messages}><UsageSummaryTable rows={[{ ...rows[0]!, bot_id: 'a/b?c#d' }]} total={total} partial={false} /></NextIntlClientProvider>);
  expect(screen.getByRole('link', { name: 'Support' })).toHaveAttribute('href', '/fr/agents/a%2Fb%3Fc%23d/usage');
});
