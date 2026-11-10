import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import type { InvitationInfo } from '@wabagent/contracts';
import messages from '../../../../messages/fr.json';
import { InvitationFlow, emailMatchesHint } from '../invitation-flow';

const push = vi.fn();
vi.mock('@/i18n/routing', () => ({
  useRouter: () => ({ push }),
  Link: (p: { children: React.ReactNode; href: string }) => <a href={p.href}>{p.children}</a>,
}));

beforeEach(() => { push.mockReset(); vi.restoreAllMocks(); });

const ORG_LYON: InvitationInfo = {
  organization_name: 'Maison Lumière',
  requires_account_creation: false,
  email_hint: 'c•••••@maison-lumiere.fr',
  grants_summary: { scope: 'entities', entities: [{ entity_name: 'Boutique Lyon', role: 'advisor' }] },
};
const NEW_ACCOUNT: InvitationInfo = {
  organization_name: 'Maison Lumière',
  requires_account_creation: true,
  email_hint: 'l•••••@maison-lumiere.fr',
  grants_summary: { scope: 'organization', role: 'admin', read_only: false },
};

interface Routes {
  info?: { status: number; body: unknown };
  me?: Array<{ status: number; body: unknown }>;
  [path: string]: unknown;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Faux BFF : /me répond dans l'ordre de la liste (le dernier élément se répète). */
function stubBff(routes: Routes) {
  const meQueue = [...(routes.me ?? [{ status: 401, body: {} }])];
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/auth/invitations/info') return json(routes.info?.status ?? 200, routes.info?.body);
    if (url === '/api/auth/me') {
      const next = meQueue.length > 1 ? meQueue.shift()! : meQueue[0];
      return json(next.status, next.body);
    }
    const custom = routes[url] as { status: number; body: unknown } | 'network' | undefined;
    if (custom === 'network') throw new TypeError('Failed to fetch');
    if (custom) return json(custom.status, custom.body);
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const sessionOf = (email: string) => ({ status: 200, body: { user: { id: 1, email, organizations: [] }, active_client_id: null } });

function renderFlow(token = 'tok-1') {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <InvitationFlow token={token} />
    </NextIntlClientProvider>,
  );
}

function callsTo(fetchMock: ReturnType<typeof stubBff>, url: string) {
  return fetchMock.mock.calls.filter((c) => c[0] === url);
}

test('emailMatchesHint : même première lettre et même domaine', () => {
  expect(emailMatchesHint('lucas@x.fr', 'l•••••@x.fr')).toBe(true);
  expect(emailMatchesHint('Lucas@X.fr', 'l•••••@x.fr')).toBe(true);
  expect(emailMatchesHint('claire@x.fr', 'l•••••@x.fr')).toBe(false);
  expect(emailMatchesHint('lucas@y.fr', 'l•••••@x.fr')).toBe(false);
  expect(emailMatchesHint('lucas@x.fr', 'sans-arobase')).toBe(false);
});

test('sans jeton : état lien invalide, aucun appel réseau', async () => {
  const fetchMock = stubBff({});
  renderFlow('');
  expect(await screen.findByText("Ce lien d'invitation n'est plus valable.")).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('loader global centré pendant la lecture de l\'invitation, puis le contenu', async () => {
  let release: (res: Response) => void = () => undefined;
  vi.stubGlobal('fetch', vi.fn((url: string) => url === '/api/auth/invitations/info'
    ? new Promise<Response>((resolve) => { release = resolve; })
    : Promise.resolve(json(401, {}))));
  renderFlow();
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('Chargement…');
  expect(status.className).toContain('min-h-screen');
  release(json(401, { error: { code: 'UNAUTHORIZED', message: 'Invitation invalide ou expirée.' } }));
  expect(await screen.findByText("Ce lien d'invitation n'est plus valable.")).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('info 401 : lien invalide avec bouton vers la connexion', async () => {
  stubBff({ info: { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Invitation invalide ou expirée.' } } } });
  renderFlow();
  expect(await screen.findByText("Ce lien d'invitation n'est plus valable.")).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Aller à la connexion' })).toHaveAttribute('href', '/login');
});

test('compte neuf : e-mail masqué en lecture seule, un seul POST accept-invite sur double clic, puis accueil avec bienvenue', async () => {
  const fetchMock = stubBff({
    info: { status: 200, body: NEW_ACCOUNT },
    '/api/auth/accept-invite': { status: 200, body: { user: { id: 1 }, client_id: 'ml', organization_name: 'Maison Lumière' } },
  });
  renderFlow('tok-1');
  expect(await screen.findByRole('heading', { name: 'Créez votre accès' })).toBeInTheDocument();
  expect(screen.getByText('Maison Lumière')).toBeInTheDocument();
  expect(screen.getByText('l•••••@maison-lumiere.fr')).toBeInTheDocument();
  expect(callsTo(fetchMock, '/api/auth/me')).toHaveLength(0);
  await userEvent.type(screen.getByLabelText('Mot de passe'), 'motdepasse12');
  const button = screen.getByRole('button', { name: 'Activer mon compte' });
  await userEvent.dblClick(button);
  await waitFor(() => expect(push).toHaveBeenCalledWith('/?welcome=1'));
  const posts = callsTo(fetchMock, '/api/auth/accept-invite');
  expect(posts).toHaveLength(1);
  expect(JSON.parse((posts[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({
    token: 'tok-1',
    password: 'motdepasse12',
    organization_name: 'Maison Lumière',
  });
});

test('compte neuf : mot de passe trop court, aucun appel', async () => {
  const fetchMock = stubBff({ info: { status: 200, body: NEW_ACCOUNT } });
  renderFlow();
  await userEvent.type(await screen.findByLabelText('Mot de passe'), 'court');
  await userEvent.click(screen.getByRole('button', { name: 'Activer mon compte' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Le mot de passe doit faire au moins 10 caractères.');
  expect(callsTo(fetchMock, '/api/auth/accept-invite')).toHaveLength(0);
});

test('compte neuf : jeton refusé par le moteur, message générique', async () => {
  stubBff({
    info: { status: 200, body: NEW_ACCOUNT },
    '/api/auth/accept-invite': { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Invitation invalide ou expirée.' } } },
  });
  renderFlow();
  await userEvent.type(await screen.findByLabelText('Mot de passe'), 'motdepasse12');
  await userEvent.click(screen.getByRole('button', { name: 'Activer mon compte' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Invitation invalide ou expirée.');
  expect(push).not.toHaveBeenCalled();
});

test('compte existant sans session : formulaire de connexion, lien oublié vers /forgot-password, puis état connecté après connexion', async () => {
  const fetchMock = stubBff({
    info: { status: 200, body: ORG_LYON },
    me: [{ status: 401, body: {} }, sessionOf('claire@maison-lumiere.fr')],
    '/api/auth/login': { status: 200, body: { user: { id: 1 } } },
  });
  renderFlow('tok-1');
  expect(await screen.findByRole('heading', { name: 'Connectez-vous pour accepter' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Mot de passe oublié ?' })).toHaveAttribute('href', '/forgot-password?invite=tok-1');
  await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'claire@maison-lumiere.fr');
  await userEvent.type(screen.getByLabelText('Mot de passe'), 'motdepasse12');
  await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
  expect(await screen.findByRole('heading', { name: 'Rejoindre Maison Lumière ?' })).toBeInTheDocument();
  expect(callsTo(fetchMock, '/api/auth/login')).toHaveLength(1);
  expect(push).not.toHaveBeenCalled();
});

test('mot de passe : Afficher / Masquer bascule le type du champ', async () => {
  stubBff({ info: { status: 200, body: ORG_LYON } });
  renderFlow();
  const field = await screen.findByLabelText('Mot de passe');
  expect(field).toHaveAttribute('type', 'password');
  await userEvent.click(screen.getByRole('button', { name: 'Afficher' }));
  expect(field).toHaveAttribute('type', 'text');
  await userEvent.click(screen.getByRole('button', { name: 'Masquer' }));
  expect(field).toHaveAttribute('type', 'password');
});

test('compte existant connecté : acceptation sans organisation résolue (client_id nul), accueil sans bienvenue', async () => {
  stubBff({
    info: { status: 200, body: ORG_LYON },
    me: [sessionOf('claire@maison-lumiere.fr')],
    '/api/auth/invitations/accept': { status: 200, body: { client_id: null, organization_name: 'Maison Lumière' } },
  });
  renderFlow('tok-1');
  await userEvent.click(await screen.findByRole('button', { name: "Accepter l'invitation" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
  expect(push).not.toHaveBeenCalledWith('/?welcome=1');
});

test('compte neuf : activation sans organisation résolue (client_id nul), accueil sans bienvenue', async () => {
  stubBff({
    info: { status: 200, body: NEW_ACCOUNT },
    '/api/auth/accept-invite': { status: 200, body: { user: { id: 1 }, client_id: null, organization_name: 'Maison Lumière' } },
  });
  renderFlow('tok-1');
  await userEvent.type(await screen.findByLabelText('Mot de passe'), 'motdepasse12');
  await userEvent.click(screen.getByRole('button', { name: 'Activer mon compte' }));
  await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
  expect(push).not.toHaveBeenCalledWith('/?welcome=1');
});

test('compte existant connecté (e-mail conforme) : rôle proposé, un seul POST accept sur double clic, puis accueil', async () => {
  const fetchMock = stubBff({
    info: { status: 200, body: ORG_LYON },
    me: [sessionOf('claire@maison-lumiere.fr')],
    '/api/auth/invitations/accept': { status: 200, body: { client_id: 'ml', organization_name: 'Maison Lumière' } },
  });
  renderFlow('tok-1');
  expect(await screen.findByRole('heading', { name: 'Rejoindre Maison Lumière ?' })).toBeInTheDocument();
  expect(screen.getByText('Conseiller · Boutique Lyon')).toBeInTheDocument();
  expect(screen.getByText('claire@maison-lumiere.fr')).toBeInTheDocument();
  await userEvent.dblClick(screen.getByRole('button', { name: "Accepter l'invitation" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith('/?welcome=1'));
  const posts = callsTo(fetchMock, '/api/auth/invitations/accept');
  expect(posts).toHaveLength(1);
  expect(JSON.parse((posts[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ token: 'tok-1', organization_name: 'Maison Lumière' });
});

test('rôle d\'organisation : Super manager · lecture seule', async () => {
  stubBff({
    info: { status: 200, body: { ...ORG_LYON, grants_summary: { scope: 'organization', role: 'super_manager', read_only: true } } },
    me: [sessionOf('claire@maison-lumiere.fr')],
  });
  renderFlow();
  expect(await screen.findByText('Super manager · lecture seule')).toBeInTheDocument();
});

test('plusieurs entités : une ligne par entité', async () => {
  stubBff({
    info: {
      status: 200,
      body: { ...ORG_LYON, grants_summary: { scope: 'entities', entities: [{ entity_name: 'Boutique Lyon', role: 'advisor' }, { entity_name: 'Boutique Paris', role: 'manager' }] } },
    },
    me: [sessionOf('claire@maison-lumiere.fr')],
  });
  renderFlow();
  expect(await screen.findByText('Conseiller · Boutique Lyon')).toBeInTheDocument();
  expect(screen.getByText('Manager · Boutique Paris')).toBeInTheDocument();
});

test('acceptation refusée par le moteur : message générique, pas de redirection', async () => {
  stubBff({
    info: { status: 200, body: ORG_LYON },
    me: [sessionOf('claire@maison-lumiere.fr')],
    '/api/auth/invitations/accept': { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Invitation invalide ou expirée.' } } },
  });
  renderFlow();
  await userEvent.click(await screen.findByRole('button', { name: "Accepter l'invitation" }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Invitation invalide ou expirée.');
  expect(push).not.toHaveBeenCalled();
});

const ACCEPT = '/api/auth/invitations/accept';

async function acceptWith(route: { status: number; body: unknown } | 'network') {
  stubBff({ info: { status: 200, body: ORG_LYON }, me: [sessionOf('claire@maison-lumiere.fr')], [ACCEPT]: route });
  renderFlow();
  await userEvent.click(await screen.findByRole('button', { name: "Accepter l'invitation" }));
  return screen.findByRole('alert');
}

// audit R-8 : une panne n'est pas une invitation refusée, et la page reste utilisable pour réessayer
test.each([500, 503])('acceptation (compte existant) en %i : texte de panne, pas « Invitation invalide ou expirée. »', async (status) => {
  const alert = await acceptWith({ status, body: { error: { code: 'INTERNAL', message: 'Erreur interne.' } } });
  expect(alert).toHaveTextContent('Enregistrement impossible pour le moment. Réessayez.');
  expect(screen.queryByText('Invitation invalide ou expirée.')).not.toBeInTheDocument();
  expect(push).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: "Accepter l'invitation" })).toBeEnabled();
});

// audit R-8
test('acceptation (compte existant) en erreur réseau : texte de panne', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const alert = await acceptWith('network');
  expect(alert).toHaveTextContent('Enregistrement impossible pour le moment. Réessayez.');
  expect(screen.queryByText('Invitation invalide ou expirée.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: "Accepter l'invitation" })).toBeEnabled();
});

// audit R-8
test('acceptation (compte existant) en 429 : trop de tentatives', async () => {
  const alert = await acceptWith({ status: 429, body: { error: { code: 'RATE_LIMITED', message: 'Trop de requêtes.' } } });
  expect(alert).toHaveTextContent('Trop de tentatives. Réessayez dans un instant.');
  expect(screen.queryByText('Invitation invalide ou expirée.')).not.toBeInTheDocument();
});

// audit R-8 : la clé du refus décide du texte
test('acceptation refusée avec la clé invitation.already_accepted : texte de la clé', async () => {
  const alert = await acceptWith({
    status: 409,
    body: { error: { code: 'CONFLICT', message: 'Invitation déjà acceptée.', reason: 'invitation.already_accepted' } },
  });
  expect(alert).toHaveTextContent('Cette invitation a déjà été acceptée.');
});

// audit R-8 : sans clé connue, le refus reste « Invitation invalide ou expirée. »
test('acceptation refusée sans clé : Invitation invalide ou expirée.', async () => {
  const alert = await acceptWith({ status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'Corps invalide.' } } });
  expect(alert).toHaveTextContent('Invitation invalide ou expirée.');
});

// audit R-8 : seule la clé décide, le texte « Session expirée. » sans clé n'est plus reconnu comme une session perdue
test('acceptation : 401 « Session expirée. » sans clé de session, lu comme un refus d\'invitation', async () => {
  const alert = await acceptWith({ status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Session expirée.' } } });
  expect(alert).toHaveTextContent('Invitation invalide ou expirée.');
  expect(screen.queryByRole('heading', { name: 'Connectez-vous pour accepter' })).not.toBeInTheDocument();
});

test('acceptation : 401 avec la clé session.invalid, retour à la connexion', async () => {
  stubBff({
    info: { status: 200, body: ORG_LYON },
    me: [sessionOf('claire@maison-lumiere.fr')],
    [ACCEPT]: { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Session invalide.', reason: 'session.invalid' } } },
  });
  renderFlow('tok-1');
  await userEvent.click(await screen.findByRole('button', { name: "Accepter l'invitation" }));
  expect(await screen.findByRole('heading', { name: 'Connectez-vous pour accepter' })).toBeInTheDocument();
});

// audit R-8 : la clé de session suffit, sans comparer le texte
test('acceptation : 401 avec la clé session.expired, retour à la connexion avec le jeton', async () => {
  stubBff({
    info: { status: 200, body: ORG_LYON },
    me: [sessionOf('claire@maison-lumiere.fr')],
    [ACCEPT]: { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'autre texte', reason: 'session.expired' } } },
  });
  renderFlow('tok-1');
  await userEvent.click(await screen.findByRole('button', { name: "Accepter l'invitation" }));
  expect(await screen.findByRole('heading', { name: 'Connectez-vous pour accepter' })).toBeInTheDocument();
  expect(screen.queryByText('Invitation invalide ou expirée.')).not.toBeInTheDocument();
});

test('« Plus tard » : retour à l\'accueil sans appel d\'acceptation', async () => {
  const fetchMock = stubBff({ info: { status: 200, body: ORG_LYON }, me: [sessionOf('claire@maison-lumiere.fr')] });
  renderFlow();
  await userEvent.click(await screen.findByRole('button', { name: 'Plus tard' }));
  expect(push).toHaveBeenCalledWith('/');
  expect(callsTo(fetchMock, '/api/auth/invitations/accept')).toHaveLength(0);
});

test('mauvais compte connecté : message avec l\'adresse masquée, Changer de compte déconnecte puis affiche la connexion', async () => {
  const fetchMock = stubBff({
    info: { status: 200, body: { ...ORG_LYON, email_hint: 'l•••••@maison-lumiere.fr' } },
    me: [sessionOf('claire@maison-lumiere.fr')],
  });
  renderFlow('tok-1');
  const alert = await screen.findByText(/Cette invitation est destinée à/);
  expect(alert).toHaveTextContent('Cette invitation est destinée à l•••••@maison-lumiere.fr.');
  expect(screen.getByText(/Vous êtes connecté avec claire@maison-lumiere.fr/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: "Accepter l'invitation" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Changer de compte' }));
  expect(await screen.findByRole('heading', { name: 'Connectez-vous pour accepter' })).toBeInTheDocument();
  expect(callsTo(fetchMock, '/api/auth/logout')).toHaveLength(1);
  expect(callsTo(fetchMock, '/api/auth/invitations/info')).toHaveLength(1);
});

test('« Changer de compte » depuis l\'état connecté : déconnexion puis connexion, jeton conservé', async () => {
  const fetchMock = stubBff({ info: { status: 200, body: ORG_LYON }, me: [sessionOf('claire@maison-lumiere.fr')] });
  renderFlow('tok-1');
  await userEvent.click(await screen.findByRole('button', { name: 'Changer de compte' }));
  expect(await screen.findByRole('heading', { name: 'Connectez-vous pour accepter' })).toBeInTheDocument();
  expect(callsTo(fetchMock, '/api/auth/logout')).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'Mot de passe oublié ?' })).toHaveAttribute('href', '/forgot-password?invite=tok-1');
});

test('info 429 : message de limitation, pas de lien invalide ; Réessayer relance le chargement', async () => {
  const fetchMock = stubBff({ info: { status: 429, body: { error: { code: 'RATE_LIMITED', message: 'x' } } } });
  renderFlow('tok-1');
  expect(await screen.findByRole('alert')).toHaveTextContent('Trop de tentatives. Réessayez dans un instant.');
  expect(screen.queryByText("Ce lien d'invitation n'est plus valable.")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  await waitFor(() => expect(callsTo(fetchMock, '/api/auth/invitations/info')).toHaveLength(2));
});

test('info 500 : erreur générique réessayable, pas de lien invalide', async () => {
  stubBff({ info: { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } } });
  renderFlow();
  expect(await screen.findByRole('alert')).toHaveTextContent("Impossible de charger l'invitation pour le moment.");
  expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  expect(screen.queryByText("Ce lien d'invitation n'est plus valable.")).not.toBeInTheDocument();
});

test('info : erreur réseau, erreur générique réessayable', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
  renderFlow();
  expect(await screen.findByRole('alert')).toHaveTextContent("Impossible de charger l'invitation pour le moment.");
});

test('info 400 : lien invalide', async () => {
  stubBff({ info: { status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'x' } } } });
  renderFlow();
  expect(await screen.findByText("Ce lien d'invitation n'est plus valable.")).toBeInTheDocument();
});

test('connexion réussie mais session illisible : message d\'erreur et bouton libéré', async () => {
  stubBff({
    info: { status: 200, body: ORG_LYON },
    me: [{ status: 401, body: {} }],
    '/api/auth/login': { status: 200, body: { user: { id: 1 } } },
  });
  renderFlow('tok-1');
  await userEvent.type(await screen.findByLabelText('Adresse e-mail'), 'claire@maison-lumiere.fr');
  await userEvent.type(screen.getByLabelText('Mot de passe'), 'motdepasse12');
  await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
  expect(await screen.findByRole('alert')).toHaveTextContent("Connexion réussie, mais votre session n'a pas pu être lue.");
  expect(screen.getByRole('button', { name: 'Se connecter' })).toBeEnabled();
  expect(screen.getByRole('heading', { name: 'Connectez-vous pour accepter' })).toBeInTheDocument();
});

test('acceptation : session expirée (et non invitation refusée), retour à la connexion avec le jeton', async () => {
  stubBff({
    info: { status: 200, body: ORG_LYON },
    me: [sessionOf('claire@maison-lumiere.fr')],
    '/api/auth/invitations/accept': { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Session expirée.', reason: 'session.expired' } } },
  });
  renderFlow('tok-1');
  await userEvent.click(await screen.findByRole('button', { name: "Accepter l'invitation" }));
  expect(await screen.findByRole('heading', { name: 'Connectez-vous pour accepter' })).toBeInTheDocument();
  expect(screen.queryByText('Invitation invalide ou expirée.')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Mot de passe oublié ?' })).toHaveAttribute('href', '/forgot-password?invite=tok-1');
  expect(push).not.toHaveBeenCalled();
});

test('mot de passe : le bouton Afficher porte aria-controls et aria-pressed', async () => {
  stubBff({ info: { status: 200, body: ORG_LYON } });
  renderFlow();
  const field = await screen.findByLabelText('Mot de passe');
  const toggle = screen.getByRole('button', { name: 'Afficher' });
  expect(toggle).toHaveAttribute('aria-controls', field.id);
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(toggle);
  expect(screen.getByRole('button', { name: 'Masquer' })).toHaveAttribute('aria-pressed', 'true');
});
