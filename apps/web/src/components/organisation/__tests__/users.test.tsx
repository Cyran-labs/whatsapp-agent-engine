import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import type { Session } from '@/components/providers/session-provider';
import OrganisationLayout from '../../../app/[locale]/(app)/organisation/layout';
import UtilisateursPage from '../../../app/[locale]/(app)/organisation/utilisateurs/page';
import { OrganisationCountsContext } from '../organisation-counts';
import { NotificationProvider } from '@/components/feedback/notification-provider';

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
let patchDelay: Promise<void> | null;
let deleteDelay: Promise<void> | null;
let resendRefusal: { status: number; message: string; reason: string } | null;
let reactivateRefusal: { message: string; reason: string } | null;
let deleteRefusal: { status: number; message: string; reason: string } | null;
let postRefusal: { message: string; reason: string } | null;
let getFail: boolean;

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
  patchDelay = null;
  deleteDelay = null;
  resendRefusal = null;
  reactivateRefusal = null;
  deleteRefusal = null;
  postRefusal = null;
  getFail = false;
  nav.search = '';
}

const entities = [
  { id: 1, name: 'Service client', status: 'active', bots: 2, members: 2 },
  { id: 2, name: 'Boutique Paris Marais', status: 'active', bots: 1, members: 1 },
  { id: 3, name: 'Boutique Lyon', status: 'active', bots: 0, members: 1 },
];

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const conflict = (message: string) => jsonRes({ error: { code: 'CONFLICT', message } }, 409);
const refusal = (status: number, message: string, reason: string) => jsonRes({ error: { code: 'CONFLICT', message, reason } }, status);

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    if (getFail && method === 'GET') return jsonRes({ error: { code: 'INTERNAL', message: 'boom' } }, 500);
    if (url === '/api/users' && method === 'GET') return jsonRes(users);
    if (url === '/api/invitations' && method === 'GET') return jsonRes(invitations);
    if (url === '/api/entities' && method === 'GET') return jsonRes(entities);
    if (url === '/api/invitations' && method === 'POST') {
      if (postRefusal) return refusal(409, postRefusal.message, postRefusal.reason);
      if (postDelay) await postDelay;
      invitations.push({ id: 20, email: postResponseEmail ?? body.email, grants: body.grants, expires_at: '2099-11-20T12:00:00.000Z', accepted_at: null, created_at: '2099-11-08T12:00:00.000Z' });
      return jsonRes({ email: postResponseEmail ?? body.email }, 201);
    }
    const inv = /^\/api\/invitations\/(\d+)(\/resend)?$/.exec(url);
    if (inv) {
      if (inv[2] && resendDelay) await resendDelay;
      if (inv[2] && resendRefusal) {
        // L'invitation a été acceptée entre-temps : la relecture ne la liste plus.
        invitations = invitations.map((i) => (i.id === Number(inv[1]) ? { ...i, accepted_at: '2099-11-09T12:00:00.000Z' } : i));
        return refusal(resendRefusal.status, resendRefusal.message, resendRefusal.reason);
      }
      if (method === 'DELETE') {
        if (deleteDelay) await deleteDelay;
        if (deleteRefusal) return refusal(deleteRefusal.status, deleteRefusal.message, deleteRefusal.reason);
        invitations = invitations.filter((i) => i.id !== Number(inv[1]));
      }
      return new Response(null, { status: 204 });
    }
    const memberships = /^\/api\/users\/(\d+)\/memberships$/.exec(url);
    if (memberships && method === 'PUT') {
      if (putError) return conflict(putError);
      return new Response(null, { status: 204 });
    }
    const status = /^\/api\/users\/(\d+)$/.exec(url);
    if (status && method === 'PATCH') {
      if (patchDelay) await patchDelay;
      if (reactivateRefusal && body.status === 'active') return refusal(409, reactivateRefusal.message, reactivateRefusal.reason);
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
      <NotificationProvider>
        <OrganisationCountsContext.Provider value={{ refreshCounts, reportConnections: () => undefined }}>
          <UtilisateursPage />
        </OrganisationCountsContext.Provider>
      </NotificationProvider>
    </NextIntlClientProvider>,
  );
}

