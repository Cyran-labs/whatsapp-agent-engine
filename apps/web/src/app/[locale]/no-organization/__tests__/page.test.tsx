import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { vi, beforeEach, afterEach, test, expect } from 'vitest';
import messages from '../../../../../messages/fr.json';
import NoOrganizationPage from '../page';

const replace = vi.fn();
vi.mock('@/i18n/routing', () => ({
  useRouter: () => ({ replace }),
  routing: { locales: ['fr', 'en'], defaultLocale: 'fr' },
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

function meWith(organizations: Array<{ name: string; status?: string; role?: string }>) {
  const body = {
    user: {
      id: 1, email: 'claire@x.fr', role: 'user', status: 'active',
      organizations: organizations.map((o, i) => ({ client_id: `c${i}`, role: 'advisor', read_only: false, ...o })),
    },
    active_client_id: null,
  };
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
}

beforeEach(() => {
  replace.mockReset();
  // sans autre consigne, la session se lit et ne porte aucune organisation
  vi.stubGlobal('fetch', meWith([]));
});
afterEach(() => vi.unstubAllGlobals());

// prototype 13 : « Mon compte » mène à Organisations (et non plus à Préférences)
test('affiche le message de la spec, le lien Mon compte vers Organisations et le bouton de déconnexion', async () => {
  renderPage();
  expect(
    await screen.findByText(
      "Vous n'avez accès à aucune organisation pour le moment. Si vous attendez une invitation, ouvrez le lien reçu par e-mail ; sinon contactez l'administrateur de votre organisation.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Mon compte' })).toHaveAttribute('href', '/account/organisations');
  expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeInTheDocument();
});

// prototype 13 : lecture de la session en échec, message distinct et « Réessayer », jamais le texte « aucune organisation »
test.each([
  ['réponse 500', () => vi.fn(async () => new Response('{}', { status: 500 }))],
  ['réseau coupé', () => vi.fn(async () => { throw new TypeError('Failed to fetch'); })],
])('lecture de la session en échec (%s) : message distinct et « Réessayer »', async (_label, makeFetch) => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', makeFetch());
  renderPage();
  expect(await screen.findByText('Impossible de lire votre session pour le moment.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  expect(screen.queryByText(/aucune organisation pour le moment/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Contactez/)).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Mon compte' })).toHaveAttribute('href', '/account/organisations');
});

// session perdue (401) : retour à la connexion comme ailleurs dans l'app, jamais « Impossible de lire votre session »
test('lecture de la session en 401 : renvoi vers la connexion avec la raison, sans message d\'erreur', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
  renderPage();
  await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
  expect(replace.mock.calls[0][0]).toMatch(/^\/login\?reason=session/);
  expect(screen.queryByText('Impossible de lire votre session pour le moment.')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
});

// prototype 13 : « Réessayer » relit la session et affiche le texte qui correspond
test('« Réessayer » relit la session puis affiche la suspension', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const ok = meWith([{ name: 'Studio Ocre', status: 'suspended' }]);
  const fetchMock = vi.fn()
    .mockImplementationOnce(async () => new Response('{}', { status: 500 }))
    .mockImplementation(ok);
  vi.stubGlobal('fetch', fetchMock);
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByText(/Studio Ocre est suspendue\./)).toBeInTheDocument();
  expect(screen.queryByText('Impossible de lire votre session pour le moment.')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

// prototype 13 : admin de toutes ses organisations suspendues, il n'a pas d'administrateur à contacter
test('organisations suspendues toutes en admin : « Contactez le support. » seul', async () => {
  vi.stubGlobal('fetch', meWith([
    { name: 'Studio Ocre', status: 'suspended', role: 'admin' },
    { name: 'Atelier Nord', status: 'suspended', role: 'admin' },
  ]));
  renderPage();
  expect(await screen.findByText('Studio Ocre et Atelier Nord sont suspendues. Contactez le support.')).toBeInTheDocument();
  expect(screen.queryByText(/administrateur/)).not.toBeInTheDocument();
});

// prototype 13 : admin d'une seule des organisations suspendues, l'administrateur de l'autre reste à contacter
test('organisations suspendues, admin d\'une seule : l\'administrateur ou le support', async () => {
  vi.stubGlobal('fetch', meWith([
    { name: 'Studio Ocre', status: 'suspended', role: 'admin' },
    { name: 'Atelier Nord', status: 'suspended', role: 'advisor' },
  ]));
  renderPage();
  expect(
    await screen.findByText("Studio Ocre et Atelier Nord sont suspendues. Contactez l'administrateur de votre organisation ou le support."),
  ).toBeInTheDocument();
});

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
  expect(await screen.findByText(/Si vous attendez une invitation/)).toBeInTheDocument();
});

// audit R-13 : le texte général (invitation) n'apparaît jamais, même un instant, pour un membre dont l'organisation est suspendue
test('lecture de la session en cours : aucun paragraphe ; le texte d\'invitation n\'est jamais dans le DOM pour un membre suspendu', async () => {
  let answer: (res: Response) => void = () => undefined;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; })));
  const seen: string[] = [];
  const observer = new MutationObserver(() => seen.push(document.body.textContent ?? ''));
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  renderPage();
  expect(screen.queryByText(/invitation/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Contactez/)).not.toBeInTheDocument();
  answer(new Response(JSON.stringify({
    user: { id: 1, email: 'c@x.fr', role: 'user', status: 'active', organizations: [{ client_id: 'c', name: 'Studio Ocre', role: 'admin', read_only: false, status: 'suspended' }] },
    active_client_id: null,
  }), { status: 200 }));
  await screen.findByText(/Studio Ocre est suspendue/);
  observer.disconnect();
  expect(seen.some((text) => text.includes('invitation'))).toBe(false);
});

test('Se déconnecter : POST /api/auth/logout puis /login, un seul appel en cas de double clic', async () => {
  const fetchMock = vi.fn(async (url: string) =>
    url === '/api/auth/me' ? new Response(JSON.stringify({ user: { id: 1, email: 'c@x.fr', role: 'user', status: 'active', organizations: [] }, active_client_id: null }), { status: 200 }) : new Response(null, { status: 204 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  renderPage();
  await userEvent.dblClick(screen.getByRole('button', { name: 'Se déconnecter' }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  const logouts = fetchMock.mock.calls.filter(([url]) => url === '/api/auth/logout');
  expect(logouts).toHaveLength(1);
  expect(logouts[0]).toEqual(['/api/auth/logout', { method: 'POST' }]);
});
