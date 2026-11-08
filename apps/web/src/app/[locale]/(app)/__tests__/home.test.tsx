import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../../messages/fr.json';
import Home from '../page';

const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(nav.search) }));

vi.mock('@/i18n/routing', () => ({
  Link: (p: { children: React.ReactNode; href: string; 'aria-current'?: 'page' }) => <a href={p.href} aria-current={p['aria-current']}>{p.children}</a>,
  usePathname: () => '/',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  routing: { locales: ['fr', 'en'], defaultLocale: 'fr' },
}));

const session = vi.hoisted(() => ({
  isAdmin: true,
  readOnly: false,
}));
vi.mock('@/components/providers/session-provider', () => {
  const org = { client_id: 'ml', name: 'Maison Lumière', role: 'admin', read_only: false };
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
  vi.restoreAllMocks();
  nav.search = '';
  session.isAdmin = true;
  session.readOnly = false;
});

function mkRow(bot_id: string, name: string, status: string, entity_id: number) {
  return { bot_id, name, slug: bot_id, status, default_language: 'fr', languages: ['fr'], numbers: [], messages_total: 0, leads_total: 0, personalized: true, entity_id };
}
const entity = (id: number, name: string, status: 'active' | 'archived' = 'active') => ({ id, name, status, bots: 0, members: 0 });

function stubFetch(rows: unknown[], entities: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/entities')) return new Response(JSON.stringify(entities), { status: 200 });
    return new Response(JSON.stringify(rows), { status: 200 });
  }));
}

function renderHome() {
  return render(<NextIntlClientProvider locale="fr" messages={messages}><Home /></NextIntlClientProvider>);
}

const THREE = [entity(1, 'Service client'), entity(2, 'Boutique Paris Marais'), entity(3, 'Boutique Lyon')];
const ROWS = [
  mkRow('a', 'Support client', 'active', 1),
  mkRow('b', 'SAV commandes', 'paused', 1),
  mkRow('c', 'Conseil Marais', 'active', 2),
  mkRow('d', 'Brouillon Lyon', 'draft', 3),
];

test('0 bot → first-run (CTA creer premier agent), sans rail', async () => {
  stubFetch([], [entity(1, 'Principale')]);
  renderHome();
  expect(await screen.findByText('Créer mon premier agent IA')).toBeInTheDocument();
  expect(screen.queryByText('Tous les agents IA')).not.toBeInTheDocument();
});

test('>=1 bot → table d agents (titre Agents + nom + CTA Creer un agent)', async () => {
  stubFetch([mkRow('a', 'Assistant A', 'draft', 1)], [entity(1, 'Principale')]);
  renderHome();
  await waitFor(() => expect(screen.getByText('Assistant A')).toBeInTheDocument());
  expect(screen.getByRole('heading', { name: 'Tous les agents IA' })).toBeInTheDocument();
  expect(screen.getByText('+ Créer un agent IA')).toBeInTheDocument();
});

test('3 entités actives : rail avec Tous, groupe Entités avec compteurs, groupe Statut', async () => {
  stubFetch(ROWS, THREE);
  renderHome();
  const rail = await screen.findByRole('complementary');
  await waitFor(() => expect(within(rail).getByText('Service client')).toBeInTheDocument());
  expect(within(rail).getByText('Maison Lumière')).toBeInTheDocument();
  const link = (label: string) => within(rail).getByText(label).closest('a') as HTMLAnchorElement;
  expect(link('Tous les agents IA')).toHaveAttribute('href', '/');
  expect(link('Tous les agents IA')).toHaveTextContent('4');
  expect(within(rail).getByText('Entités')).toBeInTheDocument();
  expect(link('Service client')).toHaveAttribute('href', '/?entity=1');
  expect(link('Service client')).toHaveTextContent('2');
  expect(link('Boutique Lyon')).toHaveTextContent('1');
  expect(within(rail).getByText('Statut')).toBeInTheDocument();
  expect(link('Actifs')).toHaveAttribute('href', '/?status=active');
  expect(link('Actifs')).toHaveTextContent('2');
  expect(link('En pause')).toHaveTextContent('1');
  expect(link('Brouillons')).toHaveTextContent('1');
  expect(screen.getByRole('columnheader', { name: 'Entité' })).toBeInTheDocument();
});

