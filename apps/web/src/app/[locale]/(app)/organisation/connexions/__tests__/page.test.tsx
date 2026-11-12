import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../../../../messages/fr.json';
import type { Session } from '@/components/providers/session-provider';
import type { WhatsAppAccountView } from '@wabagent/contracts';
import { accountView, numberView, webhookView } from '@/components/connections/__tests__/fixtures';
import { NotificationProvider } from '@/components/feedback/notification-provider';
import OrganisationLayout from '../../layout';
import {
  expectCreateButton,
  expectOrgBlockFirst,
  expectRailActive,
  headerActions,
  headerParents,
  headerTitle,
} from '@/components/shell/__tests__/frame-assertions';
import ConnexionsPage from '../page';

const replace = vi.fn();
vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, className, ...rest }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className} {...rest}>{children}</a>
  ),
  usePathname: () => '/organisation/connexions',
  useRouter: () => ({ push: vi.fn(), replace }),
  routing: { locales: ['fr', 'en'], defaultLocale: 'fr' },
}));

let mockSession: Session;
vi.mock('@/components/providers/session-provider', () => ({ useSession: () => mockSession }));

const org = { client_id: 'ml', name: 'Maison Lumière', role: 'admin' as const, read_only: false };

beforeEach(() => {
  vi.restoreAllMocks();
  replace.mockReset();
  mockSession = {
    me: { id: 1, email: 'claire@maison-lumiere.fr', role: 'user', status: 'active', organizations: [org] },
    activeOrg: org,
    isPlatformAdmin: false,
    isAdmin: true,
    readOnly: false,
    switchOrg: vi.fn(),
    notice: null,
    dismissNotice: vi.fn(),
    refresh: vi.fn(),
  };
});

/** Moteur simulé : `accounts` pour les comptes WhatsApp, listes vides pour le reste du rail. */
function stubEngine(accounts: () => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/whatsapp-accounts/2/webhook') return json(webhookView({ path: '/webhook/meta/autre-cle', url: null, verify_token: 'wab_vt_zzzzzzzzzzzzzzzz1234' }));
    if (/^\/api\/whatsapp-accounts\/\d+\/webhook$/.test(url)) return json(webhookView());
    if (url.startsWith('/api/whatsapp-accounts')) return accounts();
    if (url.startsWith('/api/entities') || url.startsWith('/api/users') || url.startsWith('/api/invitations')) {
      return new Response('[]', { status: 200 });
    }
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

async function renderPage() {
  let result: ReturnType<typeof render> | undefined;
  await act(async () => {
    result = render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <NotificationProvider><OrganisationLayout><ConnexionsPage /></OrganisationLayout></NotificationProvider>
      </NextIntlClientProvider>,
    );
  });
  return result!;
}

const principal = accountView({
  id: 1,
  name: 'Boutique principale',
  numbers: [
    numberView({ id: 1, phone_e164: '+33612457890', display_name: 'Boutique Marais', bot: { bot_id: 'conseil', name: 'Conseil Marais', status: 'limited', status_reason: null, not_responding: null } }),
    numberView({ id: 2, phone_e164: '+33184801234', display_name: 'Boutique SAV' }),
  ],
});
const sandbox = accountView({
  id: 2,
  name: 'Sandbox de test',
  is_test: true,
  numbers: [numberView({ id: 3, phone_e164: '+15550132291', display_name: 'Test Number', is_test: true, quality: null })],
});
const disconnected = accountView({
  id: 3,
  name: 'Ancien compte',
  state: 'disconnected',
  numbers: [],
});

test('squelettes pendant le chargement : en-tête réel, pas d\'erreur, pas de bloc de compte', async () => {
  // Le layout (compteur du rail) et la page lisent la même route : une même porte pour les deux.
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  stubEngine(async () => { await gate; return json([principal]); });
  const { container } = await renderPage();
  expect(screen.getByRole('heading', { name: 'Connexions', level: 1 })).toBeInTheDocument();
  expect(container.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(3);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByText('Aucun compte WhatsApp raccordé')).not.toBeInTheDocument();
  await act(async () => { release(); });
  expect(await screen.findByRole('heading', { name: 'Boutique principale' })).toBeInTheDocument();
  expect(container.querySelectorAll('[data-skeleton]').length).toBe(0);
});

