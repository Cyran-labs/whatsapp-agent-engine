import { Suspense } from 'react';
import { act, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { vi, beforeEach, test, expect } from 'vitest';
import messages from '../../../../../../../messages/fr.json';
import OverviewPage from '../page';
import UsagePage from '../usage/page';

const session = vi.hoisted(() => ({ isAdmin: true, readOnly: false }));
vi.mock('@/components/providers/session-provider', () => ({ useSession: () => session }));

const HEALTH = {
  status: 'active', numbers: ['+33612000047'], languages: ['fr'],
  whatsapp: { validated: true, validated_at: null, error: null },
  crm: { configured: false, connector: null, last_error: null, last_error_at: null },
  llm: { mode: 'platform', key_configured: false },
};
const METRICS = { leads_total: 23, rdv_total: 9, conversations_total: 40, messages_total: 142 };
const USAGE = {
  totals: { input_tokens: 184000, output_tokens: 39000, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: 1.84, calls: 312 },
  by_model: [{ model: 'claude-haiku', calls: 312, input_tokens: 184000, output_tokens: 39000, cost_usd: 1.84 }],
  by_day: [{ day: '2026-11-01', cost_usd: 1.84, calls: 312 }],
};

/** Réponses retenues jusqu'à `release()`. */
function gatedFetch() {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    await gate;
    if (url.includes('/health')) return new Response(JSON.stringify(HEALTH), { status: 200 });
    if (url.includes('/metrics')) return new Response(JSON.stringify(METRICS), { status: 200 });
    if (url.includes('/usage')) return new Response(JSON.stringify(USAGE), { status: 200 });
    if (url.includes('/leads')) return new Response(JSON.stringify({ leads: [] }), { status: 200 });
    return new Response('{}', { status: 404 });
  }));
  return () => release();
}

async function renderPage(node: React.ReactNode) {
  let result: ReturnType<typeof render> | undefined;
  await act(async () => {
    result = render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <Suspense fallback={null}>{node}</Suspense>
      </NextIntlClientProvider>,
    );
  });
  return result!;
}

beforeEach(() => {
  vi.restoreAllMocks();
  session.isAdmin = true;
  session.readOnly = false;
});

test('vue d\'ensemble : panneaux Santé, Dernières conversations, Coût et Raccourcis en squelette, puis le contenu', async () => {
  const release = gatedFetch();
  const { container } = await renderPage(<OverviewPage params={Promise.resolve({ botId: 'b1' })} />);
  for (const title of ['Santé', 'Dernières conversations', 'Coût LLM', 'Raccourcis']) {
    expect(screen.getByText(title)).toBeInTheDocument();
  }
  expect(container.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(8);
  expect(container.textContent).not.toMatch(/…|Chargement/);
  release();
  expect(await screen.findByText('142')).toBeInTheDocument();
  expect(container.querySelectorAll('[data-skeleton]')).toHaveLength(0);
});

test('usage de l\'agent IA : titre et périodes réels, indicateurs, graphique et tableau en squelette, puis le contenu', async () => {
  const release = gatedFetch();
  const { container } = await renderPage(<UsagePage params={Promise.resolve({ botId: 'b1' })} />);
  expect(screen.getByRole('heading', { name: 'Usage & coûts' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '30 j' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Modèle' })).toBeInTheDocument();
  expect(container.querySelectorAll('tbody tr[data-skeleton-row]')).toHaveLength(3);
  expect(container.textContent).not.toMatch(/…|Chargement/);
  release();
  expect(await screen.findByText('claude-haiku')).toBeInTheDocument();
  expect(container.querySelectorAll('[data-skeleton]')).toHaveLength(0);
});
