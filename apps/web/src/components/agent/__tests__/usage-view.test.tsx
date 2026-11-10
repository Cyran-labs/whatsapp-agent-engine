import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { vi, test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import messagesEn from '../../../../messages/en.json';
import { UsageView } from '../usage-view';

const usage = {
  totals: { input_tokens: 184000, output_tokens: 39000, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: 1.84, calls: 312 },
  by_model: [{ model: 'claude-haiku-4-5', calls: 268, cost_usd: 1.12, input_tokens: 152000, output_tokens: 31000 }],
  by_day: [{ day: '2026-06-01', cost_usd: 0.06, calls: 10 }, { day: '2026-06-02', cost_usd: 0.1, calls: 14 }],
};
const wrap = () => render(<NextIntlClientProvider locale="fr" messages={messages}><UsageView usage={usage} period={30} onPeriod={vi.fn()} /></NextIntlClientProvider>);

test('3 KPI rendus', () => { wrap(); expect(screen.getByText('Coût total')).toBeInTheDocument(); expect(screen.getByText('Tokens')).toBeInTheDocument(); expect(screen.getByText('Appels LLM')).toBeInTheDocument(); });
test('table par modèle + total', () => { wrap(); expect(screen.getByText('claude-haiku-4-5')).toBeInTheDocument(); expect(screen.getByText('Total')).toBeInTheDocument(); });
test('sélecteur de période', () => { wrap(); expect(screen.getByText('7 j')).toBeInTheDocument(); expect(screen.getByText('90 j')).toBeInTheDocument(); });
test('clic sur une période appelle onPeriod', async () => {
  const onPeriod = vi.fn();
  render(<NextIntlClientProvider locale="fr" messages={messages}><UsageView usage={usage} period={30} onPeriod={onPeriod} /></NextIntlClientProvider>);
  await userEvent.click(screen.getByText('7 j'));
  expect(onPeriod).toHaveBeenCalledWith(7);
});

const RATE = { rate: 0.92, date: '2026-11-09' };
const wrapWith = (value: typeof usage & { usd_eur_rate?: typeof RATE | null }, locale: 'fr' | 'en' = 'fr') =>
  render(<NextIntlClientProvider locale={locale} messages={locale === 'fr' ? messages : messagesEn}><UsageView usage={value} period={30} onPeriod={vi.fn()} /></NextIntlClientProvider>);

// audit R-4
test('« 0 erreur » n\'est plus codé en dur : aucune mention d\'erreur', () => {
  const { container } = wrap();
  expect(container.textContent).not.toMatch(/erreur/i);
  cleanup();
  const en = wrapWith(usage, 'en');
  expect(en.container.textContent).not.toMatch(/error/i);
});

// recette Q-2
test('sans taux : dollars exacts et note « Anthropic facture en dollars. », aucun euro', () => {
  const { container } = wrap();
  expect(screen.getAllByText('1,84 $').length).toBeGreaterThan(0);
  expect(screen.getByText('1,12 $')).toBeInTheDocument();
  expect(screen.getByText('Anthropic facture en dollars.')).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/€|NaN/);
});

// recette Q-2
test('avec un taux : équivalent en euros du coût total et note du taux', () => {
  wrapWith({ ...usage, usd_eur_rate: RATE });
  expect(screen.getAllByText('≈ 1,69 €').length).toBeGreaterThan(0);
  expect(screen.getByText('Anthropic facture en dollars ; équivalent en euros au taux de 0,92 du 9 novembre 2026.')).toBeInTheDocument();
});

// recette Q-2 (point d'attention 4)
test.each([0, -1, Number.NaN])('taux %s reçu : dollars seuls, jamais NaN ni 0,00 €', (rate) => {
  const { container } = wrapWith({ ...usage, usd_eur_rate: { rate, date: '2026-11-09' } });
  expect(screen.getByText('Anthropic facture en dollars.')).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/€|NaN/);
});

test('nombres de la langue : tokens et appels avec l\'espace fine des milliers', () => {
  wrap();
  expect(screen.getByText('223 000').textContent).toBe('223 000');
  expect(screen.getByText('184 000 entrée · 39 000 sortie')).toBeInTheDocument();
  expect(screen.getAllByText('312').length).toBeGreaterThan(0);
});

// recette Q-3
test('coûts tous à 0 : barres vides et mention « Aucun coût sur la période »', () => {
  const zero = { ...usage, totals: { ...usage.totals, cost_usd: 0 }, by_day: [{ day: '2026-06-01', cost_usd: 0, calls: 1 }] };
  wrapWith(zero);
  expect(screen.getByText('Aucun coût sur la période')).toBeInTheDocument();
});
