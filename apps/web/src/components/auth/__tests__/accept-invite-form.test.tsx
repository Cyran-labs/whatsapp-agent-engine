import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import { AcceptInviteForm } from '../accept-invite-form';

const push = vi.fn();
vi.mock('@/i18n/routing', () => ({ useRouter: () => ({ push }), Link: (p: { children: React.ReactNode }) => p.children }));

beforeEach(() => { push.mockReset(); vi.restoreAllMocks(); });

function renderForm(token = 'tok-1') {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AcceptInviteForm token={token} />
    </NextIntlClientProvider>,
  );
}

test('mot de passe trop court : pas d\'appel fetch, message d\'erreur affiché', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  renderForm('tok-1');
  await userEvent.type(screen.getByLabelText('Nouveau mot de passe'), 'court');
  await userEvent.click(screen.getByRole('button', { name: 'Activer mon compte' }));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(await screen.findByRole('alert')).toBeInTheDocument();
});

test('succès : POST vers accept-invite puis redirection', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ user: { id: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  renderForm('tok-1');
  await userEvent.type(screen.getByLabelText('Nouveau mot de passe'), 'motdepasse12');
  await userEvent.click(screen.getByRole('button', { name: 'Activer mon compte' }));
  expect(fetchMock).toHaveBeenCalledWith('/api/auth/accept-invite', expect.objectContaining({ method: 'POST' }));
  expect(push).toHaveBeenCalledWith('/');
});

test('échec 401 : message d\'erreur invitation invalide affiché', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'x' } }), { status: 401, headers: { 'content-type': 'application/json' } })));
  renderForm('tok-1');
  await userEvent.type(screen.getByLabelText('Nouveau mot de passe'), 'motdepasse12');
  await userEvent.click(screen.getByRole('button', { name: 'Activer mon compte' }));
  expect(await screen.findByText('Invitation invalide ou expirée.')).toBeInTheDocument();
});
