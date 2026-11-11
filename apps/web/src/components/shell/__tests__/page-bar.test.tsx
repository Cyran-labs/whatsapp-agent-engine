import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { vi, test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import type { Session } from '@/components/providers/session-provider';
import type { OrganizationSummary } from '@/lib/organizations';
import { PageBar, type Crumb } from '../page-bar';

const ml: OrganizationSummary = { client_id: 'ml', name: 'Maison Lumière', role: 'admin', read_only: false };

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
  routing: { locales: ['fr', 'en'], defaultLocale: 'fr' },
}));

let mockSession: Session;
vi.mock('@/components/providers/session-provider', () => ({
  useSession: () => mockSession,
}));

function session(activeOrg: OrganizationSummary | null = ml): Session {
  return {
    me: { id: 1, email: 'claire@x.fr', role: 'user', status: 'active', organizations: [ml] },
    activeOrg,
    isPlatformAdmin: false,
    isAdmin: true,
    readOnly: false,
    switchOrg: vi.fn(),
    notice: null,
    dismissNotice: vi.fn(),
    refresh: vi.fn(),
  };
}

function wrap(trail: Crumb[], extra: { action?: React.ReactNode; root?: 'organisation' | 'account' } = {}) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <PageBar trail={trail} {...extra} />
    </NextIntlClientProvider>,
  );
}

test('premier segment : le nom de l organisation active, lien vers la liste des agents IA', () => {
  mockSession = session();
  wrap([{ label: 'Agents IA', href: '/' }, { label: 'Conseiller boutique' }]);
  const nav = screen.getByRole('navigation', { name: 'Fil d\'Ariane' });
  const links = within(nav).getAllByRole('link');
  expect(links[0]).toHaveTextContent('Maison Lumière');
  expect(links[0]).toHaveAttribute('href', '/');
  expect(nav).toHaveTextContent('Maison Lumière›Agents IA›Conseiller boutique');
});

test('segments intermédiaires en liens, dernier en gras avec aria-current', () => {
  mockSession = session();
  wrap([{ label: 'Agents IA', href: '/' }, { label: 'Conseiller boutique', href: '/agents/1' }, { label: 'Usage et coûts' }]);
  expect(screen.getByRole('link', { name: 'Conseiller boutique' })).toHaveAttribute('href', '/agents/1');
  const last = screen.getByText('Usage et coûts');
  expect(last).toHaveAttribute('aria-current', 'page');
  expect(last.className).toContain('font-semibold');
  expect(last.closest('a')).toBeNull();
  expect(screen.getByText('Maison Lumière')).not.toHaveAttribute('aria-current');
});

test('root="account" : commence par « Mon compte », sans le nom de l organisation', () => {
  mockSession = session();
  wrap([{ label: 'Préférences' }], { root: 'account' });
  const nav = screen.getByRole('navigation', { name: 'Fil d\'Ariane' });
  expect(nav).toHaveTextContent('Mon compte›Préférences');
  expect(nav).not.toHaveTextContent('Maison Lumière');
});

test('action principale à droite, hors du fil', () => {
  mockSession = session();
  wrap([{ label: 'Agents IA' }], { action: <button type="button">+ Créer un agent IA</button> });
  const nav = screen.getByRole('navigation', { name: 'Fil d\'Ariane' });
  const button = screen.getByRole('button', { name: '+ Créer un agent IA' });
  expect(nav).not.toContainElement(button);
});

test('barre collante en haut de la zone de contenu (P-4)', () => {
  mockSession = session();
  const { container } = wrap([{ label: 'Agents IA' }]);
  const bar = container.firstElementChild as HTMLElement;
  expect(bar.className).toContain('sticky');
  expect(bar.className).toContain('top-0');
});

// point d'attention 3
test('nom d organisation de 80 caractères : tronqué, nom entier en title', () => {
  const long = { ...ml, name: 'A'.repeat(40) + ' ' + 'B'.repeat(39) };
  mockSession = session(long);
  wrap([{ label: 'Agents IA' }]);
  const first = screen.getByRole('link', { name: long.name });
  expect(first).toHaveAttribute('title', long.name);
  expect(first.className).toContain('truncate');
});
