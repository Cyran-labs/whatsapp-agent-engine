import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../../../messages/fr.json';
import GlobalUsagePage from '../page';
import { periodStart } from '@/lib/period';
import {
  expectCreateButton,
  expectOrgBlockFirst,
  expectRailActive,
  headerActions,
  headerParents,
  headerTitle,
} from '@/components/shell/__tests__/frame-assertions';

/** Zone des actions de l'en-tête (`data-page-action`), qui porte le choix de période. */
function actionZone(): HTMLElement {
  return document.querySelector('[data-page-header] [data-page-action]') as HTMLElement;
}

/** Ligne de description de l'en-tête (sous la ligne du titre) : son texte ; vide sans description. */
function headerDescription(): string {
  return (headerTitle().parentElement?.nextElementSibling?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(nav.search) }));

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
  usePathname: () => '/usage',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  routing: { locales: ['fr', 'en'], defaultLocale: 'fr' },
}));

const role = vi.hoisted(() => ({ isAdmin: true }));
vi.mock('@/components/providers/session-provider', () => {
  const org = { client_id: 'ml', name: 'Maison Lumière', role: 'admin', read_only: false };
  return {
    useSession: () => ({
      me: { id: 1, email: 'claire@maison-lumiere.fr', role: 'user', status: 'active', organizations: [org] },
      activeOrg: { ...org, role: role.isAdmin ? 'admin' : 'advisor' },
      isPlatformAdmin: false,
      isAdmin: role.isAdmin,
      readOnly: false,
      switchOrg: vi.fn(),
      refresh: vi.fn(),
    }),
  };
});

// Chaque rendu du choix de période est compté : il ne doit jamais apparaître pour un non-admin, même un instant.
const periodRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock('@/components/usage/period-choice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/usage/period-choice')>();
  return {
    ...actual,
    PeriodChoice: (props: Parameters<typeof actual.PeriodChoice>[0]) => {
      periodRenders.count += 1;
      return actual.PeriodChoice(props);
    },
  };
});

beforeEach(() => {
  vi.restoreAllMocks();
  nav.search = '';
  role.isAdmin = true;
  periodRenders.count = 0;
});

const entity = (id: number, name: string, status: 'active' | 'archived' = 'active') => ({ id, name, status, bots: 0, members: 0 });
const urow = (bot_id: string, name: string, entity_id: number | null, calls: number, input_tokens: number, output_tokens: number, cost_usd: number) =>
  ({ bot_id, name, entity_id, calls, input_tokens, output_tokens, cost_usd });

const ROWS = [
  urow('a', 'Support client', 1, 412, 184000, 39000, 1.84),
  urow('b', 'SAV commandes', 1, 166, 71000, 15000, 0.72),
  urow('c', 'Conseil Marais', 2, 251, 109000, 22000, 1.08),
];
const THREE = [entity(1, 'Service client'), entity(2, 'Boutique Paris Marais'), entity(3, 'Boutique Lyon')];

function stubFetch(rows: unknown[], entities: unknown[]) {
  const total = (rows as ReturnType<typeof urow>[]).reduce(
    (a, r) => ({ calls: a.calls + r.calls, input_tokens: a.input_tokens + r.input_tokens, output_tokens: a.output_tokens + r.output_tokens, cost_usd: a.cost_usd + r.cost_usd }),
    { calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 },
  );
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/entities')) return new Response(JSON.stringify(entities), { status: 200 });
    return new Response(JSON.stringify({ rows, total }), { status: 200 });
  }));
}

function renderPage() {
  return render(<NextIntlClientProvider locale="fr" messages={messages}><GlobalUsagePage /></NextIntlClientProvider>);
}

