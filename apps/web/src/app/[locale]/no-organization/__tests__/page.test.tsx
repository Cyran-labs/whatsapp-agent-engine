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

beforeEach(() => {
  replace.mockReset();
  // sans autre consigne, la lecture de la session échoue : la page garde son texte général
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
});
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

function meWith(organizations: Array<{ name: string; status?: string }>) {
  const body = {
    user: {
      id: 1, email: 'claire@x.fr', role: 'user', status: 'active',
      organizations: organizations.map((o, i) => ({ client_id: `c${i}`, role: 'admin', read_only: false, ...o })),
    },
    active_client_id: null,
  };
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
}

// audit R-13
test('seule organisation suspendue : la page dit la suspension, la nomme, et ne parle pas d\'invitation', async () => {
  vi.stubGlobal('fetch', meWith([{ name: 'Studio Ocre', status: 'suspended' }]));
  renderPage();
  expect(
    await screen.findByText('Studio Ocre est suspendue. Contactez l\'administrateur de votre organisation ou le support.'),
  ).toBeInTheDocument();
  expect(screen.queryByText(/invitation/)).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Mon compte' })).toBeInTheDocument();
});

// audit R-13
test('plusieurs organisations suspendues : toutes nommées, accord au pluriel', async () => {
  vi.stubGlobal('fetch', meWith([
    { name: 'Studio Ocre', status: 'suspended' },
    { name: 'Atelier Nord', status: 'suspended' },
    { name: 'Maison Lumière', status: 'suspended' },
  ]));
  renderPage();
  expect(
    await screen.findByText(/Studio Ocre, Atelier Nord et Maison Lumière sont suspendues\. Contactez l'administrateur/),
  ).toBeInTheDocument();
});

// audit R-13
test('aucune appartenance : le texte général (invitation) reste', async () => {
  vi.stubGlobal('fetch', meWith([]));
  renderPage();
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/auth/me', { cache: 'no-store' }));
  expect(screen.getByText(/Si vous attendez une invitation/)).toBeInTheDocument();
});

test('Se déconnecter : POST /api/auth/logout puis /login, un seul appel en cas de double clic', async () => {
  const fetchMock = vi.fn(async (url: string) =>
    url === '/api/auth/me' ? new Response('{}', { status: 500 }) : new Response(null, { status: 204 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  renderPage();
  await userEvent.dblClick(screen.getByRole('button', { name: 'Se déconnecter' }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  const logouts = fetchMock.mock.calls.filter(([url]) => url === '/api/auth/logout');
  expect(logouts).toHaveLength(1);
  expect(logouts[0]).toEqual(['/api/auth/logout', { method: 'POST' }]);
});
