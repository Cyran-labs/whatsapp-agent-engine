import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import type { Session } from '@/components/providers/session-provider';
import OrganisationLayout from '../../../app/[locale]/(app)/organisation/layout';
import ReglagesPage from '../../../app/[locale]/(app)/organisation/reglages/page';
import EntitesPage from '../../../app/[locale]/(app)/organisation/entites/page';
import UtilisateursPage from '../../../app/[locale]/(app)/organisation/utilisateurs/page';
import ConnexionsPage from '../../../app/[locale]/(app)/organisation/connexions/page';
import RaccorderPage from '../../../app/[locale]/(app)/organisation/connexions/raccorder/page';
import { NotificationProvider } from '@/components/feedback/notification-provider';
import {
  expectCreateButton,
  expectOrgBlockFirst,
  expectRailActive,
  headerActions,
  headerParents,
  headerTitle,
} from '@/components/shell/__tests__/frame-assertions';
import { OrganisationRail } from '../organisation-rail';
import { useOrganisationCounts } from '../organisation-counts';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));

let pathname = '/organisation/reglages';
const replace = vi.fn();
vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, className, ...rest }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className} {...rest}>{children}</a>
  ),
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), replace }),
  routing: { locales: ['fr', 'en'], defaultLocale: 'fr' },
}));

let mockSession: Session;
vi.mock('@/components/providers/session-provider', () => ({ useSession: () => mockSession }));

const org = { client_id: 'ml', name: 'Maison Lumière', role: 'admin' as const, read_only: false };
function session(over: Partial<Session> = {}): Session {
  return {
    me: { id: 1, email: 'claire@maison-lumiere.fr', role: 'user', status: 'active', organizations: [org] },
    activeOrg: org,
    isPlatformAdmin: false,
    isAdmin: true,
    readOnly: false,
    switchOrg: vi.fn(),
    notice: null,
    dismissNotice: vi.fn(),
    refresh: vi.fn(),
    ...over,
  };
}

const entity = (id: number, status: 'active' | 'archived' = 'active') => ({ id, name: `E${id}`, status, bots: 0, members: 0 });

function stubFetch(visibility: string, entities: unknown[] = [entity(1), entity(2), entity(3), entity(4, 'archived')], accounts: unknown[] = []) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/settings')) return new Response(JSON.stringify({ visibility, pool_self_claim: true }), { status: 200 });
    if (url.startsWith('/api/entities')) return new Response(JSON.stringify(entities), { status: 200 });
    if (url.startsWith('/api/whatsapp-accounts')) return new Response(JSON.stringify(accounts), { status: 200 });
    if (url.startsWith('/api/users') || url.startsWith('/api/invitations') || url.startsWith('/api/bots/summary')) {
      return new Response('[]', { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }));
}

function renderIn(ui: React.ReactNode) {
  return render(<NextIntlClientProvider locale="fr" messages={messages}>{ui}</NextIntlClientProvider>);
}

beforeEach(() => {
  vi.restoreAllMocks();
  replace.mockReset();
  pathname = '/organisation/reglages';
  mockSession = session();
});

// spec en-tête 2.3 : plus de libellé « Organisation » au-dessus des entrées, seul le bloc Organisation le dit
test('colonne Organisation : bloc Organisation, sans libellé au-dessus des entrées, quatre entrées, compteurs fournis seulement', () => {
  renderIn(<OrganisationRail activeKey="reglages" counts={{ entities: 3 }} />);
  expectOrgBlockFirst('Maison Lumière');
  expect(screen.getAllByText('Organisation')).toHaveLength(1);
  expect(document.querySelector('[data-org-block]')).toContainElement(screen.getByText('Organisation'));
  const entites = screen.getByRole('link', { name: /Entités/ });
  expect(entites).toHaveAttribute('href', '/organisation/entites');
  expect(within(entites).getByText('3')).toBeInTheDocument();
  const users = screen.getByRole('link', { name: /Utilisateurs/ });
  expect(users).toHaveAttribute('href', '/organisation/utilisateurs');
  expect(users.textContent).not.toMatch(/\d/);
  const connexions = screen.getByRole('link', { name: /Connexions/ });
  expect(connexions).toHaveAttribute('href', '/organisation/connexions');
  expect(connexions.textContent).not.toMatch(/\d/);
  expect(screen.getByRole('link', { name: /Réglages/ })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: /Réglages/ })).toHaveAttribute('href', '/organisation/reglages');
});