test('rail : Toute l organisation active, groupe « Par entité » avec l\'étiquette « Entité » et un lien par entité active', async () => {
  stubFetch(ROWS, [...THREE, entity(4, 'Ancienne', 'archived')]);
  renderPage();
  await screen.findByText('Support client');
  const rail = screen.getByRole('complementary');
  expect(within(rail).getByText('Usage et coûts')).toBeInTheDocument();
  expect(within(rail).getByText('Maison Lumière')).toBeInTheDocument();
  expect(within(rail).getByText('Toute l\'organisation').closest('a')).toHaveAttribute('aria-current', 'page');
  expect(within(rail).getByText('Toute l\'organisation').closest('a')).toHaveAttribute('href', '/usage');
  expect(within(rail).getByText('Par entité')).toBeInTheDocument();
  expect(within(rail).getByText('Entité', { exact: true })).toBeInTheDocument();
  expect(within(rail).getByText('Boutique Lyon').closest('a')).toHaveAttribute('href', '/usage?entity=3');
  expect(within(rail).queryByText('Ancienne')).not.toBeInTheDocument();
});

// spec 5.1, 5.2, 10.8 ; spec en-tête 2.2 : toute l'organisation, titre seul « Usage et coûts », description « Toute
// l'organisation · {période} », période en action
test('cadre : rail Usage actif, bloc Organisation, titre « Usage et coûts », « Toute l\'organisation · 30 derniers jours »', async () => {
  stubFetch(ROWS, THREE);
  renderPage();
  expect(await screen.findByText('Support client')).toBeInTheDocument();
  expectRailActive('usage');
  expectOrgBlockFirst('Maison Lumière');
  expect(headerParents()).toEqual([]);
  expect(headerTitle()).toHaveTextContent(/^Usage et coûts$/);
  expect(headerDescription()).toBe("Toute l'organisation · 30 derniers jours");
  expect(headerActions()).toEqual(['7 j', '30 j', '90 j']);
  expectCreateButton(null);
});

// spec en-tête 2.2 : par entité, parents « Usage et coûts » (lien vers /usage), titre au nom lu dans les entités de
// l'organisation, description « Entité · {période} »
test('cadre filtré par entité : parents « Usage et coûts », titre {entité}, « Entité · 30 derniers jours »', async () => {
  nav.search = 'entity=2';
  stubFetch(ROWS, THREE);
  renderPage();
  expect(await screen.findByText('Conseil Marais')).toBeInTheDocument();
  await waitFor(() => expect(headerTitle()).toHaveTextContent(/^Boutique Paris Marais$/));
  expect(headerParents()).toEqual(['Usage et coûts']);
  expect(within(document.querySelector('[data-page-header]') as HTMLElement).getByRole('link', { name: 'Usage et coûts' })).toHaveAttribute('href', '/usage');
  expect(headerDescription()).toBe('Entité · 30 derniers jours');
  expect(headerActions()).toEqual(['7 j', '30 j', '90 j']);
});

// prototype 3 : choix de période dans la barre du haut, 30 jours par défaut (P-7), période écrite sous le titre, `since`
// envoyé au BFF avec le même calcul que la page de l'agent IA
test('période : 30 j par défaut, « 30 derniers jours » sous le titre ; 7 j envoie since à 7 jours et l\'écrit', async () => {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url);
    if (url.startsWith('/api/entities')) return new Response(JSON.stringify(THREE), { status: 200 });
    return new Response(JSON.stringify({ rows: ROWS, total: { calls: 829, input_tokens: 364000, output_tokens: 76000, cost_usd: 3.64 } }), { status: 200 });
  }));
  renderPage();
  expect(await screen.findByText('Support client')).toBeInTheDocument();
  expect(urls).toContain(`/api/usage/summary?since=${encodeURIComponent(periodStart(30))}`);
  const group = within(actionZone()).getByRole('group', { name: 'Période' });
  expect(screen.getAllByRole('button', { name: '30 j' })).toEqual([within(actionZone()).getByRole('button', { name: '30 j' })]);
  expect(within(group).getByRole('button', { name: '30 j' })).toHaveAttribute('aria-pressed', 'true');
  expect(headerDescription()).toBe("Toute l'organisation · 30 derniers jours");
  await userEvent.click(within(group).getByRole('button', { name: '7 j' }));
  await waitFor(() => expect(urls).toContain(`/api/usage/summary?since=${encodeURIComponent(periodStart(7))}`));
  expect(within(group).getByRole('button', { name: '7 j' })).toHaveAttribute('aria-pressed', 'true');
  expect(await screen.findByText("Toute l'organisation · 7 derniers jours")).toBeInTheDocument();
  expect(screen.queryByText(/30 derniers jours/)).not.toBeInTheDocument();
  expect(urls.filter((u) => u.startsWith('/api/usage/summary')).every((u) => u.includes('since='))).toBe(true);
});

