import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../../messages/fr.json';
import Home from '../page';
import {
  expectCreateButton,
  expectOrgBlockFirst,
  expectRailActive,
  headerParents,
  headerTitle,
} from '@/components/shell/__tests__/frame-assertions';

const nav = vi.hoisted(() => ({ search: '', replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(nav.search) }));

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
  usePathname: () => '/',
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
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
  nav.replace.mockClear();
  session.isAdmin = true;
  session.readOnly = false;
});

function mkRow(bot_id: string, name: string, status: string, entity_id: number) {
  return { bot_id, name, slug: bot_id, status, default_language: 'fr', languages: ['fr'], number: null, connected: false, messages_total: 0, leads_total: 0, personalized: true, entity_id };
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

test('0 bot → first-run (CTA creer premier agent), sans entrées dans la colonne', async () => {
  stubFetch([], [entity(1, 'Principale')]);
  renderHome();
  expect(await screen.findByText('Créer mon premier agent IA')).toBeInTheDocument();
  expect(screen.queryByText('Tous les agents IA')).not.toBeInTheDocument();
});

// spec 5.1, 5.2, 10.2 ; spec en-tête 2.2
test('cadre de la liste : rail Agents IA actif, bloc Organisation en tête de colonne, titre sans parents, bouton rond « Créer un agent IA »', async () => {
  stubFetch(ROWS, THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('Support client')).toBeInTheDocument());
  expectRailActive('agents');
  expectOrgBlockFirst('Maison Lumière');
  expect(headerParents()).toEqual([]);
  expect(headerTitle()).toHaveTextContent(/^Agents IA$/);
  expect(expectCreateButton('Créer un agent IA')).toHaveAttribute('href', '/agents/new');
  expect(screen.queryByRole('navigation', { name: "Fil d'Ariane" })).not.toBeInTheDocument();
});

// entête 5 : bouton rond selon le droit de créer, pour un conseiller
test('cadre de la liste pour un conseiller : rail, bloc, titre, aucun bouton rond', async () => {
  session.isAdmin = false;
  stubFetch(ROWS, THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('Support client')).toBeInTheDocument());
  expectRailActive('agents');
  expectOrgBlockFirst('Maison Lumière');
  expect(headerTitle()).toHaveTextContent(/^Agents IA$/);
  expectCreateButton(null);
});

// spec 10.2 : premier lancement et lecture en échec, rail et colonne présents, colonne réduite au bloc et au libellé ;
// spec en-tête 7.5 : le premier lancement montre déjà la création, pas de bouton rond
test('premier lancement : rail, colonne réduite au bloc Organisation et au libellé « Agents IA », création dans la page seulement', async () => {
  stubFetch([], [entity(1, 'Principale')]);
  renderHome();
  expect(await screen.findByText('Créer mon premier agent IA')).toBeInTheDocument();
  expectRailActive('agents');
  expectOrgBlockFirst('Maison Lumière');
  const column = screen.getByRole('complementary');
  expect(within(column).getByText('Agents IA')).toBeInTheDocument();
  expect(within(column).queryAllByRole('link')).toEqual([]);
  expect(screen.queryByRole('navigation', { name: "Fil d'Ariane" })).not.toBeInTheDocument();
  expectCreateButton(null);
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
});

test('lecture en échec : rail, colonne réduite, titre « Agents IA », message dans la page, aucun bouton rond', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/entities')) return new Response(JSON.stringify(THREE), { status: 200 });
    return new Response('{}', { status: 500 });
  }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  renderHome();
  expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de charger les agents IA.');
  expectRailActive('agents');
  expectOrgBlockFirst('Maison Lumière');
  expect(within(screen.getByRole('complementary')).queryAllByRole('link')).toEqual([]);
  expect(headerParents()).toEqual([]);
  expect(headerTitle()).toHaveTextContent(/^Agents IA$/);
  expectCreateButton(null);
});

/** Ligne de description de l'en-tête (sous le titre). */
function headerDescription(): string {
  const block = headerTitle().closest('[data-page-title-block]') as HTMLElement;
  return (block.lastElementChild?.textContent ?? '').trim();
}

