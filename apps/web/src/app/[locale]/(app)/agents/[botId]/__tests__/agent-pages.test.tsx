import { Suspense } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { vi, beforeEach, test, expect } from 'vitest';
import messages from '../../../../../../../messages/fr.json';
import OverviewPage from '../page';
import UsagePage from '../usage/page';

const session = vi.hoisted(() => ({ isAdmin: true, readOnly: false }));
vi.mock('@/components/providers/session-provider', () => ({ useSession: () => session }));

// Forme réelle de `GET /bots/:botId/health` (BotHealth du moteur).
const HEALTH = {
  status: 'active', status_reason: null, languages: ['fr'],
  whatsapp: {
    number: {
      id: 4, phone_e164: '+33612000047', display_name: 'Boutique', is_test: false, provider_state: 'present', quality: 'GREEN',
      account: { id: 1, name: 'Compte principal', mode: 'meta_manual', state: 'connected', error_reason: null },
    },
  },
  crm: { configured: false, connector: null, last_error: null, last_error_at: null },
  llm: { mode: 'platform', key_configured: false },
};
const BOT = {
  bot_id: 'b1', name: 'Conseil Marais', status: 'active', status_reason: null, entity_id: 1,
  whatsapp_number: HEALTH.whatsapp.number, allowlist: ['+33611111111'], unserved: { count: 2, last_at: '2026-11-08T12:00:00.000Z' },
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
    if (url === '/api/bots/b1') return new Response(JSON.stringify(BOT), { status: 200 });
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
  expect(screen.getByText('+33 6 12 00 00 47')).toBeInTheDocument();
  expect(screen.getByText(/2 messages non servis/)).toBeInTheDocument();
  expect(screen.getByLabelText('Numéro à autoriser')).toBeInTheDocument();
});

test('changement de statut : PUT /status puis la page relit l\'agent IA et la santé, sans écran de chargement', async () => {
  let status = 'active';
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url === '/api/bots/b1/status') { status = 'paused'; return new Response(JSON.stringify({ ...BOT, status }), { status: 200 }); }
    if (url === '/api/bots/b1') return new Response(JSON.stringify({ ...BOT, status }), { status: 200 });
    if (url.includes('/health')) return new Response(JSON.stringify({ ...HEALTH, status }), { status: 200 });
    if (url.includes('/metrics')) return new Response(JSON.stringify(METRICS), { status: 200 });
    if (url.includes('/usage')) return new Response(JSON.stringify(USAGE), { status: 200 });
    if (url.includes('/leads')) return new Response(JSON.stringify({ leads: [] }), { status: 200 });
    return new Response('{}', { status: 404 });
  }));
  const { container } = await renderPage(<OverviewPage params={Promise.resolve({ botId: 'b1' })} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Mettre en pause' }));
  expect(await screen.findByRole('button', { name: 'Reprendre en accès limité' })).toBeInTheDocument();
  expect(calls).toContain('PUT /api/bots/b1/status');
  expect(calls.filter((c) => c === 'GET /api/bots/b1')).toHaveLength(2);
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

function failingFetch(status: number) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'x' } }), { status })));
}

test('agent IA d\'une autre organisation (404 du BFF) : état « introuvable » avec lien vers la liste, sans plantage', async () => {
  failingFetch(404);
  await renderPage(<OverviewPage params={Promise.resolve({ botId: 'autre-org' })} />);
  expect(await screen.findByText('Agent IA introuvable.')).toBeInTheDocument();
  const link = screen.getByRole('link', { name: 'Retour aux agents IA' });
  expect(link).toHaveAttribute('href', '/fr');
});

test('erreur serveur (500) : état d\'erreur de page, sans plantage', async () => {
  failingFetch(500);
  await renderPage(<OverviewPage params={Promise.resolve({ botId: 'b1' })} />);
  expect(await screen.findByText('Quelque chose s\'est mal passé')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  expect(screen.queryByText('Agent IA introuvable.')).not.toBeInTheDocument();
});

test('usage d\'un agent IA d\'une autre organisation (404 du BFF) : état « introuvable » avec lien vers la liste, sans plantage', async () => {
  failingFetch(404);
  await renderPage(<UsagePage params={Promise.resolve({ botId: 'autre-org' })} />);
  expect(await screen.findByText('Agent IA introuvable.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Retour aux agents IA' })).toHaveAttribute('href', '/fr');
  expect(screen.queryByRole('columnheader', { name: 'Modèle' })).not.toBeInTheDocument();
});

test('usage : erreur serveur (500) : état d\'erreur de page avec « Réessayer », sans plantage', async () => {
  failingFetch(500);
  await renderPage(<UsagePage params={Promise.resolve({ botId: 'b1' })} />);
  expect(await screen.findByText('Quelque chose s\'est mal passé')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
});

// Relecture de la page après un changement de statut : la liste d'accès limité en cours d'édition n'est pas perdue.
test('modification non enregistrée de la liste, puis « Mettre en pause » : la modification est conservée après la relecture', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/bots/b1/status') return new Response(JSON.stringify({ ...BOT, status: 'paused' }), { status: 200 });
    if (url === '/api/bots/b1') return new Response(JSON.stringify({ ...BOT, allowlist: [...BOT.allowlist] }), { status: 200 });
    if (url.includes('/health')) return new Response(JSON.stringify(HEALTH), { status: 200 });
    if (url.includes('/metrics')) return new Response(JSON.stringify(METRICS), { status: 200 });
    if (url.includes('/usage')) return new Response(JSON.stringify(USAGE), { status: 200 });
    if (url.includes('/leads')) return new Response(JSON.stringify({ leads: [] }), { status: 200 });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  await renderPage(<OverviewPage params={Promise.resolve({ botId: 'b1' })} />);
  const field = await screen.findByLabelText('Numéro à autoriser');
  await userEvent.type(field, '+33633333333');
  await userEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
  await userEvent.type(field, '+33644444444');
  await userEvent.click(screen.getByRole('button', { name: 'Mettre en pause' }));
  await vi.waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/bots/b1')).toHaveLength(2));
  await vi.waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/health'))).toHaveLength(2));
  expect(screen.getByText('+33633333333')).toBeInTheDocument();
  expect(screen.getByLabelText('Numéro à autoriser')).toHaveValue('+33644444444');
});