const mutations = () => calls.filter((c) => c.method !== 'GET');
const notifications = () => screen.getByRole('region', { name: 'Notifications' });
const listReads = (url: string) => calls.filter((c) => c.method === 'GET' && c.url === url).length;
const rowOf = (email: string) => screen.getByText(email, { selector: 'td span' }).closest('tr') as HTMLElement;

async function ready() {
  await screen.findByText('paul.dumas@maison-lumiere.fr');
}

async function openMenu(email: string) {
  const user = userEvent.setup();
  await user.click(within(rowOf(email)).getByRole('button', { name: `Gérer (${email})` }));
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
  // prototype 9 : à la place du menu, la raison en gris
  expect(me.getByText('Vous ne pouvez pas modifier vos propres accès.')).toHaveClass('text-muted-2');

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
  await waitFor(() => expect(notifications()).toHaveTextContent('Invitation renvoyée à lea.roux@gmail.com.'));

  await user.click(within(rowOf('marc@atelier-conseil.fr')).getByRole('button', { name: 'Gérer (marc@atelier-conseil.fr)' }));
  await user.click(screen.getByRole('menuitem', { name: 'Révoquer' }));
  const dialog = screen.getByRole('dialog', { name: "Révoquer l'invitation à marc@atelier-conseil.fr ?" });
  expect(mutations()).toHaveLength(1);
  await user.click(within(dialog).getByRole('button', { name: 'Révoquer' }));
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
  expect(within(drawer).getByText(/Aujourd'hui, managers et conseillers ont les mêmes droits : voir les agents IA, les leads et utiliser le simulateur\. La différence \(affecter des contacts\) arrive avec Conversations et leads\./)).toBeInTheDocument();

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
  await waitFor(() => expect(notifications()).toHaveTextContent('Invitation envoyée à lucas.petit@maison-lumiere.fr.'));
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

// recette 10 nov. 2026 : le rail disait « 2 » alors que l'en-tête disait « 1 membre · 1 invitation en attente »
test('dans le layout Organisation, le compteur Utilisateurs du rail compte les membres seulement, comme l\'en-tête, et ignore les invitations', async () => {
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <NotificationProvider><OrganisationLayout><UtilisateursPage /></OrganisationLayout></NotificationProvider>
    </NextIntlClientProvider>,
  );
  const link = () => screen.getByRole('link', { name: /Utilisateurs/ });
  await waitFor(() => expect(within(link()).getByText('5')).toBeInTheDocument());
  expect(await screen.findByText('5 membres · 2 invitations en attente')).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '+ Inviter' }));
  const drawer = screen.getByRole('dialog');
  await user.type(within(drawer).getByRole('textbox', { name: 'Adresse e-mail' }), 'nouveau@maison-lumiere.fr');
  await user.click(within(drawer).getByRole('checkbox', { name: 'Boutique Lyon' }));
  await user.click(within(drawer).getByRole('button', { name: "Envoyer l'invitation" }));
  // l'invitation s'ajoute à l'en-tête, pas au compteur du rail
  expect(await screen.findByText('5 membres · 3 invitations en attente')).toBeInTheDocument();
  expect(within(link()).getByText('5')).toBeInTheDocument();
  expect(within(link()).queryByText('8')).not.toBeInTheDocument();
});

