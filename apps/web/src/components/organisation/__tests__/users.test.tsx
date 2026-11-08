import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import type { Session } from '@/components/providers/session-provider';
import OrganisationLayout from '../../../app/[locale]/(app)/organisation/layout';
import UtilisateursPage from '../../../app/[locale]/(app)/organisation/utilisateurs/page';
import { OrganisationCountsContext } from '../organisation-counts';

const nav = { search: '' };
const replace = vi.fn();
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(nav.search) }));
vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, className, ...rest }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className} {...rest}>{children}</a>
  ),
  usePathname: () => '/organisation/utilisateurs',
  useRouter: () => ({ push: vi.fn(), replace }),
  routing: { locales: ['fr', 'en'], defaultLocale: 'fr' },
}));

const org = { client_id: 'ml', name: 'Maison Lumière', role: 'admin' as const, read_only: false };
vi.mock('@/components/providers/session-provider', () => ({
  useSession: (): Session => ({
    me: { id: 1, email: 'claire.bernard@maison-lumiere.fr', role: 'user', status: 'active', organizations: [org] },
    activeOrg: org,
    isPlatformAdmin: false,
    isAdmin: true,
    readOnly: false,
    switchOrg: vi.fn(),
    notice: null,
    dismissNotice: vi.fn(),
    refresh: vi.fn(),
  }),
}));

interface Membership { entity_id: number | null; role: string; read_only: boolean; status: 'active' | 'suspended' }
interface FakeUser { user_id: number; email: string; status: string; memberships: Membership[] }
interface FakeInvitation {
  id: number;
  email: string;
  grants: { entity_id: number | null; role: string; read_only?: boolean }[];
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

let users: FakeUser[];
let invitations: FakeInvitation[];
let calls: { method: string; url: string; body: unknown }[];
let putError: string | null;
let patchError: string | null;
let postResponseEmail: string | null;
let postDelay: Promise<void> | null;
let resendDelay: Promise<void> | null;

const active = (entity_id: number | null, role: string, read_only = false): Membership => ({ entity_id, role, read_only, status: 'active' });
const suspended = (entity_id: number | null, role: string): Membership => ({ entity_id, role, read_only: false, status: 'suspended' });

function reset() {
  users = [
    { user_id: 1, email: 'claire.bernard@maison-lumiere.fr', status: 'active', memberships: [active(null, 'admin')] },
    { user_id: 2, email: 'paul.dumas@maison-lumiere.fr', status: 'active', memberships: [active(null, 'super_manager', true)] },
    { user_id: 3, email: 'ines.martin@maison-lumiere.fr', status: 'active', memberships: [active(2, 'manager'), active(3, 'advisor')] },
    { user_id: 4, email: 'service.client@maison-lumiere.fr', status: 'active', memberships: [active(1, 'advisor')] },
    { user_id: 5, email: 'thomas.leroy@maison-lumiere.fr', status: 'active', memberships: [suspended(1, 'advisor')] },
  ];
  invitations = [
    { id: 11, email: 'lea.roux@gmail.com', grants: [{ entity_id: 3, role: 'advisor' }], expires_at: '2099-11-14T12:00:00.000Z', accepted_at: null, created_at: '2099-11-07T12:00:00.000Z' },
    { id: 12, email: 'marc@atelier-conseil.fr', grants: [{ entity_id: null, role: 'admin' }], expires_at: '2020-01-01T12:00:00.000Z', accepted_at: null, created_at: '2019-12-25T12:00:00.000Z' },
    { id: 13, email: 'deja.accepte@x.fr', grants: [{ entity_id: null, role: 'admin' }], expires_at: '2099-11-14T12:00:00.000Z', accepted_at: '2099-11-08T12:00:00.000Z', created_at: '2099-11-07T12:00:00.000Z' },
  ];
  calls = [];
  putError = null;
  patchError = null;
  postResponseEmail = null;
  postDelay = null;
  resendDelay = null;
  nav.search = '';
}

const entities = [
  { id: 1, name: 'Service client', status: 'active', bots: 2, members: 2 },
  { id: 2, name: 'Boutique Paris Marais', status: 'active', bots: 1, members: 1 },
  { id: 3, name: 'Boutique Lyon', status: 'active', bots: 0, members: 1 },
];

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const conflict = (message: string) => jsonRes({ error: { code: 'CONFLICT', message } }, 409);

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    if (url === '/api/users' && method === 'GET') return jsonRes(users);
    if (url === '/api/invitations' && method === 'GET') return jsonRes(invitations);
    if (url === '/api/entities' && method === 'GET') return jsonRes(entities);
    if (url === '/api/invitations' && method === 'POST') {
      if (postDelay) await postDelay;
      invitations.push({ id: 20, email: postResponseEmail ?? body.email, grants: body.grants, expires_at: '2099-11-20T12:00:00.000Z', accepted_at: null, created_at: '2099-11-08T12:00:00.000Z' });
      return jsonRes({ email: postResponseEmail ?? body.email }, 201);
    }
    const inv = /^\/api\/invitations\/(\d+)(\/resend)?$/.exec(url);
    if (inv) {
      if (inv[2] && resendDelay) await resendDelay;
      if (method === 'DELETE') invitations = invitations.filter((i) => i.id !== Number(inv[1]));
      return new Response(null, { status: 204 });
    }
    const memberships = /^\/api\/users\/(\d+)\/memberships$/.exec(url);
    if (memberships && method === 'PUT') {
      if (putError) return conflict(putError);
      return new Response(null, { status: 204 });
    }
    const status = /^\/api\/users\/(\d+)$/.exec(url);
    if (status && method === 'PATCH') {
      if (patchError) return conflict(patchError);
      const u = users.find((x) => x.user_id === Number(status[1]));
      if (u) u.memberships = u.memberships.map((m) => ({ ...m, status: body.status }));
      return new Response(null, { status: 204 });
    }
    return jsonRes({}, 404);
  }));
}

