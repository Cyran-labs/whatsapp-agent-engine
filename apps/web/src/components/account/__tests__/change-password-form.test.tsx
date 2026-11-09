import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach, afterEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import enMessages from '../../../../messages/en.json';
import { bindApiFetch, type ApiFetchBinding } from '@/lib/api-fetch';
import { ChangePasswordForm } from '../change-password-form';

vi.mock('@/components/providers/session-provider', () => ({
  useSession: () => ({ me: { id: 1, email: 'claire.bernard@maison-lumiere.fr', role: 'user', status: 'active', organizations: [] } }),
}));

let binding: ApiFetchBinding;
beforeEach(() => {
  vi.restoreAllMocks();
  binding = { displayedOrg: 'c1', onOrgChanged: vi.fn(), onOrgError: vi.fn(), onUnauthorized: vi.fn() };
  bindApiFetch(binding);
});
afterEach(() => bindApiFetch(null));

function renderForm(locale: 'fr' | 'en' = 'fr') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? messages : enMessages}>
      <ChangePasswordForm />
    </NextIntlClientProvider>,
  );
}

async function fill(current: string, next: string) {
  await userEvent.type(screen.getByLabelText('Mot de passe actuel'), current);
  await userEvent.type(screen.getByLabelText('Nouveau mot de passe'), next);
}

const submit = () => userEvent.click(screen.getByRole('button', { name: 'Changer le mot de passe' }));

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('e-mail en lecture seule avec son aide', () => {
  renderForm();
  const email = screen.getByLabelText('Adresse e-mail');
  expect(email).toHaveValue('claire.bernard@maison-lumiere.fr');
  expect(email).toHaveAttribute('readonly');
  expect(screen.getByText("Sert d'identifiant, ne se modifie pas.")).toBeInTheDocument();
  expect(screen.getByText('10 caractères minimum.')).toBeInTheDocument();
});

test('nouveau mot de passe de 9 caractères : bloqué côté client avec le message traduit passwordTooShort', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  renderForm();
  await fill('ancien-mdp-12', '123456789');
  await submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Le mot de passe doit faire au moins 10 caractères.');
  expect(fetchMock).not.toHaveBeenCalled();
});

test('anglais : le message de longueur suit la locale, pas le texte français du contrat', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  renderForm('en');
  await userEvent.type(screen.getByLabelText('Current password'), 'ancien-mdp-12');
  await userEvent.type(screen.getByLabelText('New password'), '123456789');
  await userEvent.click(screen.getByRole('button', { name: enMessages.account.security.submit }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Password must be at least 10 characters.');
  expect(fetchMock).not.toHaveBeenCalled();
});

test('mot de passe actuel vide : message du contrat en français, pas d\'appel réseau', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  renderForm();
  await userEvent.type(screen.getByLabelText('Nouveau mot de passe'), 'nouveau-mdp-123');
  await submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Mot de passe actuel requis.');
  expect(fetchMock).not.toHaveBeenCalled();
});

test('400 sur current_password : affiche « Mot de passe actuel incorrect. » et garde les champs', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Mot de passe actuel incorrect.',
        details: [{ path: 'current_password', message: 'Mot de passe actuel incorrect.' }],
      },
    }, 400),
  ));
  renderForm();
  await fill('mauvais-mdp-12', 'nouveau-mdp-123');
  await submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Mot de passe actuel incorrect.');
  expect(screen.getByLabelText('Mot de passe actuel')).toHaveValue('mauvais-mdp-12');
});

test('succès : POST du contrat, confirmation, champs vidés', async () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  renderForm();
  await fill('ancien-mdp-12', 'nouveau-mdp-123');
  await submit();
  expect(await screen.findByText('Mot de passe modifié. Vos autres sessions ont été déconnectées.')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/auth/change-password',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ current_password: 'ancien-mdp-12', new_password: 'nouveau-mdp-123' }),
    }),
  );
  expect(screen.getByLabelText('Mot de passe actuel')).toHaveValue('');
  expect(screen.getByLabelText('Nouveau mot de passe')).toHaveValue('');
});

test('double clic : un seul appel', async () => {
  let resolve: (r: Response) => void = () => undefined;
  const fetchMock = vi.fn(() => new Promise<Response>((r) => { resolve = r; }));
  vi.stubGlobal('fetch', fetchMock);
  renderForm();
  await fill('ancien-mdp-12', 'nouveau-mdp-123');
  const button = screen.getByRole('button', { name: 'Changer le mot de passe' });
  await userEvent.dblClick(button);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  resolve(new Response(null, { status: 204 }));
  await waitFor(() => expect(button).not.toBeDisabled());
});