test('changement de période : le tableau repasse en squelette, jamais les chiffres de l\'ancienne période sous le nouveau libellé', async () => {
  let release: (res: Response) => void = () => undefined;
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.startsWith('/api/entities')) return Promise.resolve(new Response(JSON.stringify(THREE), { status: 200 }));
    if (url.includes(encodeURIComponent(periodStart(7)))) return new Promise<Response>((resolve) => { release = resolve; });
    return Promise.resolve(new Response(JSON.stringify({ rows: ROWS, total: { calls: 829, input_tokens: 364000, output_tokens: 76000, cost_usd: 3.64 } }), { status: 200 }));
  }));
  const { container } = renderPage();
  expect(await screen.findByText('Support client')).toBeInTheDocument();
  await userEvent.click(within(actionZone()).getByRole('button', { name: '7 j' }));
  expect(screen.getByText("Toute l'organisation · 7 derniers jours")).toBeInTheDocument();
  expect(screen.queryByText('Support client')).not.toBeInTheDocument();
  expect(container.querySelectorAll('tbody tr[data-skeleton-row]')).toHaveLength(3);
  await act(async () => {
    release(new Response(JSON.stringify({ rows: ROWS.slice(0, 1), total: { calls: 412, input_tokens: 184000, output_tokens: 39000, cost_usd: 1.84 } }), { status: 200 }));
  });
  expect(await screen.findByText('Support client')).toBeInTheDocument();
  expect(screen.queryByText('SAV commandes')).not.toBeInTheDocument();
});

// prototype 8 : le nom d'un agent IA du tableau mène à son usage et le dit par « ↗ »
test('tableau : nom de l\'agent IA suivi de « ↗ », lien vers son usage', async () => {
  stubFetch(ROWS, THREE);
  renderPage();
  const link = (await screen.findByText('Support client')).closest('a') as HTMLElement;
  expect(link).toHaveAttribute('href', '/agents/a/usage');
  expect(link.textContent).toBe('Support client↗');
});

// nav 15.5, prototype 5 : /usage ouvert par un conseiller, refus sur place (spec 10.6, 10.8), aucune lecture, et le
// choix de période n'est jamais rendu (relecture tâche 6, M-2)
test('conseiller : page réservée sur place, aucun appel à /api/usage/summary ni aux entités, jamais de choix de période', async () => {
  role.isAdmin = false;
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ rows: ROWS, total: { calls: 829, input_tokens: 364000, output_tokens: 76000, cost_usd: 3.64 } }), { status: 200 });
  }));
  renderPage();
  expect(screen.getByRole('heading', { level: 1, name: 'Page réservée aux administrateurs' })).toBeInTheDocument();
  expect(screen.getByText('Cette page de l\'organisation Maison Lumière est réservée aux administrateurs.')).toBeInTheDocument();
  expect(headerParents()).toEqual([]);
  expect(headerActions()).toEqual([]);
  expectRailActive(null);
  expectOrgBlockFirst('Maison Lumière');
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(calls).toEqual([]);
  expect(screen.queryByText('Support client')).not.toBeInTheDocument();
  expect(periodRenders.count).toBe(0);
});