const refreshCounts = vi.fn();
function renderPage() {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <OrganisationCountsContext.Provider value={{ refreshCounts }}>
        <UtilisateursPage />
      </OrganisationCountsContext.Provider>
    </NextIntlClientProvider>,
  );
}

const mutations = () => calls.filter((c) => c.method !== 'GET');
const rowOf = (email: string) => screen.getByText(email, { selector: 'td span' }).closest('tr') as HTMLElement;

async function ready() {
  await screen.findByText('paul.dumas@maison-lumiere.fr');
}

async function openMenu(email: string) {
  const user = userEvent.setup();
  await user.click(within(rowOf(email)).getByRole('button', { name: `Actions pour ${email}` }));
  return user;
}

beforeEach(() => {
  vi.restoreAllMocks();
  refreshCounts.mockReset();
  replace.mockReset();
  reset();
  stubFetch();
});

test('en-tête et membres : sous-titre, « vous » sans menu, accès sur une ou deux lignes, lecture seule, statuts', async () => {
  renderPage();
  await ready();
  expect(screen.getByRole('heading', { name: 'Utilisateurs' })).toBeInTheDocument();
  expect(screen.getByText('5 membres · 2 invitations en attente')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '+ Inviter' })).toBeInTheDocument();

  const me = within(rowOf('claire.bernard@maison-lumiere.fr'));
  expect(me.getByText('vous')).toBeInTheDocument();
  expect(me.getByText('Admin')).toBeInTheDocument();
  expect(me.queryByRole('button')).not.toBeInTheDocument();

  const paul = within(rowOf('paul.dumas@maison-lumiere.fr'));
  expect(paul.getByText('Super manager')).toBeInTheDocument();
  expect(paul.getByText('lecture seule')).toBeInTheDocument();
  expect(paul.queryByText('vous')).not.toBeInTheDocument();

  const ines = within(rowOf('ines.martin@maison-lumiere.fr'));
  expect(ines.getByText('Manager')).toBeInTheDocument();
  expect(ines.getByText('· Boutique Paris Marais')).toBeInTheDocument();
  expect(ines.getByText('Conseiller')).toBeInTheDocument();
  expect(ines.getByText('· Boutique Lyon')).toBeInTheDocument();
  expect(ines.getByText('Actif')).toBeInTheDocument();

  expect(within(rowOf('thomas.leroy@maison-lumiere.fr')).getByText('Suspendu')).toBeInTheDocument();
});

