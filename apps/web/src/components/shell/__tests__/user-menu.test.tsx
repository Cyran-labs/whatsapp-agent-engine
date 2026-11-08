import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { vi, test, expect, beforeEach } from 'vitest';
import messages from '../../../../messages/fr.json';
import type { Session } from '@/components/providers/session-provider';
import type { OrganizationSummary } from '@/lib/organizations';
import { UserMenu } from '../user-menu';

const push = vi.fn();
vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, className, ...rest }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className} {...rest}>{children}</a>
  ),
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/',
  routing: { locales: ['fr', 'en'], defaultLocale: 'fr' },
}));

let mockSession: Session;
vi.mock('@/components/providers/session-provider', () => ({
  useSession: () => mockSession,
}));

const ml: OrganizationSummary = { client_id: 'ml', name: 'Maison Lumière', role: 'admin', read_only: false };

function session(over: Partial<Session> = {}, email = 'claire.bernard@maison-lumiere.fr', role = 'user'): Session {
  return {
    me: { id: 1, email, role, status: 'active', organizations: [ml] },
    activeOrg: ml,
    isPlatformAdmin: role === 'super_admin',
    isAdmin: true,
    readOnly: false,
    switchOrg: vi.fn(),
    refresh: vi.fn(),
    ...over,
  };
}

function wrap(active?: 'agents' | 'usage' | 'organisation' | 'account') {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <UserMenu active={active} />
    </NextIntlClientProvider>,
  );
}

const fetchMock = vi.fn();

beforeEach(() => {
  push.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetchMock);
  mockSession = session();
});

test('avatar : initiales de l e-mail', () => {
  wrap();
  expect(screen.getByRole('button', { name: 'claire.bernard@maison-lumiere.fr' })).toHaveTextContent('CB');
});

test('initiale unique quand l e-mail n a pas de séparateur', () => {
  mockSession = session({}, 'contact@x.fr');
  wrap();
  expect(screen.getByRole('button', { name: 'contact@x.fr' })).toHaveTextContent('C');
});

test('menu : e-mail, rôle · organisation, Mon compte, Se déconnecter', async () => {
  wrap();
  await userEvent.click(screen.getByRole('button', { name: 'claire.bernard@maison-lumiere.fr' }));
  expect(screen.getByText('Admin · Maison Lumière')).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Mon compte' })).toHaveAttribute('href', '/account/organisations');
  expect(screen.getByRole('menuitem', { name: 'Se déconnecter' })).toBeInTheDocument();
  expect(screen.queryByText('Opérateur WABAGENT')).not.toBeInTheDocument();
});

test('rôles : Super manager en lecture seule, Manager, Conseiller', async () => {
  mockSession = session({ activeOrg: { ...ml, role: 'super_manager', read_only: true } });
  const { unmount } = wrap();
  await userEvent.click(screen.getByRole('button', { name: /claire/ }));
  expect(screen.getByText('Super manager · lecture seule · Maison Lumière')).toBeInTheDocument();
  unmount();
  mockSession = session({ activeOrg: { ...ml, role: 'advisor' } });
  wrap();
  await userEvent.click(screen.getByRole('button', { name: /claire/ }));
  expect(screen.getByText('Conseiller · Maison Lumière')).toBeInTheDocument();
});

test('Se déconnecter appelle /api/auth/logout puis va sur /login', async () => {
  wrap();
  await userEvent.click(screen.getByRole('button', { name: /claire/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Se déconnecter' }));
  expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
  expect(push).toHaveBeenCalledWith('/login');
});

test('la déconnexion redirige même si l appel échoue', async () => {
  fetchMock.mockRejectedValue(new Error('réseau'));
  wrap();
  await userEvent.click(screen.getByRole('button', { name: /claire/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Se déconnecter' }));
  expect(push).toHaveBeenCalledWith('/login');
});

test('super admin : pastille, badge Opérateur WABAGENT et rôle Admin implicite', async () => {
  mockSession = session({}, 'francois@cyran.fr', 'super_admin');
  wrap();
  const trigger = screen.getByRole('button', { name: 'francois@cyran.fr' });
  expect(screen.getByTestId('platform-badge-dot')).toBeInTheDocument();
  await userEvent.click(trigger);
  expect(screen.getByText('Opérateur WABAGENT')).toBeInTheDocument();
  expect(screen.getByText('Admin implicite · Maison Lumière')).toBeInTheDocument();
});

test('super admin sans organisation active : Admin implicite seul', async () => {
  mockSession = session({ activeOrg: null }, 'francois@cyran.fr', 'super_admin');
  wrap();
  await userEvent.click(screen.getByRole('button', { name: 'francois@cyran.fr' }));
  expect(screen.getByText('Admin implicite')).toBeInTheDocument();
});

test('anneau menthe quand active === account, sinon pas d anneau', () => {
  const { unmount } = wrap('account');
  expect(screen.getByRole('button', { name: /claire/ }).className).toContain('border-brand-mint');
  unmount();
  wrap('agents');
  expect(screen.getByRole('button', { name: /claire/ }).className).not.toContain('border-brand-mint');
});

test('Échap ferme le menu et rend le focus à l avatar', async () => {
  wrap();
  const trigger = screen.getByRole('button', { name: /claire/ });
  await userEvent.click(trigger);
  expect(screen.getByRole('menuitem', { name: 'Mon compte' })).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('menuitem', { name: 'Mon compte' })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test('flèche bas passe de Mon compte à Se déconnecter', async () => {
  wrap();
  await userEvent.click(screen.getByRole('button', { name: /claire/ }));
  expect(screen.getByRole('menuitem', { name: 'Mon compte' })).toHaveFocus();
  await userEvent.keyboard('{ArrowDown}');
  expect(screen.getByRole('menuitem', { name: 'Se déconnecter' })).toHaveFocus();
});
