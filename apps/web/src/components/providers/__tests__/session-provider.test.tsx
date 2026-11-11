import { StrictMode, useEffect, useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { vi, beforeEach, afterEach, test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import enMessages from '../../../../messages/en.json';
import type { Me, OrganizationSummary } from '@/lib/organizations';
import { SessionProvider, useSession } from '../session-provider';
import { OrgNoticeBanner } from '@/components/shell/org-notice-banner';
import { NavigationGuardProvider, useNavigationGuard } from '@/components/shell/navigation-guard';
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
          setSwitchResult(r.ok ? 'ok' : r.suspended ? 'bandeau' : r.message);
          setSwitchReference(r.ok || r.suspended ? '' : (r.reference ?? 'aucune'));
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

const UNREADABLE = 'Impossible de lire votre session pour le moment.';
const unreachable = () => json({ error: { code: 'ENGINE_UNREACHABLE', message: 'Le moteur ne répond pas.' } }, 503);

/** Faux BFF : /api/auth/me répond dans l'ordre de la liste (le dernier se répète) ; une fonction donne la réponse. */
function stubMeSequence(list: Array<() => Response | Promise<Response>>) {
  let calls = 0;
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url !== '/api/auth/me') return json([]);
    const next = list[Math.min(calls, list.length - 1)];
    calls += 1;
    return next();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const ready = (activeId: string) => () => json({ user: me(), active_client_id: activeId });

// entête 5 : premier chargement en échec, cadre neutre sans aucune donnée d'organisation ni bandeau relu du stockage
test('premier chargement en échec : titre sur place, cadre neutre, aucun nom d\'organisation ni bandeau stocké', async () => {
  window.sessionStorage.setItem('wab_org_notice', JSON.stringify({ kind: 'changed', org: 'Atelier Nord', user_id: 1 }));
  stubMeSequence([unreachable]);
  const { container } = renderTree();
  expect(await screen.findByRole('heading', { level: 1, name: UNREADABLE })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  const rail = screen.getByRole('navigation', { name: 'Navigation principale' });
  // cadre neutre : marque, Aide et Compte seulement (ordre et attributs couverts par app-rail.test.tsx)
  expect(rail).toHaveTextContent('WABAGENT');
  expect(rail).toHaveTextContent('Aide');
  expect(rail).toHaveTextContent('Compte');
  for (const word of ['Organisation', 'Agents IA', 'Usage', 'claire.bernard']) expect(rail).not.toHaveTextContent(word);
  expect(container.querySelector('[data-org-block]')).toBeNull();
  expect(container).not.toHaveTextContent('Maison Lumière');
  expect(container).not.toHaveTextContent('Atelier Nord');
  expect(container).not.toHaveTextContent('Une erreur est survenue.');
  expect(screen.queryByTestId('email')).not.toBeInTheDocument();
});

// recette 3.1 : session déjà lue puis relecture en échec, le cadre de cette session reste et la page n'est pas rendue
test('session lue puis refresh() en échec : bloc Organisation de cette session, enfants absents, message et Réessayer', async () => {
  stubMeSequence([ready('c1'), unreachable]);
  const { container } = renderTree();
  await sessionReady();
  await userEvent.click(screen.getByRole('button', { name: 'rafraichir' }));
  expect(await screen.findByRole('heading', { level: 1, name: UNREADABLE })).toBeInTheDocument();
  expect(container.querySelector('[data-org-block]')).toHaveTextContent('Maison Lumière');
  expect(screen.getByRole('navigation', { name: 'Navigation principale' })).toHaveTextContent('Agents IA');
  expect(screen.queryByTestId('email')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  expect(container).not.toHaveTextContent('Une erreur est survenue.');
});

test('session illisible : la liaison d\'apiFetch reste celle de la session déjà lue', async () => {
  const fetchMock = stubMeSequence([ready('c1'), unreachable]);
  renderTree();
  await sessionReady();
  await userEvent.click(screen.getByRole('button', { name: 'rafraichir' }));
  await screen.findByRole('heading', { level: 1, name: UNREADABLE });
  await act(async () => {
    await apiFetch('/api/bots');
  });
  const call = fetchMock.mock.calls.find((c) => c[0] === '/api/bots');
  expect((call?.[1] as RequestInit).headers).toMatchObject({ 'X-Wab-Org': 'c1' });
});

test('session illisible : pendant la relecture, « Réessayer » est indisponible avec « Lecture en cours. »', async () => {
  let release: (r: Response) => void = () => undefined;
  stubMeSequence([ready('c1'), unreachable, () => new Promise<Response>((resolve) => (release = resolve))]);
  renderTree();
  await sessionReady();
  await userEvent.click(screen.getByRole('button', { name: 'rafraichir' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
  const pending = screen.getByRole('button', { name: 'Lecture en cours.' });
  expect(pending).toHaveAttribute('aria-disabled', 'true');
  await act(async () => release(json({ user: me(), active_client_id: 'c1' })));
  expect(await screen.findByTestId('org')).toHaveTextContent('Maison Lumière');
});

test('« Réessayer » réussi sur la même organisation : enfants rendus, aucun rechargement', async () => {
  stubMeSequence([ready('c1'), unreachable, ready('c1')]);
  renderTree();
  await sessionReady();
  await userEvent.click(screen.getByRole('button', { name: 'rafraichir' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByTestId('org')).toHaveTextContent('Maison Lumière');
  expect(screen.queryByRole('heading', { name: UNREADABLE })).not.toBeInTheDocument();
  expect(assign).not.toHaveBeenCalled();
});

// entête, point d'attention 5 : organisation changée dans un autre onglet pendant la panne, rechargement complet
test('« Réessayer » réussi sur une autre organisation : rechargement, jamais l\'ancien cadre avec la nouvelle organisation', async () => {
  stubMeSequence([ready('c1'), unreachable, ready('c2')]);
  const { container } = renderTree();
  await sessionReady();
  await userEvent.click(screen.getByRole('button', { name: 'rafraichir' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/fr'));
  expect(storedNotice()).toEqual({ kind: 'changed', org: 'Atelier Nord', user_id: 1 });
  expect(screen.queryByTestId('org')).not.toBeInTheDocument();
  expect(container.querySelector('[data-org-block]')).not.toHaveTextContent('Atelier Nord');
});

test('premier chargement en échec puis « Réessayer » réussi : enfants rendus', async () => {
  stubMeSequence([unreachable, ready('c1')]);
  renderTree();
  await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByTestId('org')).toHaveTextContent('Maison Lumière');
  expect(assign).not.toHaveBeenCalled();
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

// audit R-12, recette 3.13 (C-15) : un refus pour suspension se dit par le bandeau, qui nomme l'organisation tentée
test('switchOrg refusé (403) pour suspension : bandeau qui nomme l\'organisation tentée, session relue, aucune navigation', async () => {
  let meCalls = 0;
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/auth/org') return json({ error: { code: 'FORBIDDEN', message: 'Accès refusé.' } }, 403);
    meCalls += 1;
    const suspended: OrganizationSummary = { ...orgB, status: 'suspended' };
    return meCalls === 1
      ? json({ user: me(), active_client_id: 'c1', refused_client_id: null })
      : json({ user: me({ organizations: [orgA, suspended] }), active_client_id: 'c1', refused_client_id: null });
  });
  vi.stubGlobal('fetch', fetchMock);
  renderTree();
  await sessionReady();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'bascule' }));
  await waitFor(() => expect(screen.getByTestId('switch-result')).toHaveTextContent('bandeau'));
  expect(screen.getByRole('status')).toHaveTextContent(
    'Atelier Nord est suspendue. Contactez l\'administrateur de votre organisation ou le support.',
  );
  expect(screen.getByTestId('org')).toHaveTextContent('Maison Lumière');
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
function stubBff(meList: Array<{ user: Me; active_client_id: string | null; refused_client_id?: string | null }>, bots: () => Response = () => json([])) {
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
  expect(JSON.parse(window.sessionStorage.getItem('wab_org_notice') ?? 'null')).toEqual({ kind: 'changed', org: 'Atelier Nord', user_id: 1 });
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
  expect(storedNotice()).toEqual({ kind: 'suspended', org: 'Maison Lumière', role: 'admin', user_id: 1 });
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
  expect(storedNotice()).toEqual({ kind: 'access', org: 'Maison Lumière', user_id: 1 });
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
  expect(storedNotice()).toEqual({ kind: 'suspended', org: 'Maison Lumière', role: 'admin', user_id: 1 });
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
  expect(storedNotice()).toEqual({ kind: 'access', org: 'Maison Lumière', user_id: 1 });
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
  expect(storedNotice()).toEqual({ kind: 'suspended', org: 'Maison Lumière', role: 'admin', user_id: 1 });
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
  expect(storedNotice()).toEqual({ kind: 'suspended', org: 'Maison Lumière', role: 'admin', user_id: 1 });
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
  // recette 3.13 : administrateur de Maison Lumière, il ne reste que le support à contacter
  const suspendedText = 'Maison Lumière est suspendue. Contactez le support.';
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
  window.sessionStorage.setItem('wab_org_notice', JSON.stringify({ kind: 'access', org: 'Atelier Nord', role: 'advisor', readOnly: false, user_id: 1 }));
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
  window.sessionStorage.setItem('wab_org_notice', JSON.stringify({ kind: 'access', org: 'Maison Lumière', user_id: 1 }));
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

/** Pose la garde de sortie, comme l'assistant avec une saisie en attente. */
function GuardOn() {
  const { setGuard } = useNavigationGuard();
  useEffect(() => setGuard(true), [setGuard]);
  return null;
}

/** Rechargement qui relève si la garde le retient, comme le navigateur (`beforeunload` lu à la navigation). */
function assignThroughBeforeUnload(): boolean[] {
  const retained: boolean[] = [];
  assign.mockImplementation(() => {
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    retained.push(unload.defaultPrevented);
  });
  return retained;
}

function renderGuardedTree() {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <NavigationGuardProvider>
        <SessionProvider>
          <GuardOn />
          <Probe />
        </SessionProvider>
      </NavigationGuardProvider>
    </NextIntlClientProvider>,
  );
}

// relecture tâche 13, M-5 ; nav 15.4 : un rechargement voulu par la session n'est jamais retenu par la garde de l'assistant
test('garde posée, changement d\'organisation réussi : le rechargement n\'est pas retenu par beforeunload', async () => {
  const retained = assignThroughBeforeUnload();
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    url === '/api/auth/org' ? new Response(null, { status: 204 }) : json({ user: me(), active_client_id: 'c1' })));
  renderGuardedTree();
  await userEvent.click(await screen.findByRole('button', { name: 'bascule' }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/fr'));
  expect(retained).toEqual([false]);
});

test('garde posée, organisation changée dans un autre onglet : le rechargement n\'est pas retenu par beforeunload', async () => {
  const retained = assignThroughBeforeUnload();
  stubBff([{ user: me(), active_client_id: 'c1' }, { user: me(), active_client_id: 'c2' }]);
  renderGuardedTree();
  await sessionReady();
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/fr'));
  expect(retained).toEqual([false]);
});

const suspendedB: OrganizationSummary = { ...orgB, status: 'suspended' };

// recette 3.13 : membre d'une organisation suspendue qu'il n'a pas tenté d'ouvrir, aucun bandeau
test('membre de A (ouverte) et de B (suspendue), aucune tentative : aucun bandeau', async () => {
  stubBff([{ user: me({ organizations: [orgA, suspendedB] }), active_client_id: 'c1', refused_client_id: null }]);
  renderTree();
  await sessionReady();
  await act(async () => {});
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByText(/Atelier Nord/)).not.toBeInTheDocument();
});

// recette 3.13 : un refus « organisation suspendue » ne nomme jamais l'organisation ouverte, toujours ouvrable
test('handleOrgError(suspended) sur A toujours ouvrable : session relue, aucun bandeau qui nomme A', async () => {
  const { meCalls } = stubBff(
    [{ user: me({ organizations: [orgA, suspendedB] }), active_client_id: 'c1', refused_client_id: null }],
    () => json({ error: { code: 'FORBIDDEN', message: 'Organisation suspendue.', reason: 'session.organization_suspended' } }, 403),
  );
  renderTree();
  await userEvent.click(await screen.findByRole('button', { name: 'appel admin' }));
  await waitFor(() => expect(meCalls()).toBe(2));
  await act(async () => {});
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByText(/Maison Lumière est suspendue/)).not.toBeInTheDocument();
  expect(assign).not.toHaveBeenCalled();
});

// recette 3.13 : le rôle change en même temps, seul le changement de rôle est dit
test('handleOrgError(suspended) et rôle changé sur A ouvrable : bandeau du rôle, jamais « suspendue »', async () => {
  const demoted: OrganizationSummary = { ...orgA, role: 'advisor' };
  stubBff(
    [{ user: me(), active_client_id: 'c1' }, { user: me({ organizations: [demoted, orgB] }), active_client_id: 'c1' }],
    forbidden('Organisation suspendue.'),
  );
  renderTree();
  await userEvent.click(await screen.findByRole('button', { name: 'appel admin' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Votre accès à Maison Lumière a changé : vous êtes maintenant Conseiller.');
  expect(screen.queryByText(/est suspendue/)).not.toBeInTheDocument();
});

// recette 3.13 : organisation enregistrée suspendue, ouverte à sa place une autre ; le bandeau nomme la tentée
test('refused_client_id = B au chargement : bandeau qui nomme B sur la page de A', async () => {
  stubBff([{ user: me({ organizations: [orgA, suspendedB] }), active_client_id: 'c1', refused_client_id: 'c2' }]);
  renderTree();
  await sessionReady();
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Atelier Nord est suspendue. Contactez l\'administrateur de votre organisation ou le support.',
  );
  expect(screen.getByTestId('org')).toHaveTextContent('Maison Lumière');
});

test('refused_client_id = B, administrateur de B : « Contactez le support. »', async () => {
  const adminB: OrganizationSummary = { ...suspendedB, role: 'admin', read_only: false };
  stubBff([{ user: me({ organizations: [orgA, adminB] }), active_client_id: 'c1', refused_client_id: 'c2' }]);
  renderTree();
  await sessionReady();
  expect(await screen.findByRole('status')).toHaveTextContent(/^Atelier Nord est suspendue\. Contactez le support\.×$/);
});

// entête 5 : un identifiant refusé hors de la liste de l'utilisateur, ou ouvrable, ne pose aucun bandeau
test('refused_client_id inconnu ou ouvrable : aucun bandeau', async () => {
  stubBff([{ user: me({ organizations: [orgA, orgB] }), active_client_id: 'c1', refused_client_id: 'c2' }]);
  const first = renderTree();
  await sessionReady();
  await act(async () => {});
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  first.unmount();
  stubBff([{ user: me({ organizations: [orgA] }), active_client_id: 'c1', refused_client_id: 'c9' }]);
  renderTree();
  await sessionReady();
  await act(async () => {});
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

// recette 3.13 : la lecture qui réussit après un premier échec dit aussi l'organisation enregistrée refusée
test('premier chargement en échec puis « Réessayer » avec refused_client_id = B : bandeau qui nomme B', async () => {
  stubMeSequence([
    unreachable,
    () => json({ user: me({ organizations: [orgA, suspendedB] }), active_client_id: 'c1', refused_client_id: 'c2' }),
  ]);
  renderTree();
  await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByTestId('org')).toHaveTextContent('Maison Lumière');
  expect(screen.getByRole('status')).toHaveTextContent('Atelier Nord est suspendue.');
});

// revue isolation entête M-1 (revue finale B, I-2) : le bandeau stocké porte l'utilisateur qui l'a reçu ; il n'est
// jamais montré à un autre, et le bandeau en état est vidé quand la session relue est celle d'un autre utilisateur.
const otherUser = (activeId: string, organizations: OrganizationSummary[]) =>
  () => json({ user: me({ id: 2, email: 'paul.martin@x.fr', organizations }), active_client_id: activeId });
const orgC: OrganizationSummary = { client_id: 'c3', name: 'Comptoir Sud', role: 'admin', read_only: false };

// revue isolation entête M-1
test('bandeau stocké par A, premier chargement en échec puis « Réessayer » qui relit B : aucun bandeau, aucun nom de A', async () => {
  window.sessionStorage.setItem('wab_org_notice', JSON.stringify({ kind: 'access', org: 'Maison Lumière', user_id: 1 }));
  stubMeSequence([unreachable, otherUser('c3', [orgC])]);
  const { container } = renderTree();
  await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByTestId('org')).toHaveTextContent('Comptoir Sud');
  await act(async () => {});
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(container).not.toHaveTextContent('Maison Lumière');
  expect(window.sessionStorage.getItem('wab_org_notice')).toBeNull();
});

// revue isolation entête M-1
test('bandeau stocké par A, première session lue de B : aucun bandeau', async () => {
  window.sessionStorage.setItem('wab_org_notice', JSON.stringify({ kind: 'access', org: 'Maison Lumière', user_id: 1 }));
  stubMeSequence([otherUser('c3', [orgC])]);
  const { container } = renderTree();
  await sessionReady();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(container).not.toHaveTextContent('Maison Lumière');
});

// revue isolation entête M-1
test('bandeau stocké sans utilisateur (ancien format) : jamais affiché', async () => {
  window.sessionStorage.setItem('wab_org_notice', JSON.stringify({ kind: 'access', org: 'Maison Lumière' }));
  stubMeSequence([ready('c1')]);
  renderTree();
  await sessionReady();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

// revue isolation entête M-1
test('session de A lue avec un bandeau, puis relecture en échec et « Réessayer » qui relit B sur la même organisation : bandeau vidé', async () => {
  stubMeSequence([
    () => json({ user: me({ organizations: [orgA, suspendedB] }), active_client_id: 'c1', refused_client_id: 'c2' }),
    unreachable,
    otherUser('c1', [orgA]),
  ]);
  const { container } = renderTree();
  await sessionReady();
  expect(await screen.findByRole('status')).toHaveTextContent('Atelier Nord est suspendue.');
  await userEvent.click(screen.getByRole('button', { name: 'rafraichir' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByTestId('email')).toHaveTextContent('paul.martin@x.fr');
  await act(async () => {});
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(container).not.toHaveTextContent('Atelier Nord');
  expect(assign).not.toHaveBeenCalled();
});

// revue isolation entête M-1
test('session de A lue, puis « Réessayer » qui relit B sur une autre organisation : rechargement sans bandeau stocké', async () => {
  stubMeSequence([ready('c1'), unreachable, otherUser('c3', [orgC])]);
  renderTree();
  await sessionReady();
  await userEvent.click(screen.getByRole('button', { name: 'rafraichir' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/fr'));
  expect(window.sessionStorage.getItem('wab_org_notice')).toBeNull();
});

// revue isolation entête M-1
test('session de A lue avec un bandeau, puis refresh() qui relit B : bandeau vidé', async () => {
  stubMeSequence([
    () => json({ user: me({ organizations: [orgA, suspendedB] }), active_client_id: 'c1', refused_client_id: 'c2' }),
    otherUser('c1', [orgA]),
  ]);
  const { container } = renderTree();
  await sessionReady();
  expect(await screen.findByRole('status')).toHaveTextContent('Atelier Nord est suspendue.');
  await userEvent.click(screen.getByRole('button', { name: 'rafraichir' }));
  expect(await screen.findByTestId('email')).toHaveTextContent('paul.martin@x.fr');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(container).not.toHaveTextContent('Atelier Nord');
});

// revue isolation entête M-1
test('retour sur l\'onglet : session d\'un autre utilisateur sur la même organisation, rechargement sans bandeau stocké', async () => {
  stubMeSequence([ready('c1'), otherUser('c1', [orgA])]);
  renderTree();
  await sessionReady();
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/fr'));
  expect(window.sessionStorage.getItem('wab_org_notice')).toBeNull();
});

// revue isolation entête M-1 : le bandeau stocké porte l'utilisateur de la session relue
test('rechargement après changement d\'organisation : le bandeau stocké porte l\'identifiant de l\'utilisateur', async () => {
  stubMeSequence([ready('c1'), ready('c2')]);
  renderTree();
  await sessionReady();
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/fr'));
  expect(storedNotice()).toEqual({ kind: 'changed', org: 'Atelier Nord', user_id: 1 });
});

// revue isolation entête M-1 : le rôle d'un autre compte n'a pas « changé », aucun bandeau d'accès
test('403 puis session relue d\'un autre utilisateur sur la même organisation : aucun bandeau d\'accès', async () => {
  const advisorA: OrganizationSummary = { ...orgA, role: 'advisor' };
  stubBff(
    [{ user: me(), active_client_id: 'c1' }, { user: me({ id: 2, email: 'paul.martin@x.fr', organizations: [advisorA] }), active_client_id: 'c1' }],
    forbidden('Accès refusé.'),
  );
  renderTree();
  await userEvent.click(await screen.findByRole('button', { name: 'appel admin' }));
  expect(await screen.findByTestId('email')).toHaveTextContent('paul.martin@x.fr');
  await act(async () => {});
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
