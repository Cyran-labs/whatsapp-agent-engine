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
import { NotificationProvider } from '@/components/feedback/notification-provider';
import {
  expectActionInBar,
  expectNoBarAction,
  expectOrgBlockFirst,
  expectRailActive,
  pageBar,
  trail,
} from '@/components/shell/__tests__/frame-assertions';
import { OrganisationRail } from '../organisation-rail';

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

test('colonne Organisation : bloc Organisation, libellé, quatre entrées, compteurs fournis seulement', () => {
  renderIn(<OrganisationRail activeKey="reglages" counts={{ entities: 3 }} />);
  expectOrgBlockFirst('Maison Lumière');
  expect(screen.getAllByText('Organisation')).toHaveLength(2);
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
  expect(alert).toHaveClass('text-danger-ink');
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

test('layout : un non-admin est redirigé vers / sans voir la page', async () => {
  mockSession = session({ isAdmin: false });
  stubFetch('all');
  renderIn(<OrganisationLayout><div>contenu</div></OrganisationLayout>);
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  expect(screen.queryByText('contenu')).not.toBeInTheDocument();
  expect(screen.queryByText('Organisation')).not.toBeInTheDocument();
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

// spec 5.1, 5.2, 10.7
test('layout : rail Organisation actif, bloc Organisation en tête de colonne, libellé « Organisation » dessous', async () => {
  stubFetch('all');
  renderIn(<OrganisationLayout><div>contenu</div></OrganisationLayout>);
  await waitFor(() => expect(within(screen.getByRole('link', { name: /Entités/ })).getByText('3')).toBeInTheDocument());
  expectRailActive('organisation');
  expectOrgBlockFirst('Maison Lumière');
  const column = screen.getByRole('complementary');
  expect(within(column).getAllByText('Organisation')).toHaveLength(2);
});

// spec 5.3, 10.7 : fil de chaque page de l'espace et action principale dans la barre du haut
test('Entités : fil « Org › Organisation › Entités », « + Nouvelle entité » dans la barre seulement', async () => {
  pathname = '/organisation/entites';
  stubFetch('all');
  renderIn(<NotificationProvider><OrganisationLayout><EntitesPage /></OrganisationLayout></NotificationProvider>);
  expect(await screen.findByText('E1')).toBeInTheDocument();
  expect(trail()).toEqual(['Maison Lumière', 'Organisation', 'Entités']);
  expect(within(pageBar()).getByRole('link', { name: 'Organisation' })).toHaveAttribute('href', '/organisation');
  expect(expectActionInBar('button', '+ Nouvelle entité')).toBeEnabled();
});

test('Utilisateurs : fil « Org › Organisation › Utilisateurs », « + Inviter » dans la barre seulement', async () => {
  pathname = '/organisation/utilisateurs';
  stubFetch('all');
  renderIn(<NotificationProvider><OrganisationLayout><UtilisateursPage /></OrganisationLayout></NotificationProvider>);
  await waitFor(() => expect(screen.getByRole('button', { name: '+ Inviter' })).toBeEnabled());
  expect(trail()).toEqual(['Maison Lumière', 'Organisation', 'Utilisateurs']);
  expectActionInBar('button', '+ Inviter');
});

test('Réglages : fil « Org › Organisation › Réglages », aucune action dans la barre', async () => {
  stubFetch('all');
  renderIn(<OrganisationLayout><ReglagesPage /></OrganisationLayout>);
  expect(await screen.findByRole('radio', { name: 'Tout le monde voit tout' })).toBeInTheDocument();
  expect(trail()).toEqual(['Maison Lumière', 'Organisation', 'Réglages']);
  expectNoBarAction();
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
  expect(screen.getByText("Règles qui s'appliquent à tous les membres de Maison Lumière.")).toBeInTheDocument();
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
