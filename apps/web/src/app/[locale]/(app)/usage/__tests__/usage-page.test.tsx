import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../../../messages/fr.json';
import GlobalUsagePage from '../page';

const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(nav.search) }));

vi.mock('@/i18n/routing', () => ({
  Link: (p: { children: React.ReactNode; href: string; 'aria-current'?: 'page' }) => <a href={p.href} aria-current={p['aria-current']}>{p.children}</a>,
  usePathname: () => '/usage',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  routing: { locales: ['fr', 'en'], defaultLocale: 'fr' },
}));

vi.mock('@/components/providers/session-provider', () => {
  const org = { client_id: 'ml', name: 'Maison Lumière', role: 'admin', read_only: false };
  return {
    useSession: () => ({
      me: { id: 1, email: 'claire@maison-lumiere.fr', role: 'user', status: 'active', organizations: [org] },
      activeOrg: org,
      isPlatformAdmin: false,
      isAdmin: true,
      readOnly: false,
      switchOrg: vi.fn(),
      refresh: vi.fn(),
    }),
  };
});

beforeEach(() => {
  vi.restoreAllMocks();
  nav.search = '';
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

test('rail : Toute l organisation active, groupe Entités avec un lien par entité active', async () => {
  stubFetch(ROWS, [...THREE, entity(4, 'Ancienne', 'archived')]);
  renderPage();
  await screen.findByText('Support client');
  const rail = screen.getByRole('complementary');
  expect(within(rail).getByText('Usage & coûts')).toBeInTheDocument();
  expect(within(rail).getByText('Maison Lumière')).toBeInTheDocument();
  expect(within(rail).getByText('Toute l\'organisation').closest('a')).toHaveAttribute('aria-current', 'page');
  expect(within(rail).getByText('Toute l\'organisation').closest('a')).toHaveAttribute('href', '/usage');
  expect(within(rail).getByText('Entités')).toBeInTheDocument();
  expect(within(rail).getByText('Boutique Lyon').closest('a')).toHaveAttribute('href', '/usage?entity=3');
  expect(within(rail).queryByText('Ancienne')).not.toBeInTheDocument();
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

test('?entity= inconnue ou archivée : retombe sur Toute l organisation', async () => {
  nav.search = 'entity=4';
  stubFetch(ROWS, [...THREE, entity(4, 'Ancienne', 'archived')]);
  renderPage();
  await screen.findByText('Conseil Marais');
  expect(screen.getByText('Support client')).toBeInTheDocument();
  const rail = screen.getByRole('complementary');
  expect(within(rail).getByText('Toute l\'organisation').closest('a')).toHaveAttribute('aria-current', 'page');
});

test('une seule entité active : pas de groupe Entités ni de colonne Entité', async () => {
  stubFetch(ROWS.slice(0, 2), [entity(1, 'Principale')]);
  renderPage();
  await screen.findByText('Support client');
  expect(screen.queryByText('Entités')).not.toBeInTheDocument();
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
  expect(await screen.findByRole('alert')).toHaveTextContent('Une erreur est survenue.');
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
  expect(await screen.findByRole('alert')).toHaveTextContent('Une erreur est survenue.');
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
  expect(within(rail).queryByText('Entités')).not.toBeInTheDocument();
  await userEvent.click(within(rail).getByRole('button', { name: 'Réessayer' }));
  expect(await within(rail).findByText('Boutique Lyon')).toBeInTheDocument();
  expect(within(rail).queryByText('Entités indisponibles')).not.toBeInTheDocument();
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
