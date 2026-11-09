import { Suspense } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
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

// revue finale 2b-3 m-3 : la relecture qui suit une action réussie se fait en arrière-plan
test('après une action réussie, une relecture en échec garde les données affichées, avec un message et « Réessayer »', async () => {
  let afterAction = false;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/bots/b1/status') { afterAction = true; return new Response(JSON.stringify({ ...BOT, status: 'paused' }), { status: 200 }); }
    if (afterAction && init?.method === undefined) return new Response('{}', { status: 500 });
    if (url === '/api/bots/b1') return new Response(JSON.stringify(BOT), { status: 200 });
    if (url.includes('/health')) return new Response(JSON.stringify(HEALTH), { status: 200 });
    if (url.includes('/metrics')) return new Response(JSON.stringify(METRICS), { status: 200 });
    if (url.includes('/usage')) return new Response(JSON.stringify(USAGE), { status: 200 });
    if (url.includes('/leads')) return new Response(JSON.stringify({ leads: [] }), { status: 200 });
    return new Response('{}', { status: 404 });
  }));
  await renderPage(<OverviewPage params={Promise.resolve({ botId: 'b1' })} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Mettre en pause' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Impossible de relire cette page/);
  expect(screen.queryByText('Quelque chose s\'est mal passé')).not.toBeInTheDocument();
  expect(screen.getByText('142')).toBeInTheDocument();
  // « Réessayer » relit ; la lecture réussit : le message disparaît
  afterAction = false;
  await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(screen.getByText('142')).toBeInTheDocument();
});

test('après une action réussie, un 404 à la relecture (agent IA supprimé ailleurs) remplace la page par « introuvable »', async () => {
  let afterAction = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/bots/b1/status') { afterAction = true; return new Response(JSON.stringify({ ...BOT, status: 'paused' }), { status: 200 }); }
    if (afterAction && init?.method === undefined && url === '/api/bots/b1') return new Response('{}', { status: 404 });
    if (url === '/api/bots/b1') return new Response(JSON.stringify(BOT), { status: 200 });
    if (url.includes('/health')) return new Response(JSON.stringify(HEALTH), { status: 200 });
    if (url.includes('/metrics')) return new Response(JSON.stringify(METRICS), { status: 200 });
    if (url.includes('/usage')) return new Response(JSON.stringify(USAGE), { status: 200 });
    if (url.includes('/leads')) return new Response(JSON.stringify({ leads: [] }), { status: 200 });
    return new Response('{}', { status: 404 });
  }));
  await renderPage(<OverviewPage params={Promise.resolve({ botId: 'b1' })} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Mettre en pause' }));
  expect(await screen.findByText('Agent IA introuvable.')).toBeInTheDocument();
});

// revue finale 2b-3 m-3 : un 409 ORG_CHANGED recharge la page (apiFetch), il n'est ni une erreur ni un écran d'erreur
test('lecture qui répond 409 ORG_CHANGED : ni écran d\'erreur ni « introuvable », ni erreur journalisée', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'ORG_CHANGED', message: 'x' } }), { status: 409 })));
  await renderPage(<OverviewPage params={Promise.resolve({ botId: 'b1' })} />);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  expect(screen.queryByText('Quelque chose s\'est mal passé')).not.toBeInTheDocument();
  expect(screen.queryByText('Agent IA introuvable.')).not.toBeInTheDocument();
  expect(logged).not.toHaveBeenCalled();
});

test('usage : lecture qui répond 409 ORG_CHANGED : ni écran d\'erreur ni erreur journalisée', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'ORG_CHANGED', message: 'x' } }), { status: 409 })));
  await renderPage(<UsagePage params={Promise.resolve({ botId: 'b1' })} />);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  expect(screen.queryByText('Quelque chose s\'est mal passé')).not.toBeInTheDocument();
  expect(logged).not.toHaveBeenCalled();
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