test('vue organisation : colonne Entité et total de toutes les lignes', async () => {
  stubFetch(ROWS, THREE);
  renderPage();
  await screen.findByText('Support client');
  expect(screen.getByRole('columnheader', { name: 'Entité' })).toBeInTheDocument();
  const totalRow = screen.getByText('Total').closest('tr') as HTMLElement;
  expect(within(totalRow).getByText('829')).toBeInTheDocument();
  expect(within(totalRow).getByText(/3[.,]64/)).toBeInTheDocument();
});

test('?entity=1 : seules les lignes de l entité, total recalculé, entrée active, pas de colonne Entité', async () => {
  nav.search = 'entity=1';
  stubFetch(ROWS, THREE);
  renderPage();
  await screen.findByText('Support client');
  expect(screen.getByText('SAV commandes')).toBeInTheDocument();
  expect(screen.queryByText('Conseil Marais')).not.toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Entité' })).not.toBeInTheDocument();
  const totalRow = screen.getByText('Total').closest('tr') as HTMLElement;
  expect(within(totalRow).getByText('578')).toBeInTheDocument();
  expect(within(totalRow).getByText(/2[.,]56/)).toBeInTheDocument();
  const rail = screen.getByRole('complementary');
  expect(within(rail).getByText('Service client').closest('a')).toHaveAttribute('aria-current', 'page');
  expect(within(rail).getByText('Toute l\'organisation').closest('a')).not.toHaveAttribute('aria-current');
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Service client');
});

// spec en-tête 2.2, 5 ; D-104 : une entité archivée n'est plus une entité active, « Entité indisponible » au lieu du repli
// silencieux sur toute l'organisation ; aucune ligne, aucun nom de l'entité, lien vers toute l'organisation
test('?entity= archivée : « Entité indisponible », aucune ligne ni nom, lien vers toute l\'organisation', async () => {
  nav.search = 'entity=4';
  stubFetch([...ROWS, urow('d', 'Ancien agent', 4, 3, 1000, 1000, 0.01)], [...THREE, entity(4, 'Ancienne', 'archived')]);
  renderPage();
  await waitFor(() => expect(headerTitle()).toHaveTextContent(/^Entité indisponible$/));
  expect(headerParents()).toEqual(['Usage et coûts']);
  expect(headerDescription()).toBe('');
  const main = document.querySelector('[data-page-header]')?.parentElement as HTMLElement;
  expect(main).not.toHaveTextContent('Ancienne');
  expect(main).not.toHaveTextContent('Ancien agent');
  expect(screen.queryByText('Support client')).not.toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(within(main).getByRole('link', { name: "Voir l'usage de toute l'organisation" })).toHaveAttribute('href', '/usage');
  // rien à choisir pour une entité indisponible : pas de période
  expect(headerActions()).toEqual([]);
});

// entête 5, point d'attention 3 : l'identifiant d'une entité d'une autre organisation dans l'adresse ne fait jamais
// afficher son nom ni ses lignes ; le moteur ne renvoie que les lignes de l'organisation ouverte
test('?entity=2 hors de l\'organisation ouverte : « Entité indisponible », aucun nom d\'une autre organisation', async () => {
  nav.search = 'entity=2';
  stubFetch(ROWS.slice(0, 2), [entity(1, 'Service client')]);
  renderPage();
  await waitFor(() => expect(headerTitle()).toHaveTextContent(/^Entité indisponible$/));
  expect(document.body).not.toHaveTextContent('Atelier');
  expect(document.body).not.toHaveTextContent('Boutique Paris Marais');
  expect(screen.queryByText('Support client')).not.toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  // contrôle positif : l'entité de l'organisation ouverte est nommée et ses lignes affichées
  nav.search = 'entity=1';
  renderPage();
  expect(await screen.findByText('Support client')).toBeInTheDocument();
});

test('une seule entité active : pas de groupe « Par entité » ni de colonne Entité', async () => {
  stubFetch(ROWS.slice(0, 2), [entity(1, 'Principale')]);
  renderPage();
  await screen.findByText('Support client');
  expect(screen.queryByText('Par entité')).not.toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Entité' })).not.toBeInTheDocument();
});

