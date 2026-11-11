import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import messagesEn from '../../../../messages/en.json';
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
function Harness({ onCreated, onIdentityRefused, initial }: {
  onCreated: (id: string, entityId: number | null) => void;
  onIdentityRefused: (errors: Record<string, string>) => void;
  initial: WizardState;
}) {
  const [state, setState] = useState<WizardState>(initial);
  const update = (p: Partial<WizardState>) => setState((s) => ({ ...s, ...p }));
  return <StepPersonality state={state} update={update} createdBotId={null} onCreated={onCreated} onIdentityRefused={onIdentityRefused} onBack={() => {}} />;
}

function renderStep(onCreated = vi.fn(), initial: WizardState = baseState, locale: 'fr' | 'en' = 'fr') {
  const onIdentityRefused = vi.fn();
  render(<NextIntlClientProvider locale={locale} messages={locale === 'fr' ? messages : messagesEn}><Harness onCreated={onCreated} onIdentityRefused={onIdentityRefused} initial={initial} /></NextIntlClientProvider>);
  return { onCreated, onIdentityRefused };
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

test('Créer et tester poste le draft puis appelle onCreated', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ bot_id: 'ventes', entity_id: 7 }), { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
  const { onCreated } = renderStep();
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Conseiller');
  await userEvent.click(screen.getByRole('button', { name: /Créer et tester/ }));
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
  await userEvent.click(screen.getByRole('button', { name: /Créer et tester/ }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith('ventes-2', null));
});

const ORG_CHANGED_BODY = { error: { code: 'ORG_CHANGED', message: 'Organisation modifiée dans un autre onglet.' } };

test('409 ORG_CHANGED (organisation changée dans un autre onglet) : pas de conflit de slug, aucun message', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(ORG_CHANGED_BODY), { status: 409 }));
  vi.stubGlobal('fetch', fetchMock);
  const { onCreated } = renderStep();
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Conseiller');
  await userEvent.click(screen.getByRole('button', { name: /Créer et tester/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Créer et tester/ })).not.toBeDisabled());
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
  await userEvent.click(screen.getByRole('button', { name: /Créer et tester/ }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(screen.getByRole('button', { name: /Créer et tester/ })).not.toBeDisabled());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(onCreated).not.toHaveBeenCalled();
});

// audit R-2
test('refus « Choisissez une entité » : retour à l\'étape 1 avec le message du champ, jamais « Vérifiez les champs »', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => refusal(400, 'VALIDATION_ERROR', 'Choisissez une entité.', {
    details: [{ path: 'entity_id', message: 'Choisissez une entité.' }], reason: 'bot.entity_required',
  })));
  const { onCreated, onIdentityRefused } = renderStep();
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Conseiller');
  await userEvent.click(screen.getByRole('button', { name: /Créer et tester/ }));
  await waitFor(() => expect(onIdentityRefused).toHaveBeenCalledWith({ entity_id: 'Choisissez une entité.' }));
  expect(onCreated).not.toHaveBeenCalled();
  expect(screen.queryByText(/Vérifiez les champs/)).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

// audit R-2
test('refus de la langue par défaut : son onglet s\'ouvre en erreur, avec le message du champ', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => refusal(400, 'VALIDATION_ERROR', 'Données invalides.', {
    details: [{ path: 'system_prompt', message: 'Aucune personnalité ni prompt pour la langue par défaut (en).' }], reason: 'bot.default_language_missing',
  })));
  const { onIdentityRefused } = renderStep(vi.fn(), TWO_LANGS);
  await userEvent.click(screen.getByRole('button', { name: 'Français' }));
  expect(screen.getByLabelText('Rôle / métier')).toHaveValue('Conseiller');
  await userEvent.click(screen.getByRole('button', { name: /Créer et tester/ }));
  const english = await screen.findByRole('button', { name: 'English' });
  await waitFor(() => expect(screen.getByLabelText('Rôle / métier')).toHaveValue('Advisor'));
  const message = screen.getByText('Décrivez la personnalité de l\'agent IA en anglais, la langue par défaut.');
  expect(message).toHaveClass('text-danger');
  expect(english).toHaveAttribute('aria-describedby', message.id);
  expect(english).toHaveClass('border-danger');
  expect(screen.getByRole('button', { name: 'Français' })).not.toHaveAttribute('aria-describedby');
  expect(screen.getByLabelText('Rôle / métier')).toHaveAttribute('aria-invalid', 'true');
  // contre-audit D-3 : le focus va au champ de la personnalité refusée
  await waitFor(() => expect(screen.getByLabelText('Rôle / métier')).toHaveFocus());
  expect(onIdentityRefused).not.toHaveBeenCalled();
  expect(screen.queryByText(/Vérifiez les champs/)).not.toBeInTheDocument();
  // Corriger la personnalité efface l'erreur.
  await userEvent.type(screen.getByLabelText('Objectif principal'), 'x');
  expect(screen.queryByText(/Décrivez la personnalité/)).not.toBeInTheDocument();
  expect(english).not.toHaveAttribute('aria-describedby');
  expect(english).not.toHaveClass('border-danger');
  expect(screen.getByLabelText('Rôle / métier')).not.toHaveAttribute('aria-invalid');
});

