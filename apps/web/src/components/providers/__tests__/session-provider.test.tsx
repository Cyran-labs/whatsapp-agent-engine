import { StrictMode, useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { vi, beforeEach, afterEach, test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import enMessages from '../../../../messages/en.json';
import type { Me, OrganizationSummary } from '@/lib/organizations';
import { SessionProvider, useSession } from '../session-provider';
import { OrgNoticeBanner } from '@/components/shell/org-notice-banner';
import { apiFetch } from '@/lib/api-fetch';

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
  const [switchResult, setSwitchResult] = useState('');
  const [switchReference, setSwitchReference] = useState('');
  return (
    <div>
      <span data-testid="email">{s.me.email}</span>
      <span data-testid="org">{s.activeOrg?.name ?? 'aucune'}</span>
      <span data-testid="flags">{`${s.isPlatformAdmin}|${s.isAdmin}|${s.readOnly}`}</span>
      <button
        onClick={() => void s.switchOrg('c2').then((r) => {
          setSwitchResult(r.ok ? 'ok' : r.message);
          setSwitchReference(r.ok ? '' : (r.reference ?? 'aucune'));
        })}
      >
        bascule
      </button>
      <span data-testid="switch-result">{switchResult}</span>
      <span data-testid="switch-reference">{switchReference}</span>
      <button onClick={() => void s.refresh()}>rafraichir</button>
      <button onClick={() => void apiFetch('/api/bots')}>appel admin</button>
    </div>
  );
}

function renderTree() {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <SessionProvider>
        <OrgNoticeBanner />
        <Probe />
      </SessionProvider>
    </NextIntlClientProvider>,
  );
}

/**
 * Attend la session chargée ET les écouteurs `focus` / `visibilitychange` posés. `findByTestId` rend la main dès que le
 * DOM change, avant que React ait exécuté l'effet passif qui pose les écouteurs : sous charge, l'événement émis juste
 * après était perdu et le test attendait en vain le rechargement (délai de `waitFor` écoulé). `act` asynchrone purge les
 * effets en attente avant la suite.
 */
async function sessionReady(): Promise<void> {
  await screen.findByTestId('org');
  await act(async () => {});
}

const assign = vi.fn();

beforeEach(() => {
  replace.mockReset();
  assign.mockReset();
  window.sessionStorage.clear();
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

test('loader global plein écran tant que la session charge, enfants non rendus', () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
  renderTree();
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('Chargement…');
  expect(status.className).toContain('min-h-screen');
  expect(screen.queryByTestId('email')).not.toBeInTheDocument();
});

test('loader global pendant la redirection vers /no-organization (jamais d\'écran vide)', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ user: me({ organizations: [] }), active_client_id: null })));
  renderTree();
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/no-organization'));
  expect(screen.getByRole('status')).toHaveTextContent('Chargement…');
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

test('401 sur /api/auth/me : redirection vers /login, loader à la place des enfants', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'UNAUTHORIZED' } }, 401)));
  const { container } = renderTree();
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?reason=session&next=%2F'));
  expect(container.querySelector('[data-testid="email"]')).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('Chargement…');
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

// audit R-12
test('switchOrg refusé (403) : message qui nomme l\'organisation et le motif, session relue, aucune navigation', async () => {
  let meCalls = 0;
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/auth/org') return json({ error: { code: 'FORBIDDEN', message: 'Accès refusé.' } }, 403);
    meCalls += 1;
    const suspended: OrganizationSummary = { ...orgB, status: 'suspended' };
    return meCalls === 1
      ? json({ user: me(), active_client_id: 'c1' })
      : json({ user: me({ organizations: [orgA, suspended] }), active_client_id: 'c1' });
  });
  vi.stubGlobal('fetch', fetchMock);
  renderTree();
  await userEvent.click(await screen.findByRole('button', { name: 'bascule' }));
  await waitFor(() => expect(screen.getByTestId('switch-result')).toHaveTextContent('Impossible d\'ouvrir Atelier Nord : elle est suspendue.'));
  expect(meCalls).toBe(2);
  expect(assign).not.toHaveBeenCalled();
});

