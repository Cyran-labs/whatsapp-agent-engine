import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { vi, test, expect, beforeEach, afterEach } from 'vitest';
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

// Le graphique montre les 7 jours du calendrier de Paris qui finissent aujourd'hui : la date du jour est fixée.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-06-02T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

function wrap(value: UsageData | null | typeof FAILED, locale: 'fr' | 'en' = 'fr') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? messages : messagesEn}>
      <CostCard usage={value} onRetry={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

// audit R-4
// recette 10 nov. 2026 : un seul vocabulaire (entrée, sortie), plus de « tokens in · out »
test('aucune mention d\'erreur : le moteur ne compte pas les appels en échec', () => {
  const { container } = wrap(usage);
  expect(container.textContent).not.toMatch(/erreur/i);
  expect(screen.getByText('184 000 tokens d\'entrée · 39 000 de sortie')).toBeInTheDocument();
});

// audit R-4
test('aucune mention d\'erreur en anglais', () => {
  const { container } = wrap(usage, 'en');
  expect(container.textContent).not.toMatch(/error/i);
  expect(screen.getByText('184,000 input tokens · 39,000 output')).toBeInTheDocument();
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

// recette 10 nov. 2026 : « Coût par jour » avec un seul jour de données, sans date ni repère
test('un seul jour de données : sept barres bornées, chacune avec sa date, la seule non nulle est ce jour', () => {
  vi.setSystemTime(new Date('2026-11-10T10:00:00Z'));
  const { container } = wrap({ ...usage, by_day: [{ day: '2026-11-09', cost_usd: 0.02, calls: 4 }] });
  const bars = [...container.querySelectorAll('[data-bar]')] as HTMLElement[];
  expect(bars).toHaveLength(7);
  expect(bars[0]!.parentElement).toHaveClass('max-w-[56px]');
  expect(bars.map((b) => b.style.height)).toEqual(['0%', '0%', '0%', '0%', '0%', '100%', '0%']);
  expect(screen.getByText('9 nov.')).toBeInTheDocument();
});

test('en anglais : date sous la barre au format anglais', () => {
  vi.setSystemTime(new Date('2026-11-10T10:00:00Z'));
  wrap({ ...usage, by_day: [{ day: '2026-11-09', cost_usd: 0.02, calls: 4 }] }, 'en');
  expect(screen.getByText('Nov 9')).toBeInTheDocument();
});

// relecture tâche 9, I-1 : le moteur ne renvoie que les jours avec au moins un appel ; « 7 derniers jours » doit être
// vrai : les 7 jours du calendrier de Paris qui finissent aujourd'hui, un jour sans appel à zéro, un jour plus ancien exclu
test('7 jours calendaires : jours manquants à zéro, jour hors de la fenêtre exclu', () => {
  vi.setSystemTime(new Date('2026-11-10T10:00:00Z'));
  const { container } = wrap({
    ...usage,
    by_day: [
      { day: '2026-10-21', cost_usd: 5, calls: 50 },
      { day: '2026-11-03', cost_usd: 9, calls: 90 },
      { day: '2026-11-05', cost_usd: 0.3, calls: 3 },
      { day: '2026-11-10', cost_usd: 0.1, calls: 1 },
    ],
  });
  const bars = [...container.querySelectorAll('[data-bar]')] as HTMLElement[];
  expect(bars.map((b) => b.style.height)).toEqual(['0%', '100%', '0%', '0%', '0%', '0%', '33%']);
  for (const label of ['4 nov.', '5 nov.', '6 nov.', '7 nov.', '8 nov.', '9 nov.', '10 nov.']) expect(screen.getByText(label)).toBeInTheDocument();
  expect(screen.queryByText('3 nov.')).not.toBeInTheDocument();
  expect(screen.queryByText('21 oct.')).not.toBeInTheDocument();
});

test('7 jours calendaires : le jour suit le calendrier de Paris (0 h 30 à Paris, encore la veille en UTC)', () => {
  vi.setSystemTime(new Date('2026-11-09T23:30:00Z'));
  wrap({ ...usage, by_day: [{ day: '2026-11-10', cost_usd: 0.1, calls: 1 }] });
  expect(screen.getByText('10 nov.')).toBeInTheDocument();
  expect(screen.queryByText('3 nov.')).not.toBeInTheDocument();
});

// prototype 7 : le graphique montre 7 jours sous un en-tête de 30 ; chacun dit sa période
test('le montant dit « 30 derniers jours », le graphique a son en-tête « 7 derniers jours »', () => {
  const { container } = wrap(usage);
  const heading = screen.getByRole('heading', { name: /Coût LLM/ });
  expect(heading).toHaveTextContent('30 derniers jours');
  expect(heading).not.toHaveTextContent('7 derniers jours');
  const chartRange = screen.getByText('7 derniers jours');
  const chart = container.querySelector('[data-bar]');
  expect(chart).not.toBeNull();
  expect(chartRange.compareDocumentPosition(chart as Element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('en anglais : « Last 30 days » pour le montant, « Last 7 days » pour le graphique', () => {
  wrap(usage, 'en');
  expect(screen.getByRole('heading', { name: /LLM Cost/ })).toHaveTextContent('Last 30 days');
  expect(screen.getByText('Last 7 days')).toBeInTheDocument();
});
