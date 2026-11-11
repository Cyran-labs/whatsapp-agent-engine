import { Suspense } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { vi, test, expect, beforeEach } from 'vitest';
import messages from '../../../../../../../messages/fr.json';
import { useReportBot } from '@/components/agent/agent-context';
import { botNumber, botView } from '@/components/agent/__tests__/fixtures';
import { expectOrgBlockFirst, expectRailActive, trail } from '@/components/shell/__tests__/frame-assertions';
import AgentLayout from '../layout';
import UsagePage from '../usage/page';

const route = vi.hoisted(() => ({ pathname: '/agents/b1' }));
const role = vi.hoisted(() => ({ isAdmin: true }));
vi.mock('@/components/providers/session-provider', () => {
  const org = { client_id: 'ml', name: 'Maison Lumière', role: 'admin', read_only: false };
  return {
    useSession: () => ({
      me: { id: 1, email: 'claire@maison-lumiere.fr', role: 'user', status: 'active', organizations: [org] },
      activeOrg: { ...org, role: role.isAdmin ? 'admin' : 'advisor' },
      isPlatformAdmin: false,
      isAdmin: role.isAdmin,
      readOnly: false,
      switchOrg: vi.fn(),
    }),
  };
});
vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
  usePathname: () => route.pathname,
}));
// Chaque rendu du choix de période est compté : il ne doit jamais apparaître pour un non-admin, même un instant.
const periodRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock('@/components/usage/period-choice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/usage/period-choice')>();
  return {
    ...actual,
    PeriodChoice: (props: Parameters<typeof actual.PeriodChoice>[0]) => {
      periodRenders.count += 1;
      return actual.PeriodChoice(props);
    },
  };
});

beforeEach(() => {
  route.pathname = '/agents/b1';
  role.isAdmin = true;
  periodRenders.count = 0;
});

async function renderLayout(botId = 'b1') {
  await act(async () => {
    render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <Suspense fallback={null}>
          <AgentLayout params={Promise.resolve({ botId })}><span /></AgentLayout>
        </Suspense>
      </NextIntlClientProvider>,
    );
  });
}

// spec 5.1, 5.2, 10.3
test('cadre de l\'agent IA : rail Agents IA actif, bloc Organisation en tête de colonne, nom et statut dessous', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(botView({ status: 'limited' })), { status: 200 })));
  await renderLayout();
  expect(await screen.findByText('Preview')).toBeInTheDocument();
  expectRailActive('agents');
  expectOrgBlockFirst('Maison Lumière');
  expect(screen.getByRole('link', { name: "Vue d'ensemble" })).toHaveAttribute('aria-current', 'page');
});

// spec 5.1 : sur /agents/:id/usage, la page appartient à l'agent IA, l'entrée active du rail est Agents IA
test('usage de l\'agent IA : l\'entrée active du rail reste Agents IA, la section Usage est active dans la colonne', async () => {
  route.pathname = '/agents/b1/usage';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(botView({ status: 'limited' })), { status: 200 })));
  await renderLayout();
  expect(await screen.findByText('Preview')).toBeInTheDocument();
  expectRailActive('agents');
  expectOrgBlockFirst('Maison Lumière');
  const usage = screen.getAllByRole('link').find((a) => a.getAttribute('href') === '/agents/b1/usage');
  expect(usage).toHaveAttribute('aria-current', 'page');
});

// nav 15.5 : la section « Usage et coûts » de la colonne n'est rendue que pour l'admin
test('colonne de l\'agent IA : section « Usage et coûts » pour l\'admin, absente pour un conseiller', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(botView({ status: 'limited' })), { status: 200 })));
  await renderLayout();
  expect(await screen.findByText('Preview')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Usage et coûts' })).toHaveAttribute('href', '/agents/b1/usage');
  cleanup();
  role.isAdmin = false;
  await renderLayout();
  expect(await screen.findByText('Preview')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: "Vue d'ensemble" })).toBeInTheDocument();
  expect(screen.queryByText('Usage et coûts')).not.toBeInTheDocument();
  expect(screen.getAllByRole('link').filter((a) => (a.getAttribute('href') ?? '').endsWith('/usage'))).toEqual([]);
});

// nav 15.5, prototype 5 : /agents/:id/usage ouvert par un conseiller, refus sur place (spec 10.4, 10.6), aucune lecture
// des coûts, et le choix de période n'est jamais rendu (relecture tâche 6, M-2)
test('conseiller sur /agents/:id/usage : page réservée sur place, aucun appel à /usage, jamais de choix de période', async () => {
  role.isAdmin = false;
  route.pathname = '/agents/b1/usage';
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify(botView({ status: 'limited' })), { status: 200 });
  }));
  await act(async () => {
    render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <Suspense fallback={null}>
          <AgentLayout params={Promise.resolve({ botId: 'b1' })}><UsagePage params={Promise.resolve({ botId: 'b1' })} /></AgentLayout>
        </Suspense>
      </NextIntlClientProvider>,
    );
  });
  expect(screen.getByRole('heading', { level: 1, name: 'Page réservée aux administrateurs' })).toBeInTheDocument();
  expect(screen.getByText('Cette page de l\'organisation Maison Lumière est réservée aux administrateurs.')).toBeInTheDocument();
  expect(trail()).toEqual(['Maison Lumière', 'Accès refusé']);
  expectRailActive(null);
  expectOrgBlockFirst('Maison Lumière');
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(calls.filter((u) => u.includes('/usage'))).toEqual([]);
  expect(screen.queryByRole('group', { name: 'Période' })).not.toBeInTheDocument();
  expect(periodRenders.count).toBe(0);
});