/** Liens de la ligne des parents : libellé et adresse. */
function parentLinks(): Array<[string, string]> {
  const nav = screen.queryByRole('navigation', { name: "Fil d'Ariane" });
  return nav ? within(nav).getAllByRole('link').map((a) => [a.textContent ?? '', a.getAttribute('href') ?? '']) : [];
}

const PARIS = [entity(1, 'Boutique Paris'), entity(3, 'Boutique Lyon')];
const PARIS_ROWS = [
  mkRow('a', 'Support client', 'active', 1),
  mkRow('b', 'SAV commandes', 'paused', 1),
  mkRow('c', 'Pilote Lyon', 'limited', 3),
  mkRow('d', 'Brouillon Lyon', 'draft', 3),
  { ...mkRow('m', 'Pilote muet', 'limited', 3), not_responding: 'empty_allowlist', account_state: 'connected' },
];

// spec en-tête 2.2, 7.4 ; C-4, C-7 : parents, titre, description et bouton rond de chaque filtre de la liste
const LIST_HEADERS: Array<{ search: string; parents: Array<[string, string]>; title: string; description: string; create: [string, string] }> = [
  { search: '', parents: [], title: 'Agents IA', description: 'Tous les agents IA · 5 agents IA', create: ['Créer un agent IA', '/agents/new'] },
  { search: 'entity=1', parents: [['Agents IA', '/']], title: 'Boutique Paris', description: 'Entité · 2 agents IA', create: ['Créer un agent IA dans Boutique Paris', '/agents/new?entity=1'] },
  { search: 'status=draft', parents: [['Agents IA', '/']], title: 'Draft', description: 'Ne répond à personne · 1 agent IA', create: ['Créer un agent IA', '/agents/new?status=draft'] },
  { search: 'status=limited', parents: [['Agents IA', '/']], title: 'Preview', description: 'Répond seulement aux numéros de la Whitelist · 2 agents IA', create: ['Créer un agent IA', '/agents/new?status=limited'] },
  { search: 'status=active', parents: [['Agents IA', '/']], title: 'Online', description: 'Répond à tous les contacts · 1 agent IA', create: ['Créer un agent IA', '/agents/new?status=active'] },
  { search: 'status=paused', parents: [['Agents IA', '/']], title: 'Offline', description: 'Ne répond plus, conversations conservées · 1 agent IA', create: ['Créer un agent IA', '/agents/new?status=paused'] },
  { search: 'status=not_responding', parents: [['Agents IA', '/']], title: 'Ne répond pas', description: '1 agent IA', create: ['Créer un agent IA', '/agents/new?status=not_responding'] },
];

for (const h of LIST_HEADERS) {
  test(`en-tête de la liste « ${h.search || 'toute la liste'} » : parents, titre, description, bouton rond`, async () => {
    nav.search = h.search;
    stubFetch(PARIS_ROWS, PARIS);
    renderHome();
    await waitFor(() => expect(document.querySelector('tbody tr:not([data-skeleton-row])')).not.toBeNull());
    await waitFor(() => expect(headerTitle()).toHaveTextContent(new RegExp(`^${h.title}$`)));
    expect(parentLinks()).toEqual(h.parents);
    expect(headerParents()).not.toContain('Maison Lumière');
    expect(headerDescription()).toBe(h.description);
    expect(expectCreateButton(h.create[0])).toHaveAttribute('href', h.create[1]);
  });
}

// entête 5 : organisation en lecture seule, aucun bouton rond, même pour un administrateur
test('organisation en lecture seule : aucun bouton rond, sur toute la liste comme sur une entité', async () => {
  session.readOnly = true;
  stubFetch(PARIS_ROWS, PARIS);
  const first = renderHome();
  await waitFor(() => expect(screen.getByText('Support client')).toBeInTheDocument());
  expectCreateButton(null);
  first.unmount();
  nav.search = 'entity=1';
  renderHome();
  await waitFor(() => expect(headerTitle()).toHaveTextContent(/^Boutique Paris$/));
  expectCreateButton(null);
});

