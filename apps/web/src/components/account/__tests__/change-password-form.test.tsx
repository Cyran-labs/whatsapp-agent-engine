import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import enMessages from '../../../../messages/en.json';
import { ChangePasswordForm } from '../change-password-form';

vi.mock('@/components/providers/session-provider', () => ({
  useSession: () => ({ me: { id: 1, email: 'claire.bernard@maison-lumiere.fr', role: 'user', status: 'active', organizations: [] } }),
}));

beforeEach(() => vi.restoreAllMocks());

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