function Reporter() {
  const report = useReportBot();
  return <button type="button" onClick={() => report(botView({ status: 'paused' }))}>relire</button>;
}

test('le rail suit le statut relu par la page, sans rechargement de la mise en page', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(botView({ status: 'limited' })), { status: 200 })));
  await act(async () => {
    render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <Suspense fallback={null}>
          <AgentLayout params={Promise.resolve({ botId: 'b1' })}><Reporter /></AgentLayout>
        </Suspense>
      </NextIntlClientProvider>,
    );
  });
  expect(await screen.findByText('Preview')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'relire' }));
  expect(screen.getByText('Offline')).toBeInTheDocument();
  expect(screen.queryByText('Preview')).not.toBeInTheDocument();
});

// revue finale 2b-3 m-8
test('identifiant d\'agent IA à caractères spéciaux : encodé dans l\'appel et dans les liens du rail', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(botView({ status: 'limited' })), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  await act(async () => {
    render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <Suspense fallback={null}>
          <AgentLayout params={Promise.resolve({ botId: 'a b/c' })}><span /></AgentLayout>
        </Suspense>
      </NextIntlClientProvider>,
    );
  });
  expect((fetchMock.mock.calls as unknown[][]).map((c) => c[0])).toContain('/api/bots/a%20b%2Fc');
  const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href') ?? '').filter((h) => h.startsWith('/agents/'));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) expect(href.startsWith('/agents/a%20b%2Fc')).toBe(true);
});

// audit R-23 : lecture de l'agent IA en échec, le rail ne montre ni nom vide ni « Draft » inventé
async function renderFailing(fetchMock: () => Promise<Response>, botId = 'conseil-marais') {
  vi.stubGlobal('fetch', vi.fn(fetchMock));
  await act(async () => {
    render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <Suspense fallback={null}>
          <AgentLayout params={Promise.resolve({ botId })}><span /></AgentLayout>
        </Suspense>
      </NextIntlClientProvider>,
    );
  });
}

test('audit R-23 : lecture refusée (500), le rail dit « Statut inconnu » et nomme l\'agent IA par son identifiant', async () => {
  await renderFailing(async () => new Response('{}', { status: 500 }));
  expect(await screen.findByText('Statut inconnu')).toBeInTheDocument();
  expect(screen.getByText('conseil-marais')).toBeInTheDocument();
  expect(screen.queryByText('Draft')).not.toBeInTheDocument();
});

test('audit R-23 : panne réseau, même constat', async () => {
  await renderFailing(async () => { throw new Error('réseau'); });
  expect(await screen.findByText('Statut inconnu')).toBeInTheDocument();
  expect(screen.getByText('conseil-marais')).toBeInTheDocument();
  expect(screen.queryByText('Draft')).not.toBeInTheDocument();
});

test('audit R-23 : réponse sans nom ni statut, même constat', async () => {
  await renderFailing(async () => new Response('{}', { status: 200 }));
  expect(await screen.findByText('Statut inconnu')).toBeInTheDocument();
  expect(screen.queryByText('Draft')).not.toBeInTheDocument();
});

// spec 7.3, point 4 : la colonne lit la mention et l'état du compte de la lecture de l'agent IA, sans les recalculer
test('agent IA Online dont le compte est déconnecté : « Ne répond pas » sous le nom, bulle « non connecté »', async () => {
  const bot = botView({ status: 'active', not_responding: 'account_not_connected', whatsapp_number: botNumber({ account_state: 'disconnected' }) });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(bot), { status: 200 })));
  await renderLayout();
  const mention = await screen.findByText('Ne répond pas');
  expect(screen.getByText('Online')).toBeInTheDocument();
  act(() => mention.focus());
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Ne répond pas : compte WhatsApp non connecté');
});

test('mention inconnue des contrats dans la réponse : rien d\'affiché', async () => {
  const bot = { ...botView({ status: 'active' }), not_responding: 'motif_futur' };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(bot), { status: 200 })));
  await renderLayout();
  expect(await screen.findByText('Online')).toBeInTheDocument();
  expect(screen.queryByText('Ne répond pas')).not.toBeInTheDocument();
});

function OfflineReporter() {
  const report = useReportBot();
  return <button type="button" onClick={() => report(botView({ status: 'paused', status_reason: 'number_removed' }))}>relire</button>;
}