// entête 5 : conseiller sur une entité, aucun bouton rond
test('conseiller sur une liste filtrée par entité : titre de l\'entité, aucun bouton rond', async () => {
  session.isAdmin = false;
  nav.search = 'entity=1';
  stubFetch(PARIS_ROWS, PARIS);
  renderHome();
  await waitFor(() => expect(headerTitle()).toHaveTextContent(/^Boutique Paris$/));
  expectCreateButton(null);
});

// entête 5, point d'attention 3 : entité d'une autre organisation (ou archivée) dans l'adresse, jamais son nom, liste
// vide et lien vers toute la liste, fin du repli silencieux
test('?entity=2 absente des entités de l\'organisation : « Entité indisponible », liste vide, lien vers toute la liste', async () => {
  nav.search = 'entity=2';
  stubFetch([mkRow('a', 'Support client', 'active', 1)], [entity(1, 'Boutique Paris')]);
  const { container } = renderHome();
  await waitFor(() => expect(headerTitle()).toHaveTextContent(/^Entité indisponible$/));
  expect(parentLinks()).toEqual([['Agents IA', '/']]);
  const main = screen.getByRole('main');
  expect(main).not.toHaveTextContent('Boutique Paris');
  expect(main).not.toHaveTextContent('Support client');
  expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
  expect(within(main).getByRole('link', { name: 'Voir tous les agents IA' })).toHaveAttribute('href', '/');
  expectCreateButton(null);
});

test('>=1 bot → table d agents (titre Agents + nom + CTA Creer un agent)', async () => {
  stubFetch([mkRow('a', 'Assistant A', 'draft', 1)], [entity(1, 'Principale')]);
  renderHome();
  await waitFor(() => expect(screen.getByText('Assistant A')).toBeInTheDocument());
  expect(screen.getByRole('heading', { name: 'Agents IA' })).toBeInTheDocument();
  expectCreateButton('Créer un agent IA');
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
  expect(within(rail).getByText('Par entité')).toBeInTheDocument();
  expect(within(rail).getByText('Par entité').parentElement).toHaveTextContent('Par entitéEntité');
  expect(link('Service client')).toHaveAttribute('href', '/?entity=1');
  expect(link('Service client')).toHaveTextContent('2');
  expect(link('Boutique Lyon')).toHaveTextContent('1');
  expect(within(rail).getByText('Statut')).toBeInTheDocument();
  expect(link('Online')).toHaveAttribute('href', '/?status=active');
  expect(link('Online')).toHaveTextContent('2');
  expect(link('Offline')).toHaveTextContent('1');
  expect(link('Draft')).toHaveTextContent('1');
  expect(screen.getByRole('columnheader', { name: 'Entité' })).toBeInTheDocument();
});

// recette 10 nov. 2026 : « Désactivé » est gris dans le tableau, il l'est aussi dans le rail (il était orange, comme « Accès limité »)
test('rail : la pastille « Offline » est grise, celle de « Preview » orange', async () => {
  stubFetch([...ROWS, mkRow('e', 'Accès restreint', 'limited', 1)], THREE);
  renderHome();
  const rail = await screen.findByRole('complementary');
  await waitFor(() => expect(within(rail).getByText('Service client')).toBeInTheDocument());
  const dot = (label: string) => within(rail).getByText(label).closest('a')!.querySelector('span[aria-hidden="true"]') as HTMLElement;
  expect(dot('Offline')).toHaveClass('bg-offline-ink'); // spec 3.11 : jeton gris d'Offline
  expect(dot('Offline')).not.toHaveClass('bg-warning');
  expect(dot('Preview')).toHaveClass('bg-warning');
});

test('une seule entité active : pas de groupe Entités ni de colonne Entité, groupe Statut présent', async () => {
  stubFetch(ROWS, [entity(1, 'Principale'), entity(2, 'Ancienne', 'archived')]);
  renderHome();
  const rail = await screen.findByRole('complementary');
  await waitFor(() => expect(screen.getByText('Support client')).toBeInTheDocument());
  expect(within(rail).queryByText('Par entité')).not.toBeInTheDocument();
  expect(within(rail).getByText('Statut')).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Entité' })).not.toBeInTheDocument();
});