// relecture tâche 10, m-2 : pendant l'envoi, « Renvoyer » dit pourquoi il est sans effet (l'entrée du menu le disait)
test('« Renvoyer » : un seul POST sur double clic tant que le premier est en cours, bouton grisé avec « Envoi en cours »', async () => {
  let release!: () => void;
  resendDelay = new Promise<void>((r) => { release = r; });
  renderPage();
  await ready();
  const user = userEvent.setup();
  const button = within(rowOf('lea.roux@gmail.com')).getByRole('button', { name: 'Renvoyer' });
  await user.dblClick(button);
  expect(button).toHaveAttribute('aria-disabled', 'true');
  expect(button).toHaveAccessibleDescription('Envoi en cours');
  await user.click(button);
  release();
  await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'));
  expect(button).not.toHaveAttribute('aria-describedby');
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

test('chargement : en-tête réel des membres, 3 lignes squelettes et sous-titre en squelette, puis la liste', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    await gate;
    return real(url, init);
  }));
  const { container } = renderPage();
  expect(screen.getByRole('columnheader', { name: 'Utilisateur' })).toBeInTheDocument();
  expect(container.querySelectorAll('tbody tr[data-skeleton-row]')).toHaveLength(3);
  expect(container.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(3);
  expect(screen.queryByText(/Chargement/)).not.toBeInTheDocument();
  release();
  await ready();
  expect(container.querySelectorAll('[data-skeleton]')).toHaveLength(0);
  expect(screen.getByText('5 membres · 2 invitations en attente')).toBeInTheDocument();
});

// recette Q-7
test('recette Q-7 : « Gérer » visible et nommé sur chaque ligne de membre et d\'invitation, absent sur « vous », plus de « ⋯ »', async () => {
  renderPage();
  await ready();
  for (const email of ['paul.dumas@maison-lumiere.fr', 'thomas.leroy@maison-lumiere.fr', 'lea.roux@gmail.com', 'marc@atelier-conseil.fr']) {
    const button = within(rowOf(email)).getByRole('button', { name: `Gérer (${email})` });
    expect(button).toHaveTextContent('Gérer');
  }
  expect(within(rowOf('claire.bernard@maison-lumiere.fr')).queryByRole('button')).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain('⋯');
});

// prototype 9 : une action n'apparaît qu'une fois
test('prototype 9 : « Renvoyer » en bouton seul sur la ligne d\'invitation, absent du menu « Gérer » (Révoquer seul)', async () => {
  renderPage();
  await ready();
  const user = userEvent.setup();
  const row = within(rowOf('lea.roux@gmail.com'));
  expect(row.getAllByRole('button', { name: 'Renvoyer' })).toHaveLength(1);
  await user.click(row.getByRole('button', { name: 'Gérer (lea.roux@gmail.com)' }));
  expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Révoquer']);
  expect(screen.queryByRole('menuitem', { name: 'Renvoyer' })).not.toBeInTheDocument();
});

// audit R-16
test('audit R-16 : lecture en échec, encadré avec Réessayer à la place des tableaux, liste au réessai', async () => {
  getFail = true;
  renderPage();
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Impossible de charger les utilisateurs.');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '+ Inviter' })).toBeDisabled();
  getFail = false;
  const user = userEvent.setup();
  await user.click(within(alert).getByRole('button', { name: 'Réessayer' }));
  await ready();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '+ Inviter' })).toBeEnabled();
});

