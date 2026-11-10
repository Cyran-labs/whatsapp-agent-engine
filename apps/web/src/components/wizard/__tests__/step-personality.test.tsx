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
  welcomeEnabled: true, welcome: {}, leadFields: [], entityId: null,
};

// Wrapper a etat reel : sans lui, l'input controle par `state` ne refleterait pas la frappe.
function Harness({ onCreated, onEntityRefused, initial }: {
  onCreated: (id: string, entityId: number | null) => void;
  onEntityRefused: (message: string) => void;
  initial: WizardState;
}) {
  const [state, setState] = useState<WizardState>(initial);
  const update = (p: Partial<WizardState>) => setState((s) => ({ ...s, ...p }));
  return <StepPersonality state={state} update={update} createdBotId={null} onCreated={onCreated} onEntityRefused={onEntityRefused} onBack={() => {}} />;
}

function renderStep(onCreated = vi.fn(), initial: WizardState = baseState) {
  const onEntityRefused = vi.fn();
  render(<NextIntlClientProvider locale="fr" messages={messages}><Harness onCreated={onCreated} onEntityRefused={onEntityRefused} initial={initial} /></NextIntlClientProvider>);
  return { onCreated, onEntityRefused };
}

/** Refus du moteur tel que le BFF le relaie. */
const refusal = (status: number, code: string, message: string, extra: { details?: { path: string; message: string }[]; reason?: string; request_id?: string } = {}) =>
  new Response(JSON.stringify({ error: { code, message, ...extra } }), { status });

const TWO_LANGS: WizardState = {
  ...baseState,
  languages: ['fr', 'en'],
  defaultLanguage: 'en',
  perLang: {
    fr: { mode: 'guided', role: 'Conseiller', tones: [], objective: '', info: '', raw: '' },
    en: { mode: 'guided', role: 'Advisor', tones: [], objective: '', info: '', raw: '' },
  },
};

test('Créer & tester poste le draft puis appelle onCreated', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ bot_id: 'ventes', entity_id: 7 }), { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
  const { onCreated } = renderStep();
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Conseiller');
  await userEvent.click(screen.getByRole('button', { name: /Créer & tester/ }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith('ventes', 7));
  const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
  const body = JSON.parse(init.body as string);
  expect(body.personality.fr.role).toBe('Conseiller');
});

test('collision de slug (409) → suffixe et réessaie', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(refusal(409, 'CONFLICT', 'bot_id déjà pris.', { reason: 'bot.id_taken' }))
    .mockResolvedValueOnce(new Response(JSON.stringify([{ bot_id: 'ventes' }]), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ bot_id: 'ventes-2' }), { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
  const { onCreated } = renderStep();
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Conseiller');
  await userEvent.click(screen.getByRole('button', { name: /Créer & tester/ }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith('ventes-2', null));
});

const ORG_CHANGED_BODY = { error: { code: 'ORG_CHANGED', message: 'Organisation modifiée dans un autre onglet.' } };

test('409 ORG_CHANGED (organisation changée dans un autre onglet) : pas de conflit de slug, aucun message', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(ORG_CHANGED_BODY), { status: 409 }));
  vi.stubGlobal('fetch', fetchMock);
  const { onCreated } = renderStep();
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Conseiller');
  await userEvent.click(screen.getByRole('button', { name: /Créer & tester/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Créer & tester/ })).not.toBeDisabled());
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(onCreated).not.toHaveBeenCalled();
});

test('409 ORG_CHANGED au réessai après un conflit de slug : aucun message non plus', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(refusal(409, 'CONFLICT', 'bot_id déjà pris.', { reason: 'bot.id_taken' }))
    .mockResolvedValueOnce(new Response(JSON.stringify([{ bot_id: 'ventes' }]), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(ORG_CHANGED_BODY), { status: 409 }));
  vi.stubGlobal('fetch', fetchMock);
  const { onCreated } = renderStep();
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Conseiller');
  await userEvent.click(screen.getByRole('button', { name: /Créer & tester/ }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(screen.getByRole('button', { name: /Créer & tester/ })).not.toBeDisabled());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(onCreated).not.toHaveBeenCalled();
});

