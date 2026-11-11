import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { vi, beforeEach, test, expect } from 'vitest';
import messages from '../../../../../../../messages/fr.json';
import { expectRailActive, trail } from '@/components/shell/__tests__/frame-assertions';
import NewAgentPage from '../page';

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
const query = vi.hoisted(() => ({ value: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(query.value) }));
vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
  usePathname: () => '/agents/new',
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  routing: { locales: ['fr', 'en'], defaultLocale: 'fr' },
}));
/** Propriétés reçues par l'assistant : son entité préremplie et la liste d'origine (C-7). */
vi.mock('@/components/wizard/wizard', () => ({
  Wizard: ({ initialEntityId, origin }: { initialEntityId: number | null; origin: unknown }) => (
    <div data-testid="wizard" data-entity={String(initialEntityId)} data-origin={JSON.stringify(origin)} />
  ),
}));

const session = vi.hoisted(() => ({ isAdmin: true, readOnly: false }));
vi.mock('@/components/providers/session-provider', () => {
  const org = { client_id: 'ml', name: 'Maison Lumière', role: 'advisor', read_only: false };
  return {
    useSession: () => ({
      me: { id: 1, email: 'claire@maison-lumiere.fr', role: 'user', status: 'active', organizations: [org] },
      activeOrg: org,
      isPlatformAdmin: false,
      isAdmin: session.isAdmin,
      readOnly: session.readOnly,
      switchOrg: vi.fn(),
      refresh: vi.fn(),
    }),
  };
});

beforeEach(() => {
  nav.replace.mockClear();
  query.value = '';
  session.isAdmin = true;
  session.readOnly = false;
});

function renderPage() {
  return render(<NextIntlClientProvider locale="fr" messages={messages}><NewAgentPage /></NextIntlClientProvider>);
}

test('admin : assistant de création affiché, pas de redirection', () => {
  renderPage();
  expect(screen.getByTestId('wizard')).toBeInTheDocument();
  expect(nav.replace).not.toHaveBeenCalled();
});

// spec 12.1 : le cadre normal (rail, colonne, barre) est posé par l'assistant, qui en tient l'état ; la page n'en ajoute
// pas un second (le mode concentré et son `<main>` propre ont disparu)
test('assistant de création : la page ne pose ni cadre ni zone principale autour de l\'assistant', () => {
  renderPage();
  expect(screen.queryByRole('main')).not.toBeInTheDocument();
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
});

// prototype 5 : refus sur place (spec 10.6), à la même adresse, jamais une redirection silencieuse
test.each([
  ['non-admin', { isAdmin: false, readOnly: false }],
  ['lecture seule', { isAdmin: true, readOnly: true }],
])('%s : page réservée sur place, assistant non rendu, aucune redirection', (_label, over) => {
  Object.assign(session, over);
  renderPage();
  expect(screen.getByRole('heading', { level: 1, name: 'Page réservée aux administrateurs' })).toBeInTheDocument();
  expect(screen.getByText('Cette page de l\'organisation Maison Lumière est réservée aux administrateurs.')).toBeInTheDocument();
  expect(trail()).toEqual(['Maison Lumière', 'Accès refusé']);
  expectRailActive(null);
  expect(screen.queryByTestId('wizard')).not.toBeInTheDocument();
  expect(nav.replace).not.toHaveBeenCalled();
});

// recette 3.14, C-7 : l'assistant reçoit la liste d'origine lue par `parseAgentFilter` ; l'entité préremplie n'est que
// celle d'une origine d'entité
test.each([
  ['', null, { kind: 'all' }],
  ['entity=1', 1, { kind: 'entity', entityId: 1 }],
  ['status=limited', null, { kind: 'status', status: 'limited' }],
  ['status=not_responding', null, { kind: 'not_responding' }],
  // valeurs invalides : toute la liste, rien de prérempli
  ['entity=abc&status=bogus', null, { kind: 'all' }],
])('adresse « ?%s » : entité préremplie %s, origine %j', (search, entity, origin) => {
  query.value = search;
  renderPage();
  const wizard = screen.getByTestId('wizard');
  expect(wizard).toHaveAttribute('data-entity', String(entity));
  expect(JSON.parse(wizard.getAttribute('data-origin') ?? 'null')).toEqual(origin);
});