test('filtre entité : seules ses lignes, titre au nom de l\'entité, pas de colonne Entité, création présélectionnée', async () => {
  nav.search = 'entity=2';
  stubFetch(ROWS, THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('Conseil Marais')).toBeInTheDocument());
  expect(screen.queryByText('Support client')).not.toBeInTheDocument();
  await waitFor(() => expect(headerTitle()).toHaveTextContent(/^Boutique Paris Marais$/));
  expect(headerParents()).toEqual(['Agents IA']);
  expect(screen.queryByRole('columnheader', { name: 'Entité' })).not.toBeInTheDocument();
  expect(expectCreateButton('Créer un agent IA dans Boutique Paris Marais')).toHaveAttribute('href', '/agents/new?entity=2');
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
  expect(headerTitle()).toHaveTextContent(/^Offline$/);
  expect(headerParents()).toEqual(['Agents IA']);
  expect(screen.getByRole('columnheader', { name: 'Entité' })).toBeInTheDocument();
  expect(expectCreateButton('Créer un agent IA')).toHaveAttribute('href', '/agents/new?status=paused');
});

// spec en-tête 7.4 : fin du repli silencieux sur toute la liste
test('entité inconnue dans l URL : « Entité indisponible », aucune ligne, jamais toute la liste', async () => {
  nav.search = 'entity=99';
  stubFetch(ROWS, THREE);
  renderHome();
  await waitFor(() => expect(headerTitle()).toHaveTextContent(/^Entité indisponible$/));
  expect(headerParents()).toEqual(['Agents IA']);
  expect(screen.queryByText('Brouillon Lyon')).not.toBeInTheDocument();
  expect(screen.queryByText('Support client')).not.toBeInTheDocument();
});

// entête 5
test('conseiller : pas de bouton rond « Créer un agent IA »', async () => {
  session.isAdmin = false;
  stubFetch(ROWS, THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('Support client')).toBeInTheDocument());
  expectCreateButton(null);
});

// entête 5
test('super manager en lecture seule : pas de bouton rond « Créer un agent IA »', async () => {
  session.isAdmin = false;
  session.readOnly = true;
  stubFetch(ROWS, THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('Support client')).toBeInTheDocument());
  expectCreateButton(null);
});

// entête 5
test('admin en lecture seule : pas de bouton rond « Créer un agent IA » non plus', async () => {
  session.readOnly = true;
  stubFetch(ROWS, THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('Support client')).toBeInTheDocument());
  expectCreateButton(null);
});

// audit R-18
test('échec du chargement des entités : la page reste utilisable, une ligne « Entités indisponibles » avec Réessayer remplace le regroupement', async () => {
  let entityCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/entities')) {
      entityCalls += 1;
      return entityCalls === 1 ? new Response('{}', { status: 500 }) : new Response(JSON.stringify(THREE), { status: 200 });
    }
    return new Response(JSON.stringify(ROWS), { status: 200 });
  }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  renderHome();
  await waitFor(() => expect(screen.getByText('Support client')).toBeInTheDocument());
  const rail = screen.getByRole('complementary');
  expect(await within(rail).findByText('Entités indisponibles')).toBeInTheDocument();
  expect(within(rail).queryByText('Par entité')).not.toBeInTheDocument();
  await userEvent.click(within(rail).getByRole('button', { name: 'Réessayer' }));
  expect(await within(rail).findByText('Boutique Lyon')).toBeInTheDocument();
  expect(within(rail).queryByText('Entités indisponibles')).not.toBeInTheDocument();
});

// audit R-18
test('entités illisibles et filtre ?entity=2 : la liste reste filtrée, le titre ne dit pas « Tous les agents IA »', async () => {
  nav.search = 'entity=2';
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/entities')) return new Response('{}', { status: 500 });
    return new Response(JSON.stringify(ROWS), { status: 200 });
  }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  renderHome();
  expect(await screen.findByText('Conseil Marais')).toBeInTheDocument();
  expect(screen.queryByText('Support client')).not.toBeInTheDocument();
  expect(headerTitle()).toHaveTextContent('Entité indisponible');
  expect(headerParents()).toEqual(['Agents IA']);
});