// audit R-2
test('refus « Choisissez une entité » : retour à l\'étape 1 avec le message du champ, jamais « Vérifiez les champs »', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => refusal(400, 'VALIDATION_ERROR', 'Choisissez une entité.', {
    details: [{ path: 'entity_id', message: 'Choisissez une entité.' }], reason: 'bot.entity_required',
  })));
  const { onCreated, onEntityRefused } = renderStep();
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Conseiller');
  await userEvent.click(screen.getByRole('button', { name: /Créer & tester/ }));
  await waitFor(() => expect(onEntityRefused).toHaveBeenCalledWith('Choisissez une entité.'));
  expect(onCreated).not.toHaveBeenCalled();
  expect(screen.queryByText(/Vérifiez les champs/)).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

// audit R-2
test('refus de la langue par défaut : son onglet s\'ouvre en erreur, avec le message du champ', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => refusal(400, 'VALIDATION_ERROR', 'Données invalides.', {
    details: [{ path: 'system_prompt', message: 'Aucune personnalité ni prompt pour la langue par défaut (en).' }], reason: 'bot.default_language_missing',
  })));
  const { onEntityRefused } = renderStep(vi.fn(), TWO_LANGS);
  await userEvent.click(screen.getByRole('button', { name: 'Français' }));
  expect(screen.getByLabelText('Rôle / métier')).toHaveValue('Conseiller');
  await userEvent.click(screen.getByRole('button', { name: /Créer & tester/ }));
  const english = await screen.findByRole('button', { name: 'English' });
  await waitFor(() => expect(screen.getByLabelText('Rôle / métier')).toHaveValue('Advisor'));
  const message = screen.getByText('Aucune personnalité ni prompt pour la langue par défaut (en).');
  expect(message).toHaveClass('text-danger');
  expect(english).toHaveAttribute('aria-describedby', message.id);
  expect(english).toHaveClass('border-danger');
  expect(screen.getByRole('button', { name: 'Français' })).not.toHaveAttribute('aria-describedby');
  expect(screen.getByLabelText('Rôle / métier')).toHaveAttribute('aria-invalid', 'true');
  expect(onEntityRefused).not.toHaveBeenCalled();
  expect(screen.queryByText(/Vérifiez les champs/)).not.toBeInTheDocument();
  // Corriger la personnalité efface l'erreur.
  await userEvent.type(screen.getByLabelText('Objectif principal'), 'x');
  expect(screen.queryByText(/langue par défaut/)).not.toBeInTheDocument();
  expect(english).not.toHaveAttribute('aria-describedby');
  expect(english).not.toHaveClass('border-danger');
  expect(screen.getByLabelText('Rôle / métier')).not.toHaveAttribute('aria-invalid');
});

