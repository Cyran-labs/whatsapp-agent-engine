import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import { LoginForm } from '../login-form';

const push = vi.fn();
vi.mock('@/i18n/routing', () => ({ useRouter: () => ({ push }), Link: (p: { children: React.ReactNode }) => p.children }));

beforeEach(() => { push.mockReset(); vi.restoreAllMocks(); });

function renderForm() {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <LoginForm />
    </NextIntlClientProvider>,
  );
}

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
