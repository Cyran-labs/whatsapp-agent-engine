import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../../../messages/fr.json';
import type { Session } from '@/components/providers/session-provider';
import type { OrganizationSummary } from '@/lib/organizations';
import { expectCreateButton, expectNoOrgBlock, expectRailActive, headerActions, headerParents, headerTitle } from '@/components/shell/__tests__/frame-assertions';
import AccountLayout from '../layout';
import OrganisationsPage from '../organisations/page';
import PreferencesPage from '../preferences/page';
import SecuritePage from '../securite/page';

let pathname = '/account/organisations';
const push = vi.fn();
vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, className, ...rest }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className} {...rest}>{children}</a>
  ),
  usePathname: () => pathname,
  useRouter: () => ({ push, replace: vi.fn() }),
  routing: { locales: ['fr', 'en'], defaultLocale: 'fr' },
}));

let mockSession: Session;
vi.mock('@/components/providers/session-provider', () => ({
  useSession: () => mockSession,
}));

const switchOrg = vi.fn();

const ml: OrganizationSummary = { client_id: 'ml', name: 'Maison Lumière', role: 'admin', read_only: false };
const an: OrganizationSummary = { client_id: 'an', name: 'Atelier Nord', role: 'advisor', read_only: false };
const so: OrganizationSummary = { client_id: 'so', name: 'Studio Ocre', role: 'admin', read_only: false, status: 'suspended' };

function session(orgs: OrganizationSummary[], over: Partial<Session> = {}): Session {
  return {
    me: { id: 1, email: 'claire.bernard@maison-lumiere.fr', role: 'user', status: 'active', organizations: orgs },
    activeOrg: orgs[0] ?? null,
    isPlatformAdmin: false,
    isAdmin: true,
    readOnly: false,
    switchOrg,
    notice: null,
    dismissNotice: vi.fn(),
    refresh: vi.fn(),
    ...over,
  };
}

function renderIn(ui: React.ReactNode) {
  return render(<NextIntlClientProvider locale="fr" messages={messages}>{ui}</NextIntlClientProvider>);
}

beforeEach(() => {
  vi.restoreAllMocks();
  push.mockReset();
  pathname = '/account/organisations';
  switchOrg.mockReset();
  switchOrg.mockResolvedValue({ ok: true });
});

test('layout : rail « Mon compte » avec l\'e-mail en titre et trois entrées', () => {
  mockSession = session([ml, an, so]);
  renderIn(<AccountLayout><p>contenu</p></AccountLayout>);
  const rail = screen.getByRole('complementary');
  expect(within(rail).getByText('Mon compte')).toBeInTheDocument();
  expect(rail).toHaveTextContent('claire.bernard@maison-lumiere.fr');
  expect(within(rail).getByRole('link', { name: /Organisations/ })).toHaveAttribute('href', '/account/organisations');
  expect(within(rail).getByRole('link', { name: 'Préférences' })).toHaveAttribute('href', '/account/preferences');
  expect(within(rail).getByRole('link', { name: 'Sécurité' })).toHaveAttribute('href', '/account/securite');
  expect(within(rail).getByRole('link', { name: /Organisations/ })).toHaveAttribute('aria-current', 'page');
  expect(within(rail).getByRole('link', { name: 'Préférences' })).not.toHaveAttribute('aria-current');
  expect(screen.getByText('contenu')).toBeInTheDocument();
});

// spec 5.1, 11 : rail Compte actif, colonne « Mon compte » sans bloc Organisation
test('layout : rail Compte actif, colonne sans bloc Organisation', () => {
  mockSession = session([ml, an]);
  renderIn(<AccountLayout><p>contenu</p></AccountLayout>);
  expectRailActive('account');
  expectNoOrgBlock();
});

// spec 11 : « Se déconnecter » en bas de la colonne du compte (le menu de l'avatar n'existe plus)
test('« Se déconnecter » en bas de la colonne : appelle /api/auth/logout puis va sur /login', async () => {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  mockSession = session([ml]);
  renderIn(<AccountLayout><p>contenu</p></AccountLayout>);
  const column = screen.getByRole('complementary');
  const logout = within(column).getByRole('button', { name: 'Se déconnecter' });
  expect(column.lastElementChild).toContainElement(logout);
  expect(within(column).getByRole('link', { name: 'Sécurité' }).compareDocumentPosition(logout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await userEvent.click(logout);
  expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
  expect(push).toHaveBeenCalledWith('/login');
});

test('« Se déconnecter » : la déconnexion redirige même si l\'appel échoue', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('réseau'); }));
  mockSession = session([ml]);
  renderIn(<AccountLayout><p>contenu</p></AccountLayout>);
  await userEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
  expect(push).toHaveBeenCalledWith('/login');
});