// audit R-12
test('switchOrg refusé (403) : organisation absente de la session relue, motif « plus accès »', async () => {
  let meCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/auth/org') return json({ error: { code: 'FORBIDDEN', message: 'Accès refusé.' } }, 403);
    meCalls += 1;
    return meCalls === 1
      ? json({ user: me(), active_client_id: 'c1' })
      : json({ user: me({ organizations: [orgA] }), active_client_id: 'c1' });
  }));
  renderTree();
  await userEvent.click(await screen.findByRole('button', { name: 'bascule' }));
  await waitFor(() => expect(screen.getByTestId('switch-result')).toHaveTextContent('Impossible d\'ouvrir Atelier Nord : vous n\'y avez plus accès.'));
});

// audit R-12
test('switchOrg : panne réseau, 429 et 500 donnent chacun leur motif, sans relire la session', async () => {
  const cases: Array<[() => Response | Promise<Response>, string]> = [
    [() => Promise.reject(new TypeError('fetch failed')), 'la connexion au serveur a échoué, réessayez'],
    [() => json({ error: { code: 'RATE_LIMITED' } }, 429), 'trop de tentatives, réessayez dans un instant'],
    [() => json({ error: { code: 'INTERNAL' } }, 500), 'l\'opération a échoué, réessayez'],
  ];
  for (const [answer, reason] of cases) {
    let meCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/auth/org') return answer();
      meCalls += 1;
      return json({ user: me(), active_client_id: 'c1' });
    }));
    const view = renderTree();
    await userEvent.click(await screen.findByRole('button', { name: 'bascule' }));
    await waitFor(() => expect(screen.getByTestId('switch-result')).toHaveTextContent(`Impossible d'ouvrir Atelier Nord : ${reason}.`));
    expect(meCalls).toBe(1);
    view.unmount();
  }
});

// audit R-14 (tâche 16b) : une panne serveur du changement d'organisation porte la référence de la requête, les autres refus non
test('switchOrg : la référence de la requête suit une panne 500, jamais un refus 403, 429 ou réseau', async () => {
  const cases: Array<[() => Response | Promise<Response>, string]> = [
    [() => json({ error: { code: 'INTERNAL', message: 'Erreur interne.', request_id: 'req-org-1' } }, 500), 'req-org-1'],
    [() => json({ error: { code: 'INTERNAL', message: 'Erreur interne.' } }, 502), 'aucune'],
    [() => json({ error: { code: 'RATE_LIMITED', request_id: 'req-org-2' } }, 429), 'aucune'],
    [() => Promise.reject(new TypeError('fetch failed')), 'aucune'],
  ];
  for (const [answer, reference] of cases) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/api/auth/org' ? answer() : json({ user: me(), active_client_id: 'c1' }))));
    const view = renderTree();
    await userEvent.click(await screen.findByRole('button', { name: 'bascule' }));
    await waitFor(() => expect(screen.getByTestId('switch-reference')).toHaveTextContent(reference));
    expect(screen.getByTestId('switch-result')).not.toHaveTextContent('Erreur interne.');
    view.unmount();
  }
});

test('switchOrg réussi : { ok: true }', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    url === '/api/auth/org' ? new Response(null, { status: 204 }) : json({ user: me(), active_client_id: 'c1' })));
  renderTree();
  await userEvent.click(await screen.findByRole('button', { name: 'bascule' }));
  await waitFor(() => expect(screen.getByTestId('switch-result')).toHaveTextContent('ok'));
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

/** Faux BFF : /api/auth/me répond dans l'ordre de la liste (le dernier se répète), /api/bots répond `bots`. */
function stubBff(meList: Array<{ user: Me; active_client_id: string | null }>, bots: () => Response = () => json([])) {
  let meCalls = 0;
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url === '/api/auth/me') {
      const body = meList[Math.min(meCalls, meList.length - 1)];
      meCalls += 1;
      return json(body);
    }
    return bots();
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, meCalls: () => meCalls };
}

const forbidden = (message: string) => () => json({ error: { code: 'FORBIDDEN', message } }, 403);