test('welcome=1 : bandeau avec le nom de l\'organisation de la session, fermable (retire le paramètre)', async () => {
  nav.search = 'welcome=1';
  stubFetch(ROWS, THREE);
  renderHome();
  expect(await screen.findByText('Bienvenue dans Maison Lumière.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Fermer' }));
  expect(screen.queryByText('Bienvenue dans Maison Lumière.')).not.toBeInTheDocument();
  expect(nav.replace).toHaveBeenCalledWith('/');
});

test('welcome=<texte> forgé dans l\'URL : jamais affiché, aucun bandeau', async () => {
  nav.search = 'welcome=' + encodeURIComponent('WABAGENT. Votre compte va être suspendu, appelez le 06 00 00 00 00');
  stubFetch(ROWS, THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('Support client')).toBeInTheDocument());
  expect(screen.queryByText(/suspendu/)).not.toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('welcome=1 : bandeau aussi affiché sur le premier lancement (organisation sans agent IA)', async () => {
  nav.search = 'welcome=1';
  stubFetch([], [entity(1, 'Principale')]);
  renderHome();
  expect(await screen.findByText('Créer mon premier agent IA')).toBeInTheDocument();
  expect(screen.getByText('Bienvenue dans Maison Lumière.')).toBeInTheDocument();
});

test('sans paramètre welcome : pas de bandeau', async () => {
  stubFetch(ROWS, THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('Support client')).toBeInTheDocument());
  expect(screen.queryByText(/Bienvenue dans/)).not.toBeInTheDocument();
});

test('erreur de chargement des agents IA : message et Réessayer, jamais le premier lancement', async () => {
  let summaryCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/entities')) return new Response(JSON.stringify(THREE), { status: 200 });
    summaryCalls += 1;
    if (summaryCalls === 1) return new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'Erreur interne.' } }), { status: 500 });
    return new Response(JSON.stringify(ROWS), { status: 200 });
  }));
  renderHome();
  // contre-audit D-5 : le texte nomme ce qui n'a pas pu être lu
  expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de charger les agents IA.');
  expect(screen.queryByText('Créer mon premier agent IA')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByText('Support client')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('échec réseau sur les agents IA : message d\'erreur, pas de premier lancement', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/entities')) return new Response(JSON.stringify(THREE), { status: 200 });
    throw new TypeError('network');
  }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  renderHome();
  // contre-audit D-5 : le texte nomme ce qui n'a pas pu être lu
  expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de charger les agents IA.');
  expect(screen.queryByText('Créer mon premier agent IA')).not.toBeInTheDocument();
});

test('chargement des agents IA : en-tête réel, 3 lignes squelettes, compteurs du rail en squelette, puis la liste', async () => {
  let release: (res: Response) => void = () => undefined;
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.startsWith('/api/entities')) return Promise.resolve(new Response(JSON.stringify([entity(1, 'Principale')]), { status: 200 }));
    return new Promise<Response>((resolve) => { release = resolve; });
  }));
  const { container } = renderHome();
  expect(screen.getByRole('columnheader', { name: 'Agent IA' })).toBeInTheDocument();
  expect(container.querySelectorAll('tbody tr[data-skeleton-row]')).toHaveLength(3);
  // Entrée de la colonne (son libellé est dans un `span` du lien) ; le titre de la page porte le même texte.
  expect(screen.getByText('Tous les agents IA', { selector: 'a > span' }).closest('a')?.querySelector('[data-skeleton]')).not.toBeNull();
  expect(screen.queryByText('Aucun agent IA')).not.toBeInTheDocument();
  expect(screen.queryByText(/Chargement/)).not.toBeInTheDocument();

  release(new Response(JSON.stringify([mkRow('a', 'Assistant A', 'draft', 1)]), { status: 200 }));
  expect(await screen.findByText('Assistant A')).toBeInTheDocument();
  expect(container.querySelectorAll('[data-skeleton]')).toHaveLength(0);
  expect(screen.getByText('Tous les agents IA · 1 agent IA')).toBeInTheDocument();
});