// spec 5.1, 11 : sans organisation active, le rail n'a que la marque, Aide et Compte ; même colonne
test('sans organisation active : rail réduit, colonne du compte inchangée', () => {
  mockSession = session([so], { activeOrg: null, isAdmin: false });
  renderIn(<AccountLayout><p>contenu</p></AccountLayout>);
  const rail = screen.getByRole('navigation', { name: 'Navigation principale' });
  expect(Array.from(rail.querySelectorAll('[data-rail-entry]')).map((el) => el.getAttribute('data-rail-entry'))).toEqual(['brand', 'help', 'account']);
  expectRailActive('account');
  expect(within(screen.getByRole('complementary')).getByRole('link', { name: 'Sécurité' })).toBeInTheDocument();
});

// spec 11 ; spec en-tête 2.2 : première page de l'espace Compte, titre seul (nom de la page), phrase existante, aucune
// action ni ligne des parents ; le nom de l'organisation n'apparaît pas dans l'en-tête
test.each([
  ['/account/organisations', 'Organisations', 'Les organisations auxquelles vous avez accès, et votre rôle dans chacune.', <OrganisationsPage key="o" />],
  ['/account/preferences', 'Préférences', 'Mémorisés sur cet appareil.', <PreferencesPage key="p" />],
  ['/account/securite', 'Sécurité', null, <SecuritePage key="s" />],
])('%s : titre « %s » sans parents, aucune action', (path, label, description, page) => {
  pathname = path;
  mockSession = session([ml, an]);
  renderIn(<AccountLayout>{page}</AccountLayout>);
  expect(headerTitle()).toHaveTextContent(label);
  expect(headerParents()).toEqual([]);
  expect(headerActions()).toEqual([]);
  expectCreateButton(null);
  const header = document.querySelector('[data-page-header]') as HTMLElement;
  if (description) expect(header).toHaveTextContent(description);
  expect(header).not.toHaveTextContent('Mon compte');
});

// spec 11 : le compteur compte toutes les organisations listées dans le tableau, suspendues comprises (remplace la règle
// de l'audit R-13, qui ne comptait que les ouvrables)
test('layout : le compteur des organisations compte aussi les suspendues, comme le tableau', () => {
  mockSession = session([ml, an, so]);
  renderIn(<AccountLayout><OrganisationsPage /></AccountLayout>);
  const link = within(screen.getByRole('complementary')).getByRole('link', { name: /Organisations/ });
  expect(link).toHaveTextContent('3');
  expect(screen.getAllByRole('row').slice(1)).toHaveLength(3);
});

test('layout : sans aucune organisation, pas de compteur', () => {
  mockSession = session([], { activeOrg: null, isAdmin: false });
  renderIn(<AccountLayout><p>contenu</p></AccountLayout>);
  const link = within(screen.getByRole('complementary')).getByRole('link', { name: /Organisations/ });
  expect(link.textContent).not.toMatch(/\d/);
});

