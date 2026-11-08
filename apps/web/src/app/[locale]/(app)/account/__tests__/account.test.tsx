import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../../../messages/fr.json';
import type { Session } from '@/components/providers/session-provider';
import type { OrganizationSummary } from '@/lib/organizations';
import AccountLayout from '../layout';
import OrganisationsPage from '../organisations/page';

let pathname = '/account/organisations';
vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, className, ...rest }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className} {...rest}>{children}</a>
  ),
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  routing: { locales: ['fr', 'en'], defaultLocale: 'fr' },
}));

let mockSession: Session;
vi.mock('@/components/providers/session-provider', () => ({
  useSession: () => mockSession,
}));

const switchOrg = vi.fn();

const ml: OrganizationSummary = { client_id: 'ml', name: 'Maison Lumière', role: 'admin', read_only: false };
const an: OrganizationSummary = { client_id: 'an', name: 'Atelier Nord', role: 'advisor', read_only: false };
const so: OrganizationSummary = { client_id: 'so', name: 'Studio Ocre', role: 'admin', read_only: false, status: 'suspended' };

function session(orgs: OrganizationSummary[], over: Partial<Session> = {}): Session {
  return {
    me: { id: 1, email: 'claire.bernard@maison-lumiere.fr', role: 'user', status: 'active', organizations: orgs },
    activeOrg: orgs[0] ?? null,
    isPlatformAdmin: false,
    isAdmin: true,
    readOnly: false,
    switchOrg,
    notice: null,
    dismissNotice: vi.fn(),
    refresh: vi.fn(),
    ...over,
  };
}

function renderIn(ui: React.ReactNode) {
  return render(<NextIntlClientProvider locale="fr" messages={messages}>{ui}</NextIntlClientProvider>);
}

beforeEach(() => {
  pathname = '/account/organisations';
  switchOrg.mockReset();
  switchOrg.mockResolvedValue(undefined);
});

test('layout : rail « Mon compte » avec l\'e-mail en titre et trois entrées', () => {
  mockSession = session([ml, an, so]);
  renderIn(<AccountLayout><p>contenu</p></AccountLayout>);
  const rail = screen.getByRole('complementary');
  expect(within(rail).getByText('Mon compte')).toBeInTheDocument();
  expect(rail).toHaveTextContent('claire.bernard@maison-lumiere.fr');
  expect(within(rail).getByRole('link', { name: /Organisations/ })).toHaveAttribute('href', '/account/organisations');
  expect(within(rail).getByRole('link', { name: 'Préférences' })).toHaveAttribute('href', '/account/preferences');
  expect(within(rail).getByRole('link', { name: 'Sécurité' })).toHaveAttribute('href', '/account/securite');
  expect(within(rail).getByRole('link', { name: /Organisations/ })).toHaveAttribute('aria-current', 'page');
  expect(within(rail).getByRole('link', { name: 'Préférences' })).not.toHaveAttribute('aria-current');
  expect(screen.getByText('contenu')).toBeInTheDocument();
});

test('layout : l\'entrée de la page courante est active', () => {
  pathname = '/account/securite';
  mockSession = session([ml]);
  renderIn(<AccountLayout><p>contenu</p></AccountLayout>);
  expect(screen.getByRole('link', { name: 'Sécurité' })).toHaveAttribute('aria-current', 'page');
});

test('organisations : ligne active, ligne ouvrable, ligne suspendue', () => {
  mockSession = session([ml, an, so]);
  renderIn(<OrganisationsPage />);
  const rows = screen.getAllByRole('row').slice(1);
  expect(rows).toHaveLength(3);

  expect(rows[0]).toHaveTextContent('Maison Lumière');
  expect(rows[0]).toHaveTextContent('Admin');
  expect(rows[0]).toHaveTextContent('Organisation active');
  expect(rows[0]).toHaveTextContent('ouverte');
  expect(within(rows[0]).queryByRole('button')).toBeNull();

  expect(rows[1]).toHaveTextContent('Conseiller');
  expect(rows[1]).toHaveTextContent('Actif');
  expect(within(rows[1]).getByRole('button', { name: 'Ouvrir →' })).toBeInTheDocument();

  expect(rows[2]).toHaveTextContent('Suspendue');
  expect(rows[2]).toHaveTextContent('indisponible');
  expect(within(rows[2]).queryByRole('button')).toBeNull();
});

test('organisations : « Ouvrir → » appelle switchOrg avec l\'organisation', async () => {
  mockSession = session([ml, an]);
  renderIn(<OrganisationsPage />);
  await userEvent.click(screen.getByRole('button', { name: 'Ouvrir →' }));
  expect(switchOrg).toHaveBeenCalledWith('an');
});

test('organisations : rôle super manager en lecture seule', () => {
  const gv: OrganizationSummary = { client_id: 'gv', name: 'Groupe Valmont', role: 'super_manager', read_only: true };
  mockSession = session([ml, gv]);
  renderIn(<OrganisationsPage />);
  expect(screen.getByText('Super manager · lecture seule')).toBeInTheDocument();
});

test('organisations : aucune organisation, état vide sans tableau', () => {
  mockSession = session([], { activeOrg: null });
  renderIn(<OrganisationsPage />);
  expect(screen.getByText('Aucune organisation pour le moment.')).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
});
