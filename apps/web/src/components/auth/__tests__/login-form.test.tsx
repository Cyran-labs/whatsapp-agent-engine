import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import enMessages from '../../../../messages/en.json';
import { LoginForm } from '../login-form';

const push = vi.fn();
vi.mock('@/i18n/routing', () => ({ useRouter: () => ({ push }), Link: (p: { children: React.ReactNode }) => p.children }));

beforeEach(() => { push.mockReset(); vi.restoreAllMocks(); });

function renderForm(props: React.ComponentProps<typeof LoginForm> = {}, locale: 'fr' | 'en' = 'fr') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? messages : enMessages}>
      <LoginForm {...props} />
    </NextIntlClientProvider>,
  );
}

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText(/Adresse e-mail|Email address/), 'demo@example.com');
  await userEvent.type(screen.getByLabelText(/Mot de passe|Password/), 'motdepasse12');
  await userEvent.click(screen.getByRole('button', { name: /Se connecter|Sign in/ }));
}

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const OUTAGE = 'Connexion impossible pour le moment. Réessayez dans un instant.';

test('erreur de validation locale : champ requis, pas d\'appel réseau', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  renderForm();
  await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
  expect(fetchMock).not.toHaveBeenCalled();
});

test('login réussi : POST puis redirection', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ user: { id: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  renderForm();
  await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'demo@example.com');
  await userEvent.type(screen.getByLabelText('Mot de passe'), 'motdepasse12');
  await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
  expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ method: 'POST' }));
  expect(push).toHaveBeenCalledWith('/');
});

test('identifiants invalides : message d\'erreur affiché', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'x' } }), { status: 401, headers: { 'content-type': 'application/json' } })));
  renderForm();
  await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'demo@example.com');
  await userEvent.type(screen.getByLabelText('Mot de passe'), 'motdepasse12');
  await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
  expect(await screen.findByText('Identifiants invalides.')).toBeInTheDocument();
});

// audit R-1 : une panne du moteur n'est jamais présentée comme des identifiants invalides
test.each([500, 502, 503])('panne du moteur (%i) : texte de panne, jamais « Identifiants invalides. »', async (status) => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes(status, { error: { code: 'INTERNAL', message: 'Erreur interne.' } })));
  renderForm();
  await fillAndSubmit();
  expect(await screen.findByRole('alert')).toHaveTextContent(OUTAGE);
  expect(screen.queryByText('Identifiants invalides.')).not.toBeInTheDocument();
  expect(push).not.toHaveBeenCalled();
});

// audit R-1
test('erreur réseau : texte de panne, jamais « Identifiants invalides. », le bouton est libéré', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
  renderForm();
  await fillAndSubmit();
  expect(await screen.findByRole('alert')).toHaveTextContent(OUTAGE);
  expect(screen.queryByText('Identifiants invalides.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Se connecter' })).toBeEnabled();
});

// audit R-1
test('panne : la référence de la requête est citée quand le BFF la donne', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes(500, { error: { code: 'INTERNAL', message: 'Erreur interne.', request_id: 'req-42' } })));
  renderForm();
  await fillAndSubmit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Référence : req-42');
});

// audit R-1
test('panne en anglais : texte anglais', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes(503, { error: { code: 'INTERNAL', message: 'Erreur interne.' } })));
  renderForm({}, 'en');
  await fillAndSubmit();
  expect(await screen.findByRole('alert')).toHaveTextContent(enMessages.auth.loginUnavailable);
});

// audit R-1
test('429 : trop de tentatives, pas de panne ni d\'identifiants invalides', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes(429, { error: { code: 'RATE_LIMITED', message: 'Trop de requêtes.' } })));
  renderForm();
  await fillAndSubmit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Trop de tentatives. Réessayez dans un instant.');
});

test('401 avec la clé auth.invalid_credentials : texte de la clé', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes(401, { error: { code: 'UNAUTHORIZED', message: 'x', reason: 'auth.invalid_credentials' } })));
  renderForm();
  await fillAndSubmit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Identifiants invalides.');
});

test('401 en anglais sans clé : identifiants invalides en anglais, pas le texte français du moteur', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes(401, { error: { code: 'UNAUTHORIZED', message: 'Identifiants invalides.' } })));
  renderForm({}, 'en');
  await fillAndSubmit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials.');
});

// audit R-10 : retour là où l'on était
test('redirectTo : la connexion réussie renvoie vers le chemin demandé, avec sa langue', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes(200, { user: { id: 1 } })));
  renderForm({ redirectTo: { path: '/organisation/membres?x=1', locale: 'fr' } });
  await fillAndSubmit();
  expect(push).toHaveBeenCalledWith('/organisation/membres?x=1', { locale: 'fr' });
});

test('redirectTo sans langue : poussé sans option', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes(200, { user: { id: 1 } })));
  renderForm({ redirectTo: { path: '/agents', locale: null } });
  await fillAndSubmit();
  expect(push).toHaveBeenCalledWith('/agents');
});