test('statut « Preview » : entrée du rail avec compteur, filtre, et agent IA en service (pas de bandeau de mise en route)', async () => {
  const rows = [...ROWS, mkRow('e', 'Pilote Lyon', 'limited', 3)];
  stubFetch(rows, THREE);
  renderHome();
  const rail = await screen.findByRole('complementary');
  await waitFor(() => expect(within(rail).getByText('Preview')).toBeInTheDocument());
  const link = within(rail).getByText('Preview').closest('a') as HTMLAnchorElement;
  expect(link).toHaveAttribute('href', '/?status=limited');
  expect(link).toHaveTextContent('1');
  expect(within(rail).getByText('Online').closest('a')).toHaveTextContent('2');
  expect(within(rail).getByText('Tous les agents IA').closest('a')).toHaveTextContent('5');
  expect(screen.getByText('Pilote Lyon')).toBeInTheDocument();
});

test('filtre statut limited : seules ses lignes, titre « Preview »', async () => {
  nav.search = 'status=limited';
  stubFetch([...ROWS, mkRow('e', 'Pilote Lyon', 'limited', 3)], THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('Pilote Lyon')).toBeInTheDocument());
  expect(screen.queryByText('Support client')).not.toBeInTheDocument();
  expect(headerTitle()).toHaveTextContent(/^Preview$/);
  expect(headerParents()).toEqual(['Agents IA']);
});

test('un seul agent IA en accès limité : il est en service, le bandeau « Mise en route » n\'apparaît pas', async () => {
  stubFetch([mkRow('e', 'Pilote Lyon', 'limited', 1)], [entity(1, 'Principale')]);
  renderHome();
  await waitFor(() => expect(screen.getByText('Pilote Lyon')).toBeInTheDocument());
  expect(screen.queryByText('Mise en route')).not.toBeInTheDocument();
});

// prototype 8 : « Brancher un numéro » mène à la page du premier agent IA Draft sans numéro, où le bouton existe
test('mise en route : « Brancher un numéro » mène l\'admin au premier agent IA Draft sans numéro, dans l\'ordre de la liste', async () => {
  stubFetch([
    { ...mkRow('w', 'Draft branché', 'draft', 1), number: '+33612000047' },
    mkRow('o', 'Arrêté', 'paused', 1),
    mkRow('d', 'Brouillon', 'draft', 1),
    mkRow('e', 'Autre brouillon', 'draft', 1),
  ], [entity(1, 'Principale')]);
  renderHome();
  await waitFor(() => expect(screen.getByText('Mise en route')).toBeInTheDocument());
  expect(screen.getByRole('link', { name: 'Brancher un numéro' })).toHaveAttribute('href', '/agents/d');
});

// prototype 8 : sans agent IA Draft sans numéro, le comportement d'avant (Connexions)
test('mise en route : aucun agent IA Draft sans numéro, « Brancher un numéro ↗ Connexions » mène à Connexions', async () => {
  stubFetch([{ ...mkRow('w', 'Draft branché', 'draft', 1), number: '+33612000047' }, mkRow('o', 'Arrêté', 'paused', 1)], [entity(1, 'Principale')]);
  renderHome();
  await waitFor(() => expect(screen.getByText('Mise en route')).toBeInTheDocument());
  // A-7 : le lien qui change d'espace le dit
  expect(screen.getByRole('link', { name: 'Brancher un numéro ↗ Connexions' })).toHaveAttribute('href', '/organisation/connexions');
});

test('mise en route : un agent IA dont le numéro est connecté coche l\'étape, sans bouton de raccordement', async () => {
  stubFetch([{ ...mkRow('d', 'Brouillon', 'draft', 1), connected: true }], [entity(1, 'Principale')]);
  renderHome();
  await waitFor(() => expect(screen.getByText('Mise en route')).toBeInTheDocument());
  expect(screen.queryByRole('link', { name: /Brancher un numéro/ })).not.toBeInTheDocument();
  expect(screen.getByText('Brancher un numéro').previousElementSibling).toHaveTextContent('✓');
});

test('mise en route : un conseiller ne voit pas le lien vers Connexions', async () => {
  session.isAdmin = false;
  stubFetch([mkRow('d', 'Brouillon', 'draft', 1)], [entity(1, 'Principale')]);
  renderHome();
  await waitFor(() => expect(screen.getByText('Mise en route')).toBeInTheDocument());
  expect(screen.queryByRole('link', { name: /Brancher un numéro/ })).not.toBeInTheDocument();
});

