import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { vi, test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import messagesEn from '../../../../messages/en.json';
import type { UsageData } from '@/lib/agent-types';
import { CostCard } from '../cost-card';
import { FAILED } from '../panel-ui';

const usage: UsageData = {
  totals: { input_tokens: 184000, output_tokens: 39000, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: 1.84, calls: 312 },
  by_model: [],
  by_day: [{ day: '2026-06-01', cost_usd: 0.06, calls: 10 }, { day: '2026-06-02', cost_usd: 0.1, calls: 14 }],
};
const RATE = { rate: 0.92, date: '2026-11-09' };

function wrap(value: UsageData | null | typeof FAILED, locale: 'fr' | 'en' = 'fr') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? messages : messagesEn}>
      <CostCard usage={value} onRetry={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

// audit R-4
test('aucune mention d\'erreur : le moteur ne compte pas les appels en échec', () => {
  const { container } = wrap(usage);
  expect(container.textContent).not.toMatch(/erreur/i);
  expect(screen.getByText('184 000 tokens in · 39 000 out')).toBeInTheDocument();
});

// audit R-4
test('aucune mention d\'erreur en anglais', () => {
  const { container } = wrap(usage, 'en');
  expect(container.textContent).not.toMatch(/error/i);
  expect(screen.getByText('184,000 tokens in · 39,000 out')).toBeInTheDocument();
});

// recette Q-2
test('sans taux : dollars exacts, moyenne par jour en dollars, note « Anthropic facture en dollars. », aucun euro', () => {
  const { container } = wrap(usage);
  expect(screen.getByText('1,84 $')).toBeInTheDocument();
  expect(screen.getByText('~0,92 $/jour')).toBeInTheDocument();
  expect(screen.getByText('Anthropic facture en dollars.')).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/€|NaN/);
});

// recette Q-2
test('avec un taux : dollars, équivalent en euros et note avec le taux et sa date', () => {
  wrap({ ...usage, usd_eur_rate: RATE });
  expect(screen.getByText('1,84 $')).toBeInTheDocument();
  expect(screen.getByText('≈ 1,69 €')).toBeInTheDocument();
  expect(screen.getByText('Anthropic facture en dollars ; équivalent en euros au taux de 0,92 du 9 novembre 2026.')).toBeInTheDocument();
});

// recette Q-2 (point d'attention 4)
test.each([0, -1, Number.NaN])('taux %s reçu : dollars seuls, jamais NaN ni 0,00 €', (rate) => {
  const { container } = wrap({ ...usage, usd_eur_rate: { rate, date: '2026-11-09' } });
  expect(screen.getByText('Anthropic facture en dollars.')).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/€|NaN/);
});

// recette Q-2
test('en anglais : « $1.84 », « ≈ €1.69 » et la note anglaise', () => {
  wrap({ ...usage, usd_eur_rate: RATE }, 'en');
  expect(screen.getByText('$1.84')).toBeInTheDocument();
  expect(screen.getByText('≈ €1.69')).toBeInTheDocument();
  expect(screen.getByText('Anthropic bills in dollars; euro equivalent at the rate of 0.92 from November 9, 2026.')).toBeInTheDocument();
});

// recette Q-3
test('tous les coûts à 0 : barres vides et mention « Aucun coût sur la période »', () => {
  const { container } = wrap({ ...usage, totals: { ...usage.totals, cost_usd: 0 }, by_day: [{ day: '2026-06-01', cost_usd: 0, calls: 1 }, { day: '2026-06-02', cost_usd: 0, calls: 1 }] });
  expect(screen.getByText('Aucun coût sur la période')).toBeInTheDocument();
  container.querySelectorAll('[data-bar]').forEach((b) => expect((b as HTMLElement).style.height).toBe('0%'));
  expect(container.querySelectorAll('.bg-accent')).toHaveLength(0);
});

test('un coût positif : pas de mention d\'absence de coût', () => {
  wrap(usage);
  expect(screen.queryByText('Aucun coût sur la période')).not.toBeInTheDocument();
});

// audit R-17 (conservé) : lecture en échec, jamais un montant à zéro
test('lecture en échec : « Coûts indisponibles », ni montant ni note de monnaie', () => {
  const { container } = wrap(FAILED);
  expect(screen.getByText('Coûts indisponibles')).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/\$|€/);
});

// recette Q-2 : un petit coût réel n'est jamais présenté comme nul
test('coût de 0,004 $ : « < 0,01 $ » et « < 0,01 € » avec un taux, jamais « 0,00 »', () => {
  const { container } = wrap({ ...usage, totals: { ...usage.totals, cost_usd: 0.004 }, usd_eur_rate: RATE });
  expect(screen.getByText('< 0,01 $')).toBeInTheDocument();
  expect(screen.getByText('< 0,01 €')).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/0,00/);
});