// spec 16 : place réservée, sans effet, qui le dit
test('spec 16 : « Marque et connaissances » après Réglages, grisée, non lien, pastille « Soon », bulle au focus', async () => {
  renderIn(<OrganisationRail activeKey="entites" counts={{}} />);
  const column = screen.getByRole('complementary');
  const entry = within(column).getByRole('link', { name: /Marque et connaissances/ });
  expect(entry).toHaveAttribute('aria-disabled', 'true');
  expect(entry).not.toHaveAttribute('href');
  expect(entry.tagName).not.toBe('A');
  expect(within(entry).getByText('Soon')).toBeInTheDocument();
  const labels = within(column).getAllByRole('link').map((a) => a.textContent ?? '');
  expect(labels.findIndex((l) => l.includes('Marque et connaissances'))).toBe(labels.findIndex((l) => l.includes('Réglages')) + 1);
  const bubble = document.getElementById(entry.getAttribute('aria-describedby') ?? '');
  expect(bubble).not.toBeVisible();
  await userEvent.tab();
  while (document.activeElement !== entry) await userEvent.tab();
  expect(bubble).toBeVisible();
  expect(entry).toHaveAccessibleDescription(
    'Disponible prochainement : la marque, le ton et la base documentaire de l\'organisation, de ses entités et de ses agents IA.',
  );
});

// prototype 17
test('prototype 17 : Connexions avec un compte en erreur, point rouge et « 1 en erreur » à la place du compteur gris', () => {
  renderIn(<OrganisationRail activeKey="entites" counts={{ connections: 3, connectionErrors: 1 }} />);
  const connexions = screen.getByRole('link', { name: /Connexions/ });
  const alert = within(connexions).getByText('1 en erreur');
  expect(alert).toHaveClass('text-danger-ink', 'bg-danger-soft');
  expect(within(connexions).queryByText('3')).not.toBeInTheDocument();
  expect(connexions.querySelector('[data-dot]')).toHaveClass('bg-danger');
});

test('Connexions sans compte en erreur : compteur gris, ni point rouge ni alerte', () => {
  renderIn(<OrganisationRail activeKey="entites" counts={{ connections: 3, connectionErrors: 0 }} />);
  const connexions = screen.getByRole('link', { name: /Connexions/ });
  expect(within(connexions).getByText('3')).toHaveClass('text-muted-2');
  expect(connexions).not.toHaveTextContent('en erreur');
  expect(connexions.querySelector('[data-dot]')).toBeNull();
});

test('layout : compte en erreur lu par /api/whatsapp-accounts, « 1 en erreur » sur l\'entrée Connexions', async () => {
  pathname = '/organisation/entites';
  stubFetch('all', undefined, [
    { id: 1, state: 'connected' },
    { id: 2, state: 'error' },
    { id: 3, state: 'disconnected' },
  ]);
  renderIn(<OrganisationLayout><div>x</div></OrganisationLayout>);
  const connexions = screen.getByRole('link', { name: /Connexions/ });
  await waitFor(() => expect(within(connexions).getByText('1 en erreur')).toBeInTheDocument());
});

function Refresh() {
  const { refreshCounts } = useOrganisationCounts();
  return <button type="button" onClick={refreshCounts}>relire</button>;
}

// relecture tâche 10, m-5 : un 409 ORG_CHANGED (organisation changée dans un autre onglet, la page se recharge) ne laisse
// pas les compteurs ni l'alerte de l'organisation précédente : la colonne repasse en chargement
test('layout : relecture en ORG_CHANGED, « 1 en erreur » et compteurs de l\'ancienne organisation retirés, squelettes', async () => {
  pathname = '/organisation/entites';
  stubFetch('all', undefined, [{ id: 2, state: 'error' }]);
  renderIn(<OrganisationLayout><Refresh /></OrganisationLayout>);
  const connexions = screen.getByRole('link', { name: /Connexions/ });
  await waitFor(() => expect(within(connexions).getByText('1 en erreur')).toBeInTheDocument());
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'ORG_CHANGED', message: 'Organisation changée.' } }), { status: 409 })));
  await userEvent.click(screen.getByRole('button', { name: 'relire' }));
  await waitFor(() => expect(connexions).not.toHaveTextContent('en erreur'));
  expect(within(screen.getByRole('link', { name: /Entités/ })).queryByText('3')).not.toBeInTheDocument();
  expect(connexions.querySelector('[data-skeleton]')).not.toBeNull();
});

