import { Suspense } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { vi, test, expect } from 'vitest';
import messages from '../../../../../../../messages/fr.json';
import { useReportBot } from '@/components/agent/agent-context';
import { botView } from '@/components/agent/__tests__/fixtures';
import AgentLayout from '../layout';

vi.mock('@/components/shell/top-bar', () => ({ TopBar: () => null }));
vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
  usePathname: () => '/agents/b1',
}));

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
  expect(await screen.findByText('Accès limité')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'relire' }));
  expect(screen.getByText('Désactivé')).toBeInTheDocument();
  expect(screen.queryByText('Accès limité')).not.toBeInTheDocument();
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

// audit R-23 : lecture de l'agent IA en échec, le rail ne montre ni nom vide ni « Brouillon » inventé
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
  expect(screen.queryByText('Brouillon')).not.toBeInTheDocument();
});

test('audit R-23 : panne réseau, même constat', async () => {
  await renderFailing(async () => { throw new Error('réseau'); });
  expect(await screen.findByText('Statut inconnu')).toBeInTheDocument();
  expect(screen.getByText('conseil-marais')).toBeInTheDocument();
  expect(screen.queryByText('Brouillon')).not.toBeInTheDocument();
});

test('audit R-23 : réponse sans nom ni statut, même constat', async () => {
  await renderFailing(async () => new Response('{}', { status: 200 }));
  expect(await screen.findByText('Statut inconnu')).toBeInTheDocument();
  expect(screen.queryByText('Brouillon')).not.toBeInTheDocument();
});