test('ligne sans entité connue : visible en vue organisation, absente d un filtre', async () => {
  stubFetch([...ROWS, urow('z', 'Orphelin', null, 1, 1000, 1000, 0.01)], THREE);
  const { unmount } = renderPage();
  await screen.findByText('Orphelin');
  unmount();
  nav.search = 'entity=1';
  renderPage();
  await screen.findByText('Support client');
  expect(screen.queryByText('Orphelin')).not.toBeInTheDocument();
});

test('échec du chargement : pas de plantage, rail présent', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom'); }));
  renderPage();
  await waitFor(() => expect(screen.getByRole('complementary')).toBeInTheDocument());
  expect(screen.queryByText('Total')).not.toBeInTheDocument();
});

test('?entity=1 pendant le chargement des entités : le filtre est déjà appliqué', async () => {
  nav.search = 'entity=1';
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/entities')) return new Promise<Response>(() => {});
    return new Response(JSON.stringify({ rows: ROWS, total: { calls: 829, input_tokens: 364000, output_tokens: 76000, cost_usd: 3.64 } }), { status: 200 });
  }));
  renderPage();
  await screen.findByText('Support client');
  expect(screen.queryByText('Conseil Marais')).not.toBeInTheDocument();
  // Nom de l'entité encore en lecture : squelette dans le titre, jamais « toute l'organisation » ; parents « Usage et coûts »
  const title = headerTitle();
  expect(title.querySelector('[data-skeleton]')).not.toBeNull();
  expect(title.textContent).toBe('');
  expect(headerParents()).toEqual(['Usage et coûts']);
  expect(headerDescription()).toBe('Entité · 30 derniers jours');
});

test('erreur de /api/usage/summary : message d\'erreur et Réessayer, pas de plantage', async () => {
  let summaryCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/entities')) return new Response(JSON.stringify(THREE), { status: 200 });
    summaryCalls += 1;
    if (summaryCalls === 1) {
      return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Accès refusé.' } }), { status: 403 });
    }
    return new Response(JSON.stringify({ rows: ROWS, total: { calls: 829, input_tokens: 364000, output_tokens: 76000, cost_usd: 3.64 } }), { status: 200 });
  }));
  renderPage();
  // contre-audit D-5
  expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de charger l\'usage et les coûts.');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByText('Support client')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('réponse sans total : traitée comme une erreur, le tableau ne reçoit jamais un total indéfini', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/entities')) return new Response(JSON.stringify(THREE), { status: 200 });
    return new Response(JSON.stringify({ rows: ROWS }), { status: 200 });
  }));
  renderPage();
  // contre-audit D-5
  expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de charger l\'usage et les coûts.');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});

test('chargement : en-tête réel et 3 lignes squelettes, puis le tableau', async () => {
  let release: (res: Response) => void = () => undefined;
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.startsWith('/api/entities')) return Promise.resolve(new Response(JSON.stringify([entity(1, 'Siège')]), { status: 200 }));
    return new Promise<Response>((resolve) => { release = resolve; });
  }));
  const { container } = renderPage();
  expect(screen.getByRole('columnheader', { name: 'Agent IA' })).toBeInTheDocument();
  expect(container.querySelectorAll('tbody tr[data-skeleton-row]')).toHaveLength(3);
  expect(screen.queryByText('Total')).not.toBeInTheDocument();
  expect(screen.queryByText(/Chargement/)).not.toBeInTheDocument();
  release(new Response(JSON.stringify({ rows: ROWS, total: { calls: 829, input_tokens: 364000, output_tokens: 76000, cost_usd: 3.64 } }), { status: 200 }));
  expect(await screen.findByText('Support client')).toBeInTheDocument();
  expect(container.querySelectorAll('[data-skeleton]')).toHaveLength(0);
});

