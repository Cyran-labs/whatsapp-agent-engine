import { Suspense } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { vi, test, expect, beforeEach } from 'vitest';
import messages from '../../../../../../../messages/fr.json';
import { useReportBot } from '@/components/agent/agent-context';
import { botNumber, botView } from '@/components/agent/__tests__/fixtures';
import { expectOrgBlockFirst, expectRailActive } from '@/components/shell/__tests__/frame-assertions';
import AgentLayout from '../layout';

const route = vi.hoisted(() => ({ pathname: '/agents/b1' }));
vi.mock('@/components/providers/session-provider', () => {
  const org = { client_id: 'ml', name: 'Maison Lumière', role: 'admin', read_only: false };
  return {
    useSession: () => ({
      me: { id: 1, email: 'claire@maison-lumiere.fr', role: 'user', status: 'active', organizations: [org] },
      activeOrg: org,
      isPlatformAdmin: false,
      isAdmin: true,
      readOnly: false,
      switchOrg: vi.fn(),
    }),
  };
});
vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
  usePathname: () => route.pathname,
}));

beforeEach(() => {
  route.pathname = '/agents/b1';
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
