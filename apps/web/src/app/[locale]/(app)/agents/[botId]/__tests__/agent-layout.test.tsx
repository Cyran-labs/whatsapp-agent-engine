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
  expect(screen.getByText('En pause')).toBeInTheDocument();
  expect(screen.queryByText('Accès limité')).not.toBeInTheDocument();
});