// audit R-2
test.each([
  // contre-audit D-2 : le texte des droits, jamais le texte brut du moteur
  [403, 'FORBIDDEN', 'Accès refusé.', "Vous n'avez pas les droits pour cette action."],
  [500, 'INTERNAL', 'Erreur interne.', 'Action impossible pour le moment. Réessayez.'],
])('refus %i : message propre sous le bouton, jamais « Vérifiez les champs »', async (status, code, message, shown) => {
  vi.stubGlobal('fetch', vi.fn(async () => refusal(status, code, message, status === 500 ? { request_id: 'req-abc' } : {})));
  renderStep();
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Conseiller');
  await userEvent.click(screen.getByRole('button', { name: /Créer et tester/ }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(shown);
  if (status === 500) expect(alert).toHaveTextContent('Référence : req-abc');
  expect(alert).not.toHaveTextContent('Vérifiez les champs');
  if (status === 403) expect(alert).not.toHaveTextContent('Accès refusé.');
  expect(screen.getByRole('button', { name: /Créer et tester/ })).toBeEnabled();
  // Le message précède le bouton dans la page ? Non : il est sous le bouton (après lui dans le document).
  const button = screen.getByRole('button', { name: /Créer et tester/ });
  expect(button.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('réseau coupé : message propre, bouton de nouveau actif', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  renderStep();
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Conseiller');
  await userEvent.click(screen.getByRole('button', { name: /Créer et tester/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Action impossible pour le moment. Réessayez.');
});

test('la personnalité de la langue par défaut est exigée : Créer et tester désactivé, raison sous le bouton', async () => {
  const state: WizardState = { ...TWO_LANGS, perLang: { ...TWO_LANGS.perLang, en: { mode: 'guided', role: '', tones: [], objective: '', info: '', raw: '' } } };
  vi.stubGlobal('fetch', vi.fn());
  renderStep(vi.fn(), state);
  const button = screen.getByRole('button', { name: /Créer et tester/ });
  expect(button).toBeDisabled();
  const reason = screen.getByText('Renseignez la personnalité de la langue par défaut (anglais).');
  expect(button).toHaveAttribute('aria-describedby', reason.id);
  expect(button.compareDocumentPosition(reason) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Advisor');
  expect(button).toBeEnabled();
  expect(screen.queryByText(/Renseignez la personnalité/)).not.toBeInTheDocument();
});

// recette Q-12
test('texte tapé sans Entrée : ajouté au champ envoyé à Créer et tester', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ bot_id: 'ventes' }), { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
  const { onCreated } = renderStep();
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Conseiller');
  await userEvent.type(screen.getByLabelText('Ajouter un champ'), 'e-mail');
  await userEvent.click(screen.getByRole('button', { name: /Créer et tester/ }));
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
  await userEvent.click(screen.getByRole('button', { name: /Créer et tester/ }));
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

// audit R-2
test('refus de la langue par défaut : texte de l\'interface qui nomme la langue, jamais « prompt » ni le texte du moteur', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => refusal(400, 'VALIDATION_ERROR', 'Données invalides.', {
    details: [{ path: 'system_prompt', message: 'Aucune personnalité ni prompt pour la langue par défaut (fr).' }], reason: 'bot.default_language_missing',
  })));
  renderStep();
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Conseiller');
  await userEvent.click(screen.getByRole('button', { name: /Créer et tester/ }));
  const message = await screen.findByText('Décrivez la personnalité de l\'agent IA en français, la langue par défaut.');
  expect(message).toHaveClass('text-danger');
  expect(message.textContent).not.toMatch(/prompt/i);
  expect(screen.queryByText(/Aucune personnalité/)).not.toBeInTheDocument();
});

// audit R-2
test('refus de la langue par défaut en anglais : texte anglais qui nomme la langue', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => refusal(400, 'VALIDATION_ERROR', 'Données invalides.', {
    details: [{ path: 'system_prompt', message: 'Aucune personnalité ni prompt pour la langue par défaut (en).' }], reason: 'bot.default_language_missing',
  })));
  renderStep(vi.fn(), TWO_LANGS, 'en');
  await userEvent.click(screen.getByRole('button', { name: /Create and test/ }));
  const message = await screen.findByText('Describe the AI agent\'s personality in English, the default language.');
  expect(message).toHaveClass('text-danger');
  expect(screen.queryByText(/Aucune personnalité/)).not.toBeInTheDocument();
});

// audit R-2
test('refus sur le nom (champ de l\'étape 1) : retour à l\'étape 1 avec le message du champ', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => refusal(400, 'VALIDATION_ERROR', 'Données invalides.', {
    details: [{ path: 'name', message: 'Le nom est requis.' }],
  })));
  const { onIdentityRefused, onCreated } = renderStep();
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Conseiller');
  await userEvent.click(screen.getByRole('button', { name: /Créer et tester/ }));
  await waitFor(() => expect(onIdentityRefused).toHaveBeenCalledWith({ name: 'Le nom est requis.' }));
  expect(onCreated).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

// audit R-2
test('refus sur bot_id (le champ identifiant de l\'étape 1) : retour à l\'étape 1 avec le message du champ', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => refusal(400, 'VALIDATION_ERROR', 'Données invalides.', {
    details: [{ path: 'bot_id', message: 'bot_id: minuscules, chiffres, tirets.' }],
  })));
  const { onIdentityRefused, onCreated } = renderStep();
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Conseiller');
  await userEvent.click(screen.getByRole('button', { name: /Créer et tester/ }));
  await waitFor(() => expect(onIdentityRefused).toHaveBeenCalledWith({ bot_id: 'bot_id: minuscules, chiffres, tirets.' }));
  expect(onCreated).not.toHaveBeenCalled();
});