// prototype 5 : refus sur place (spec 10.6, 10.7), à la même adresse, jamais une redirection silencieuse ; aucune
// route réservée n'est lue (compteurs de la colonne compris)
test.each([
  ['/organisation/entites', <EntitesPage key="e" />],
  ['/organisation/utilisateurs', <UtilisateursPage key="u" />],
  ['/organisation/reglages', <ReglagesPage key="r" />],
  ['/organisation/connexions', <ConnexionsPage key="c" />],
  // relecture tâche 11, M-2
  ['/organisation/connexions/raccorder', <RaccorderPage key="rc" />],
])('conseiller sur %s : page réservée sur place, sans redirection ni lecture', async (path, page) => {
  pathname = path;
  mockSession = session({ isAdmin: false, activeOrg: { ...org, role: 'advisor' } });
  stubFetch('all');
  renderIn(<NotificationProvider><OrganisationLayout>{page}</OrganisationLayout></NotificationProvider>);
  expect(screen.getByRole('heading', { level: 1, name: 'Page réservée aux administrateurs' })).toBeInTheDocument();
  expect(screen.getByText('Cette page de l\'organisation Maison Lumière est réservée aux administrateurs.')).toBeInTheDocument();
  // spec en-tête 2.2 : titre seul, sans ligne des parents ni action
  expect(headerTitle()).toHaveTextContent('Page réservée aux administrateurs');
  expect(headerParents()).toEqual([]);
  expect(headerActions()).toEqual([]);
  expectCreateButton(null);
  expectRailActive(null);
  expectOrgBlockFirst('Maison Lumière');
  expect(screen.queryByRole('link', { name: /Entités/ })).not.toBeInTheDocument();
  await act(async () => { await Promise.resolve(); });
  expect(replace).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

test('layout : un admin voit le rail avec le nom de l\'organisation et le nombre d\'entités actives', async () => {
  stubFetch('all');
  renderIn(<OrganisationLayout><div>contenu</div></OrganisationLayout>);
  expect(screen.getByText('contenu')).toBeInTheDocument();
  expectOrgBlockFirst('Maison Lumière');
  const entites = screen.getByRole('link', { name: /Entités/ });
  await waitFor(() => expect(within(entites).getByText('3')).toBeInTheDocument());
  expect(replace).not.toHaveBeenCalled();
});

// spec 5.1, 5.2, 10.7 ; spec en-tête 2.3 : « Organisation » n'est écrit qu'une fois dans la colonne, dans le bloc
test('layout : rail Organisation actif, bloc Organisation en tête de colonne, sans libellé « Organisation » dessous', async () => {
  stubFetch('all');
  renderIn(<OrganisationLayout><div>contenu</div></OrganisationLayout>);
  await waitFor(() => expect(within(screen.getByRole('link', { name: /Entités/ })).getByText('3')).toBeInTheDocument());
  expectRailActive('organisation');
  expectOrgBlockFirst('Maison Lumière');
  const column = screen.getByRole('complementary');
  expect(within(column).getAllByText('Organisation')).toHaveLength(1);
});

// spec en-tête 2.2 : première page de l'espace, titre seul sans ligne des parents ; bouton rond « Nouvelle entité »,
// qui ouvre la même ligne de création que l'ancien bouton ; description : phrase existante puis le nombre d'entités
test('Entités : titre seul, description avec le nombre, bouton rond « Nouvelle entité » qui ouvre la création', async () => {
  pathname = '/organisation/entites';
  stubFetch('all');
  renderIn(<NotificationProvider><OrganisationLayout><EntitesPage /></OrganisationLayout></NotificationProvider>);
  expect(await screen.findByText('E1')).toBeInTheDocument();
  expect(headerTitle()).toHaveTextContent('Entités');
  expect(headerParents()).toEqual([]);
  expect(headerActions()).toEqual(['Nouvelle entité']);
  const header = document.querySelector('[data-page-header]') as HTMLElement;
  // décision de François du 12 nov. 2026 (recette P-9) : phrase raccourcie, compte gardé
  expect(header).toHaveTextContent('Boutiques, équipes ou services. Chaque agent IA appartient à une entité. · 3 entités actives');
  const round = expectCreateButton('Nouvelle entité') as HTMLElement;
  expect(round.querySelector('[data-create-icon="entity"]')).not.toBeNull();
  expect(round).toBeEnabled();
  await userEvent.click(round);
  expect(screen.getByRole('textbox', { name: "Nom de l'entité" })).toBeInTheDocument();
});

// spec en-tête 2.2 : bouton rond « Inviter un utilisateur », qui ouvre le même tiroir que l'ancien bouton
test('Utilisateurs : titre seul, « n membres · n invitations en attente », bouton rond qui ouvre l\'invitation', async () => {
  pathname = '/organisation/utilisateurs';
  stubFetch('all');
  renderIn(<NotificationProvider><OrganisationLayout><UtilisateursPage /></OrganisationLayout></NotificationProvider>);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Inviter un utilisateur' })).toBeEnabled());
  expect(headerTitle()).toHaveTextContent('Utilisateurs');
  expect(headerParents()).toEqual([]);
  expect(headerActions()).toEqual(['Inviter un utilisateur']);
  expect(document.querySelector('[data-page-header]')).toHaveTextContent('0 membre · 0 invitation en attente');
  const round = expectCreateButton('Inviter un utilisateur') as HTMLElement;
  expect(round.querySelector('[data-create-icon="user"]')).not.toBeNull();
  await userEvent.click(round);
  expect(screen.getByRole('dialog', { name: 'Inviter un utilisateur' })).toBeInTheDocument();
});

// spec en-tête 7.5, P27 : Entités et Utilisateurs n'ont pas d'encart vide qui porte l'action : même sans ligne, le bouton
// rond reste, et l'action n'apparaît qu'une fois
test.each([
  ['/organisation/entites', <EntitesPage key="e" />, 'Nouvelle entité'],
  ['/organisation/utilisateurs', <UtilisateursPage key="u" />, 'Inviter un utilisateur'],
])('état vide sur %s : le bouton rond reste, une seule fois', async (path, page, name) => {
  pathname = path;
  stubFetch('all', []);
  renderIn(<NotificationProvider><OrganisationLayout>{page}</OrganisationLayout></NotificationProvider>);
  await waitFor(() => expect(screen.getByRole('button', { name })).toBeEnabled());
  expectCreateButton(name);
});

// P7, entête 5 : bouton rond seulement pour un administrateur d'une organisation qui n'est pas en lecture seule ; le
// conseiller est sur le refus sur place (test plus haut)
test.each([
  ['/organisation/entites', <EntitesPage key="e" />, 'Entités'],
  ['/organisation/utilisateurs', <UtilisateursPage key="u" />, 'Utilisateurs'],
])('organisation en lecture seule sur %s : aucun bouton rond', async (path, page, title) => {
  pathname = path;
  mockSession = session({ readOnly: true, activeOrg: { ...org, read_only: true } });
  stubFetch('all');
  renderIn(<NotificationProvider><OrganisationLayout>{page}</OrganisationLayout></NotificationProvider>);
  await act(async () => { await Promise.resolve(); });
  expect(headerTitle()).toHaveTextContent(title);
  expectCreateButton(null);
  expect(headerActions()).toEqual([]);
});

// spec en-tête 2.2, correction 14
test('Réglages : titre seul, phrase « de l\'organisation {nom} », aucune action', async () => {
  stubFetch('all');
  renderIn(<OrganisationLayout><ReglagesPage /></OrganisationLayout>);
  expect(await screen.findByRole('radio', { name: 'Tout le monde voit tout' })).toBeInTheDocument();
  expect(headerTitle()).toHaveTextContent('Réglages');
  expect(headerParents()).toEqual([]);
  expect(headerActions()).toEqual([]);
  expect(document.querySelector('[data-page-header]')).toHaveTextContent(
    "Règles qui s'appliquent à tous les membres de l'organisation Maison Lumière.",
  );
});

test('layout : clé active déduite de l\'URL', () => {
  pathname = '/organisation/entites';
  stubFetch('all');
  renderIn(<OrganisationLayout><div>x</div></OrganisationLayout>);
  expect(screen.getByRole('link', { name: /Entités/ })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: /Réglages/ })).not.toHaveAttribute('aria-current');
});