// spec 6.1 : le motif d'Offline suit la relecture de la page
test('relecture Offline avec motif : la colonne dit « Numéro retiré » à côté de la pastille', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(botView({ status: 'limited' })), { status: 200 })));
  await act(async () => {
    render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <Suspense fallback={null}>
          <AgentLayout params={Promise.resolve({ botId: 'b1' })}><OfflineReporter /></AgentLayout>
        </Suspense>
      </NextIntlClientProvider>,
    );
  });
  expect(await screen.findByText('Preview')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'relire' }));
  expect(screen.getByText('Offline')).toBeInTheDocument();
  expect(screen.getByText('Numéro retiré')).toBeInTheDocument();
});

const ENTITIES = [
  { id: 1, client_id: 'ml', name: 'Siège Paris', status: 'active' },
  { id: 2, client_id: 'ml', name: 'Boutique Lyon', status: 'active' },
];

/** Moteur simulé : l'agent IA sur `/api/bots/b1`, les entités sur `/api/entities` (ou leur échec). */
function stubAgentAndEntities(bot: unknown, entities: Response | (() => Response)) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/entities')) return typeof entities === 'function' ? entities() : entities;
    return typeof bot === 'function' ? (bot as () => Response)() : new Response(JSON.stringify(bot), { status: 200 });
  }));
}

/** Bloc d'en-tête de la colonne de l'agent IA (sous le bloc Organisation). */
const columnHeader = () => screen.getByText('Agent IA').closest('aside > div > div') as HTMLElement;

// prototype 7 : la colonne dit l'entité de l'agent IA, lue de /api/entities par son entity_id
test('colonne : « ‹ Tous les agents IA », étiquette « Agent IA », nom, pastille et ligne « Entité · {nom} »', async () => {
  stubAgentAndEntities(botView({ status: 'limited', entity_id: 2 }), () => new Response(JSON.stringify(ENTITIES), { status: 200 }));
  await renderLayout();
  expect(await screen.findByText('Entité · Boutique Lyon')).toBeInTheDocument();
  const header = columnHeader();
  expect(header).toHaveTextContent('Conseil Marais');
  expect(header).toContainElement(screen.getByText('Preview'));
  expect(header).toContainElement(screen.getByText('Entité · Boutique Lyon'));
  const back = screen.getByRole('link', { name: /Tous les agents IA/ });
  expect(back).toHaveAttribute('href', '/');
  expect(back).toHaveTextContent('‹');
  expect(back.compareDocumentPosition(screen.getByText('Agent IA')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByText('Entité · Siège Paris')).not.toBeInTheDocument();
});

test('entités illisibles : pas de ligne Entité, le reste de la colonne est là', async () => {
  stubAgentAndEntities(botView({ status: 'limited', entity_id: 2 }), () => new Response('{}', { status: 500 }));
  await renderLayout();
  expect(await screen.findByText('Preview')).toBeInTheDocument();
  expect(screen.queryByText(/^Entité ·/)).not.toBeInTheDocument();
});

test('entité de l\'agent IA absente de la liste (archivée) : pas de ligne Entité', async () => {
  stubAgentAndEntities(botView({ status: 'limited', entity_id: 9 }), () => new Response(JSON.stringify(ENTITIES), { status: 200 }));
  await renderLayout();
  expect(await screen.findByText('Preview')).toBeInTheDocument();
  expect(screen.queryByText(/^Entité ·/)).not.toBeInTheDocument();
});

// audit R-23, comportement gardé : lecture de l'agent IA en échec, ni mention ni ligne Entité
test('lecture de l\'agent IA en échec : identifiant, « Statut inconnu », ni mention ni ligne Entité, même avec les entités lues', async () => {
  stubAgentAndEntities(() => new Response('{}', { status: 500 }), () => new Response(JSON.stringify(ENTITIES), { status: 200 }));
  await renderLayout();
  expect(await screen.findByText('Statut inconnu')).toBeInTheDocument();
  expect(screen.getByText('b1')).toBeInTheDocument();
  expect(screen.queryByText(/^Entité ·/)).not.toBeInTheDocument();
  expect(screen.queryByText('Ne répond pas')).not.toBeInTheDocument();
});

test('la ligne Entité reste après une relecture de l\'agent IA par la page', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
    String(input).startsWith('/api/entities')
      ? new Response(JSON.stringify(ENTITIES), { status: 200 })
      : new Response(JSON.stringify(botView({ status: 'limited', entity_id: 1 })), { status: 200 })));
  await act(async () => {
    render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <Suspense fallback={null}>
          <AgentLayout params={Promise.resolve({ botId: 'b1' })}><Reporter /></AgentLayout>
        </Suspense>
      </NextIntlClientProvider>,
    );
  });
  expect(await screen.findByText('Entité · Siège Paris')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'relire' }));
  expect(screen.getByText('Offline')).toBeInTheDocument();
  expect(screen.getByText('Entité · Siège Paris')).toBeInTheDocument();
});
