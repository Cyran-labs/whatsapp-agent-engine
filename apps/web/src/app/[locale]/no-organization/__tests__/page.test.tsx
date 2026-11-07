import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { vi, beforeEach, afterEach, test, expect } from 'vitest';
import messages from '../../../../../messages/fr.json';
import NoOrganizationPage from '../page';

const replace = vi.fn();
vi.mock('@/i18n/routing', () => ({
  useRouter: () => ({ replace }),
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

function renderPage() {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <NoOrganizationPage />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => replace.mockReset());
afterEach(() => vi.unstubAllGlobals());

test('affiche le message de la spec, le lien Mon compte et le bouton de déconnexion', () => {
  renderPage();
  expect(
    screen.getByText(
      "Vous n'avez accès à aucune organisation pour le moment. Si vous attendez une invitation, ouvrez le lien reçu par e-mail ; sinon contactez l'administrateur de votre organisation.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Mon compte' })).toHaveAttribute('href', '/account/preferences');
  expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeInTheDocument();
});

test('Se déconnecter : POST /api/auth/logout puis /login, un seul appel en cas de double clic', async () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  renderPage();
  await userEvent.dblClick(screen.getByRole('button', { name: 'Se déconnecter' }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
});
