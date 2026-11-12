import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect, vi } from 'vitest';
import type { NotRespondingReason } from '@wabagent/contracts';
import messages from '../../../../messages/fr.json';
import en from '../../../../messages/en.json';
import type { BotHealth } from '@/lib/agent-types';
import { HealthPanel } from '../health-panel';
import { botNumber } from './fixtures';

const HEALTH: BotHealth = {
  status: 'active',
  status_reason: null,
  languages: ['fr'],
  whatsapp: { number: botNumber() },
  crm: { configured: true, connector: 'hubspot', last_error: null, last_error_at: null },
  llm: { mode: 'platform', key_configured: false },
};
const METRICS = { leads_total: 1, rdv_total: 0, conversations_total: 2, messages_total: 3 };

function wrap(notResponding: NotRespondingReason | null, locale: 'fr' | 'en' = 'fr', health: BotHealth = HEALTH) {
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? messages : en}>
      <HealthPanel health={health} metrics={METRICS} onRetryHealth={vi.fn()} onRetryMetrics={vi.fn()} notResponding={notResponding} />
    </NextIntlClientProvider>,
  );
  return screen.getByRole('heading', { level: 3, name: /Santé|Health/ });
}

// recette 3.4 : étiquette rouge « Ne répond pas » dans l'en-tête du panneau, plus de ligne de texte rouge
test.each(['no_number', 'number_removed', 'account_not_connected', 'organization_suspended'] as const)(
  'recette 3.4 : %s, étiquette rouge « Ne répond pas » dans l\'en-tête de Santé',
  (reason) => {
    const title = wrap(reason);
    const label = title.querySelector('[data-mention="danger"]') as HTMLElement;
    expect(label).toHaveTextContent(/^Ne répond pas$/);
    expect(label.className).toContain('bg-danger-soft');
    expect(label.className).toContain('text-danger-ink');
    expect(title).not.toHaveTextContent("voir l'encart Statut");
    expect(title).not.toHaveTextContent('tout est opérationnel');
    expect(screen.queryByText('Whitelist vide')).not.toBeInTheDocument();
  },
);

// recette 3.5 : Whitelist vide, étiquette neutre, aucune classe danger dans l'en-tête
test('recette 3.5 : empty_allowlist, étiquette neutre « Whitelist vide », sans rouge', () => {
  const title = wrap('empty_allowlist');
  const label = title.querySelector('[data-mention="neutral"]') as HTMLElement;
  expect(label).toHaveTextContent(/^Whitelist vide$/);
  expect(label.className).toContain('border-border-strong');
  expect(label.className).toContain('text-muted');
  expect(title.innerHTML).not.toMatch(/danger/);
  expect(title).not.toHaveTextContent('Ne répond pas');
  expect(title).not.toHaveTextContent('tout est opérationnel');
});

test('agent IA qui répond : « tout est opérationnel », aucune étiquette', () => {
  const title = wrap(null);
  expect(title).toHaveTextContent('tout est opérationnel');
  expect(title.querySelector('[data-mention]')).toBeNull();
});

test('en anglais : « Not responding »', () => {
  expect(wrap('no_number', 'en')).toHaveTextContent('Not responding');
});

// décision de François du 12 nov. 2026 (recette P-11) : un Draft sans numéro n'est pas une panne ; l'en-tête « à vérifier »
// prend un ton neutre, le rouge reste à la mention « Ne répond pas » (hors Whitelist vide)
test.each(['draft', 'paused'] as const)('agent IA %s sans numéro : « à vérifier » neutre, sans rouge dans l\'en-tête', (status) => {
  const title = wrap(null, 'fr', { ...HEALTH, status, whatsapp: { number: null } });
  expect(title).toHaveTextContent('à vérifier');
  expect(title.innerHTML).not.toMatch(/danger/);
  const label = title.querySelector('[data-health-summary]') as HTMLElement;
  expect(label).toHaveTextContent(/^à vérifier$/);
  expect(label.className).toContain('text-muted');
  expect(label.className).not.toContain('text-muted-2');
});

test('agent IA en service avec un problème : « à vérifier » reste rouge', () => {
  const title = wrap(null, 'fr', { ...HEALTH, whatsapp: { number: null } });
  const label = title.querySelector('[data-health-summary]') as HTMLElement;
  expect(label).toHaveTextContent(/^à vérifier$/);
  expect(label.className).toContain('text-danger');
});