const mutedRow = (bot_id: string, name: string, status: string, reason: string) =>
  ({ ...mkRow(bot_id, name, status, 1), not_responding: reason, account_state: 'connected' });

// spec 7.3, prototype 1 : l'entrée « Ne répond pas » n'existe que si au moins un agent IA porte la mention
test('colonne : pas d\'entrée « Ne répond pas » quand aucun agent IA ne porte la mention', async () => {
  stubFetch(ROWS, THREE);
  renderHome();
  const rail = await screen.findByRole('complementary');
  await waitFor(() => expect(within(rail).getByText('Online').closest('a')).toHaveTextContent('2'));
  expect(within(rail).queryByText('Ne répond pas')).not.toBeInTheDocument();
});

// spec 7.3, prototype 1
test('colonne : entrée « Ne répond pas » avec son nombre, point rouge, sous les statuts ; Preview et Online comptent tout', async () => {
  stubFetch([...ROWS, mutedRow('m', 'Pilote muet', 'limited', 'empty_allowlist')], THREE);
  renderHome();
  const rail = await screen.findByRole('complementary');
  const entry = (await within(rail).findByText('Ne répond pas')).closest('a') as HTMLAnchorElement;
  expect(entry).toHaveAttribute('href', '/?status=not_responding');
  expect(entry).toHaveTextContent('1');
  expect(entry.querySelector('[data-dot]')).toHaveClass('bg-danger');
  const statusLinks = within(rail).getByText('Statut').parentElement!.querySelectorAll('a');
  expect([...statusLinks].map((a) => a.textContent?.replace(/\d+$/, ''))).toEqual(['Online', 'Preview', 'Offline', 'Draft', 'Ne répond pas']);
  expect(within(rail).getByText('Preview').closest('a')).toHaveTextContent('1');
  expect(within(rail).getByText('Online').closest('a')).toHaveTextContent('2');
});

// spec 7.3, 10.2, prototype 1
test('filtre « Ne répond pas » : seules les lignes à la mention, titre « Ne répond pas », entrée active', async () => {
  nav.search = 'status=not_responding';
  stubFetch([...ROWS, mutedRow('m', 'Pilote muet', 'limited', 'empty_allowlist'), mutedRow('n', 'Support muet', 'active', 'account_not_connected')], THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('Pilote muet')).toBeInTheDocument());
  expect(screen.getByText('Support muet')).toBeInTheDocument();
  expect(screen.queryByText('Support client')).not.toBeInTheDocument();
  expect(headerTitle()).toHaveTextContent(/^Ne répond pas$/);
  expect(headerParents()).toEqual(['Agents IA']);
  const rail = screen.getByRole('complementary');
  expect(within(rail).getByText('Ne répond pas').closest('a')).toHaveAttribute('aria-current', 'page');
  expect(expectCreateButton('Créer un agent IA')).toHaveAttribute('href', '/agents/new?status=not_responding');
});

// spec 10.2 ; entête 5 : conseiller, titre et parents identiques, pas de création
test('filtre « Ne répond pas » pour un conseiller : même titre et mêmes parents, pas de bouton rond', async () => {
  session.isAdmin = false;
  nav.search = 'status=not_responding';
  stubFetch([...ROWS, mutedRow('m', 'Pilote muet', 'limited', 'empty_allowlist')], THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('Pilote muet')).toBeInTheDocument());
  expect(headerTitle()).toHaveTextContent(/^Ne répond pas$/);
  expect(headerParents()).toEqual(['Agents IA']);
  expectCreateButton(null);
});

// spec en-tête 2.1 : première page de l'espace, titre seul, pas de ligne des parents
test('liste non filtrée : titre « Agents IA », pas de ligne des parents', async () => {
  stubFetch(ROWS, THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('Support client')).toBeInTheDocument());
  expect(headerTitle()).toHaveTextContent(/^Agents IA$/);
  expect(screen.queryByRole('navigation', { name: "Fil d'Ariane" })).not.toBeInTheDocument();
});

// prototype 15 : le numéro de l'agent IA est celui de la société, en entier pour tous, conseiller compris
test('conseiller : numéro de l\'agent IA en entier dans le tableau', async () => {
  session.isAdmin = false;
  stubFetch([{ ...mkRow('a', 'Support client', 'active', 1), number: '+33612000047' }], [entity(1, 'Principale')]);
  renderHome();
  expect(await screen.findByText('+33 6 12 00 00 47')).toBeInTheDocument();
  expect(document.body.textContent).not.toContain('••');
});

