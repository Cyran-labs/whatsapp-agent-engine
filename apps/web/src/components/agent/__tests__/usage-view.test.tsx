import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import messagesEn from '../../../../messages/en.json';
import { UsageView } from '../usage-view';

const usage = {
  totals: { input_tokens: 184000, output_tokens: 39000, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: 1.84, calls: 312 },
  by_model: [{ model: 'claude-haiku-4-5', calls: 268, cost_usd: 1.12, input_tokens: 152000, output_tokens: 31000 }],
  by_day: [{ day: '2026-06-01', cost_usd: 0.06, calls: 10 }, { day: '2026-06-02', cost_usd: 0.1, calls: 14 }],
};
const wrap = () => render(<NextIntlClientProvider locale="fr" messages={messages}><UsageView usage={usage} days={30} /></NextIntlClientProvider>);

test('3 KPI rendus', () => { wrap(); expect(screen.getByText('Coût total')).toBeInTheDocument(); expect(screen.getByText('Tokens')).toBeInTheDocument(); expect(screen.getByText('Appels LLM')).toBeInTheDocument(); });
test('table par modèle + total', () => { wrap(); expect(screen.getByText('claude-haiku-4-5')).toBeInTheDocument(); expect(screen.getByText('Total')).toBeInTheDocument(); });
// spec en-tête 2.2 : le titre et le choix de période sont dans l'en-tête de la page (rendu par la page), pas dans la vue
test('ni titre ni choix de période dans la vue : ils sont dans l\'en-tête de la page', () => {
  wrap();
  expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  for (const label of ['7 j', '30 j', '90 j']) expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
});

const RATE = { rate: 0.92, date: '2026-11-09' };
const wrapWith = (value: typeof usage & { usd_eur_rate?: typeof RATE | null }, locale: 'fr' | 'en' = 'fr') =>
  render(<NextIntlClientProvider locale={locale} messages={locale === 'fr' ? messages : messagesEn}><UsageView usage={value} days={30} /></NextIntlClientProvider>);

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
  expect(screen.getByText('184 000 tokens d\'entrée · 39 000 tokens de sortie')).toBeInTheDocument();
  expect(screen.getAllByText('312').length).toBeGreaterThan(0);
});

// recette Q-3
test('coûts tous à 0 : barres vides et mention « Aucun coût sur la période »', () => {
  const zero = { ...usage, totals: { ...usage.totals, cost_usd: 0 }, by_day: [{ day: '2026-06-01', cost_usd: 0, calls: 1 }] };
  wrapWith(zero);
  expect(screen.getByText('Aucun coût sur la période')).toBeInTheDocument();
});

// recette 10 nov. 2026
test('table par modèle : en-têtes « Tokens d\'entrée » et « Tokens de sortie », plus de « Tokens in / out »', () => {
  wrap();
  expect(screen.getByRole('columnheader', { name: "Tokens d'entrée" })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Tokens de sortie' })).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/tokens (in|out)\b/i);
});

// recette 10 nov. 2026
test('graphique par jour : première et dernière date écrites sous les barres', () => {
  wrap();
  expect(screen.getByText('1 juin')).toBeInTheDocument();
  expect(screen.getByText('2 juin')).toBeInTheDocument();
});

// relecture tâche 11 (décision du contrôleur) : la vue s'aligne à gauche avec l'en-tête, jamais centrée dans la zone de
// contenu ; C-3 : pleine largeur du contenu, sans largeur maximale
test('vue alignée à gauche et pleine largeur : le bloc n\'est ni centré ni borné', () => {
  const { container } = wrap();
  const root = container.firstElementChild as HTMLElement;
  expect(root.className).not.toMatch(/\bmx-auto\b/);
  expect(root.className).not.toMatch(/\bmax-w-/);
  expect(root).toContainElement(screen.getByText('Coût total'));
});

// recette 3.9 (D-91) : la moyenne divise par la durée de la période choisie, pas par le nombre de jours d'activité
test.each([
  [7, '~0,26 $/jour'],
  [30, '~0,06 $/jour'],
  [90, '~0,02 $/jour'],
])('période de %i j : total divisé par la durée de la période (%s)', (days, text) => {
  render(<NextIntlClientProvider locale="fr" messages={messages}><UsageView usage={usage} days={days} /></NextIntlClientProvider>);
  expect(screen.getByText(text)).toBeInTheDocument();
});

// décision de François du 12 nov. 2026 (recette, remarques du bilan) : « moins de 0,01 $/jour », jamais « ~< 0,01 $/jour »
test('moyenne sous le centime : « moins de 0,01 $/jour »', () => {
  const tiny = { ...usage, totals: { ...usage.totals, cost_usd: 0.05 } };
  const { container } = render(<NextIntlClientProvider locale="fr" messages={messages}><UsageView usage={tiny} days={30} /></NextIntlClientProvider>);
  expect(screen.getByText('moins de 0,01 $/jour')).toBeInTheDocument();
  expect(container.textContent).not.toContain('~<');
});
