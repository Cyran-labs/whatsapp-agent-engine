import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import { ForgotPasswordForm } from '../forgot-password-form';
import { ResetPasswordForm } from '../reset-password-form';

const push = vi.fn();
vi.mock('@/i18n/routing', () => ({
  useRouter: () => ({ push }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

beforeEach(() => { push.mockReset(); vi.restoreAllMocks(); });

function wrap(node: React.ReactNode) {
  return render(<NextIntlClientProvider locale="fr" messages={messages}>{node}</NextIntlClientProvider>);
}

function reply(status: number, body?: unknown): Response {
  return body === undefined
    ? new Response(null, { status })
    : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const SENT = 'Si un compte existe pour cette adresse, un lien vous a été envoyé. Il est valable 2 heures.';

// ---- mot de passe oublié

test('demande : titre, consigne, champ et bouton du brief', () => {
  wrap(<ForgotPasswordForm />);
  expect(screen.getByRole('heading', { name: 'Mot de passe oublié' })).toBeInTheDocument();
  expect(screen.getByText('Indiquez votre adresse e-mail : si un compte existe, nous vous envoyons un lien pour choisir un nouveau mot de passe.')).toBeInTheDocument();
  expect(screen.getByLabelText('Adresse e-mail')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Recevoir un lien' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Retour à la connexion' })).toHaveAttribute('href', '/login');
});

test('demande : message de confirmation exact, formulaire remplacé, quand le BFF répond 204', async () => {
  const fetchMock = vi.fn(async () => reply(204));
  vi.stubGlobal('fetch', fetchMock);
  wrap(<ForgotPasswordForm />);
  await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'claire@maison-lumiere.fr');
  await userEvent.click(screen.getByRole('button', { name: 'Recevoir un lien' }));
  expect(await screen.findByText(SENT)).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith('/api/auth/forgot-password', expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'claire@maison-lumiere.fr' }) }));
  expect(screen.queryByLabelText('Adresse e-mail')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Recevoir un lien' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Retour à la connexion' })).toHaveAttribute('href', '/login');
});

test('demande : un incident serveur affiche une erreur et garde le formulaire', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply(500, { error: { code: 'INTERNAL', message: 'x' } })));
  wrap(<ForgotPasswordForm />);
  await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'claire@maison-lumiere.fr');
  await userEvent.click(screen.getByRole('button', { name: 'Recevoir un lien' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Envoi impossible pour le moment. Réessayez.');
  expect(screen.queryByText(SENT)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Recevoir un lien' })).toBeEnabled();
});

test('demande : 429 affiche le message de limitation et garde le formulaire', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply(429, { error: { code: 'RATE_LIMITED', message: 'x' } })));
  wrap(<ForgotPasswordForm />);
  await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'claire@maison-lumiere.fr');
  await userEvent.click(screen.getByRole('button', { name: 'Recevoir un lien' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Trop de tentatives. Réessayez dans un instant.');
  expect(screen.queryByText(SENT)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Recevoir un lien' })).toBeEnabled();
});

test('demande : adresse mal formée, pas d\'appel réseau', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  wrap(<ForgotPasswordForm />);
  await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'pas-un-email');
  await userEvent.click(screen.getByRole('button', { name: 'Recevoir un lien' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Saisissez une adresse e-mail valide.');
  expect(fetchMock).not.toHaveBeenCalled();
});

test('demande : un seul appel sur double clic', async () => {
  let release: (r: Response) => void = () => undefined;
  const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
  vi.stubGlobal('fetch', fetchMock);
  wrap(<ForgotPasswordForm />);
  await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'claire@maison-lumiere.fr');
  const button = screen.getByRole('button', { name: 'Recevoir un lien' });
  await userEvent.dblClick(button);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  release(reply(204));
  expect(await screen.findByText(SENT)).toBeInTheDocument();
});

test('demande avec invitation : le retour mène à l\'invitation, avant et après l\'envoi', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply(204)));
  wrap(<ForgotPasswordForm invite="tok 1" />);
  expect(screen.getByRole('link', { name: 'Retour à la connexion' })).toHaveAttribute('href', '/accept-invite?token=tok%201');
  await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'claire@maison-lumiere.fr');
  await userEvent.click(screen.getByRole('button', { name: 'Recevoir un lien' }));
  await screen.findByText(SENT);
  expect(screen.getByRole('link', { name: 'Retour à la connexion' })).toHaveAttribute('href', '/accept-invite?token=tok%201');
});