// spec 11 : « Mémorisés sur cet appareil. » sous le titre de Préférences, pour la langue et le thème
test('préférences : « Mémorisés sur cet appareil. » juste sous le titre, avant les réglages', () => {
  pathname = '/account/preferences';
  mockSession = session([ml]);
  renderIn(<PreferencesPage />);
  const heading = screen.getByRole('heading', { level: 1, name: 'Préférences' });
  const hint = screen.getByText('Mémorisés sur cet appareil.');
  // la ligne de description de l'en-tête suit la ligne du titre
  expect(heading.parentElement?.nextElementSibling).toBe(hint);
  expect(hint.compareDocumentPosition(screen.getByText("Langue de l'interface")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('layout : l\'entrée de la page courante est active', () => {
  pathname = '/account/securite';
  mockSession = session([ml]);
  renderIn(<AccountLayout><p>contenu</p></AccountLayout>);
  expect(screen.getByRole('link', { name: 'Sécurité' })).toHaveAttribute('aria-current', 'page');
});

test('organisations : ligne active, ligne ouvrable, ligne suspendue', () => {
  mockSession = session([ml, an, so]);
  renderIn(<OrganisationsPage />);
  const rows = screen.getAllByRole('row').slice(1);
  expect(rows).toHaveLength(3);

  expect(rows[0]).toHaveTextContent('Maison Lumière');
  expect(rows[0]).toHaveTextContent('Admin');
  // spec 6.4, 11 : « Ouverte » pour l'organisation en cours, « Active » pour une organisation ouvrable
  expect(within(rows[0]).getByText('Ouverte')).toBeInTheDocument();
  expect(rows[0]).not.toHaveTextContent('Organisation active');
  // la colonne d'action de l'organisation ouverte est vide : pas de redite « ouverte » à côté de la pastille
  expect(rows[0].textContent?.match(/ouverte/gi)).toHaveLength(1);
  expect(within(rows[0]).getAllByRole('cell').at(-1)).toBeEmptyDOMElement();
  expect(within(rows[0]).queryByRole('button')).toBeNull();

  expect(rows[1]).toHaveTextContent('Conseiller');
  expect(within(rows[1]).getByText('Active')).toBeInTheDocument();
  expect(rows[1]).not.toHaveTextContent('Actif');
  expect(within(rows[1]).getByRole('button', { name: 'Ouvrir →' })).toBeInTheDocument();

  expect(rows[2]).toHaveTextContent('Suspendue');
  expect(rows[2]).toHaveTextContent('indisponible');
  expect(within(rows[2]).queryByRole('button')).toBeNull();
});

test('organisations : « Ouvrir → » appelle switchOrg avec l\'organisation', async () => {
  mockSession = session([ml, an]);
  renderIn(<OrganisationsPage />);
  await userEvent.click(screen.getByRole('button', { name: 'Ouvrir →' }));
  expect(switchOrg).toHaveBeenCalledWith('an');
});

test('organisations : rôle super manager en lecture seule', () => {
  const gv: OrganizationSummary = { client_id: 'gv', name: 'Groupe Valmont', role: 'super_manager', read_only: true };
  mockSession = session([ml, gv]);
  renderIn(<OrganisationsPage />);
  expect(screen.getByText('Super manager · lecture seule')).toBeInTheDocument();
});

test('organisations : aucune organisation, état vide sans tableau', () => {
  mockSession = session([], { activeOrg: null });
  renderIn(<OrganisationsPage />);
  expect(screen.getByText('Aucune organisation pour le moment.')).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
});

// audit R-12
test('organisations : « Ouvrir → » refusé, le message est affiché sur la page et un double clic ne part qu\'une fois', async () => {
  let refuse: (value: { ok: false; message: string; reference: string | null }) => void = () => undefined;
  switchOrg.mockReturnValueOnce(new Promise((resolve) => { refuse = resolve; }));
  mockSession = session([ml, an]);
  renderIn(<OrganisationsPage />);
  await userEvent.dblClick(screen.getByRole('button', { name: /Ouvrir/ }));
  expect(switchOrg).toHaveBeenCalledTimes(1);
  refuse({ ok: false, message: 'Impossible d\'ouvrir Atelier Nord : vous n\'y avez plus accès.', reference: null });
  expect(await screen.findByRole('alert')).toHaveTextContent('Impossible d\'ouvrir Atelier Nord : vous n\'y avez plus accès.');
});

// recette 3.13 (C-15) : la suspension se dit par le bandeau, la page ne la répète pas
test('organisations : « Ouvrir → » refusé pour suspension, aucun message sur la page', async () => {
  switchOrg.mockResolvedValueOnce({ ok: false, suspended: true });
  mockSession = session([ml, an]);
  renderIn(<OrganisationsPage />);
  await userEvent.click(screen.getByRole('button', { name: /Ouvrir/ }));
  await waitFor(() => expect(switchOrg).toHaveBeenCalledWith('an'));
  await act(async () => {});
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

// audit R-14 (tâche 16b) : une panne serveur du changement d'organisation montre la référence de la requête
test('organisations : « Ouvrir → » en panne serveur, le message et la référence de la requête', async () => {
  switchOrg.mockResolvedValueOnce({ ok: false, message: 'Impossible d\'ouvrir Atelier Nord : l\'opération a échoué, réessayez.', reference: 'req-org-page' });
  mockSession = session([ml, an]);
  renderIn(<OrganisationsPage />);
  await userEvent.click(screen.getByRole('button', { name: /Ouvrir/ }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Impossible d\'ouvrir Atelier Nord : l\'opération a échoué, réessayez.');
  expect(alert).toHaveTextContent('Référence : req-org-page');
});