test('apiFetch depuis l\'app : en-tête X-Wab-Org avec l\'organisation affichée', async () => {
  const { fetchMock } = stubBff([{ user: me(), active_client_id: 'c1' }]);
  renderTree();
  await userEvent.click(await screen.findByRole('button', { name: 'appel admin' }));
  const call = fetchMock.mock.calls.find((c) => c[0] === '/api/bots');
  expect((call?.[1] as RequestInit).headers).toMatchObject({ 'X-Wab-Org': 'c1' });
});

test('retour sur l\'onglet (focus) : organisation changée ailleurs, rechargement sur /<locale>', async () => {
  const { meCalls } = stubBff([{ user: me(), active_client_id: 'c1' }, { user: me(), active_client_id: 'c2' }]);
  renderTree();
  await sessionReady();
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/fr'));
  expect(meCalls()).toBe(2);
});

test('onglet redevenu visible : même organisation, pas de rechargement', async () => {
  const { meCalls } = stubBff([{ user: me(), active_client_id: 'c1' }]);
  renderTree();
  await sessionReady();
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await waitFor(() => expect(meCalls()).toBe(2));
  expect(assign).not.toHaveBeenCalled();
});

test('onglet redevenu visible : accès retiré (aucune organisation), rechargement', async () => {
  stubBff([{ user: me(), active_client_id: 'c1' }, { user: me({ organizations: [] }), active_client_id: null }]);
  renderTree();
  await sessionReady();
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/fr'));
});

