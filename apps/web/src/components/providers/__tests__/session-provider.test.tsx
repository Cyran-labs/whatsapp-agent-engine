import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { vi, beforeEach, afterEach, test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import type { Me, OrganizationSummary } from '@/lib/organizations';
import { SessionProvider, useSession } from '../session-provider';

const replace = vi.fn();
let pathname = '/';
vi.mock('@/i18n/routing', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace, push: vi.fn() }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
  routing: { locales: ['fr', 'en'], defaultLocale: 'fr' },
}));

const orgA: OrganizationSummary = { client_id: 'c1', name: 'Maison Lumière', role: 'admin', read_only: false };
const orgB: OrganizationSummary = { client_id: 'c2', name: 'Atelier Nord', role: 'super_manager', read_only: true };

function me(overrides: Partial<Me> = {}): Me {
  return { id: 1, email: 'claire.bernard@x.fr', role: 'admin', status: 'active', organizations: [orgA, orgB], ...overrides };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function Probe() {
  const s = useSession();
  return (
    <div>
      <span data-testid="email">{s.me.email}</span>
      <span data-testid="org">{s.activeOrg?.name ?? 'aucune'}</span>
      <span data-testid="flags">{`${s.isPlatformAdmin}|${s.isAdmin}|${s.readOnly}`}</span>
      <button onClick={() => void s.switchOrg('c2')}>bascule</button>
      <button onClick={() => void s.refresh()}>rafraichir</button>
    </div>
  );
}

function renderTree() {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <SessionProvider>
        <Probe />
      </SessionProvider>
    </NextIntlClientProvider>,
  );
}

const assign = vi.fn();

beforeEach(() => {
  replace.mockReset();
  assign.mockReset();
  pathname = '/';
  vi.stubGlobal('location', { ...window.location, assign });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('rend les enfants avec le contexte quand /api/auth/me répond', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ user: me(), active_client_id: 'c1' })));
  renderTree();
  expect(await screen.findByTestId('email')).toHaveTextContent('claire.bernard@x.fr');
  expect(screen.getByTestId('org')).toHaveTextContent('Maison Lumière');
  expect(screen.getByTestId('flags')).toHaveTextContent('false|true|false');
  expect(replace).not.toHaveBeenCalled();
});

test('ne rend rien tant que la session charge', () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
  const { container } = renderTree();
  expect(container).toBeEmptyDOMElement();
});

test('lecture seule et super admin dérivés de la session', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ user: me({ role: 'super_admin' }), active_client_id: 'c2' })));
  renderTree();
  expect(await screen.findByTestId('flags')).toHaveTextContent('true|false|true');
});

test('aucune organisation (membre ordinaire) : redirige vers /no-organization et ne rend pas les enfants', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ user: me({ organizations: [] }), active_client_id: null })));
  renderTree();
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/no-organization'));
  expect(screen.queryByTestId('email')).not.toBeInTheDocument();
});

test('aucune organisation (super admin sans organisation sur la plateforme) : même redirection', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ user: me({ role: 'super_admin', organizations: [] }), active_client_id: null })));
  renderTree();
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/no-organization'));
});

test('aucune organisation ouvrable (toutes suspendues) : même redirection', async () => {
  const suspended: OrganizationSummary = { ...orgA, status: 'suspended' };
  vi.stubGlobal('fetch', vi.fn(async () => json({ user: me({ role: 'super_admin', organizations: [suspended] }), active_client_id: null })));
  renderTree();
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/no-organization'));
});

test('aucune organisation sur /account : pas de redirection, les enfants sont rendus', async () => {
  pathname = '/account/preferences';
  vi.stubGlobal('fetch', vi.fn(async () => json({ user: me({ organizations: [] }), active_client_id: null })));
  renderTree();
  expect(await screen.findByTestId('org')).toHaveTextContent('aucune');
  expect(replace).not.toHaveBeenCalled();
});

test('401 sur /api/auth/me : redirection vers /login, rien n est rendu', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'UNAUTHORIZED' } }, 401)));
  const { container } = renderTree();
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  expect(container).toBeEmptyDOMElement();
});

test('erreur serveur sur /api/auth/me : message et bouton Réessayer qui recharge', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json({ error: { code: 'INTERNAL' } }, 500))
    .mockResolvedValueOnce(json({ user: me(), active_client_id: 'c1' }));
  vi.stubGlobal('fetch', fetchMock);
  renderTree();
  await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByTestId('email')).toBeInTheDocument();
  expect(replace).not.toHaveBeenCalled();
});

test('switchOrg : POST /api/auth/org avec le client_id, puis rechargement sur /<locale>', async () => {
  const fetchMock = vi.fn(async (url: string) =>
    url === '/api/auth/org' ? new Response(null, { status: 204 }) : json({ user: me(), active_client_id: 'c1' }),
  );
  vi.stubGlobal('fetch', fetchMock);
  renderTree();
  await userEvent.click(await screen.findByRole('button', { name: 'bascule' }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/fr'));
  const call = fetchMock.mock.calls.find((c) => c[0] === '/api/auth/org') as unknown as [string, RequestInit];
  expect(call[1].method).toBe('POST');
  expect(JSON.parse(String(call[1].body))).toEqual({ client_id: 'c2' });
});

test('switchOrg refusé (403) : recharge la session sans naviguer', async () => {
  let meCalls = 0;
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/auth/org') return json({ error: { code: 'FORBIDDEN' } }, 403);
    meCalls += 1;
    return meCalls === 1
      ? json({ user: me(), active_client_id: 'c1' })
      : json({ user: me({ organizations: [orgA] }), active_client_id: 'c1' });
  });
  vi.stubGlobal('fetch', fetchMock);
  renderTree();
  await userEvent.click(await screen.findByRole('button', { name: 'bascule' }));
  await waitFor(() => expect(meCalls).toBe(2));
  expect(assign).not.toHaveBeenCalled();
});

test('refresh : relit /api/auth/me et met le contexte à jour', async () => {
  let meCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      meCalls += 1;
      return json({ user: me(), active_client_id: meCalls === 1 ? 'c1' : 'c2' });
    }),
  );
  renderTree();
  expect(await screen.findByTestId('org')).toHaveTextContent('Maison Lumière');
  await userEvent.click(screen.getByRole('button', { name: 'rafraichir' }));
  await waitFor(() => expect(screen.getByTestId('org')).toHaveTextContent('Atelier Nord'));
});