// audit R-2
test.each([
  [403, 'FORBIDDEN', 'Accès refusé.', 'Accès refusé.'],
  [500, 'INTERNAL', 'Erreur interne.', 'Action impossible pour le moment. Réessayez.'],
])('refus %i : message propre sous le bouton, jamais « Vérifiez les champs »', async (status, code, message, shown) => {
  vi.stubGlobal('fetch', vi.fn(async () => refusal(status, code, message, status === 500 ? { request_id: 'req-abc' } : {})));
  renderStep();
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Conseiller');
  await userEvent.click(screen.getByRole('button', { name: /Créer & tester/ }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(shown);
  if (status === 500) expect(alert).toHaveTextContent('Référence : req-abc');
  expect(alert).not.toHaveTextContent('Vérifiez les champs');
  expect(screen.getByRole('button', { name: /Créer & tester/ })).toBeEnabled();
  // Le message précède le bouton dans la page ? Non : il est sous le bouton (après lui dans le document).
  const button = screen.getByRole('button', { name: /Créer & tester/ });
  expect(button.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('réseau coupé : message propre, bouton de nouveau actif', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  renderStep();
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Conseiller');
  await userEvent.click(screen.getByRole('button', { name: /Créer & tester/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Action impossible pour le moment. Réessayez.');
});

test('la personnalité de la langue par défaut est exigée : Créer & tester désactivé, raison sous le bouton', async () => {
  const state: WizardState = { ...TWO_LANGS, perLang: { ...TWO_LANGS.perLang, en: { mode: 'guided', role: '', tones: [], objective: '', info: '', raw: '' } } };
  vi.stubGlobal('fetch', vi.fn());
  renderStep(vi.fn(), state);
  const button = screen.getByRole('button', { name: /Créer & tester/ });
  expect(button).toBeDisabled();
  const reason = screen.getByText('Renseignez la personnalité de la langue par défaut (English).');
  expect(button).toHaveAttribute('aria-describedby', reason.id);
  expect(button.compareDocumentPosition(reason) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Advisor');
  expect(button).toBeEnabled();
  expect(screen.queryByText(/Renseignez la personnalité/)).not.toBeInTheDocument();
});

// recette Q-12
test('texte tapé sans Entrée : ajouté au champ envoyé à Créer & tester', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ bot_id: 'ventes' }), { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
  const { onCreated } = renderStep();
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Conseiller');
  await userEvent.type(screen.getByLabelText('Ajouter un champ'), 'e-mail');
  await userEvent.click(screen.getByRole('button', { name: /Créer & tester/ }));
  await waitFor(() => expect(onCreated).toHaveBeenCalled());
  const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  expect(body.lead_fields).toBe('e-mail');
  expect(screen.getByText('e-mail')).toBeInTheDocument();
  expect(screen.getByLabelText('Ajouter un champ')).toHaveValue('');
});

// recette Q-12
test('bouton Ajouter : ajoute le champ tapé, désactivé sans texte', async () => {
  vi.stubGlobal('fetch', vi.fn());
  renderStep();
  const add = screen.getByRole('button', { name: 'Ajouter' });
  expect(add).toBeDisabled();
  await userEvent.type(screen.getByLabelText('Ajouter un champ'), 'téléphone');
  await userEvent.click(add);
  expect(screen.getByText('téléphone')).toBeInTheDocument();
  expect(screen.getByLabelText('Ajouter un champ')).toHaveValue('');
  expect(add).toBeDisabled();
});

// recette Q-12
test('texte non ajouté déjà dans la liste : création bloquée, message sous le champ, rien d\'envoyé', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const { onCreated } = renderStep(vi.fn(), { ...baseState, leadFields: ['e-mail'] });
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Conseiller');
  await userEvent.type(screen.getByLabelText('Ajouter un champ'), 'e-mail');
  await userEvent.click(screen.getByRole('button', { name: /Créer & tester/ }));
  const message = screen.getByText('Ce champ est déjà dans la liste.');
  expect(message).toHaveClass('text-danger');
  expect(screen.getByLabelText('Ajouter un champ')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Ajouter un champ')).toHaveAttribute('aria-describedby', message.id);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(onCreated).not.toHaveBeenCalled();
  // Retaper efface le message.
  await userEvent.type(screen.getByLabelText('Ajouter un champ'), '2');
  expect(screen.queryByText('Ce champ est déjà dans la liste.')).not.toBeInTheDocument();
});

// recette Q-13
test('note sous la liste : ces informations ne sont pas encore visibles ni envoyées au CRM', () => {
  vi.stubGlobal('fetch', vi.fn());
  renderStep();
  expect(screen.getByText(
    'Ces informations sont collectées pendant les conversations. Elles ne sont pas encore visibles dans WABAGENT ni envoyées à votre CRM : ce sera possible avec la page Conversations & Leads.',
  )).toBeInTheDocument();
});