// spec 10.2 : texte de premier lancement du conseiller inchangé
test('premier lancement pour un conseiller : message inchangé, pas de bouton de création', async () => {
  session.isAdmin = false;
  stubFetch([], [entity(1, 'Principale')]);
  renderHome();
  expect(await screen.findByText("Aucun agent IA pour le moment. L'administrateur de votre organisation peut en créer un.")).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Créer/ })).not.toBeInTheDocument();
});

// relecture tâche 8, M-1 : chaque entrée de la colonne (Tous, entités, statuts, « Ne répond pas ») annonce le nombre de
// lignes que montre la liste filtrée par son lien ; une dérive entre compteur et filtre casse ici
test('colonne : le compteur de chaque entrée égale le nombre de lignes de sa liste filtrée', async () => {
  const rows = [
    ...ROWS,
    mutedRow('m', 'Pilote muet', 'limited', 'empty_allowlist'),
    { ...mutedRow('n', 'Support muet', 'active', 'account_not_connected'), entity_id: 2 },
    mkRow('p', 'Pilote Lyon', 'limited', 3),
    // motif inconnu : ni mention ni compte
    { ...mutedRow('q', 'Motif futur', 'active', 'motif_futur'), entity_id: 3 },
  ];
  stubFetch(rows, THREE);
  const first = renderHome();
  const column = await screen.findByRole('complementary');
  await within(column).findByText('Ne répond pas');
  await waitFor(() => expect(within(column).getByText('Boutique Lyon')).toBeInTheDocument());
  const entries = within(column).getAllByRole('link').map((a) => ({
    label: a.textContent?.replace(/^[▤◫]/, '').replace(/\d+$/, '') ?? '',
    href: a.getAttribute('href') ?? '',
    count: Number(/(\d+)$/.exec(a.textContent ?? '')?.[1]),
  }));
  first.unmount();
  expect(entries.map((e) => e.label)).toEqual([
    'Tous les agents IA', 'Service client', 'Boutique Paris Marais', 'Boutique Lyon',
    'Online', 'Preview', 'Offline', 'Draft', 'Ne répond pas',
  ]);

  for (const entry of entries) {
    nav.search = entry.href.replace(/^\/\??/, '');
    const { container, unmount } = renderHome();
    await waitFor(() => expect(container.querySelector('tbody tr:not([data-skeleton-row])')).not.toBeNull());
    expect({ label: entry.label, rows: container.querySelectorAll('tbody tr').length }).toEqual({ label: entry.label, rows: entry.count });
    unmount();
  }
});

// relecture tâche 8, M-4 (non-régression, A-14) : l'entrée « Ne répond pas » apparaît dans le même rendu que les
// compteurs, jamais après eux ; elle est la dernière entrée de la colonne, son arrivée ne décale aucune autre entrée
test('chargement : « Ne répond pas » absente avec les compteurs en squelette, présente dès que les compteurs le sont', async () => {
  let release: (res: Response) => void = () => undefined;
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.startsWith('/api/entities')) return Promise.resolve(new Response(JSON.stringify([entity(1, 'Principale')]), { status: 200 }));
    return new Promise<Response>((resolve) => { release = resolve; });
  }));
  renderHome();
  const column = screen.getByRole('complementary');
  expect(within(column).getByText('Online').closest('a')!.querySelector('[data-skeleton]')).not.toBeNull();
  expect(within(column).queryByText('Ne répond pas')).not.toBeInTheDocument();

  release(new Response(JSON.stringify([mutedRow('m', 'Pilote muet', 'limited', 'empty_allowlist')]), { status: 200 }));
  const entry = (await within(column).findByText('Ne répond pas')).closest('a')!;
  expect(column.querySelectorAll('[data-skeleton]')).toHaveLength(0);
  expect(within(column).getByText('Preview').closest('a')).toHaveTextContent('1');
  const links = within(column).getAllByRole('link');
  expect(links[links.length - 1]).toBe(entry);
});