test('une seule entité active : pas de groupe Entités ni de colonne Entité, groupe Statut présent', async () => {
  stubFetch(ROWS, [entity(1, 'Principale'), entity(2, 'Ancienne', 'archived')]);
  renderHome();
  const rail = await screen.findByRole('complementary');
  await waitFor(() => expect(screen.getByText('Support client')).toBeInTheDocument());
  expect(within(rail).queryByText('Entités')).not.toBeInTheDocument();
  expect(within(rail).getByText('Statut')).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Entité' })).not.toBeInTheDocument();
});

test('filtre entité : seules ses lignes, titre = nom de l entité, pas de colonne Entité, création présélectionnée', async () => {
  nav.search = 'entity=2';
  stubFetch(ROWS, THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('Conseil Marais')).toBeInTheDocument());
  expect(screen.queryByText('Support client')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Boutique Paris Marais' })).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Entité' })).not.toBeInTheDocument();
  const create = screen.getByText('+ Créer un agent IA').closest('a');
  expect(create).toHaveAttribute('href', '/agents/new?entity=2');
  const rail = screen.getByRole('complementary');
  const active = within(rail).getByText('Boutique Paris Marais').closest('a');
  expect(active).toHaveAttribute('aria-current', 'page');
});

test('filtre statut : titre = libellé du statut, lien de création sans entité', async () => {
  nav.search = 'status=paused';
  stubFetch(ROWS, THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('SAV commandes')).toBeInTheDocument());
  expect(screen.queryByText('Support client')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'En pause' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Entité' })).toBeInTheDocument();
  expect(screen.getByText('+ Créer un agent IA').closest('a')).toHaveAttribute('href', '/agents/new');
});

test('entité inconnue dans l URL : retombe sur Tous les agents IA', async () => {
  nav.search = 'entity=99';
  stubFetch(ROWS, THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('Support client')).toBeInTheDocument());
  expect(screen.getByRole('heading', { name: 'Tous les agents IA' })).toBeInTheDocument();
  expect(screen.getByText('Brouillon Lyon')).toBeInTheDocument();
});

test('conseiller : pas de « + Créer un agent IA »', async () => {
  session.isAdmin = false;
  stubFetch(ROWS, THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('Support client')).toBeInTheDocument());
  expect(screen.queryByText('+ Créer un agent IA')).not.toBeInTheDocument();
});

test('super manager en lecture seule : pas de « + Créer un agent IA »', async () => {
  session.isAdmin = false;
  session.readOnly = true;
  stubFetch(ROWS, THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('Support client')).toBeInTheDocument());
  expect(screen.queryByText('+ Créer un agent IA')).not.toBeInTheDocument();
});

test('admin en lecture seule : pas de « + Créer un agent IA » non plus', async () => {
  session.readOnly = true;
  stubFetch(ROWS, THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('Support client')).toBeInTheDocument());
  expect(screen.queryByText('+ Créer un agent IA')).not.toBeInTheDocument();
});

test('échec du chargement des entités : la page reste utilisable, sans groupe Entités', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/entities')) return new Response('{}', { status: 500 });
    return new Response(JSON.stringify(ROWS), { status: 200 });
  }));
  renderHome();
  await waitFor(() => expect(screen.getByText('Support client')).toBeInTheDocument());
  expect(screen.queryByText('Entités')).not.toBeInTheDocument();
});

test('paramètre welcome : bandeau « Bienvenue dans … » fermable, absent sans le paramètre', async () => {
  nav.search = 'welcome=Maison%20Lumi%C3%A8re';
  stubFetch(ROWS, THREE);
  renderHome();
  expect(await screen.findByText('Bienvenue dans Maison Lumière.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Fermer' }));
  expect(screen.queryByText('Bienvenue dans Maison Lumière.')).not.toBeInTheDocument();
});

test('paramètre welcome : bandeau aussi affiché sur le premier lancement (organisation sans agent IA)', async () => {
  nav.search = 'welcome=Atelier';
  stubFetch([], [entity(1, 'Principale')]);
  renderHome();
  expect(await screen.findByText('Créer mon premier agent IA')).toBeInTheDocument();
  expect(screen.getByText('Bienvenue dans Atelier.')).toBeInTheDocument();
});

test('sans paramètre welcome : pas de bandeau', async () => {
  stubFetch(ROWS, THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('Support client')).toBeInTheDocument());
  expect(screen.queryByText(/Bienvenue dans/)).not.toBeInTheDocument();
});