const currentPasswordRefused = () =>
  vi.fn(async () =>
    json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Mot de passe actuel incorrect.',
        details: [{ path: 'current_password', message: 'Mot de passe actuel incorrect.' }],
      },
    }, 400),
  );

test('anglais : le refus du mot de passe actuel est traduit, pas le message français du moteur', async () => {
  vi.stubGlobal('fetch', currentPasswordRefused());
  renderForm('en');
  await userEvent.type(screen.getByLabelText('Current password'), 'mauvais-mdp-12');
  await userEvent.type(screen.getByLabelText('New password'), 'nouveau-mdp-123');
  await userEvent.click(screen.getByRole('button', { name: enMessages.account.security.submit }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect.');
  expect(screen.queryByText('Mot de passe actuel incorrect.')).not.toBeInTheDocument();
});

test('autre 400 du moteur : son message est affiché tel quel', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    json({ error: { code: 'VALIDATION_ERROR', message: 'Trop de tentatives.', details: [{ path: 'new_password' }] } }, 400),
  ));
  renderForm();
  await fill('ancien-mdp-12', 'nouveau-mdp-123');
  await submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Trop de tentatives.');
});

// audit R-26
test('429 : texte traduit « Trop de tentatives. », pas le texte brut du moteur', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'RATE_LIMITED', message: 'Trop de requêtes.' } }, 429)));
  renderForm();
  await fill('ancien-mdp-12', 'nouveau-mdp-123');
  await submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Trop de tentatives. Réessayez dans un instant.');
  expect(screen.queryByText('Trop de requêtes.')).not.toBeInTheDocument();
});

// audit R-26
test('429 en anglais : texte anglais', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'RATE_LIMITED', message: 'Trop de requêtes.' } }, 429)));
  renderForm('en');
  await userEvent.type(screen.getByLabelText('Current password'), 'ancien-mdp-12');
  await userEvent.type(screen.getByLabelText('New password'), 'nouveau-mdp-123');
  await userEvent.click(screen.getByRole('button', { name: enMessages.account.security.submit }));
  expect(await screen.findByRole('alert')).toHaveTextContent(enMessages.errors.generic.rateLimited);
});

// audit R-26 : 401 passe par apiFetch, donc par la redirection de session
test('401 : redirection de session demandée, aucun « Session expirée. » affiché', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'UNAUTHORIZED', message: 'Session expirée.' } }, 401)));
  renderForm();
  await fill('ancien-mdp-12', 'nouveau-mdp-123');
  await submit();
  await waitFor(() => expect(binding.onUnauthorized).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('Session expirée.')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Changer le mot de passe' })).toBeEnabled();
});

// audit R-26 : l'en-tête d'organisation affichée accompagne l'appel comme pour le reste de l'application
test('l\'appel passe par apiFetch : organisation affichée transmise', async () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  renderForm();
  await fill('ancien-mdp-12', 'nouveau-mdp-123');
  await submit();
  await screen.findByText('Mot de passe modifié. Vos autres sessions ont été déconnectées.');
  const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
  expect(new Headers(init.headers).get('X-Wab-Org')).toBe('c1');
});

// audit R-26
test('panne 500 : texte générique et référence de la requête, pas « Erreur interne. »', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'INTERNAL', message: 'Erreur interne.', request_id: 'req-9' } }, 500)));
  renderForm();
  await fill('ancien-mdp-12', 'nouveau-mdp-123');
  await submit();
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Une erreur est survenue.');
  expect(alert).toHaveTextContent('Référence : req-9');
  expect(screen.queryByText('Erreur interne.')).not.toBeInTheDocument();
});

test('erreur réseau : texte générique, bouton libéré', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
  renderForm();
  await fill('ancien-mdp-12', 'nouveau-mdp-123');
  await submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Une erreur est survenue.');
  expect(screen.getByRole('button', { name: 'Changer le mot de passe' })).toBeEnabled();
});

test('clé auth.current_password_incorrect sans détail : texte du mot de passe actuel incorrect', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    json({ error: { code: 'VALIDATION_ERROR', message: 'Mot de passe actuel incorrect.', reason: 'auth.current_password_incorrect' } }, 400),
  ));
  renderForm('en');
  await userEvent.type(screen.getByLabelText('Current password'), 'mauvais-mdp-12');
  await userEvent.type(screen.getByLabelText('New password'), 'nouveau-mdp-123');
  await userEvent.click(screen.getByRole('button', { name: enMessages.account.security.submit }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect.');
});