test('apiFetch reçoit 409 ORG_CHANGED : rechargement sur /<locale>', async () => {
  stubBff([{ user: me(), active_client_id: 'c1' }], () =>
    json({ error: { code: 'ORG_CHANGED', message: 'Organisation changée dans un autre onglet.' } }, 409));
  renderTree();
  await userEvent.click(await screen.findByRole('button', { name: 'appel admin' }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/fr'));
});

// audit R-11
test('409 ORG_CHANGED : l\'onglet se recharge et le bandeau explique, en nommant la nouvelle organisation', async () => {
  stubBff(
    [{ user: me(), active_client_id: 'c1' }, { user: me(), active_client_id: 'c2' }],
    () => json({ error: { code: 'ORG_CHANGED', message: 'Organisation changée dans un autre onglet.' } }, 409),
  );
  const first = renderTree();
  await userEvent.click(await screen.findByRole('button', { name: 'appel admin' }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/fr'));
  first.unmount();
  stubBff([{ user: me(), active_client_id: 'c2' }]);
  renderTree();
  const text = 'Vous avez changé d\'organisation dans un autre onglet : cet onglet affiche maintenant Atelier Nord.';
  expect((await screen.findByText(text)).closest('[role=\"status\"]')).not.toBeNull();
});

// audit R-11
test('409 ORG_CHANGED en rafale : une seule relecture de la session et un seul rechargement', async () => {
  const { meCalls } = stubBff(
    [{ user: me(), active_client_id: 'c1' }, { user: me(), active_client_id: 'c2' }],
    () => json({ error: { code: 'ORG_CHANGED', message: 'Organisation changée dans un autre onglet.' } }, 409),
  );
  renderTree();
  const button = await screen.findByRole('button', { name: 'appel admin' });
  await userEvent.click(button);
  await userEvent.click(button);
  await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
  expect(meCalls()).toBe(2);
});

// audit R-11
test('409 ORG_CHANGED et relecture impossible : rechargement quand même, sans bandeau', async () => {
  let meCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/auth/me') {
      meCalls += 1;
      if (meCalls === 1) return json({ user: me(), active_client_id: 'c1' });
      return json({ error: { code: 'INTERNAL' } }, 500);
    }
    return json({ error: { code: 'ORG_CHANGED', message: 'x' } }, 409);
  }));
  renderTree();
  await userEvent.click(await screen.findByRole('button', { name: 'appel admin' }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/fr'));
  expect(window.sessionStorage.getItem('wab_org_notice')).toBeNull();
});

// audit R-11
test('retour sur l\'onglet : le rechargement laisse le bandeau « autre onglet » nommant la nouvelle organisation', async () => {
  stubBff([{ user: me(), active_client_id: 'c1' }, { user: me(), active_client_id: 'c2' }]);
  renderTree();
  await sessionReady();
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/fr'));
  expect(JSON.parse(window.sessionStorage.getItem('wab_org_notice') ?? 'null')).toEqual({ kind: 'changed', org: 'Atelier Nord' });
});

const suspendedA: OrganizationSummary = { ...orgA, status: 'suspended' };
const storedNotice = () => JSON.parse(window.sessionStorage.getItem('wab_org_notice') ?? 'null');

// audit R-11
test('retour sur l\'onglet après suspension de l\'organisation affichée : bandeau « suspendue », pas « autre onglet »', async () => {
  stubBff([
    { user: me(), active_client_id: 'c1' },
    { user: me({ organizations: [suspendedA, orgB] }), active_client_id: 'c2' },
  ]);
  renderTree();
  await sessionReady();
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/fr'));
  expect(storedNotice()).toEqual({ kind: 'suspended', org: 'Maison Lumière' });
});

// audit R-11
test('retour sur l\'onglet après retrait d\'accès à l\'organisation affichée : bandeau « accès perdu »', async () => {
  stubBff([
    { user: me(), active_client_id: 'c1' },
    { user: me({ organizations: [orgB] }), active_client_id: 'c2' },
  ]);
  renderTree();
  await sessionReady();
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/fr'));
  expect(storedNotice()).toEqual({ kind: 'access', org: 'Maison Lumière' });
});

// audit R-11
test('409 ORG_CHANGED alors que l\'organisation affichée est suspendue : bandeau « suspendue »', async () => {
  stubBff(
    [{ user: me(), active_client_id: 'c1' }, { user: me({ organizations: [suspendedA, orgB] }), active_client_id: 'c2' }],
    () => json({ error: { code: 'ORG_CHANGED', message: 'Organisation changée dans un autre onglet.' } }, 409),
  );
  renderTree();
  await userEvent.click(await screen.findByRole('button', { name: 'appel admin' }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/fr'));
  expect(storedNotice()).toEqual({ kind: 'suspended', org: 'Maison Lumière' });
});

// audit R-11
test('409 ORG_CHANGED alors que l\'accès à l\'organisation affichée est retiré : bandeau « accès perdu »', async () => {
  stubBff(
    [{ user: me(), active_client_id: 'c1' }, { user: me({ organizations: [orgB] }), active_client_id: 'c2' }],
    () => json({ error: { code: 'ORG_CHANGED', message: 'Organisation changée dans un autre onglet.' } }, 409),
  );
  renderTree();
  await userEvent.click(await screen.findByRole('button', { name: 'appel admin' }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/fr'));
  expect(storedNotice()).toEqual({ kind: 'access', org: 'Maison Lumière' });
});

// audit R-11 : un 409 et un 403 simultanés décident une seule fois, d'après la session relue
test('409 et 403 simultanés : un seul rechargement, un seul message, celui de la session relue', async () => {
  let botCalls = 0;
  stubBff(
    [{ user: me(), active_client_id: 'c1' }, { user: me({ organizations: [suspendedA, orgB] }), active_client_id: 'c2' }],
    () => {
      botCalls += 1;
      return botCalls === 1
        ? json({ error: { code: 'ORG_CHANGED', message: 'Organisation changée dans un autre onglet.' } }, 409)
        : json({ error: { code: 'FORBIDDEN', message: 'Organisation suspendue.' } }, 403);
    },
  );
  renderTree();
  const button = await screen.findByRole('button', { name: 'appel admin' });
  await userEvent.click(button);
  await userEvent.click(button);
  await waitFor(() => expect(assign).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 50));
  expect(assign).toHaveBeenCalledTimes(1);
  expect(storedNotice()).toEqual({ kind: 'suspended', org: 'Maison Lumière' });
});

// audit R-12
test('switchOrg refusé et la session relue affiche une autre organisation : même décision et rechargement', async () => {
  let meCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/auth/org') return json({ error: { code: 'FORBIDDEN', message: 'Accès refusé.' } }, 403);
    meCalls += 1;
    return meCalls === 1
      ? json({ user: me({ organizations: [orgA, orgB, { ...orgB, client_id: 'c3', name: 'Studio Ocre' }] }), active_client_id: 'c1' })
      : json({ user: me({ organizations: [suspendedA, orgB] }), active_client_id: 'c2' });
  }));
  renderTree();
  await userEvent.click(await screen.findByRole('button', { name: 'bascule' }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/fr'));
  expect(storedNotice()).toEqual({ kind: 'suspended', org: 'Maison Lumière' });
  expect(screen.getByTestId('switch-result')).toHaveTextContent('Impossible d\'ouvrir Atelier Nord');
});

test('message stocké mal formé : ignoré, aucun bandeau', async () => {
  window.sessionStorage.setItem('wab_org_notice', 'access');
  stubBff([{ user: me(), active_client_id: 'c1' }]);
  renderTree();
  await screen.findByTestId('org');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('apiFetch reçoit 401 : redirection vers /login', async () => {
  stubBff([{ user: me(), active_client_id: 'c1' }], () => json({ error: { code: 'UNAUTHORIZED', message: 'Session expirée.' } }, 401));
  renderTree();
  await userEvent.click(await screen.findByRole('button', { name: 'appel admin' }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?reason=session&next=%2F'));
});

// audit R-10 : la connexion explique pourquoi et sait où revenir (langue et requête comprises)
test('apiFetch reçoit 401 : /login?reason=session&next=<chemin actuel avec langue et requête>', async () => {
  vi.stubGlobal('location', { ...window.location, assign, pathname: '/fr/organisation/utilisateurs', search: '?tab=invitations' });
  stubBff([{ user: me(), active_client_id: 'c1' }], () => json({ error: { code: 'UNAUTHORIZED', message: 'Session expirée.' } }, 401));
  renderTree();
  await userEvent.click(await screen.findByRole('button', { name: 'appel admin' }));
  await waitFor(() =>
    expect(replace).toHaveBeenCalledWith(
      '/login?reason=session&next=%2Ffr%2Forganisation%2Futilisateurs%3Ftab%3Dinvitations',
    ),
  );
});

// audit R-10
test('401 sur /api/auth/me : même redirection avec le chemin actuel', async () => {
  vi.stubGlobal('location', { ...window.location, assign, pathname: '/en/agents/12', search: '' });
  vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'UNAUTHORIZED' } }, 401)));
  renderTree();
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?reason=session&next=%2Fen%2Fagents%2F12'));
});

test('« Organisation suspendue. » : relit la session, repli sur une autre organisation, rechargement puis bandeau', async () => {
  stubBff(
    [{ user: me(), active_client_id: 'c1' }, { user: me({ organizations: [{ ...orgA, status: 'suspended' }, orgB] }), active_client_id: 'c2' }],
    forbidden('Organisation suspendue.'),
  );
  const first = renderTree();
  await userEvent.click(await screen.findByRole('button', { name: 'appel admin' }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/fr'));
  first.unmount();
  // la page rechargée affiche le message une seule fois
  stubBff([{ user: me({ organizations: [orgB] }), active_client_id: 'c2' }]);
  const second = renderTree();
  // audit R-29 : le bandeau nomme l'organisation suspendue (celle qu'on quitte), pas celle d'arrivée
  const suspendedText = 'Maison Lumière est suspendue. Contactez l\'administrateur de votre organisation ou le support.';
  expect((await screen.findByText(suspendedText)).closest('[role=\"status\"]')).not.toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Fermer le message' }));
  expect(screen.queryByText(suspendedText)).not.toBeInTheDocument();
  second.unmount();
  renderTree();
  await screen.findByTestId('org');
  expect(screen.queryByText(suspendedText)).not.toBeInTheDocument();
});

test('403 d\'appartenance : accès retiré, repli sur l\'organisation restante avec « Vous n\'avez plus accès à … »', async () => {
  stubBff(
    [{ user: me(), active_client_id: 'c1' }, { user: me({ organizations: [orgB] }), active_client_id: 'c2' }],
    forbidden('Accès refusé.'),
  );
  const first = renderTree();
  await userEvent.click(await screen.findByRole('button', { name: 'appel admin' }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/fr'));
  first.unmount();
  stubBff([{ user: me({ organizations: [orgB] }), active_client_id: 'c2' }]);
  renderTree();
  // audit R-29
  expect((await screen.findByText('Vous n\'avez plus accès à Maison Lumière.')).closest('[role=\"status\"]')).not.toBeNull();
});

test('403 de rôle (rien n\'a changé) : session relue, ni bandeau ni rechargement', async () => {
  const { meCalls } = stubBff([{ user: me(), active_client_id: 'c1' }], forbidden('Accès refusé.'));
  renderTree();
  await userEvent.click(await screen.findByRole('button', { name: 'appel admin' }));
  await waitFor(() => expect(meCalls()).toBe(2));
  expect(assign).not.toHaveBeenCalled();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('403 après changement de rôle dans la même organisation : contexte mis à jour et bandeau, sans rechargement', async () => {
  const demoted: OrganizationSummary = { ...orgA, role: 'advisor' };
  stubBff(
    [{ user: me(), active_client_id: 'c1' }, { user: me({ organizations: [demoted, orgB] }), active_client_id: 'c1' }],
    forbidden('Accès refusé.'),
  );
  renderTree();
  await userEvent.click(await screen.findByRole('button', { name: 'appel admin' }));
  // audit R-29 : le bandeau nomme l'organisation et le nouveau rôle
  expect((await screen.findByText('Votre accès à Maison Lumière a changé : vous êtes maintenant Conseiller.')).closest('[role=\"status\"]')).not.toBeNull();
  expect(screen.getByTestId('flags')).toHaveTextContent('false|false|false');
  expect(assign).not.toHaveBeenCalled();
});

test('403 et plus aucune organisation : redirection vers /no-organization', async () => {
  stubBff(
    [{ user: me(), active_client_id: 'c1' }, { user: me({ organizations: [] }), active_client_id: null }],
    forbidden('Organisation suspendue.'),
  );
  renderTree();
  await userEvent.click(await screen.findByRole('button', { name: 'appel admin' }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/no-organization'));
});

test('bandeau en anglais', async () => {
  window.sessionStorage.setItem('wab_org_notice', JSON.stringify({ kind: 'access', org: 'Atelier Nord', role: 'advisor', readOnly: false }));
  stubBff([{ user: me(), active_client_id: 'c1' }]);
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SessionProvider>
        <OrgNoticeBanner />
      </SessionProvider>
    </NextIntlClientProvider>,
  );
  expect((await screen.findByText('Your access to Atelier Nord has changed: you are now Advisor.')).closest('[role=\"status\"]')).not.toBeNull();
});

test('mode strict (double montage) : la liaison d\'apiFetch reste posée', async () => {
  const { fetchMock } = stubBff([{ user: me(), active_client_id: 'c1' }]);
  render(
    <StrictMode>
      <NextIntlClientProvider locale="fr" messages={messages}>
        <SessionProvider>
          <Probe />
        </SessionProvider>
      </NextIntlClientProvider>
    </StrictMode>,
  );
  await userEvent.click(await screen.findByRole('button', { name: 'appel admin' }));
  const call = fetchMock.mock.calls.find((c) => c[0] === '/api/bots');
  expect((call?.[1] as RequestInit).headers).toMatchObject({ 'X-Wab-Org': 'c1' });
});

test('mode strict : le bandeau stocké avant rechargement s\'affiche malgré le double montage', async () => {
  window.sessionStorage.setItem('wab_org_notice', JSON.stringify({ kind: 'access', org: 'Maison Lumière' }));
  stubBff([{ user: me(), active_client_id: 'c1' }]);
  render(
    <StrictMode>
      <NextIntlClientProvider locale="fr" messages={messages}>
        <SessionProvider>
          <OrgNoticeBanner />
          <Probe />
        </SessionProvider>
      </NextIntlClientProvider>
    </StrictMode>,
  );
  expect((await screen.findByText('Vous n\'avez plus accès à Maison Lumière.')).closest('[role=\"status\"]')).not.toBeNull();
});