// audit R-2
test.each([
  ['le réseau tombe', () => { throw new TypeError('network'); }],
  ['la liste est illisible', () => new Response('pas du json', { status: 200 })],
])('collision de slug puis %s à la relecture des agents IA : message sous le bouton, bouton de nouveau actif', async (_name, second) => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(refusal(409, 'CONFLICT', 'bot_id déjà pris.', { reason: 'bot.id_taken' }))
    .mockImplementationOnce(async () => second());
  vi.stubGlobal('fetch', fetchMock);
  const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const { onCreated } = renderStep();
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Conseiller');
  await userEvent.click(screen.getByRole('button', { name: /Créer et tester/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Création impossible. Réessayez.');
  expect(screen.getByRole('button', { name: /Créer et tester/ })).toBeEnabled();
  expect(onCreated).not.toHaveBeenCalled();
  for (const call of err.mock.calls) expect(call.every((arg) => typeof arg === 'string')).toBe(true);
});

// recette Q-12
test('Ajouter désactivé : sa raison le décrit', () => {
  vi.stubGlobal('fetch', vi.fn());
  renderStep();
  const add = screen.getByRole('button', { name: 'Ajouter' });
  expect(add).toBeDisabled();
  const reason = document.getElementById(add.getAttribute('aria-describedby') ?? '');
  expect(reason).toHaveTextContent('Saisissez une information à collecter.');
});


// recette Q-13
test('note en anglais : « not yet visible in WABAGENT or sent to your CRM »', () => {
  vi.stubGlobal('fetch', vi.fn());
  renderStep(vi.fn(), baseState, 'en');
  expect(screen.getByText(/not yet visible in WABAGENT or sent to your CRM/)).toBeInTheDocument();
});

// contre-audit D-4 : les tons s'affichent dans la langue de l'interface ; la valeur envoyée au moteur ne change pas.
test.each([
  ['fr', ['Chaleureux', 'Professionnel', 'Concis', 'Enthousiaste', 'Formel']],
  ['en', ['Warm', 'Professional', 'Concise', 'Enthusiastic', 'Formal']],
] as const)('contre-audit D-4 : les tons sont affichés en %s', (locale, labels) => {
  renderStep(vi.fn(), baseState, locale);
  for (const label of labels) expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
  if (locale === 'en') expect(screen.queryByRole('button', { name: 'Chaleureux' })).not.toBeInTheDocument();
});

test('contre-audit D-4 : en anglais, choisir « Warm » envoie toujours la valeur « Chaleureux » au moteur', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ bot_id: 'ventes', entity_id: 7 }), { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
  const { onCreated } = renderStep(vi.fn(), baseState, 'en');
  await userEvent.type(screen.getByLabelText('Role / business'), 'Advisor');
  await userEvent.click(screen.getByRole('button', { name: 'Warm' }));
  await userEvent.click(screen.getByRole('button', { name: /Create and test/ }));
  await waitFor(() => expect(onCreated).toHaveBeenCalled());
  const body = JSON.parse(((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]).body as string);
  expect(body.personality.fr.tones).toEqual(['Chaleureux']);
});