test('sous-titre au singulier', async () => {
  users = [users[0]];
  invitations = [invitations[0]];
  renderPage();
  await screen.findByText('claire.bernard@maison-lumiere.fr');
  expect(screen.getByText('1 membre · 1 invitation en attente')).toBeInTheDocument();
});

test('invitations en attente : expiration, expirée, acceptées masquées', async () => {
  renderPage();
  await ready();
  expect(screen.getByText('Invitations en attente')).toBeInTheDocument();
  const lea = within(rowOf('lea.roux@gmail.com'));
  expect(lea.getByText('Expire le 14 nov.')).toBeInTheDocument();
  expect(lea.getByText('Conseiller')).toBeInTheDocument();
  expect(lea.getByText('· Boutique Lyon')).toBeInTheDocument();
  expect(within(rowOf('marc@atelier-conseil.fr')).getByText('Expirée')).toBeInTheDocument();
  expect(screen.queryByText('deja.accepte@x.fr')).not.toBeInTheDocument();
});

test('avatar d\'une invitation : initiales de l\'e-mail, comme pour les membres', async () => {
  renderPage();
  await ready();
  expect(within(rowOf('lea.roux@gmail.com')).getByText('LR')).toBeInTheDocument();
  expect(within(rowOf('marc@atelier-conseil.fr')).getByText('M')).toBeInTheDocument();
  expect(within(rowOf('claire.bernard@maison-lumiere.fr')).getByText('CB')).toBeInTheDocument();
});

test('« Renvoyer » appelle POST /api/invitations/<id>/resend, « Révoquer » appelle DELETE', async () => {
  renderPage();
  await ready();
  const user = userEvent.setup();
  await user.click(within(rowOf('lea.roux@gmail.com')).getByRole('button', { name: 'Renvoyer' }));
  await waitFor(() => expect(mutations()).toEqual([{ method: 'POST', url: '/api/invitations/11/resend', body: undefined }]));
  expect(await screen.findByRole('status')).toHaveTextContent('Invitation renvoyée à lea.roux@gmail.com');

  await user.click(within(rowOf('marc@atelier-conseil.fr')).getByRole('button', { name: 'Actions pour marc@atelier-conseil.fr' }));
  await user.click(screen.getByRole('menuitem', { name: 'Révoquer' }));
  await waitFor(() => expect(mutations().at(-1)).toEqual({ method: 'DELETE', url: '/api/invitations/12', body: undefined }));
  await waitFor(() => expect(screen.queryByText('marc@atelier-conseil.fr')).not.toBeInTheDocument());
  expect(refreshCounts).toHaveBeenCalled();
});

test('tiroir d\'invitation : « Certaines entités » par défaut, encart, bouton désactivé tant qu\'aucune entité n\'est cochée', async () => {
  renderPage();
  await ready();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '+ Inviter' }));
  const drawer = screen.getByRole('dialog', { name: 'Inviter un utilisateur' });
  expect(within(drawer).getByText('Il recevra un lien valable 7 jours pour rejoindre Maison Lumière.')).toBeInTheDocument();
  expect(within(drawer).getByRole('radio', { name: /Certaines entités/ })).toHaveAttribute('aria-checked', 'true');
  expect(within(drawer).getByText(/Aujourd'hui, managers et conseillers ont les mêmes droits : voir les agents IA, les leads et utiliser le simulateur\. La différence \(affecter des contacts\) arrive avec Conversations & Leads\./)).toBeInTheDocument();

  const send = within(drawer).getByRole('button', { name: "Envoyer l'invitation" });
  await user.type(within(drawer).getByRole('textbox', { name: 'Adresse e-mail' }), 'lucas.petit@maison-lumiere.fr');
  expect(send).toBeDisabled();

  const lyon = within(drawer).getByRole('checkbox', { name: 'Boutique Lyon' });
  expect(lyon).not.toBeChecked();
  const lyonRoles = within(drawer).getByRole('radiogroup', { name: 'Rôle pour Boutique Lyon' });
  expect(within(lyonRoles).getByRole('radio', { name: 'Manager' })).toBeDisabled();
  await user.click(lyon);
  expect(within(lyonRoles).getByRole('radio', { name: 'Conseiller' })).toHaveAttribute('aria-checked', 'true');
  expect(send).toBeEnabled();
  await user.click(lyon);
  expect(send).toBeDisabled();
});