test('Réglages : trois cartes, seule « Tout le monde voit tout » est cochée', async () => {
  stubFetch('all');
  renderIn(<ReglagesPage />);
  expect(screen.getByRole('heading', { name: 'Réglages' })).toBeInTheDocument();
  expect(screen.getByText("Règles qui s'appliquent à tous les membres de l'organisation Maison Lumière.")).toBeInTheDocument();
  expect(screen.getByText('Visibilité des conversations et des leads')).toBeInTheDocument();
  const all = await screen.findByRole('radio', { name: 'Tout le monde voit tout' });
  await waitFor(() => expect(all).toHaveAttribute('aria-checked', 'true'));
  const entities = screen.getByRole('radio', { name: 'Chacun voit ses entités' });
  const pool = screen.getByRole('radio', { name: 'Chacun voit ses contacts et le pool' });
  // prototype 10 : modes indisponibles grisés, pastille « Soon », bulle « Disponible prochainement : … » au focus
  for (const card of [entities, pool]) {
    expect(card).toHaveAttribute('aria-checked', 'false');
    expect(card).toHaveAttribute('aria-disabled', 'true');
    expect(within(card).getByText('Soon')).toBeInTheDocument();
    expect(card).toHaveAccessibleDescription(/^Disponible prochainement : /);
    const bubble = document.getElementById(card.getAttribute('aria-describedby') ?? '');
    expect(bubble).not.toBeVisible();
    act(() => card.focus());
    expect(card).toHaveFocus();
    expect(bubble).toBeVisible();
  }
  // relecture tâche 10, m-3 : le mode en vigueur est aussi un arrêt du clavier, pas seulement les modes à venir
  expect(all).toHaveAttribute('tabindex', '0');
  expect(within(all).queryByText('Soon')).not.toBeInTheDocument();
  expect(all).not.toHaveAttribute('aria-describedby');
  expect(document.body.textContent).not.toContain('bientôt disponible');
  expect(screen.queryByRole('button', { name: /Enregistrer/ })).not.toBeInTheDocument();
  expect(screen.getByText(/Seul mode disponible aujourd'hui : rien à enregistrer\./)).toBeInTheDocument();
});

test('Réglages : la carte cochée reflète la visibilité renvoyée par le moteur', async () => {
  stubFetch('entities');
  renderIn(<ReglagesPage />);
  const entities = await screen.findByRole('radio', { name: 'Chacun voit ses entités' });
  await waitFor(() => expect(entities).toHaveAttribute('aria-checked', 'true'));
  expect(screen.getByRole('radio', { name: 'Tout le monde voit tout' })).toHaveAttribute('aria-checked', 'false');
});

// audit R-16
test('audit R-16 : Réglages, lecture en échec, encadré avec Réessayer et aucune carte (rien ne laisse croire à un réglage vide)', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
  renderIn(<ReglagesPage />);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Impossible de charger les réglages.');
  expect(screen.queryAllByRole('radio')).toHaveLength(0);
  expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  expect(screen.queryByText('Une erreur est survenue.')).not.toBeInTheDocument();
  stubFetch('entities');
  const user = userEvent.setup();
  await user.click(within(alert).getByRole('button', { name: 'Réessayer' }));
  const entities = await screen.findByRole('radio', { name: 'Chacun voit ses entités' });
  expect(entities).toHaveAttribute('aria-checked', 'true');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('Réglages : trois cartes squelettes pendant la lecture, puis les cartes', async () => {
  let release: (res: Response) => void = () => undefined;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
  const { container } = renderIn(<ReglagesPage />);
  expect(screen.getByText('Visibilité des conversations et des leads')).toBeInTheDocument();
  expect(screen.queryAllByRole('radio')).toHaveLength(0);
  expect(container.querySelectorAll('[data-skeleton-card]')).toHaveLength(3);
  expect(screen.queryByText(/Chargement/)).not.toBeInTheDocument();
  release(new Response(JSON.stringify({ visibility: 'all', pool_self_claim: true }), { status: 200 }));
  expect(await screen.findByRole('radio', { name: 'Tout le monde voit tout' })).toHaveAttribute('aria-checked', 'true');
  expect(container.querySelectorAll('[data-skeleton]')).toHaveLength(0);
});