// spec 12.2 (variante A) : champs de prompt agrandis en largeur et en hauteur, redimensionnables en hauteur
test('champs de prompt pleine largeur et redimensionnables : objectif sur 3 lignes, informations 300 px, accueil 96 px, mode avancé 320 px', async () => {
  renderStep();
  const objective = screen.getByLabelText('Objectif principal');
  expect(objective.tagName).toBe('TEXTAREA');
  expect(objective).toHaveAttribute('rows', '3');
  const info = screen.getByLabelText('Informations clés à connaître');
  expect(info).toHaveClass('min-h-[300px]');
  const welcome = screen.getByLabelText('Message d\'accueil');
  expect(welcome).toHaveClass('min-h-[96px]');
  for (const field of [objective, info, welcome]) expect(field).toHaveClass('w-full', 'resize-y');

  const advanced = screen.getByRole('button', { name: /Écrire vos propres instructions \(remplace le mode guidé\)/ });
  expect(advanced).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText(/Mode avancé|écrase le mode guidé/)).not.toBeInTheDocument();
  await userEvent.click(advanced);
  expect(advanced).toHaveAttribute('aria-expanded', 'true');
  const raw = screen.getByLabelText(/Écrire vos propres instructions/, { selector: 'textarea' });
  expect(raw).toHaveClass('min-h-[320px]', 'w-full', 'resize-y');
});

test('l\'objectif sur plusieurs lignes est bien envoyé', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ bot_id: 'ventes', entity_id: null }), { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
  renderStep();
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Conseiller');
  await userEvent.type(screen.getByLabelText('Objectif principal'), 'Prendre rendez-vous{Enter}Qualifier le besoin');
  await userEvent.click(screen.getByRole('button', { name: /Créer et tester/ }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const body = String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body);
  expect(body).toContain('Prendre rendez-vous\\nQualifier le besoin');
});

// relecture tâche 13, I-1 : refus de la personnalité survenu au renvoi avant un saut du stepper
test('refus de la personnalité reçu de l\'assistant : message et champ en erreur, comme pour « Créer et tester »', async () => {
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <StepPersonality state={baseState} update={vi.fn()} createdBotId="ventes" onCreated={vi.fn()} onIdentityRefused={vi.fn()} onBack={vi.fn()} personalityRefusal={1} />
    </NextIntlClientProvider>,
  );
  expect(await screen.findByText("Décrivez la personnalité de l'agent IA en français, la langue par défaut.")).toBeInTheDocument();
  expect(screen.getByLabelText('Rôle / métier')).toHaveAttribute('aria-invalid', 'true');
});

// relecture tâche 13, M-1 : le champ de lead tapé sans « Ajouter » est signalé à l'assistant
test('champ de lead tapé : le texte est remonté, puis vidé à l\'ajout et au démontage', async () => {
  const onLeadDraftChange = vi.fn();
  function Host() {
    const [state, setState] = useState<WizardState>(baseState);
    return <StepPersonality state={state} update={(p) => setState((s) => ({ ...s, ...p }))} createdBotId="ventes" onCreated={vi.fn()} onIdentityRefused={vi.fn()} onBack={vi.fn()} onLeadDraftChange={onLeadDraftChange} />;
  }
  const { unmount } = render(<NextIntlClientProvider locale="fr" messages={messages}><Host /></NextIntlClientProvider>);
  await userEvent.type(screen.getByLabelText('Ajouter un champ'), 'e-mail');
  expect(onLeadDraftChange).toHaveBeenLastCalledWith('e-mail');
  await userEvent.click(screen.getByRole('button', { name: /^Ajouter$/ }));
  expect(onLeadDraftChange).toHaveBeenLastCalledWith('');
  await userEvent.type(screen.getByLabelText('Ajouter un champ'), 'ville');
  unmount();
  expect(onLeadDraftChange).toHaveBeenLastCalledWith('');
});