test('envoi d\'une invitation : un seul POST même sur double clic, message avec l\'e-mail renvoyé par le moteur', async () => {
  let release!: () => void;
  postDelay = new Promise<void>((r) => { release = r; });
  postResponseEmail = 'lucas.petit@maison-lumiere.fr';
  renderPage();
  await ready();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '+ Inviter' }));
  const drawer = screen.getByRole('dialog', { name: 'Inviter un utilisateur' });
  await user.type(within(drawer).getByRole('textbox', { name: 'Adresse e-mail' }), 'Lucas.Petit@Maison-Lumiere.fr');
  await user.click(within(drawer).getByRole('checkbox', { name: 'Boutique Paris Marais' }));
  await user.click(within(within(drawer).getByRole('radiogroup', { name: 'Rôle pour Boutique Paris Marais' })).getByRole('radio', { name: 'Manager' }));
  await user.click(within(drawer).getByRole('checkbox', { name: 'Boutique Lyon' }));
  const send = within(drawer).getByRole('button', { name: "Envoyer l'invitation" });
  await user.dblClick(send);
  release();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(mutations()).toEqual([
    {
      method: 'POST',
      url: '/api/invitations',
      body: {
        email: 'Lucas.Petit@Maison-Lumiere.fr',
        grants: [{ entity_id: 2, role: 'manager' }, { entity_id: 3, role: 'advisor' }],
      },
    },
  ]);
  expect(await screen.findByRole('status')).toHaveTextContent('Invitation envoyée à lucas.petit@maison-lumiere.fr');
  expect(refreshCounts).toHaveBeenCalled();
  // Dans la fenêtre d'invitations en attente (et dans le message).
  expect(within(rowOf('lucas.petit@maison-lumiere.fr')).getByText('Expire le 20 nov.')).toBeInTheDocument();
});

