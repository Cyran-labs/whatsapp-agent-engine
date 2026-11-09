import { render, screen, waitFor, within } from '@testing-library/react';
import { vi, test, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import type { Session } from '@/components/providers/session-provider';
import OrganisationLayout from '../../../app/[locale]/(app)/organisation/layout';
import ReglagesPage from '../../../app/[locale]/(app)/organisation/reglages/page';
import { OrganisationRail } from '../organisation-rail';

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

function stubFetch(visibility: string, entities: unknown[] = [entity(1), entity(2), entity(3), entity(4, 'archived')]) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/settings')) return new Response(JSON.stringify({ visibility, pool_self_claim: true }), { status: 200 });
    if (url.startsWith('/api/entities')) return new Response(JSON.stringify(entities), { status: 200 });
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

test('rail Organisation : titre, quatre entrées, compteurs fournis seulement', () => {
  renderIn(<OrganisationRail activeKey="reglages" counts={{ entities: 3 }} />);
  expect(screen.getByText('Organisation')).toBeInTheDocument();
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
  expect(screen.getByText('Maison Lumière', { selector: 'div' })).toBeInTheDocument();
  const entites = screen.getByRole('link', { name: /Entités/ });
  await waitFor(() => expect(within(entites).getByText('3')).toBeInTheDocument());
  expect(replace).not.toHaveBeenCalled();
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
  for (const card of [entities, pool]) {
    expect(card).toHaveAttribute('aria-checked', 'false');
    expect(card).toHaveAttribute('aria-disabled', 'true');
    expect(within(card).getByText('bientôt disponible')).toBeInTheDocument();
  }
  expect(within(all).queryByText('bientôt disponible')).not.toBeInTheDocument();
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

test('Réglages : échec de lecture signalé, aucune carte cochée', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
  renderIn(<ReglagesPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Une erreur est survenue.');
  for (const radio of screen.getAllByRole('radio')) expect(radio).toHaveAttribute('aria-checked', 'false');
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