// audit R-18
test('entités illisibles : ligne « Entités indisponibles » avec Réessayer dans le rail, le tableau reste affiché', async () => {
  let entityCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/entities')) {
      entityCalls += 1;
      return entityCalls === 1 ? new Response('{}', { status: 500 }) : new Response(JSON.stringify(THREE), { status: 200 });
    }
    return new Response(JSON.stringify({ rows: ROWS, total: { calls: 829, input_tokens: 364000, output_tokens: 76000, cost_usd: 3.64 } }), { status: 200 });
  }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  renderPage();
  await screen.findByText('Support client');
  const rail = screen.getByRole('complementary');
  expect(await within(rail).findByText('Entités indisponibles')).toBeInTheDocument();
  expect(within(rail).queryByText('Par entité')).not.toBeInTheDocument();
  // toute l'organisation : l'en-tête ne dépend pas des entités
  expect(headerTitle()).toHaveTextContent(/^Usage et coûts$/);
  await userEvent.click(within(rail).getByRole('button', { name: 'Réessayer' }));
  expect(await within(rail).findByText('Boutique Lyon')).toBeInTheDocument();
  expect(within(rail).queryByText('Entités indisponibles')).not.toBeInTheDocument();
});

// audit R-18, spec en-tête 2.2 : filtre d'entité avec des entités illisibles, le nom n'est pas connu : « Entité
// indisponible » en titre, parents « Usage et coûts », les lignes de l'entité restent filtrées
test('?entity=1, entités illisibles : titre « Entité indisponible », lignes de l\'entité, période gardée', async () => {
  nav.search = 'entity=1';
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/entities')) return new Response('{}', { status: 500 });
    return new Response(JSON.stringify({ rows: ROWS, total: { calls: 829, input_tokens: 364000, output_tokens: 76000, cost_usd: 3.64 } }), { status: 200 });
  }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  renderPage();
  await screen.findByText('Support client');
  await waitFor(() => expect(headerTitle()).toHaveTextContent(/^Entité indisponible$/));
  expect(screen.queryByText('Conseil Marais')).not.toBeInTheDocument();
  expect(headerParents()).toEqual(['Usage et coûts']);
  expect(headerDescription()).toBe('Entité · 30 derniers jours');
  expect(headerActions()).toEqual(['7 j', '30 j', '90 j']);
});

// audit R-3
test('une ligne indisponible : « Total partiel » en vue organisation, « Total » dans l\'entité dont toutes les lignes sont lues', async () => {
  const rows = [...ROWS, { bot_id: 'x', name: 'Panne', entity_id: 2, unavailable: true }];
  const total = { calls: 829, input_tokens: 364000, output_tokens: 76000, cost_usd: 3.64 };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/entities')) return new Response(JSON.stringify(THREE), { status: 200 });
    return new Response(JSON.stringify({ rows, total, partial: true }), { status: 200 });
  }));
  const { unmount } = renderPage();
  await screen.findByText('Panne');
  expect(screen.getByText('Total partiel')).toBeInTheDocument();
  expect(screen.queryByText('Total')).not.toBeInTheDocument();
  unmount();
  nav.search = 'entity=1';
  renderPage();
  await screen.findByText('Support client');
  expect(screen.getByText('Total')).toBeInTheDocument();
  expect(screen.queryByText('Total partiel')).not.toBeInTheDocument();
});

// recette Q-2
test('le taux de la plateforme fourni par le BFF donne l\'équivalent en euros et la note du taux', async () => {
  const total = { calls: 829, input_tokens: 364000, output_tokens: 76000, cost_usd: 3.64 };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/entities')) return new Response(JSON.stringify(THREE), { status: 200 });
    return new Response(JSON.stringify({ rows: ROWS, total, partial: false, usd_eur_rate: { rate: 0.92, date: '2026-11-09' } }), { status: 200 });
  }));
  renderPage();
  await screen.findByText('Support client');
  const totalRow = screen.getByText('Total').closest('tr') as HTMLElement;
  expect(within(totalRow).getByText('≈ 3,35 €')).toBeInTheDocument();
  expect(screen.getByText('Anthropic facture en dollars ; équivalent en euros au taux de 0,92 du 9 novembre 2026.')).toBeInTheDocument();
});
