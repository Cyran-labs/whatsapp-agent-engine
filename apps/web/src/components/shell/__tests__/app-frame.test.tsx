import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { vi, beforeEach, test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import type { Session } from '@/components/providers/session-provider';
import type { OrganizationSummary } from '@/lib/organizations';
import { AppFrame } from '../app-frame';

const location = vi.hoisted(() => ({ path: '/agents/demo-1', query: '' }));
vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => location.path,
  routing: { locales: ['fr', 'en'], defaultLocale: 'fr' },
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(location.query),
}));

const ml: OrganizationSummary = { client_id: 'ml', name: 'Maison Lumière', role: 'admin', read_only: false };
const session: Session = {
  me: { id: 1, email: 'claire@x.fr', role: 'user', status: 'active', organizations: [ml] },
  activeOrg: ml,
  isPlatformAdmin: false,
  isAdmin: true,
  readOnly: false,
  switchOrg: vi.fn(),
  notice: null,
  dismissNotice: vi.fn(),
  refresh: vi.fn(),
};
vi.mock('@/components/providers/session-provider', () => ({
  useSession: () => session,
}));

beforeEach(() => {
  location.path = '/agents/demo-1';
  location.query = '';
});

function frame() {
  return (
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AppFrame space="agents" column={<aside>Colonne</aside>}>
        <p>Contenu</p>
      </AppFrame>
    </NextIntlClientProvider>
  );
}

function scrollZone(): HTMLElement {
  return document.querySelector('[data-page-scroll]') as HTMLElement;
}

// recette 3.10 : rail et colonne à pleine hauteur, seule la zone de contenu défile
test('rail et colonne hors de la zone défilante, contenu dedans', () => {
  render(frame());
  const zone = scrollZone();
  expect(zone).not.toBeNull();
  expect(zone.className).toContain('overflow-auto');
  // positionnée : un élément en position absolue de la page (texte réservé aux lecteurs d'écran) reste dans la zone et
  // ne fait jamais défiler le document
  expect(zone.className.split(' ')).toContain('relative');
  expect(zone).toHaveTextContent('Contenu');
  expect(zone).not.toContainElement(screen.getByRole('navigation', { name: 'Navigation principale' }));
  expect(zone).not.toContainElement(screen.getByRole('complementary'));
  // le cadre lui-même ne défile pas : il tient dans la hauteur que lui donne la page
  const root = zone.parentElement as HTMLElement;
  expect(root.className).toContain('overflow-hidden');
  expect(root.className).toContain('min-h-0');
  expect(root.className.split(' ')).toContain('relative');
});

// recette 3.14 (C-20) : chaque changement de page ouvre en haut
test('changement de chemin, puis de requête seule : la zone revient en haut', () => {
  const { rerender } = render(frame());
  const zone = scrollZone();

  zone.scrollTop = 400;
  location.path = '/agents/demo-1/usage';
  rerender(frame());
  expect(zone.scrollTop).toBe(0);

  zone.scrollTop = 400;
  location.query = 'entity=1';
  rerender(frame());
  expect(zone.scrollTop).toBe(0);

  // même adresse : le défilement reste
  zone.scrollTop = 400;
  rerender(frame());
  expect(zone.scrollTop).toBe(400);
});
