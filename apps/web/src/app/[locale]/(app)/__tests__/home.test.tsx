import { render, screen, waitFor } from '@testing-library/react';
import { vi, beforeEach, test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../../messages/fr.json';
import Home from '../page';

vi.mock('@/i18n/routing', () => ({
  Link: (p: { children: React.ReactNode; href: string }) => <a href={p.href}>{p.children}</a>,
  usePathname: () => '/',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  routing: { locales: ['fr', 'en'], defaultLocale: 'fr' },
}));

beforeEach(() => vi.restoreAllMocks());

function renderHome() {
  return render(<NextIntlClientProvider locale="fr" messages={messages}><Home /></NextIntlClientProvider>);
}

test('0 bot → first-run (CTA creer premier agent)', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })));
  renderHome();
  expect(await screen.findByText('Créer mon premier agent IA')).toBeInTheDocument();
});

test('>=1 bot → table d agents (titre Agents + nom + CTA Creer un agent)', async () => {
  const row = { bot_id: 'a', name: 'Assistant A', slug: 'assistant-a', status: 'draft', default_language: 'fr', languages: ['fr'], numbers: [], messages_total: 0, leads_total: 0, personalized: true };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([row]), { status: 200 })));
  renderHome();
  await waitFor(() => expect(screen.getByText('Assistant A')).toBeInTheDocument());
  expect(screen.getByRole('heading', { name: 'Agents IA' })).toBeInTheDocument();
  expect(screen.getByText('+ Créer un agent IA')).toBeInTheDocument();
});
