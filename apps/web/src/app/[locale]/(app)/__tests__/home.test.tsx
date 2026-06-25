import { render, screen, waitFor } from '@testing-library/react';
import { vi, beforeEach, test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../../messages/fr.json';
import Home from '../page';

vi.mock('@/i18n/routing', () => ({ Link: (p: { children: React.ReactNode; href: string }) => <a href={p.href}>{p.children}</a> }));

beforeEach(() => vi.restoreAllMocks());

function renderHome() {
  return render(<NextIntlClientProvider locale="fr" messages={messages}><Home /></NextIntlClientProvider>);
}

test('first-run : 0 bot → CTA creer premier agent', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })));
  renderHome();
  expect(await screen.findByText('Créer mon premier agent')).toBeInTheDocument();
});

test('>=1 bot → checklist avec etape Creer cochee', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ bot_id: 'a', name: 'A', status: 'draft', default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'x' } }]), { status: 200 })));
  renderHome();
  await waitFor(() => expect(screen.getByText("Créer un agent")).toBeInTheDocument());
});
