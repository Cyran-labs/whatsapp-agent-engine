import { render, screen, waitFor } from '@testing-library/react';
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
      <AcceptInviteForm token={token} organizationName="Maison Lumière" emailHint="l•••••@x.fr" />
    </NextIntlClientProvider>,
  );
}

test('mot de passe trop court : pas d\'appel fetch, message d\'erreur affiché', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  renderForm('tok-1');
  await userEvent.type(screen.getByLabelText('Mot de passe'), 'court');
  await userEvent.click(screen.getByRole('button', { name: 'Activer mon compte' }));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(await screen.findByRole('alert')).toBeInTheDocument();
});

test('succès avec organisation résolue : POST vers accept-invite puis accueil avec bienvenue', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ user: { id: 1 }, client_id: 'ml', organization_name: 'Maison Lumière' }), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  renderForm('tok-1');
  await userEvent.type(screen.getByLabelText('Mot de passe'), 'motdepasse12');
  await userEvent.click(screen.getByRole('button', { name: 'Activer mon compte' }));
  expect(fetchMock).toHaveBeenCalledWith('/api/auth/accept-invite', expect.objectContaining({ method: 'POST' }));
  await waitFor(() => expect(push).toHaveBeenCalledWith('/?welcome=1'));
});

test('succès sans organisation résolue (client_id nul) : accueil sans bandeau de bienvenue', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ user: { id: 1 }, client_id: null, organization_name: '' }), { status: 200, headers: { 'content-type': 'application/json' } })));
  renderForm('tok-1');
  await userEvent.type(screen.getByLabelText('Mot de passe'), 'motdepasse12');
  await userEvent.click(screen.getByRole('button', { name: 'Activer mon compte' }));
  await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
  expect(push).not.toHaveBeenCalledWith('/?welcome=1');
});

test('échec 401 : message d\'erreur invitation invalide affiché', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'x' } }), { status: 401, headers: { 'content-type': 'application/json' } })));
  renderForm('tok-1');
  await userEvent.type(screen.getByLabelText('Mot de passe'), 'motdepasse12');
  await userEvent.click(screen.getByRole('button', { name: 'Activer mon compte' }));
  expect(await screen.findByText('Invitation invalide ou expirée.')).toBeInTheDocument();
});

test('jauge : les segments s\'allument avec la robustesse du mot de passe', async () => {
  renderForm('tok-1');
  const lit = () => screen.getByTestId('strength-meter').querySelectorAll('.bg-success').length;
  expect(lit()).toBe(0);
  await userEvent.type(screen.getByLabelText('Mot de passe'), 'abcdefghiJ1');
  expect(lit()).toBe(3);
  expect(screen.getByText('10 caractères minimum.')).toBeInTheDocument();
  expect(screen.getByTestId('email-hint')).toHaveTextContent('l•••••@x.fr');
});

test('erreur serveur 500 : message d\'enregistrement, pas « invitation invalide »', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'x' } }), { status: 500, headers: { 'content-type': 'application/json' } })));
  renderForm('tok-1');
  await userEvent.type(screen.getByLabelText('Mot de passe'), 'motdepasse12');
  await userEvent.click(screen.getByRole('button', { name: 'Activer mon compte' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Enregistrement impossible pour le moment. Réessayez.');
  expect(screen.queryByText('Invitation invalide ou expirée.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Activer mon compte' })).toBeEnabled();
});

test('échec réseau (fetch rejette) : message d\'enregistrement', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
  renderForm('tok-1');
  await userEvent.type(screen.getByLabelText('Mot de passe'), 'motdepasse12');
  await userEvent.click(screen.getByRole('button', { name: 'Activer mon compte' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Enregistrement impossible pour le moment. Réessayez.');
});
