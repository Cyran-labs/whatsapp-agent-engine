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
  welcomeEnabled: true, welcome: { fr: 'Bonjour 👋' }, leadFields: [], entityId: null,
};

function renderStep(onNext = vi.fn()) {
  render(<NextIntlClientProvider locale="fr" messages={messages}>
    <StepTest botId="ventes" state={state} onNext={onNext} onBack={vi.fn()} />
  </NextIntlClientProvider>);
}

test('« Continuer » mène à l\'étape suivante au lieu de terminer, et le compteur indique 3 / 5', async () => {
  const onNext = vi.fn();
  renderStep(onNext);
  expect(screen.getByText('3 / 5')).toBeInTheDocument();
  expect(screen.queryByText(/Terminer/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /Continuer/ }));
  expect(onNext).toHaveBeenCalledTimes(1);
});

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

test('le bandeau de simulation dit ce que fait le moteur, sans citer de modèle ni promettre la gratuité', () => {
  renderStep();
  const banner = screen.getByText(/Simulation : elle passe par les clés de la plateforme, avec les mêmes modèles qu'un vrai client\. Ses appels sont comptés dans Usage & coûts\./);
  expect(banner).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/Haiku|Sonnet|Opus|gratuite|quota/i);
});