// ---- nouveau mot de passe

test('réinitialisation : 9 caractères refusés côté client, aucun appel', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  wrap(<ResetPasswordForm token="rtok" />);
  expect(screen.getByRole('heading', { name: 'Choisir un nouveau mot de passe' })).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Nouveau mot de passe'), '123456789');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Le mot de passe doit faire au moins 10 caractères.');
  expect(fetchMock).not.toHaveBeenCalled();
});

test('réinitialisation : jauge et mention des 10 caractères', () => {
  wrap(<ResetPasswordForm token="rtok" />);
  expect(screen.getByTestId('strength-meter')).toBeInTheDocument();
  expect(screen.getByText('10 caractères minimum.')).toBeInTheDocument();
});

test('réinitialisation : succès, redirection vers /login?reset=1', async () => {
  const fetchMock = vi.fn(async () => reply(204));
  vi.stubGlobal('fetch', fetchMock);
  wrap(<ResetPasswordForm token="rtok" />);
  await userEvent.type(screen.getByLabelText('Nouveau mot de passe'), 'motdepasse12');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(fetchMock).toHaveBeenCalledWith('/api/auth/reset-password', expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 'rtok', password: 'motdepasse12' }) }));
  expect(push).toHaveBeenCalledWith('/login?reset=1');
});

test('réinitialisation avec invitation : succès, redirection vers l\'invitation', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply(204)));
  wrap(<ResetPasswordForm token="rtok" invite="tok 1" />);
  await userEvent.type(screen.getByLabelText('Nouveau mot de passe'), 'motdepasse12');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(push).toHaveBeenCalledWith('/accept-invite?token=tok%201');
});

test('réinitialisation : 401 affiche le message d\'expiration et le lien vers /forgot-password', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply(401, { error: { code: 'UNAUTHORIZED', message: 'Lien de réinitialisation invalide ou expiré.' } })));
  wrap(<ResetPasswordForm token="rtok" />);
  await userEvent.type(screen.getByLabelText('Nouveau mot de passe'), 'motdepasse12');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Lien de réinitialisation invalide ou expiré.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Recevoir un nouveau lien' })).toHaveAttribute('href', '/forgot-password');
  expect(screen.queryByLabelText('Nouveau mot de passe')).not.toBeInTheDocument();
  expect(push).not.toHaveBeenCalled();
});

test('réinitialisation : 429 affiche la limitation sans basculer en lien expiré', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply(429, { error: { code: 'RATE_LIMITED', message: 'x' } })));
  wrap(<ResetPasswordForm token="rtok" />);
  await userEvent.type(screen.getByLabelText('Nouveau mot de passe'), 'motdepasse12');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Trop de tentatives. Réessayez dans un instant.');
  expect(screen.getByLabelText('Nouveau mot de passe')).toBeInTheDocument();
});

test('réinitialisation : jeton absent, état « lien expiré » directement et aucun appel', () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  wrap(<ResetPasswordForm token="" invite="tok-1" />);
  expect(screen.getByText('Lien de réinitialisation invalide ou expiré.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Recevoir un nouveau lien' })).toHaveAttribute('href', '/forgot-password?invite=tok-1');
  expect(fetchMock).not.toHaveBeenCalled();
});

test('réinitialisation : un seul appel sur double clic', async () => {
  let release: (r: Response) => void = () => undefined;
  const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
  vi.stubGlobal('fetch', fetchMock);
  wrap(<ResetPasswordForm token="rtok" />);
  await userEvent.type(screen.getByLabelText('Nouveau mot de passe'), 'motdepasse12');
  await userEvent.dblClick(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  release(reply(204));
  await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));
});