// revue finale (mineur T4) : pendant la lecture des comptes, aucun bouton rond (il apparaîtrait puis disparaîtrait s'il
// n'y a aucun compte) ; il paraît une fois les comptes lus et non vides
test('chargement : aucun bouton rond tant que les comptes ne sont pas lus, puis le bouton rond', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  stubEngine(async () => { await gate; return json([principal]); });
  await renderPage();
  expect(screen.getByRole('heading', { name: 'Connexions', level: 1 })).toBeInTheDocument();
  expectCreateButton(null);
  await act(async () => { release(); });
  expect(await screen.findByRole('heading', { name: 'Boutique principale' })).toBeInTheDocument();
  expectCreateButton('Raccorder un compte WhatsApp');
});

test('comptes : un bloc par compte raccordé, bloc CRM Soon, lien de raccordement', async () => {
  stubEngine(() => json([principal, sandbox]));
  await renderPage();
  expect(await screen.findByRole('heading', { name: 'Boutique principale' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Sandbox de test' })).toBeInTheDocument();
  expect(screen.getByText('+33 6 12 45 78 90')).toBeInTheDocument();
  expect(screen.getByText('+1 555 013 2291')).toBeInTheDocument();
  expect(screen.getByText('Compte de test')).toBeInTheDocument();
  expect(screen.queryByText('à venir')).not.toBeInTheDocument();
  const connect = screen.getByRole('link', { name: 'Raccorder un compte WhatsApp' });
  expect(connect).toHaveAttribute('href', '/organisation/connexions/raccorder');
  // spec R1 §6.2 : comptes Meta, rien à copier chez Meta, aucune boîte webhook
  expect(screen.queryByText('Webhook du compte')).not.toBeInTheDocument();
});

test('rail : « Connexions » entre Utilisateurs et Réglages, page courante, compteur des comptes non déconnectés', async () => {
  stubEngine(() => json([principal, sandbox, disconnected]));
  await renderPage();
  const nav = screen.getByRole('complementary');
  const labels = within(nav).getAllByRole('link').map((a) => a.textContent ?? '');
  const index = (word: string) => labels.findIndex((l) => l.includes(word));
  expect(index('Utilisateurs')).toBeGreaterThan(-1);
  expect(index('Connexions')).toBe(index('Utilisateurs') + 1);
  expect(index('Réglages')).toBe(index('Connexions') + 1);
  const link = within(nav).getByRole('link', { name: /Connexions/ });
  expect(link).toHaveAttribute('href', '/organisation/connexions');
  expect(link).toHaveAttribute('aria-current', 'page');
  await waitFor(() => expect(within(link).getByText('2')).toBeInTheDocument());
});

// prototype 10 : section CRM à venir, grisée, pastille Soon, bulle « Disponible prochainement : … » au survol et au focus
test('prototype 10 : section CRM grisée, non lien, pastille « Soon », bulle au focus clavier', async () => {
  stubEngine(() => json([principal]));
  await renderPage();
  await screen.findByRole('heading', { name: 'Boutique principale' });
  const crm = screen.getByRole('group', { name: /CRM/ });
  expect(crm).toHaveAttribute('aria-disabled', 'true');
  expect(crm).not.toHaveAttribute('href');
  expect(within(crm).getByText('Soon')).toBeInTheDocument();
  expect(within(crm).queryByRole('link')).not.toBeInTheDocument();
  const bubble = document.getElementById(crm.getAttribute('aria-describedby') ?? '');
  expect(bubble).not.toBeVisible();
  act(() => crm.focus());
  expect(bubble).toBeVisible();
  expect(crm).toHaveAccessibleDescription("Disponible prochainement : le raccordement d'un CRM à l'organisation, puis son usage réglé dans chaque agent IA.");
});

// prototype 17 : un compte en erreur se voit depuis toutes les pages de l'espace, sur l'entrée Connexions
test('prototype 17 : un compte en erreur, point rouge et « 1 en erreur » à la place du compteur sur l\'entrée Connexions', async () => {
  const broken = accountView({ id: 4, name: 'Compte Lyon', state: 'error', error_reason: 'token_invalid', numbers: [] });
  stubEngine(() => json([principal, broken, disconnected]));
  await renderPage();
  const link = within(screen.getByRole('complementary')).getByRole('link', { name: /Connexions/ });
  await waitFor(() => expect(within(link).getByText('1 en erreur')).toBeInTheDocument());
  expect(within(link).getByText('1 en erreur')).toHaveClass('text-danger-ink', 'bg-danger-soft');
  expect(link.querySelector('[data-dot]')).toHaveClass('bg-danger');
  expect(within(link).queryByText('2')).not.toBeInTheDocument();
});

// spec 5.1, 10.7 ; spec en-tête 2.2 : titre seul, phrase existante, bouton rond « Raccorder un compte WhatsApp » (glyphe
// WhatsApp) vers le raccordement
test('cadre : rail Organisation actif, bloc Organisation, titre seul, bouton rond « Raccorder un compte WhatsApp »', async () => {
  stubEngine(() => json([principal]));
  await renderPage();
  await screen.findByRole('heading', { name: 'Boutique principale' });
  expectRailActive('organisation');
  expectOrgBlockFirst('Maison Lumière');
  expect(headerTitle()).toHaveTextContent('Connexions');
  expect(headerParents()).toEqual([]);
  expect(headerActions()).toEqual(['Raccorder un compte WhatsApp']);
  expect(document.querySelector('[data-page-header]')).toHaveTextContent("Les comptes WhatsApp de l'organisation et leurs numéros.");
  const round = expectCreateButton('Raccorder un compte WhatsApp') as HTMLElement;
  expect(round).toHaveAttribute('href', '/organisation/connexions/raccorder');
  expect(round.querySelector('[data-create-icon="whatsapp"]')).not.toBeNull();
});

// spec en-tête 7.5 : l'encart vide porte l'action, le bouton rond est masqué ; une action n'apparaît jamais deux fois
test('aucun compte : pas de bouton rond, le bouton de raccordement est dans l\'encart vide', async () => {
  stubEngine(() => json([]));
  await renderPage();
  expect(await screen.findByText('Aucun compte WhatsApp raccordé')).toBeInTheDocument();
  expectCreateButton(null);
  expect(headerActions()).toEqual([]);
  expect(screen.getByRole('link', { name: '+ Raccorder un compte WhatsApp' })).toBeInTheDocument();
});

// P7, entête 5 : organisation en lecture seule, aucun bouton rond
test('organisation en lecture seule : aucun bouton rond', async () => {
  mockSession = { ...mockSession, readOnly: true, activeOrg: { ...org, read_only: true } };
  stubEngine(() => json([principal]));
  await renderPage();
  await screen.findByRole('heading', { name: 'Boutique principale' });
  expectCreateButton(null);
  expect(headerActions()).toEqual([]);
});

test('compte retiré : replié en bas, sans numéro ni webhook ni action', async () => {
  stubEngine(() => json([principal, disconnected]));
  await renderPage();
  await screen.findByRole('heading', { name: 'Boutique principale' });
  const summary = screen.getByText('1 compte retiré');
  const details = summary.closest('details');
  expect(details).not.toBeNull();
  expect(details).not.toHaveAttribute('open');
  expect(within(details!).getByText('Ancien compte')).toBeInTheDocument();
  expect(within(details!).getByText('Retiré')).toBeInTheDocument();
  expect(within(details!).queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Ancien compte' })).not.toBeInTheDocument();
});

test('état vide : message et un seul bouton de raccordement', async () => {
  stubEngine(() => json([]));
  await renderPage();
  expect(await screen.findByText('Aucun compte WhatsApp raccordé')).toBeInTheDocument();
  const links = screen.getAllByRole('link', { name: /Raccorder un compte WhatsApp/ });
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveAttribute('href', '/organisation/connexions/raccorder');
  const nav = screen.getByRole('complementary');
  await waitFor(() => expect(within(within(nav).getByRole('link', { name: /Connexions/ })).getByText('0')).toBeInTheDocument());
});

test('seulement des comptes retirés : état vide et la liste repliée', async () => {
  stubEngine(() => json([disconnected]));
  await renderPage();
  expect(await screen.findByText('Aucun compte WhatsApp raccordé')).toBeInTheDocument();
  expect(screen.getByText('1 compte retiré')).toBeInTheDocument();
});

test('échec du moteur : état d\'erreur de page avec « Réessayer », puis la page au second essai', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  let fail = true;
  stubEngine(() => (fail ? json({ error: { message: 'boom' } }, 500) : json([principal])));
  await renderPage();
  const retry = await screen.findByRole('button', { name: 'Réessayer' });
  // contre-audit D-5 : la page dit ce qui n'a pas pu être lu, dans une alerte
  expect(screen.getByRole('alert')).toHaveTextContent('Impossible de charger les connexions.');
  expect(screen.queryByText(/Quelque chose s'est mal passé/)).not.toBeInTheDocument();
  fail = false;
  await act(async () => { fireEvent.click(retry); });
  expect(await screen.findByRole('heading', { name: 'Boutique principale' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
  error.mockRestore();
});

test('réponse ORG_CHANGED : aucun message d\'erreur, aucun état vide, la page reste en chargement', async () => {
  stubEngine(() => json({ error: { code: 'ORG_CHANGED', message: 'Organisation changée dans un autre onglet.' } }, 409));
  const { container } = await renderPage();
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/whatsapp-accounts'));
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
  expect(screen.queryByText('Aucun compte WhatsApp raccordé')).not.toBeInTheDocument();
  expect(screen.queryByText(/Quelque chose s'est mal passé/)).not.toBeInTheDocument();
  expect(container.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0);
});

// Arbitrage du contrôleur : une relecture en échec après une action garde les données précédentes.
// audit §5.1 « Échec d'une relecture après réussite »
test('relecture en échec après une écriture réussie : les comptes restent affichés, « Modification enregistrée… » et « Réessayer »', async () => {
  let renamed = false;
  let rereadFails = true;
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.endsWith('/webhook')) return json(webhookView());
    if (url === '/api/whatsapp-accounts/1' && init?.method === 'PATCH') {
      renamed = true;
      return json(principal);
    }
    if (url.startsWith('/api/whatsapp-accounts')) {
      return renamed && rereadFails ? json({ error: { message: 'boom' } }, 500) : json([principal]);
    }
    if (url.startsWith('/api/entities') || url.startsWith('/api/users') || url.startsWith('/api/invitations')) {
      return new Response('[]', { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }));
  await renderPage();
  await screen.findByRole('heading', { name: 'Boutique principale' });
  await userEvent.click(screen.getByRole('button', { name: 'Gérer (Boutique principale)' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Renommer' }));
  await userEvent.type(screen.getByLabelText('Nom du compte'), '{Enter}');

  const banner = await screen.findByText("Modification enregistrée. L'affichage n'a pas pu être actualisé.");
  expect(banner.closest('[role="alert"]')).not.toBeNull();
  expect(screen.queryByText(/Impossible de relire les connexions/)).not.toBeInTheDocument();
  // Les données précédentes restent, la page n'est pas remplacée par l'état d'erreur.
  expect(screen.getByRole('heading', { name: 'Boutique principale' })).toBeInTheDocument();
  expect(screen.getByText('+33 6 12 45 78 90')).toBeInTheDocument();
  expect(screen.queryByText(/Quelque chose s'est mal passé/)).not.toBeInTheDocument();

  rereadFails = false;
  await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  await waitFor(() => expect(screen.queryByText(/Modification enregistrée/)).not.toBeInTheDocument());
  expect(screen.getByRole('heading', { name: 'Boutique principale' })).toBeInTheDocument();
});

test('action réussie : la page est relue une fois et le compteur du rail suit cette lecture', async () => {
  let reads = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/webhook')) return json(webhookView());
    if (url === '/api/whatsapp-accounts/1' && init?.method === 'PATCH') return json(principal);
    if (url.startsWith('/api/whatsapp-accounts')) {
      reads += 1;
      return json([principal]);
    }
    if (url.startsWith('/api/entities') || url.startsWith('/api/users') || url.startsWith('/api/invitations')) {
      return new Response('[]', { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }));
  await renderPage();
  await screen.findByRole('heading', { name: 'Boutique principale' });
  const before = reads;
  await userEvent.click(screen.getByRole('button', { name: 'Gérer (Boutique principale)' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Renommer' }));
  await userEvent.type(screen.getByLabelText('Nom du compte'), '{Enter}');
  // Une seule lecture des comptes : la page la relit et en donne le compte au rail (revue finale 2b-3 m-2)
  await waitFor(() => expect(reads).toBe(before + 1));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  expect(reads).toBe(before + 1);
});

// revue 2b-3 M-1 : un numéro branché dans un autre onglet est visible au retour, sans relecture manuelle
test('retour sur l\'onglet : les comptes sont relus et le nouveau détenteur du numéro s\'affiche', async () => {
  let reads = 0;
  let changedElsewhere = false;
  const taken = accountView({
    id: 1,
    name: 'Boutique principale',
    numbers: [numberView({ id: 2, phone_e164: '+33184801234', display_name: 'Boutique SAV', bot: { bot_id: 'ventes', name: 'Ventes express', status: 'limited', status_reason: null, not_responding: null } })],
  });
  stubEngine(() => { reads += 1; return json([changedElsewhere ? taken : principal]); });
  await renderPage();
  await screen.findByRole('heading', { name: 'Boutique principale' });
  expect(screen.queryByText('Ventes express')).not.toBeInTheDocument();
  const before = reads;
  changedElsewhere = true;
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(await screen.findByText('Ventes express')).toBeInTheDocument();
  expect(reads).toBeGreaterThan(before);
});

// revue 2b-3 M-1
test('onglet qui passe en arrière-plan : aucune relecture', async () => {
  stubEngine(() => json([principal]));
  await renderPage();
  await screen.findByRole('heading', { name: 'Boutique principale' });
  const before = vi.mocked(fetch).mock.calls.length;
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(vi.mocked(fetch).mock.calls.length).toBe(before);
});

/** Comptes CM.com : la boîte webhook à copier n'existe plus que pour eux (spec R1 §6.2). */
const cmPrincipal = { ...principal, mode: 'cm_com' as const, waba_id: null, meta_app_id: null };
const cmSandbox = { ...sandbox, mode: 'cm_com' as const, waba_id: null, meta_app_id: null };

// revue 2b-3 M-2 : la liste des comptes ne sert aucun secret, chaque boîte lit la route dédiée de son compte (CM.com)
test('chaque boîte webhook lit GET /api/whatsapp-accounts/<id>/webhook ; le webhook affiché vient de cette route', async () => {
  const fetchMock = stubEngine(() => json([cmPrincipal, cmSandbox]));
  await renderPage();
  await screen.findByRole('heading', { name: 'Boutique principale' });
  expect(await screen.findAllByText('Webhook du compte')).toHaveLength(2);
  expect(screen.getByText('https://dev.wabagent.com/webhook/meta/cle-secrete-du-compte')).toBeInTheDocument();
  expect(screen.getByText('/webhook/meta/autre-cle')).toBeInTheDocument();
  const urls = fetchMock.mock.calls.map(([url]) => url as string);
  expect(urls.filter((u) => u.endsWith('/webhook')).sort()).toEqual(['/api/whatsapp-accounts/1/webhook', '/api/whatsapp-accounts/2/webhook']);
});

// revue 2b-3 M-1 (cycle 1, I-1) : le scénario principal passe par le lien « Libre · Brancher », qui disparaît quand
// la relecture montre un détenteur ; la fenêtre et le refus du moteur doivent rester affichés
test('« Brancher » depuis un numéro libre : 409 « Ce numéro a changé » puis relecture où le numéro est pris, la fenêtre reste ouverte avec le message et le nouvel avertissement', async () => {
  const stale = 'Ce numéro a changé depuis votre lecture : vérifiez la liste.';
  let takenElsewhere = false;
  const freeView = accountView({ id: 1, name: 'Boutique principale', numbers: [numberView({ id: 2, phone_e164: '+33184801234', display_name: 'Boutique SAV' })] });
  const takenView = accountView({
    id: 1,
    name: 'Boutique principale',
    numbers: [numberView({ id: 2, phone_e164: '+33184801234', display_name: 'Boutique SAV', bot: { bot_id: 'ventes', name: 'Ventes express', status: 'limited', status_reason: null, not_responding: null } })],
  });
  const puts: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/webhook')) return json(webhookView());
    if (url === '/api/bots') return json([{ bot_id: 'sav', name: 'SAV commandes', status: 'draft', whatsapp_number: null }]);
    if (url === '/api/bots/sav/number' && init?.method === 'PUT') {
      puts.push(JSON.parse(String(init.body)));
      takenElsewhere = true;
      return json({ error: { code: 'CONFLICT', message: stale, details: [{ path: 'expected_bot_id', message: stale }] } }, 409);
    }
    if (url.startsWith('/api/whatsapp-accounts')) return json([takenElsewhere ? takenView : freeView]);
    if (url.startsWith('/api/entities') || url.startsWith('/api/users') || url.startsWith('/api/invitations')) return new Response('[]', { status: 200 });
    return new Response('{}', { status: 404 });
  }));
  await renderPage();
  await screen.findByRole('heading', { name: 'Boutique principale' });
  await userEvent.click(screen.getByRole('button', { name: 'Brancher sur un agent IA' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(await within(dialog).findByRole('radio', { name: /SAV commandes/ }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Brancher' }));

  // La relecture a eu lieu : le lien « Brancher sur un agent IA » a laissé place au détenteur.
  expect(await screen.findByRole('link', { name: /Ventes express/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Brancher sur un agent IA' })).not.toBeInTheDocument();
  // La fenêtre est toujours là, avec le refus du moteur et l'avertissement du nouveau détenteur.
  const still = screen.getByRole('dialog');
  expect(within(still).getByRole('alert')).toHaveTextContent(stale);
  expect(within(still).getByRole('status')).toHaveTextContent('Ventes express');
  expect(within(still).getByRole('button', { name: 'Brancher' })).toBeDisabled();
  expect(puts).toEqual([{ number_id: 2, expected_bot_id: null }]);
});

// revue 2b-3 M-1 (cycle 1, I-1) : même démontage, par la relecture au retour sur l'onglet
test('« Brancher » ouvert sur un numéro libre : une relecture au retour sur l\'onglet qui montre un détenteur ne ferme pas la fenêtre', async () => {
  let takenElsewhere = false;
  const freeView = accountView({ id: 1, name: 'Boutique principale', numbers: [numberView({ id: 2, phone_e164: '+33184801234', display_name: 'Boutique SAV' })] });
  const takenView = accountView({
    id: 1,
    name: 'Boutique principale',
    numbers: [numberView({ id: 2, phone_e164: '+33184801234', display_name: 'Boutique SAV', bot: { bot_id: 'ventes', name: 'Ventes express', status: 'limited', status_reason: null, not_responding: null } })],
  });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/webhook')) return json(webhookView());
    if (url === '/api/bots') return json([{ bot_id: 'sav', name: 'SAV commandes', status: 'draft', whatsapp_number: null }]);
    if (url.startsWith('/api/whatsapp-accounts')) return json([takenElsewhere ? takenView : freeView]);
    if (url.startsWith('/api/entities') || url.startsWith('/api/users') || url.startsWith('/api/invitations')) return new Response('[]', { status: 200 });
    return new Response('{}', { status: 404 });
  }));
  await renderPage();
  await screen.findByRole('heading', { name: 'Boutique principale' });
  await userEvent.click(screen.getByRole('button', { name: 'Brancher sur un agent IA' }));
  await screen.findByRole('dialog');
  takenElsewhere = true;
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(await screen.findByRole('link', { name: /Ventes express/ })).toBeInTheDocument();
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByRole('status')).toHaveTextContent('Ventes express');
});

// revue 2b-3 M-1 (cycle 1, m-2), revue finale 2b-3 m-2 : le compteur du rail suit la lecture de la page, sans seconde lecture des comptes
test('retour sur l\'onglet : la page relit les comptes une seule fois et le compteur du rail en prend le résultat', async () => {
  let two = false;
  const fetchMock = stubEngine(() => json(two ? [principal, sandbox] : [principal]));
  await renderPage();
  await screen.findByRole('heading', { name: 'Boutique principale' });
  const nav = screen.getByRole('complementary');
  const link = within(nav).getByRole('link', { name: /Connexions/ });
  await waitFor(() => expect(within(link).getByText('1')).toBeInTheDocument());
  const accountReads = () => fetchMock.mock.calls.filter(([url]) => url === '/api/whatsapp-accounts').length;
  const accountsBefore = accountReads();
  two = true;
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  await waitFor(() => expect(within(link).getByText('2')).toBeInTheDocument());
  expect(accountReads()).toBe(accountsBefore + 1);
});

// audit §5.1 : sans écriture avant, le bandeau d'une relecture en échec reste « Impossible de relire les connexions »
test('relecture en échec au retour sur l\'onglet (aucune écriture avant) : bandeau « Impossible de relire les connexions », pas « Modification enregistrée »', async () => {
  let fail = false;
  stubEngine(() => (fail ? json({ error: { message: 'boom' } }, 500) : json([principal])));
  await renderPage();
  await screen.findByRole('heading', { name: 'Boutique principale' });
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  fail = true;
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(await screen.findByText('Impossible de relire les connexions : les informations affichées peuvent être périmées.')).toBeInTheDocument();
  expect(screen.queryByText(/Modification enregistrée/)).not.toBeInTheDocument();
  error.mockRestore();
});

/** Moteur où retirer le compte 1 réussit (204) ; les lectures suivantes le montrent retiré. */
function stubRemovableEngine(accounts: WhatsAppAccountView[], outcome: { waba_cleanup: string; app_webhook: string } = { waba_cleanup: 'done', app_webhook: 'repointed' }) {
  let removed = false;
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (/^\/api\/whatsapp-accounts\/\d+\/webhook$/.test(url)) return json(webhookView());
    if (url === '/api/whatsapp-accounts/1/disconnect' && init?.method === 'POST') {
      removed = true;
      return json(outcome);
    }
    if (url.startsWith('/api/whatsapp-accounts')) {
      return json(accounts.map((a) => (removed && a.id === 1 ? { ...a, state: 'disconnected', numbers: [] } : a)));
    }
    if (url.startsWith('/api/entities') || url.startsWith('/api/users') || url.startsWith('/api/invitations')) return new Response('[]', { status: 200 });
    return new Response('{}', { status: 404 });
  }));
  return calls;
}

async function removeFirstAccount() {
  await userEvent.click(screen.getByRole('button', { name: 'Gérer (Boutique principale)' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Retirer le compte' }));
  await userEvent.click(within(screen.getByRole('dialog', { name: 'Retirer le compte Boutique principale ?' })).getByRole('button', { name: 'Retirer le compte' }));
}

// spec R1 §5.5 : le bilan du retrait est dit dans la fenêtre ; à sa fermeture, la page notifie et range le compte.
test('Retirer un compte Meta dont l\'app pointe encore vers lui : la phrase, puis à la fermeture la notification et « Comptes retirés »', async () => {
  stubRemovableEngine([principal, sandbox], { waba_cleanup: 'done', app_webhook: 'left' });
  await renderPage();
  await screen.findByRole('heading', { name: 'Boutique principale' });
  await removeFirstAccount();
  const dialog = await screen.findByRole('dialog', { name: 'Compte Boutique principale retiré' });
  expect(within(dialog).getByText(/pointe encore vers ce compte retiré/)).toBeInTheDocument();
  expect(screen.queryByText('1 compte retiré')).not.toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Fermer' }));
  await waitFor(() => expect(screen.getByText('1 compte retiré')).toBeInTheDocument());
  expect(await screen.findByText('Compte WhatsApp Boutique principale retiré.')).toBeInTheDocument();
});

// recette Q-5
test('aucun libellé « Déconnecter » sur la page : le menu du compte propose « Retirer le compte », la section est « Comptes retirés »', async () => {
  stubEngine(() => json([principal, disconnected]));
  const { container } = await renderPage();
  await screen.findByRole('heading', { name: 'Boutique principale' });
  await userEvent.click(screen.getByRole('button', { name: 'Gérer (Boutique principale)' }));
  expect(screen.getByRole('menuitem', { name: 'Retirer le compte' })).toBeInTheDocument();
  expect(container.textContent ?? '').not.toMatch(/déconnect/i);
  expect(screen.getByText('1 compte retiré')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Retirer le compte' }));
  expect(screen.getByRole('dialog', { name: 'Retirer le compte Boutique principale ?' }).textContent ?? '').not.toMatch(/déconnect/i);
});

// audit R-19
test('Retirer un compte : notification « Compte WhatsApp Boutique principale retiré. », le compte passe dans « Comptes retirés »', async () => {
  stubRemovableEngine([principal, sandbox]);
  await renderPage();
  await screen.findByRole('heading', { name: 'Boutique principale' });
  await removeFirstAccount();
  const notification = await screen.findByText('Compte WhatsApp Boutique principale retiré.');
  expect(within(screen.getByRole('region', { name: 'Notifications' })).getByText('Compte WhatsApp Boutique principale retiré.')).toBe(notification);
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Boutique principale' })).not.toBeInTheDocument());
  expect(screen.getByText('1 compte retiré')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Sandbox de test' })).toBeInTheDocument();
});

// recette Q-8
test('Retirer un compte : aucune lecture du webhook du compte retiré après le retrait, même pendant la relecture', async () => {
  const calls = stubRemovableEngine([cmPrincipal, cmSandbox]);
  await renderPage();
  await screen.findByRole('heading', { name: 'Boutique principale' });
  await waitFor(() => expect(calls).toContain('GET /api/whatsapp-accounts/1/webhook'));
  const afterPost = () => calls.slice(calls.indexOf('POST /api/whatsapp-accounts/1/disconnect') + 1);
  await removeFirstAccount();
  await screen.findByText('Compte WhatsApp Boutique principale retiré.');
  await waitFor(() => expect(screen.getByText('1 compte retiré')).toBeInTheDocument());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  expect(calls).toContain('POST /api/whatsapp-accounts/1/disconnect');
  expect(afterPost().filter((c) => c === 'GET /api/whatsapp-accounts/1/webhook')).toEqual([]);
});

// audit R-19 + audit §5.1 : le retrait a réussi, la relecture qui suit échoue
test('Retirer un compte puis relecture en échec : la notification de réussite et le bandeau « Modification enregistrée… », le compte déjà dans « Comptes retirés »', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  let removed = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/webhook')) return json(webhookView());
    if (url === '/api/whatsapp-accounts/1/disconnect') { removed = true; return new Response(null, { status: 204 }); }
    if (url.startsWith('/api/whatsapp-accounts')) return removed ? json({ error: { message: 'boom' } }, 500) : json([principal, sandbox]);
    if (url.startsWith('/api/entities') || url.startsWith('/api/users') || url.startsWith('/api/invitations')) return new Response('[]', { status: 200 });
    return new Response('{}', { status: 404 });
  }));
  await renderPage();
  await screen.findByRole('heading', { name: 'Boutique principale' });
  await removeFirstAccount();
  expect(await screen.findByText('Compte WhatsApp Boutique principale retiré.')).toBeInTheDocument();
  expect(await screen.findByText("Modification enregistrée. L'affichage n'a pas pu être actualisé.")).toBeInTheDocument();
  expect(screen.getByText('1 compte retiré')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Boutique principale' })).not.toBeInTheDocument();
  error.mockRestore();
});
