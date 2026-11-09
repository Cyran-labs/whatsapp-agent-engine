import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi, test, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../../../../messages/fr.json';
import type { Session } from '@/components/providers/session-provider';
import { accountView, numberView } from '@/components/connections/__tests__/fixtures';
import OrganisationLayout from '../../layout';
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
        <OrganisationLayout><ConnexionsPage /></OrganisationLayout>
      </NextIntlClientProvider>,
    );
  });
  return result!;
}

const principal = accountView({
  id: 1,
  name: 'Boutique principale',
  numbers: [
    numberView({ id: 1, phone_e164: '+33612457890', display_name: 'Boutique Marais', bot: { bot_id: 'conseil', name: 'Conseil Marais', status: 'limited' } }),
    numberView({ id: 2, phone_e164: '+33184801234', display_name: 'Boutique SAV' }),
  ],
});
const sandbox = accountView({
  id: 2,
  name: 'Sandbox de test',
  is_test: true,
  webhook: { path: '/webhook/meta/autre-cle', url: null, verify_token: 'wab_vt_zzzzzzzzzzzzzzzz1234' },
  numbers: [numberView({ id: 3, phone_e164: '+15550132291', display_name: 'Test Number', is_test: true, quality: null })],
});
const disconnected = accountView({
  id: 3,
  name: 'Ancien compte',
  state: 'disconnected',
  numbers: [],
  webhook: { path: '', url: null, verify_token: null },
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

test('comptes : un bloc par compte raccordé, bloc CRM « à venir », lien de raccordement', async () => {
  stubEngine(() => json([principal, sandbox]));
  await renderPage();
  expect(await screen.findByRole('heading', { name: 'Boutique principale' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Sandbox de test' })).toBeInTheDocument();
  expect(screen.getByText('+33 6 12 45 78 90')).toBeInTheDocument();
  expect(screen.getByText('+1 555 013 2291')).toBeInTheDocument();
  expect(screen.getByText('Compte de test')).toBeInTheDocument();
  expect(screen.getByText('à venir')).toBeInTheDocument();
  const connect = screen.getByRole('link', { name: '+ Raccorder un compte WhatsApp' });
  expect(connect).toHaveAttribute('href', '/organisation/connexions/raccorder');
  expect(screen.getByText('Adresse publique du moteur non configurée')).toBeInTheDocument();
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

test('compte déconnecté : replié en bas, sans numéro ni webhook ni action', async () => {
  stubEngine(() => json([principal, disconnected]));
  await renderPage();
  await screen.findByRole('heading', { name: 'Boutique principale' });
  const summary = screen.getByText('1 compte déconnecté');
  const details = summary.closest('details');
  expect(details).not.toBeNull();
  expect(details).not.toHaveAttribute('open');
  expect(within(details!).getByText('Ancien compte')).toBeInTheDocument();
  expect(within(details!).getByText('Déconnecté')).toBeInTheDocument();
  expect(within(details!).queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Ancien compte' })).not.toBeInTheDocument();
});

test('état vide : message et un seul bouton de raccordement', async () => {
  stubEngine(() => json([]));
  await renderPage();
  expect(await screen.findByText('Aucun compte WhatsApp raccordé')).toBeInTheDocument();
  const links = screen.getAllByRole('link', { name: '+ Raccorder un compte WhatsApp' });
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveAttribute('href', '/organisation/connexions/raccorder');
  const nav = screen.getByRole('complementary');
  await waitFor(() => expect(within(within(nav).getByRole('link', { name: /Connexions/ })).getByText('0')).toBeInTheDocument());
});

test('seulement des comptes déconnectés : état vide et la liste repliée', async () => {
  stubEngine(() => json([disconnected]));
  await renderPage();
  expect(await screen.findByText('Aucun compte WhatsApp raccordé')).toBeInTheDocument();
  expect(screen.getByText('1 compte déconnecté')).toBeInTheDocument();
});

test('échec du moteur : état d\'erreur de page avec « Réessayer », puis la page au second essai', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  let fail = true;
  stubEngine(() => (fail ? json({ error: { message: 'boom' } }, 500) : json([principal])));
  await renderPage();
  const retry = await screen.findByRole('button', { name: 'Réessayer' });
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