// audit R-19
test('audit R-19 : modifier les accès notifie « Accès de … modifiés. »', async () => {
  renderPage();
  await ready();
  const user = await openMenu('paul.dumas@maison-lumiere.fr');
  await user.click(screen.getByRole('menuitem', { name: 'Modifier les accès' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(notifications()).toHaveTextContent('Accès de paul.dumas@maison-lumiere.fr modifiés.'));
});

// audit R-19
test('audit R-19 : suspendre notifie « … suspendu. »', async () => {
  renderPage();
  await ready();
  const user = await openMenu('service.client@maison-lumiere.fr');
  await user.click(screen.getByRole('menuitem', { name: 'Suspendre' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Suspendre' }));
  await waitFor(() => expect(notifications()).toHaveTextContent('service.client@maison-lumiere.fr suspendu.'));
});

// audit R-19
test('audit R-19 : le refus d\'une action dans une fenêtre reste dans la fenêtre, jamais en notification', async () => {
  patchError = "L'organisation doit garder au moins un admin.";
  renderPage();
  await ready();
  const user = await openMenu('paul.dumas@maison-lumiere.fr');
  await user.click(screen.getByRole('menuitem', { name: 'Suspendre' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Suspendre' }));
  expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent("L'organisation doit garder au moins un admin.");
  expect(notifications()).toHaveTextContent('');
});

// audit R-22
test('audit R-22 : Échap pendant la suspension ne ferme pas la fenêtre', async () => {
  let release!: () => void;
  patchDelay = new Promise<void>((r) => { release = r; });
  renderPage();
  await ready();
  const user = await openMenu('service.client@maison-lumiere.fr');
  await user.click(screen.getByRole('menuitem', { name: 'Suspendre' }));
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Suspendre' }));
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  release();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

// audit R-20
test('audit R-20 : Révoquer ouvre une confirmation, Annuler n\'envoie rien', async () => {
  renderPage();
  await ready();
  const user = userEvent.setup();
  await user.click(within(rowOf('marc@atelier-conseil.fr')).getByRole('button', { name: 'Gérer (marc@atelier-conseil.fr)' }));
  await user.click(screen.getByRole('menuitem', { name: 'Révoquer' }));
  const dialog = screen.getByRole('dialog', { name: "Révoquer l'invitation à marc@atelier-conseil.fr ?" });
  expect(within(dialog).getByText(/Le lien envoyé ne fonctionnera plus\. Pour rejoindre Maison Lumière, la personne devra être invitée de nouveau\./)).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(mutations()).toEqual([]);
  expect(screen.getByText('marc@atelier-conseil.fr')).toBeInTheDocument();
});

// audit R-20
test('audit R-20 : confirmer envoie un seul DELETE même sur double clic, notifie et relit', async () => {
  renderPage();
  await ready();
  const user = userEvent.setup();
  await user.click(within(rowOf('marc@atelier-conseil.fr')).getByRole('button', { name: 'Gérer (marc@atelier-conseil.fr)' }));
  await user.click(screen.getByRole('menuitem', { name: 'Révoquer' }));
  await user.dblClick(within(screen.getByRole('dialog')).getByRole('button', { name: 'Révoquer' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(mutations()).toEqual([{ method: 'DELETE', url: '/api/invitations/12', body: undefined }]);
  expect(notifications()).toHaveTextContent('Invitation à marc@atelier-conseil.fr révoquée.');
  expect(screen.queryByText('marc@atelier-conseil.fr')).not.toBeInTheDocument();
  expect(refreshCounts).toHaveBeenCalled();
});

// audit R-20
test('audit R-20 : un 404 « introuvable » après une révocation déjà faite n\'est pas une erreur, la liste est relue', async () => {
  deleteRefusal = { status: 404, message: 'Invitation introuvable.', reason: 'invitation.not_found' };
  invitations = invitations.filter((i) => i.id !== 12);
  renderPage();
  await ready();
  // L'invitation 12 a disparu à la lecture ; on revoque la 11, dont la révocation concurrente a déjà abouti.
  const user = userEvent.setup();
  await user.click(within(rowOf('lea.roux@gmail.com')).getByRole('button', { name: 'Gérer (lea.roux@gmail.com)' }));
  await user.click(screen.getByRole('menuitem', { name: 'Révoquer' }));
  invitations = invitations.filter((i) => i.id !== 11);
  const before = listReads('/api/invitations');
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Révoquer' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.queryByText('Invitation introuvable.')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(listReads('/api/invitations')).toBeGreaterThan(before);
  expect(screen.queryByText('lea.roux@gmail.com')).not.toBeInTheDocument();
  // le 404 ne prouve pas que cette révocation a eu lieu (renvoi ou acceptation la suppriment aussi) : aucune réussite notifiée
  expect(notifications()).toHaveTextContent('');
});

// audit R-20
test('audit R-20 : pendant une révocation, « Révoquer » et « Renvoyer » de la ligne sont désactivés avec leur raison, un seul DELETE', async () => {
  let release!: () => void;
  deleteDelay = new Promise<void>((r) => { release = r; });
  renderPage();
  await ready();
  const user = userEvent.setup();
  const gerer = () => within(rowOf('marc@atelier-conseil.fr')).getByRole('button', { name: 'Gérer (marc@atelier-conseil.fr)' });
  await user.click(gerer());
  await user.click(screen.getByRole('menuitem', { name: 'Révoquer' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Révoquer' }));
  expect(within(rowOf('marc@atelier-conseil.fr')).getByRole('button', { name: 'Renvoyer' })).toHaveAttribute('aria-disabled', 'true');
  await user.click(gerer());
  const revokeItem = screen.getByRole('menuitem', { name: 'Révoquer' });
  expect(revokeItem).toHaveAttribute('aria-disabled', 'true');
  expect(revokeItem).toHaveAccessibleDescription('Envoi en cours');
  await user.click(revokeItem);
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  release();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(mutations()).toEqual([{ method: 'DELETE', url: '/api/invitations/12', body: undefined }]);
});

// audit R-20
test('audit R-20 : un autre refus de la révocation reste affiché dans la fenêtre, qui reste ouverte', async () => {
  deleteRefusal = { status: 409, message: 'Cette invitation a déjà été acceptée.', reason: 'invitation.already_accepted' };
  renderPage();
  await ready();
  const user = userEvent.setup();
  await user.click(within(rowOf('marc@atelier-conseil.fr')).getByRole('button', { name: 'Gérer (marc@atelier-conseil.fr)' }));
  await user.click(screen.getByRole('menuitem', { name: 'Révoquer' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Révoquer' }));
  expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Cette invitation a déjà été acceptée.');
});

// audit R-27
test('audit R-27 : Renvoyer une invitation acceptée ailleurs, le refus nomme l\'invitation, la liste est relue', async () => {
  resendRefusal = { status: 409, message: 'Cette invitation a déjà été acceptée.', reason: 'invitation.already_accepted' };
  renderPage();
  await ready();
  const before = listReads('/api/invitations');
  const user = userEvent.setup();
  await user.click(within(rowOf('lea.roux@gmail.com')).getByRole('button', { name: 'Renvoyer' }));
  const message = await screen.findByText('lea.roux@gmail.com : Cette invitation a déjà été acceptée.');
  expect(within(message.closest('tr') as HTMLElement).getByRole('alert')).toBeInTheDocument();
  expect(listReads('/api/invitations')).toBeGreaterThan(before);
  // la relecture ne liste plus l'invitation : le refus reste lisible, avec son nom
  expect(screen.queryByText('lea.roux@gmail.com', { selector: 'td span' })).not.toBeInTheDocument();
  expect(notifications()).toHaveTextContent('');
  await user.click(within(message.closest('tr') as HTMLElement).getByRole('button', { name: 'Fermer' }));
  expect(screen.queryByText(/lea\.roux@gmail\.com : /)).not.toBeInTheDocument();
});

// audit R-27
test('audit R-27 : Réactiver un membre refusé, le refus est sous la ligne du membre en le nommant, la liste est relue', async () => {
  reactivateRefusal = { message: "Cette personne est déjà membre de l'organisation : modifiez ses accès.", reason: 'member.already_member' };
  renderPage();
  await ready();
  const before = listReads('/api/users');
  const user = await openMenu('thomas.leroy@maison-lumiere.fr');
  await user.click(screen.getByRole('menuitem', { name: 'Réactiver' }));
  const message = await screen.findByText(/^thomas\.leroy@maison-lumiere\.fr : /);
  const errorRow = message.closest('tr') as HTMLElement;
  expect(rowOf('thomas.leroy@maison-lumiere.fr').nextElementSibling).toBe(errorRow);
  expect(listReads('/api/users')).toBeGreaterThan(before);
  expect(notifications()).toHaveTextContent('');
});

// audit R-27
test('audit R-27 : Réactiver un membre, un double clic n\'envoie qu\'un PATCH', async () => {
  let release!: () => void;
  patchDelay = new Promise<void>((r) => { release = r; });
  renderPage();
  await ready();
  const user = userEvent.setup();
  await user.click(within(rowOf('thomas.leroy@maison-lumiere.fr')).getByRole('button', { name: 'Gérer (thomas.leroy@maison-lumiere.fr)' }));
  const item = screen.getByRole('menuitem', { name: 'Réactiver' });
  await user.click(item);
  // second clic pendant l'envoi : l'entrée est désactivée avec sa raison
  await user.click(within(rowOf('thomas.leroy@maison-lumiere.fr')).getByRole('button', { name: 'Gérer (thomas.leroy@maison-lumiere.fr)' }));
  const again = screen.getByRole('menuitem', { name: 'Réactiver' });
  expect(again).toHaveAttribute('aria-disabled', 'true');
  expect(again).toHaveAccessibleDescription('Envoi en cours');
  await user.click(again);
  release();
  await waitFor(() => expect(within(rowOf('thomas.leroy@maison-lumiere.fr')).getByText('Actif')).toBeInTheDocument());
  expect(mutations()).toHaveLength(1);
});

// audit R-28
test('audit R-28 : « ne peut pas être invité » dit que l\'adresse appartient à un compte de la plateforme et de contacter le support', async () => {
  postRefusal = { message: 'Ce compte ne peut pas être invité.', reason: 'invitation.not_invitable' };
  renderPage();
  await ready();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '+ Inviter' }));
  const drawer = screen.getByRole('dialog');
  await user.type(within(drawer).getByRole('textbox', { name: 'Adresse e-mail' }), 'root@wabagent.test');
  await user.click(within(drawer).getByRole('checkbox', { name: 'Boutique Lyon' }));
  await user.click(within(drawer).getByRole('button', { name: "Envoyer l'invitation" }));
  expect(await within(drawer).findByRole('alert')).toHaveTextContent('Cette adresse appartient à un compte de la plateforme : contactez le support.');
  expect(notifications()).toHaveTextContent('');
});

test('audit R-19 : invitation envoyée mais relecture en échec, notification de réussite puis bandeau avec Réessayer, retiré au réessai réussi', async () => {
  renderPage();
  await ready();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '+ Inviter' }));
  const drawer = screen.getByRole('dialog');
  await user.type(within(drawer).getByRole('textbox', { name: 'Adresse e-mail' }), 'nouveau@maison-lumiere.fr');
  await user.click(within(drawer).getByRole('checkbox', { name: 'Boutique Lyon' }));
  getFail = true;
  await user.click(within(drawer).getByRole('button', { name: "Envoyer l'invitation" }));
  await waitFor(() => expect(notifications()).toHaveTextContent('Invitation envoyée à nouveau@maison-lumiere.fr.'));
  expect(notifications()).not.toHaveTextContent('actualisé');
  const banner = await screen.findByRole('alert');
  expect(banner).toHaveTextContent("Modification enregistrée. L'affichage n'a pas pu être actualisé.");
  // les listes restent celles de la dernière lecture
  expect(screen.getByText('paul.dumas@maison-lumiere.fr')).toBeInTheDocument();
  expect(screen.queryByText('nouveau@maison-lumiere.fr', { selector: 'td span' })).not.toBeInTheDocument();
  // un réessai en échec garde le bandeau : on attend la fin de la relecture avant de le vérifier
  const reads = () => calls.filter((c) => c.method === 'GET' && c.url === '/api/users').length;
  const readsBefore = reads();
  await user.click(within(banner).getByRole('button', { name: 'Réessayer' }));
  await waitFor(() => expect(reads()).toBe(readsBefore + 1));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.getByRole('alert')).toHaveTextContent("Modification enregistrée. L'affichage n'a pas pu être actualisé.");
  getFail = false;
  await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Réessayer' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(within(rowOf('nouveau@maison-lumiere.fr')).getByText('Expire le 20 nov.')).toBeInTheDocument();
});