test('tiroir, « Toute l\'organisation » : rôle à choisir, « Lecture seule » seulement sous Super manager, pas d\'encart', async () => {
  renderPage();
  await ready();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '+ Inviter' }));
  const drawer = screen.getByRole('dialog', { name: 'Inviter un utilisateur' });
  await user.type(within(drawer).getByRole('textbox', { name: 'Adresse e-mail' }), 'direction@maison-lumiere.fr');
  await user.click(within(drawer).getByRole('radio', { name: /Toute l'organisation/ }));
  const send = within(drawer).getByRole('button', { name: "Envoyer l'invitation" });
  expect(send).toBeDisabled();
  expect(within(drawer).queryByText(/Aujourd'hui, managers et conseillers/)).not.toBeInTheDocument();
  expect(within(drawer).queryByRole('switch')).not.toBeInTheDocument();

  await user.click(within(drawer).getByRole('radio', { name: /^Admin/ }));
  expect(send).toBeEnabled();
  expect(within(drawer).queryByRole('switch')).not.toBeInTheDocument();

  await user.click(within(drawer).getByRole('radio', { name: /^Super manager/ }));
  const readOnly = within(drawer).getByRole('switch', { name: 'Lecture seule' });
  expect(readOnly).toHaveAttribute('aria-checked', 'false');
  await user.click(readOnly);
  await user.click(send);
  await waitFor(() =>
    expect(mutations()).toEqual([
      { method: 'POST', url: '/api/invitations', body: { email: 'direction@maison-lumiere.fr', grants: [{ entity_id: null, role: 'super_manager', read_only: true }] } },
    ]),
  );
});

test('lecture seule cochée puis Admin choisi : elle n\'est pas envoyée', async () => {
  renderPage();
  await ready();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '+ Inviter' }));
  const drawer = screen.getByRole('dialog');
  await user.type(within(drawer).getByRole('textbox', { name: 'Adresse e-mail' }), 'a@maison-lumiere.fr');
  await user.click(within(drawer).getByRole('radio', { name: /Toute l'organisation/ }));
  await user.click(within(drawer).getByRole('radio', { name: /^Super manager/ }));
  await user.click(within(drawer).getByRole('switch', { name: 'Lecture seule' }));
  await user.click(within(drawer).getByRole('radio', { name: /^Admin/ }));
  await user.click(within(drawer).getByRole('button', { name: "Envoyer l'invitation" }));
  await waitFor(() => expect(mutations()[0]?.body).toEqual({ email: 'a@maison-lumiere.fr', grants: [{ entity_id: null, role: 'admin' }] }));
});

test('erreur du moteur à l\'invitation (déjà membre) : affichée telle quelle, tiroir ouvert', async () => {
  renderPage();
  await ready();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '+ Inviter' }));
  const drawer = screen.getByRole('dialog');
  await user.type(within(drawer).getByRole('textbox', { name: 'Adresse e-mail' }), 'paul.dumas@maison-lumiere.fr');
  await user.click(within(drawer).getByRole('checkbox', { name: 'Boutique Lyon' }));
  const original = vi.mocked(fetch).getMockImplementation();
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (url === '/api/invitations' && init?.method === 'POST') return conflict("Cette personne est déjà membre de l'organisation : modifiez ses accès.");
    return original ? original(url, init) : jsonRes({}, 404);
  });
  await user.click(within(drawer).getByRole('button', { name: "Envoyer l'invitation" }));
  expect(await within(drawer).findByRole('alert')).toHaveTextContent("Cette personne est déjà membre de l'organisation : modifiez ses accès.");
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('modification des accès : e-mail figé, formulaire prérempli, PUT des grants', async () => {
  renderPage();
  await ready();
  const user = await openMenu('paul.dumas@maison-lumiere.fr');
  await user.click(screen.getByRole('menuitem', { name: 'Modifier les accès' }));
  const drawer = screen.getByRole('dialog', { name: 'Modifier les accès' });
  expect(within(drawer).getByRole('textbox', { name: 'Adresse e-mail' })).toHaveValue('paul.dumas@maison-lumiere.fr');
  expect(within(drawer).getByRole('textbox', { name: 'Adresse e-mail' })).toHaveAttribute('readonly');
  expect(within(drawer).getByRole('radio', { name: /Toute l'organisation/ })).toHaveAttribute('aria-checked', 'true');
  expect(within(drawer).getByRole('radio', { name: /^Super manager/ })).toHaveAttribute('aria-checked', 'true');
  const readOnly = within(drawer).getByRole('switch', { name: 'Lecture seule' });
  expect(readOnly).toHaveAttribute('aria-checked', 'true');
  await user.click(readOnly);
  await user.click(within(drawer).getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() =>
    expect(mutations()).toEqual([{ method: 'PUT', url: '/api/users/2/memberships', body: { grants: [{ entity_id: null, role: 'super_manager' }] } }]),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('modification : « L\'organisation doit garder au moins un admin. » affiché dans le tiroir, tiroir ouvert', async () => {
  putError = "L'organisation doit garder au moins un admin.";
  users[1].memberships = [active(null, 'admin')];
  renderPage();
  await ready();
  const user = await openMenu('paul.dumas@maison-lumiere.fr');
  await user.click(screen.getByRole('menuitem', { name: 'Modifier les accès' }));
  const drawer = screen.getByRole('dialog', { name: 'Modifier les accès' });
  await user.click(within(drawer).getByRole('radio', { name: /Certaines entités/ }));
  await user.click(within(drawer).getByRole('checkbox', { name: 'Boutique Lyon' }));
  await user.click(within(drawer).getByRole('button', { name: 'Enregistrer' }));
  expect(await within(drawer).findByRole('alert')).toHaveTextContent("L'organisation doit garder au moins un admin.");
  expect(screen.getByRole('dialog', { name: 'Modifier les accès' })).toBeInTheDocument();
});

test('modification d\'un membre à entités : cases préremplies avec leur rôle', async () => {
  renderPage();
  await ready();
  const user = await openMenu('ines.martin@maison-lumiere.fr');
  await user.click(screen.getByRole('menuitem', { name: 'Modifier les accès' }));
  const drawer = screen.getByRole('dialog', { name: 'Modifier les accès' });
  expect(within(drawer).getByRole('checkbox', { name: 'Boutique Paris Marais' })).toBeChecked();
  expect(within(drawer).getByRole('checkbox', { name: 'Service client' })).not.toBeChecked();
  const paris = within(drawer).getByRole('radiogroup', { name: 'Rôle pour Boutique Paris Marais' });
  expect(within(paris).getByRole('radio', { name: 'Manager' })).toHaveAttribute('aria-checked', 'true');
  await user.click(within(drawer).getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() =>
    expect(mutations()[0]).toEqual({
      method: 'PUT',
      url: '/api/users/3/memberships',
      body: { grants: [{ entity_id: 2, role: 'manager' }, { entity_id: 3, role: 'advisor' }] },
    }),
  );
});

test('suspension : fenêtre de confirmation puis PATCH { status: suspended }', async () => {
  renderPage();
  await ready();
  const user = await openMenu('service.client@maison-lumiere.fr');
  await user.click(screen.getByRole('menuitem', { name: 'Suspendre' }));
  const dialog = screen.getByRole('dialog', { name: 'Suspendre service.client@maison-lumiere.fr ?' });
  expect(within(dialog).getByText(/Il perd immédiatement l'accès à Maison Lumière\. Ses autres organisations ne sont pas touchées\./)).toBeInTheDocument();
  expect(mutations()).toEqual([]);
  await user.click(within(dialog).getByRole('button', { name: 'Suspendre' }));
  await waitFor(() => expect(mutations()).toEqual([{ method: 'PATCH', url: '/api/users/4', body: { status: 'suspended' } }]));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(within(rowOf('service.client@maison-lumiere.fr')).getByText('Suspendu')).toBeInTheDocument());
});

test('suspension : le refus « dernier admin » reste affiché dans la fenêtre, qui reste ouverte', async () => {
  patchError = "L'organisation doit garder au moins un admin.";
  renderPage();
  await ready();
  const user = await openMenu('paul.dumas@maison-lumiere.fr');
  await user.click(screen.getByRole('menuitem', { name: 'Suspendre' }));
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Suspendre' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent("L'organisation doit garder au moins un admin.");
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('suspension : double clic, un seul PATCH', async () => {
  renderPage();
  await ready();
  const user = await openMenu('service.client@maison-lumiere.fr');
  await user.click(screen.getByRole('menuitem', { name: 'Suspendre' }));
  await user.dblClick(within(screen.getByRole('dialog')).getByRole('button', { name: 'Suspendre' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(mutations()).toHaveLength(1);
});

test('« Réactiver » : PATCH { status: active } sans confirmation', async () => {
  renderPage();
  await ready();
  const user = await openMenu('thomas.leroy@maison-lumiere.fr');
  expect(screen.queryByRole('menuitem', { name: 'Suspendre' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('menuitem', { name: 'Réactiver' }));
  await waitFor(() => expect(mutations()).toEqual([{ method: 'PATCH', url: '/api/users/5', body: { status: 'active' } }]));
  await waitFor(() => expect(within(rowOf('thomas.leroy@maison-lumiere.fr')).getByText('Actif')).toBeInTheDocument());
});

test('Échap ferme le tiroir', async () => {
  renderPage();
  await ready();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '+ Inviter' }));
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('?entity=<id> : seuls les membres de cette entité, pastille « Entité : … » retirable', async () => {
  nav.search = 'entity=3';
  renderPage();
  await screen.findByText('ines.martin@maison-lumiere.fr');
  expect(screen.queryByText('paul.dumas@maison-lumiere.fr')).not.toBeInTheDocument();
  expect(screen.queryByText('service.client@maison-lumiere.fr')).not.toBeInTheDocument();
  const chip = screen.getByText('Entité : Boutique Lyon');
  expect(chip).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: "Retirer le filtre sur l'entité" }));
  expect(replace).toHaveBeenCalledWith('/organisation/utilisateurs');
});

test('?entity= inconnu : pas de filtre', async () => {
  nav.search = 'entity=99';
  renderPage();
  await ready();
  expect(screen.getByText('service.client@maison-lumiere.fr')).toBeInTheDocument();
  expect(screen.queryByText(/^Entité : /)).not.toBeInTheDocument();
});

test('accès à une entité archivée : « Entité archivée »', async () => {
  users[3].memberships = [active(77, 'advisor')];
  renderPage();
  await ready();
  expect(within(rowOf('service.client@maison-lumiere.fr')).getByText('· Entité archivée')).toBeInTheDocument();
});

test('dans le layout Organisation, le compteur Utilisateurs du rail = membres + invitations en attente, relu après une invitation', async () => {
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <OrganisationLayout><UtilisateursPage /></OrganisationLayout>
    </NextIntlClientProvider>,
  );
  const link = () => screen.getByRole('link', { name: /Utilisateurs/ });
  await waitFor(() => expect(within(link()).getByText('7')).toBeInTheDocument());
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '+ Inviter' }));
  const drawer = screen.getByRole('dialog');
  await user.type(within(drawer).getByRole('textbox', { name: 'Adresse e-mail' }), 'nouveau@maison-lumiere.fr');
  await user.click(within(drawer).getByRole('checkbox', { name: 'Boutique Lyon' }));
  await user.click(within(drawer).getByRole('button', { name: "Envoyer l'invitation" }));
  await waitFor(() => expect(within(link()).getByText('8')).toBeInTheDocument());
});

test('« Renvoyer » : un seul POST sur double clic tant que le premier est en cours, bouton et entrée de menu désactivés', async () => {
  let release!: () => void;
  resendDelay = new Promise<void>((r) => { release = r; });
  renderPage();
  await ready();
  const user = userEvent.setup();
  const button = within(rowOf('lea.roux@gmail.com')).getByRole('button', { name: 'Renvoyer' });
  await user.dblClick(button);
  expect(button).toBeDisabled();
  await user.click(within(rowOf('lea.roux@gmail.com')).getByRole('button', { name: 'Actions pour lea.roux@gmail.com' }));
  expect(screen.getByRole('menuitem', { name: 'Renvoyer' })).toBeDisabled();
  release();
  await waitFor(() => expect(button).toBeEnabled());
  expect(mutations()).toEqual([{ method: 'POST', url: '/api/invitations/11/resend', body: undefined }]);
});

test('tiroir : Échap et clic sur le voile sont ignorés pendant l\'envoi', async () => {
  let release!: () => void;
  postDelay = new Promise<void>((r) => { release = r; });
  renderPage();
  await ready();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '+ Inviter' }));
  const drawer = screen.getByRole('dialog');
  await user.type(within(drawer).getByRole('textbox', { name: 'Adresse e-mail' }), 'a@maison-lumiere.fr');
  await user.click(within(drawer).getByRole('checkbox', { name: 'Boutique Lyon' }));
  await user.click(within(drawer).getByRole('button', { name: "Envoyer l'invitation" }));
  fireEvent.keyDown(drawer, { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  release();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('tiroir, organisation : groupe « Rôle » et « Lecture seule : consulte… » avec espace avant les deux-points', async () => {
  renderPage();
  await ready();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '+ Inviter' }));
  const drawer = screen.getByRole('dialog');
  await user.click(within(drawer).getByRole('radio', { name: /Toute l'organisation/ }));
  expect(within(drawer).getByRole('radiogroup', { name: 'Rôle' })).toBeInTheDocument();
  await user.click(within(drawer).getByRole('radio', { name: /^Super manager/ }));
  expect(within(drawer).getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === 'Lecture seule : consulte sans agir, simulateur compris.')).toBeInTheDocument();
});

test('membre dont une appartenance est suspendue : « Suspendu » (comme le moteur)', async () => {
  users[2].memberships = [active(2, 'manager'), suspended(3, 'advisor')];
  renderPage();
  await ready();
  expect(within(rowOf('ines.martin@maison-lumiere.fr')).getByText('Suspendu')).toBeInTheDocument();
});
