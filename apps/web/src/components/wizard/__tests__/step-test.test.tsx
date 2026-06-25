import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import { StepTest } from '../step-test';
import type { WizardState } from '@/lib/bot-draft';

beforeEach(() => vi.restoreAllMocks());

const state: WizardState = {
  name: 'Ventes', slug: 'ventes', languages: ['fr'], defaultLanguage: 'fr',
  perLang: { fr: { mode: 'guided', role: 'Conseiller', tones: [], objective: '', info: '', raw: '' } },
  welcomeEnabled: true, welcome: { fr: 'Bonjour 👋' }, leadFields: [],
};

function renderStep() {
  render(<NextIntlClientProvider locale="fr" messages={messages}>
    <StepTest botId="ventes" state={state} onFinish={vi.fn()} onBack={vi.fn()} />
  </NextIntlClientProvider>);
}

test('affiche le message d\'accueil et envoie un message gratuit', async () => {
  expect.assertions(3);
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    expect(JSON.parse(init.body as string).use_bot_config).toBe(false);
    return new Response(JSON.stringify({ session_id: 's1', reply: 'Bonjour, comment aider ?', model: 'haiku' }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  renderStep();
  expect(screen.getByText('Bonjour 👋')).toBeInTheDocument();
  await userEvent.type(screen.getByPlaceholderText('Écrivez un message…'), 'Salut');
  await userEvent.keyboard('{Enter}');
  expect(await screen.findByText('Bonjour, comment aider ?')).toBeInTheDocument();
});