// Relecture au retour sur l'onglet (revue 2b-3, cycle 1, PO) : l'agent IA activé ou modifié ailleurs ne reste pas affiché périmé.

type Overrides = { bot?: Partial<typeof BOT>; health?: Partial<typeof HEALTH>; fail?: boolean };

/** Moteur simulé dont l'état se modifie entre deux lectures ; `reads` compte les lectures de l'agent IA. */
function liveEngine(current: { value: Overrides }) {
  const reads = { bot: 0 };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (current.value.fail) return new Response('{}', { status: 500 });
    if (url === '/api/bots/b1') { reads.bot += 1; return new Response(JSON.stringify({ ...BOT, ...current.value.bot }), { status: 200 }); }
    if (url.includes('/health')) return new Response(JSON.stringify({ ...HEALTH, ...current.value.health }), { status: 200 });
    if (url.includes('/metrics')) return new Response(JSON.stringify(METRICS), { status: 200 });
    if (url.includes('/usage')) return new Response(JSON.stringify(USAGE), { status: 200 });
    if (url.includes('/leads')) return new Response(JSON.stringify({ leads: [] }), { status: 200 });
    return new Response('{}', { status: 404 });
  }));
  return reads;
}

async function backToTab(state: 'visible' | 'hidden' = 'visible') {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
}

test('retour sur l\'onglet : l\'agent IA activé ailleurs n\'est plus affiché en brouillon, sans écran de chargement', async () => {
  const engine = { value: { bot: { status: 'draft' }, health: { status: 'draft' } } as Overrides };
  const reads = liveEngine(engine);
  const { container } = await renderPage(<OverviewPage params={Promise.resolve({ botId: 'b1' })} />);
  await screen.findByText('142');
  expect(screen.getAllByText('Brouillon').length).toBeGreaterThan(0);
  expect(reads.bot).toBe(1);

  engine.value = { bot: { status: 'active' }, health: { status: 'active' } };
  await backToTab();
  await waitFor(() => expect(reads.bot).toBe(2));
  await waitFor(() => expect(screen.queryAllByText('Brouillon')).toHaveLength(0));
  expect(screen.getAllByText('Actif').length).toBeGreaterThan(0);
  expect(container.querySelectorAll('[data-skeleton]')).toHaveLength(0);
});

test('onglet qui passe en arrière-plan : aucune relecture', async () => {
  const reads = liveEngine({ value: {} });
  await renderPage(<OverviewPage params={Promise.resolve({ botId: 'b1' })} />);
  await screen.findByText('142');
  await backToTab('hidden');
  expect(reads.bot).toBe(1);
});

test('l\'écouteur est retiré au démontage : un retour sur l\'onglet ne relit plus rien', async () => {
  const reads = liveEngine({ value: {} });
  const { unmount } = await renderPage(<OverviewPage params={Promise.resolve({ botId: 'b1' })} />);
  await screen.findByText('142');
  unmount();
  await backToTab();
  expect(reads.bot).toBe(1);
});

