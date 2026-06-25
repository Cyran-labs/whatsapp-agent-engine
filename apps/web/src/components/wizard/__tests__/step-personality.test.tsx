import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import { useState } from 'react';
import { StepPersonality } from '../step-personality';
import type { WizardState } from '@/lib/bot-draft';

beforeEach(() => vi.restoreAllMocks());

const baseState: WizardState = {
  name: 'Ventes', slug: 'ventes', languages: ['fr'], defaultLanguage: 'fr',
  perLang: { fr: { mode: 'guided', role: '', tones: [], objective: '', info: '', raw: '' } },
  welcomeEnabled: true, welcome: {}, leadFields: [],
};

// Wrapper a etat reel : sans lui, l'input controle par `state` ne refleterait pas la frappe.
function Harness({ onCreated }: { onCreated: (id: string) => void }) {
  const [state, setState] = useState<WizardState>(baseState);
  const update = (p: Partial<WizardState>) => setState((s) => ({ ...s, ...p }));
  return <StepPersonality state={state} update={update} createdBotId={null} onCreated={onCreated} onBack={() => {}} />;
}

function renderStep(onCreated = vi.fn()) {
  render(<NextIntlClientProvider locale="fr" messages={messages}><Harness onCreated={onCreated} /></NextIntlClientProvider>);
  return { onCreated };
}

test('Créer & tester poste le draft puis appelle onCreated', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ bot_id: 'ventes' }), { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
  const { onCreated } = renderStep();
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Conseiller');
  await userEvent.click(screen.getByRole('button', { name: /Créer & tester/ }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith('ventes'));
  const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
  expect(body.personality.fr.role).toBe('Conseiller');
});

test('collision de slug (409) → suffixe et réessaie', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'CONFLICT', message: 'bot_id déjà pris.' } }), { status: 409 }))
    .mockResolvedValueOnce(new Response(JSON.stringify([{ bot_id: 'ventes' }]), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ bot_id: 'ventes-2' }), { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
  const { onCreated } = renderStep();
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Conseiller');
  await userEvent.click(screen.getByRole('button', { name: /Créer & tester/ }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith('ventes-2'));
});
