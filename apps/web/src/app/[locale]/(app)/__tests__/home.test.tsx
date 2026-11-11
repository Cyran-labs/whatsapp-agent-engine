import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../../messages/fr.json';
import Home from '../page';
import {
  expectActionInBar,
  expectNoBarAction,
  expectOrgBlockFirst,
  expectRailActive,
  trail,
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

// spec 5.1, 5.2, 5.3, 10.2
test('cadre de la liste : rail Agents IA actif, bloc Organisation en tête de colonne, fil, « + Créer un agent IA » dans la barre seulement', async () => {
  stubFetch(ROWS, THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('Support client')).toBeInTheDocument());
  expectRailActive('agents');
  expectOrgBlockFirst('Maison Lumière');
  expect(trail()).toEqual(['Maison Lumière', 'Agents IA', 'Tous les agents IA']);
  expect(expectActionInBar('link', '+ Créer un agent IA')).toHaveAttribute('href', '/agents/new');
});

test('cadre de la liste filtrée par entité : la création présélectionnée reste dans la barre', async () => {
  nav.search = 'entity=2';
  stubFetch(ROWS, THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('Conseil Marais')).toBeInTheDocument());
  expect(expectActionInBar('link', '+ Créer un agent IA')).toHaveAttribute('href', '/agents/new?entity=2');
});

test('cadre de la liste pour un conseiller : rail, bloc, fil, aucune action dans la barre', async () => {
  session.isAdmin = false;
  stubFetch(ROWS, THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('Support client')).toBeInTheDocument());
  expectRailActive('agents');
  expectOrgBlockFirst('Maison Lumière');
  expect(trail()).toEqual(['Maison Lumière', 'Agents IA', 'Tous les agents IA']);
  expectNoBarAction();
});

// spec 10.2 : premier lancement et lecture en échec, rail et colonne présents, colonne réduite au bloc et au libellé
test('premier lancement : rail, colonne réduite au bloc Organisation et au libellé « Agents IA », fil, création dans la page seulement', async () => {
  stubFetch([], [entity(1, 'Principale')]);
  renderHome();
  expect(await screen.findByText('Créer mon premier agent IA')).toBeInTheDocument();
  expectRailActive('agents');
  expectOrgBlockFirst('Maison Lumière');
  const column = screen.getByRole('complementary');
  expect(within(column).getByText('Agents IA')).toBeInTheDocument();
  expect(within(column).queryAllByRole('link')).toEqual([]);
  expect(trail()).toEqual(['Maison Lumière', 'Agents IA']);
  expectNoBarAction();
});

test('lecture en échec : rail, colonne réduite, fil, message dans la page', async () => {
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
  expect(trail()).toEqual(['Maison Lumière', 'Agents IA']);
  expectNoBarAction();
});

test('>=1 bot → table d agents (titre Agents + nom + CTA Creer un agent)', async () => {
  stubFetch([mkRow('a', 'Assistant A', 'draft', 1)], [entity(1, 'Principale')]);
  renderHome();
  await waitFor(() => expect(screen.getByText('Assistant A')).toBeInTheDocument());
  expect(screen.getByRole('heading', { name: 'Agents IA' })).toBeInTheDocument();
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
  expect(dot('Offline')).toHaveClass('bg-muted-2');
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

test('filtre entité : seules ses lignes, titre « Entité : {nom} », pas de colonne Entité, création présélectionnée', async () => {
  nav.search = 'entity=2';
  stubFetch(ROWS, THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('Conseil Marais')).toBeInTheDocument());
  expect(screen.queryByText('Support client')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Entité : Boutique Paris Marais$/);
  expect(trail()).toEqual(['Maison Lumière', 'Agents IA', 'Entité : Boutique Paris Marais']);
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
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Offline$/);
  expect(trail()).toEqual(['Maison Lumière', 'Agents IA', 'Statut : Offline']);
  expect(screen.getByRole('columnheader', { name: 'Entité' })).toBeInTheDocument();
  expect(screen.getByText('+ Créer un agent IA').closest('a')).toHaveAttribute('href', '/agents/new');
});

test('entité inconnue dans l URL : retombe sur Tous les agents IA', async () => {
  nav.search = 'entity=99';
  stubFetch(ROWS, THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('Support client')).toBeInTheDocument());
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Agents IA$/);
  expect(trail()).toEqual(['Maison Lumière', 'Agents IA', 'Tous les agents IA']);
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
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Entité indisponible');
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
  expect(screen.getByText('Tous les agents IA', { selector: 'a' }).querySelector('[data-skeleton]')).not.toBeNull();
  expect(screen.queryByText('Aucun agent IA')).not.toBeInTheDocument();
  expect(screen.queryByText(/Chargement/)).not.toBeInTheDocument();

  release(new Response(JSON.stringify([mkRow('a', 'Assistant A', 'draft', 1)]), { status: 200 }));
  expect(await screen.findByText('Assistant A')).toBeInTheDocument();
  expect(container.querySelectorAll('[data-skeleton]')).toHaveLength(0);
  expect(screen.getByText('1 agent IA')).toBeInTheDocument();
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
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Preview$/);
  expect(trail()).toEqual(['Maison Lumière', 'Agents IA', 'Statut : Preview']);
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
test('filtre « Ne répond pas » : seules les lignes à la mention, titre et fil « Ne répond pas », entrée active', async () => {
  nav.search = 'status=not_responding';
  stubFetch([...ROWS, mutedRow('m', 'Pilote muet', 'limited', 'empty_allowlist'), mutedRow('n', 'Support muet', 'active', 'account_not_connected')], THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('Pilote muet')).toBeInTheDocument());
  expect(screen.getByText('Support muet')).toBeInTheDocument();
  expect(screen.queryByText('Support client')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Ne répond pas$/);
  expect(trail()).toEqual(['Maison Lumière', 'Agents IA', 'Ne répond pas']);
  const rail = screen.getByRole('complementary');
  expect(within(rail).getByText('Ne répond pas').closest('a')).toHaveAttribute('aria-current', 'page');
  expect(screen.getByText('+ Créer un agent IA').closest('a')).toHaveAttribute('href', '/agents/new');
});

// spec 10.2 : conseiller, titre et fil identiques, pas de création
test('filtre « Ne répond pas » pour un conseiller : même titre et même fil, pas de « + Créer un agent IA »', async () => {
  session.isAdmin = false;
  nav.search = 'status=not_responding';
  stubFetch([...ROWS, mutedRow('m', 'Pilote muet', 'limited', 'empty_allowlist')], THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('Pilote muet')).toBeInTheDocument());
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Ne répond pas$/);
  expect(trail()).toEqual(['Maison Lumière', 'Agents IA', 'Ne répond pas']);
  expect(screen.queryByText('+ Créer un agent IA')).not.toBeInTheDocument();
});

// spec 10.2 : liste non filtrée, titre « Agents IA », fil qui finit par « Tous les agents IA »
test('liste non filtrée : titre « Agents IA », fil « Tous les agents IA »', async () => {
  stubFetch(ROWS, THREE);
  renderHome();
  await waitFor(() => expect(screen.getByText('Support client')).toBeInTheDocument());
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Agents IA$/);
  expect(trail()).toEqual(['Maison Lumière', 'Agents IA', 'Tous les agents IA']);
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