test('réponse périmée ignorée : deux retours successifs, la lecture la plus ancienne arrive en dernier', async () => {
  const gates: Array<() => void> = [];
  const served: string[] = [];
  let reads = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/bots/b1') {
      reads += 1;
      const mine = reads;
      // 1 : chargement initial (immédiat) ; 2 : retour lent, brouillon ; 3 : retour rapide, actif.
      if (mine === 2) await new Promise<void>((resolve) => { gates.push(resolve); });
      const status = mine === 2 ? 'draft' : 'active';
      served.push(status);
      return new Response(JSON.stringify({ ...BOT, status }), { status: 200 });
    }
    if (url.includes('/health')) return new Response(JSON.stringify(HEALTH), { status: 200 });
    if (url.includes('/metrics')) return new Response(JSON.stringify(METRICS), { status: 200 });
    if (url.includes('/usage')) return new Response(JSON.stringify(USAGE), { status: 200 });
    if (url.includes('/leads')) return new Response(JSON.stringify({ leads: [] }), { status: 200 });
    return new Response('{}', { status: 404 });
  }));
  await renderPage(<OverviewPage params={Promise.resolve({ botId: 'b1' })} />);
  await screen.findByText('142');
  // Seule la date est simulée : deux retours séparés de moins de 5 s ne donnent qu'une relecture (revue finale 2b-3 m-2).
  vi.useFakeTimers({ toFake: ['Date'] });
  await backToTab();
  await waitFor(() => expect(reads).toBe(2));
  vi.setSystemTime(Date.now() + 10_000);
  await backToTab();
  await waitFor(() => expect(served).toEqual(['active', 'active']));
  vi.useRealTimers();
  // La lecture lente (brouillon) se termine après la plus récente : elle est ignorée.
  await act(async () => { gates[0]!(); });
  await act(async () => { await Promise.resolve(); });
  expect(served).toContain('draft');
  expect(screen.queryAllByText('Brouillon')).toHaveLength(0);
  expect(screen.getAllByText('Actif').length).toBeGreaterThan(0);
});

test('modifications non enregistrées de la liste d\'accès limité conservées par la relecture, avec l\'avertissement existant', async () => {
  const engine = { value: {} as Overrides };
  const reads = liveEngine(engine);
  await renderPage(<OverviewPage params={Promise.resolve({ botId: 'b1' })} />);
  await screen.findByText('142');
  const field = screen.getByLabelText('Numéro à autoriser');
  await userEvent.type(field, '+33622222222{Enter}');
  await userEvent.type(field, '+3366');
  expect(screen.getByText('+33622222222')).toBeInTheDocument();

  engine.value = { bot: { allowlist: ['+33611111111', '+33633333333'] } };
  await backToTab();
  await waitFor(() => expect(reads.bot).toBe(2));
  // La liste en cours d'édition et la saisie du champ survivent ; le conflit est signalé.
  expect(await screen.findByText(/La liste a changé dans le moteur entre-temps/)).toBeInTheDocument();
  expect(screen.getByText('+33622222222')).toBeInTheDocument();
  expect(screen.queryByText('+33633333333')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Numéro à autoriser')).toHaveValue('+3366');
});

test('relecture au retour en échec : la page reste affichée avec ses données', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const engine = { value: {} as Overrides };
  liveEngine(engine);
  await renderPage(<OverviewPage params={Promise.resolve({ botId: 'b1' })} />);
  await screen.findByText('142');
  engine.value = { fail: true };
  await backToTab();
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText('142')).toBeInTheDocument();
  expect(screen.queryByText('Quelque chose s\'est mal passé')).not.toBeInTheDocument();
});

test('agent IA supprimé ailleurs (404 au retour) : l\'état « introuvable » remplace la page', async () => {
  const engine = { value: {} as Overrides };
  liveEngine(engine);
  await renderPage(<OverviewPage params={Promise.resolve({ botId: 'b1' })} />);
  await screen.findByText('142');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
  await backToTab();
  expect(await screen.findByText('Agent IA introuvable.')).toBeInTheDocument();
});

// revue finale 2b-3 m-8 : l'identifiant texte de l'agent IA est encodé dans chaque chemin d'API
test('identifiant d\'agent IA à caractères spéciaux : vue d\'ensemble et usage l\'encodent dans chaque appel', async () => {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url);
    return new Response('{}', { status: 404 });
  }));
  await renderPage(<OverviewPage params={Promise.resolve({ botId: 'a b/c' })} />);
  await screen.findByText('Agent IA introuvable.');
  await renderPage(<UsagePage params={Promise.resolve({ botId: 'a b/c' })} />);
  await waitFor(() => expect(urls.some((u) => u.includes('/usage?since='))).toBe(true));
  expect(urls.length).toBeGreaterThan(1);
  for (const url of urls) {
    expect(url.startsWith('/api/bots/a%20b%2Fc')).toBe(true);
    expect(url).not.toContain('a b/c');
  }
});
