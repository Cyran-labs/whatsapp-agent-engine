import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { vi, test, expect, beforeEach } from 'vitest';
import messages from '../../../../messages/fr.json';
import type { Session } from '@/components/providers/session-provider';
import type { OrganizationSummary } from '@/lib/organizations';
import { TopBar } from '../top-bar';

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, className, ...rest }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className} {...rest}>{children}</a>
  ),
  usePathname: () => '/',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  routing: { locales: ['fr', 'en'], defaultLocale: 'fr' },
}));

let mockSession: Session;
vi.mock('@/components/providers/session-provider', () => ({
  useSession: () => mockSession,
}));

const ml: OrganizationSummary = { client_id: 'ml', name: 'Maison Lumière', role: 'admin', read_only: false };

function makeSession(over: Partial<Session> = {}): Session {
  return {
    me: { id: 1, email: 'claire.bernard@maison-lumiere.fr', role: 'user', status: 'active', organizations: [ml] },
    activeOrg: ml,
    isPlatformAdmin: false,
    isAdmin: true,
    readOnly: false,
    switchOrg: vi.fn(),
    refresh: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  mockSession = makeSession();
});

function wrap(ui: React.ReactNode) {
  return render(<NextIntlClientProvider locale="fr" messages={messages}>{ui}</NextIntlClientProvider>);
}

test('logo + nav globale : Agents IA, Usage & coûts, Organisation pour un admin', () => {
  wrap(<TopBar active="agents" />);
  expect(screen.getByText('WABAGENT')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Agents IA' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'Usage & coûts' })).not.toHaveAttribute('aria-current');
  expect(screen.getByRole('link', { name: 'Organisation' })).toHaveAttribute('href', '/organisation');
});

test('Usage & coûts est marqué actif quand active="usage"', () => {
  wrap(<TopBar active="usage" />);
  expect(screen.getByRole('link', { name: 'Usage & coûts' })).toHaveAttribute('aria-current', 'page');
});

test('Organisation est absent pour un conseiller', () => {
  mockSession = makeSession({ isAdmin: false, activeOrg: { ...ml, role: 'advisor' } });
  wrap(<TopBar active="agents" />);
  expect(screen.queryByRole('link', { name: 'Organisation' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Usage & coûts' })).toBeInTheDocument();
});

test('plus de bouton Déconnexion, de sélecteur de langue ni de thème dans le bandeau', () => {
  wrap(<TopBar active="agents" />);
  expect(screen.queryByRole('button', { name: 'Déconnexion' })).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /thème/i })).not.toBeInTheDocument();
  expect(screen.queryByText('Paramètres')).not.toBeInTheDocument();
});

test('crumb : fil d Ariane « Agents IA › nom » à la place de la nav', () => {
  wrap(<TopBar active="agents" crumb="Support" />);
  expect(screen.getByText('Support')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Agents IA' })).toHaveAttribute('href', '/');
  expect(screen.queryByRole('link', { name: 'Usage & coûts' })).not.toBeInTheDocument();
});

test('avatar avec les initiales de l e-mail à droite', () => {
  wrap(<TopBar active="agents" />);
  expect(screen.getByRole('button', { name: 'claire.bernard@maison-lumiere.fr' })).toHaveTextContent('CB');
});

test('une seule organisation : pas de sélecteur', () => {
  wrap(<TopBar active="agents" />);
  expect(screen.queryByRole('button', { name: /Maison Lumière/ })).not.toBeInTheDocument();
});

test('plusieurs organisations : sélecteur à côté de la marque', () => {
  mockSession = makeSession({
    me: {
      ...makeSession().me,
      organizations: [ml, { client_id: 'an', name: 'Atelier Nord', role: 'advisor', read_only: false }],
    },
  });
  wrap(<TopBar active="agents" />);
  expect(screen.getByRole('button', { name: /Maison Lumière/ })).toBeInTheDocument();
});
