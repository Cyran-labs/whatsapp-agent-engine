import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { vi, test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import type { Session } from '@/components/providers/session-provider';
import type { OrganizationSummary } from '@/lib/organizations';
import { ReservedPage } from '../reserved-page';
import { AppFrame } from '../app-frame';

const an: OrganizationSummary = { client_id: 'an', name: 'Atelier Nord', role: 'advisor', read_only: false };

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

mockSession = {
  me: { id: 1, email: 'claire@x.fr', role: 'user', status: 'active', organizations: [an] },
  activeOrg: an,
  isPlatformAdmin: false,
  isAdmin: false,
  readOnly: false,
  switchOrg: vi.fn(),
  notice: null,
  dismissNotice: vi.fn(),
  refresh: vi.fn(),
};

function wrap(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
}

// prototype 5
test('refus sur place : rail sans entrée active, colonne réduite au bloc Organisation, fil, titre, phrase, retour', () => {
  wrap(<ReservedPage />);
  const rail = screen.getByRole('navigation', { name: 'Navigation principale' });
  expect(rail.querySelector('[aria-current]')).toBeNull();
  const column = document.querySelector('aside') as HTMLElement;
  expect(column).toHaveTextContent('Organisation');
  expect(column.querySelectorAll('a')).toHaveLength(0);
  expect(screen.getByRole('navigation', { name: 'Fil d\'Ariane' })).toHaveTextContent('Atelier Nord›Accès refusé');
  expect(screen.getByRole('heading', { level: 1, name: 'Page réservée aux administrateurs' })).toBeInTheDocument();
  expect(screen.getByText('Cette page de l\'organisation Atelier Nord est réservée aux administrateurs.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Retour aux agents IA' })).toHaveAttribute('href', '/');
});

test('AppFrame : rail, colonne, puis zone de contenu défilante sans marge haute', () => {
  wrap(
    <AppFrame space="agents" column={<aside>colonne</aside>}>
      <p>contenu</p>
    </AppFrame>,
  );
  expect(screen.getByRole('link', { name: 'Agents IA' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByText('colonne')).toBeInTheDocument();
  const zone = screen.getByText('contenu').parentElement as HTMLElement;
  expect(zone.className).toContain('overflow-auto');
  expect(zone.className).not.toMatch(/\bp[ty]?-/);
});
