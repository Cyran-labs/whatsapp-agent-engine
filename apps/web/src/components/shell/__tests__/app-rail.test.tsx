import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { vi, test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import type { Session } from '@/components/providers/session-provider';
import type { OrganizationSummary } from '@/lib/organizations';
import tailwindConfig from '../../../../tailwind.config';
import { AppRail, type Space } from '../app-rail';

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

const ml: OrganizationSummary = { client_id: 'ml', name: 'Maison Lumière', role: 'admin', read_only: false };
const an: OrganizationSummary = { client_id: 'an', name: 'Atelier Nord', role: 'advisor', read_only: false };

function session(over: Partial<Session> = {}, email = 'claire.bernard@maison-lumiere.fr', role = 'user'): Session {
  const activeOrg = over.activeOrg === undefined ? ml : over.activeOrg;
  return {
    me: { id: 1, email, role, status: 'active', organizations: [ml, an] },
    activeOrg,
    isPlatformAdmin: role === 'super_admin',
    isAdmin: activeOrg?.role === 'admin',
    readOnly: false,
    switchOrg: vi.fn(),
    notice: null,
    dismissNotice: vi.fn(),
    refresh: vi.fn(),
    ...over,
  };
}

function wrap(active: Space | null = null) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AppRail active={active} />
    </NextIntlClientProvider>,
  );
}

/** Mots des entrées du rail, dans l'ordre d'affichage. */
function words(): string[] {
  const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
  return Array.from(nav.querySelectorAll('[data-rail-entry]')).map((el) => el.getAttribute('data-rail-entry') ?? '');
}

test('admin : marque, Organisation, Agents IA, Usage, Leads, Reprise, Aide, Compte, dans cet ordre', () => {
  mockSession = session();
  wrap('agents');
  expect(words()).toEqual(['brand', 'organisation', 'agents', 'usage', 'leads', 'handover', 'help', 'account']);
  expect(screen.getByRole('link', { name: 'WABAGENT' })).toHaveAttribute('href', '/');
  expect(screen.getByRole('link', { name: 'Organisation' })).toHaveAttribute('href', '/organisation');
  expect(screen.getByRole('link', { name: 'Agents IA' })).toHaveAttribute('href', '/');
  expect(screen.getByRole('link', { name: 'Usage' })).toHaveAttribute('href', '/usage');
});

// nav 15.5 : aucun rôle non admin n'a Organisation ni Usage
test.each<[string, OrganizationSummary]>([
  ['conseiller', an],
  ['manager', { ...an, role: 'manager' }],
  ['super manager', { ...an, role: 'super_manager' }],
  ['super manager en lecture seule', { ...an, role: 'super_manager', read_only: true }],
])('%s : ni Organisation ni Usage', (_role, org) => {
  mockSession = session({ activeOrg: org });
  wrap('agents');
  expect(words()).toEqual(['brand', 'agents', 'leads', 'handover', 'help', 'account']);
  expect(screen.queryByRole('link', { name: 'Organisation' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Usage' })).not.toBeInTheDocument();
});

test('sans organisation active : marque, Aide et Compte seuls', () => {
  mockSession = session({ activeOrg: null, isAdmin: false });
  wrap('account');
  expect(words()).toEqual(['brand', 'help', 'account']);
});

test.each<[Space, string]>([
  ['organisation', 'Organisation'],
  ['agents', 'Agents IA'],
  ['usage', 'Usage'],
  ['account', 'Compte, claire.bernard@maison-lumiere.fr'],
])('entrée active %s : aria-current et fond, les autres non', (space, name) => {
  mockSession = session();
  wrap(space);
  const active = screen.getByRole('link', { name });
  expect(active).toHaveAttribute('aria-current', 'page');
  expect(active.className.split(/\s+/)).toContain('bg-brand');
  // fond seul : aucune barre menthe à gauche
  expect(active.className).not.toMatch(/inset|border-l/);
  const current = screen.getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page');
  expect(current).toHaveLength(1);
});

test('aucune entrée active (refus sur place)', () => {
  mockSession = session();
  wrap(null);
  expect(screen.getAllByRole('link').filter((l) => l.hasAttribute('aria-current'))).toHaveLength(0);
});

// prototype 16
test.each([
  ['Leads', 'Disponible prochainement : suivi des conversations et des leads.'],
  ['Reprise', 'Disponible prochainement : un conseiller reprend la conversation.'],
  ['Aide', 'Disponible prochainement : aide en ligne et contact du support.'],
])('%s : grisée, pas un lien, bulle au focus clavier', async (word, tip) => {
  mockSession = session();
  wrap('agents');
  const entry = screen.getByText(word).closest('[aria-disabled]') as HTMLElement;
  expect(entry).toHaveAttribute('aria-disabled', 'true');
  // annoncée comme lien indisponible (M-2), sans être un vrai lien
  expect(entry).toHaveAttribute('role', 'link');
  expect(entry.tagName).not.toBe('A');
  expect(entry).not.toHaveAttribute('href');
  expect(entry.closest('a')).toBeNull();
  const bubble = screen.getByText(tip);
  expect(bubble).toHaveAttribute('role', 'tooltip');
  expect(entry).toHaveAttribute('aria-describedby', bubble.id);
  expect(bubble).not.toBeVisible();
  // tabulation jusqu'à l'entrée : la bulle s'affiche
  while (document.activeElement !== entry) await userEvent.tab();
  expect(bubble).toBeVisible();
  await userEvent.tab();
  expect(bubble).not.toBeVisible();
});

// relecture tâche 5, I-1
test.each(['Leads', 'Reprise', 'Aide'])('%s : au survol, bulle à contraste plein (aucun parent à opacité réduite)', async (word) => {
  mockSession = session();
  wrap('agents');
  const entry = screen.getByText(word).closest('[aria-disabled]') as HTMLElement;
  await userEvent.hover(entry);
  const bubble = document.getElementById(entry.getAttribute('aria-describedby') as string) as HTMLElement;
  expect(bubble).toBeVisible();
  // le mot reste grisé
  expect(screen.getByText(word).closest('[class*="opacity-"]')).not.toBeNull();
  for (let el: HTMLElement | null = bubble; el; el = el.parentElement) {
    expect(el.className).not.toMatch(/(^|\s)opacity-(?!100)/);
  }
});

test('aucune pastille dans le rail (ni Soon, ni New, ni compteur)', () => {
  mockSession = session();
  wrap('agents');
  const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
  expect(within(nav).queryByText('Soon')).not.toBeInTheDocument();
  expect(within(nav).queryByText('New')).not.toBeInTheDocument();
});

// relecture tâche 5, M-1 : le survol pose un fond qui existe dans le thème (pas une opacité sur une variable sans alpha)
test('survol d une entrée inactive : fond du jeton brand-hover', () => {
  mockSession = session();
  wrap('agents');
  const classes = screen.getByRole('link', { name: 'Usage' }).className.split(/\s+/);
  expect(classes).toContain('hover:bg-brand-hover');
  expect(classes.filter((c) => c.includes('/'))).toEqual([]);
  expect((tailwindConfig.theme?.extend?.colors as { brand: Record<string, string> }).brand.hover).toBe('var(--brand-hover)');
});

// relecture tâche 5, M-3 : le nom accessible commence par le mot visible (WCAG 2.5.3)
test('Compte : initiales dans un rond, lien direct vers les organisations du compte', () => {
  mockSession = session();
  wrap('agents');
  const account = screen.getByRole('link', { name: 'Compte, claire.bernard@maison-lumiere.fr' });
  expect(account).toHaveAttribute('href', '/account/organisations');
  expect(account).toHaveTextContent('CB');
  expect(account).toHaveTextContent('Compte');
  expect(screen.queryByTestId('platform-badge-dot')).not.toBeInTheDocument();
});

test('opérateur : étoile sur l avatar', () => {
  mockSession = session({}, 'francois@cyran.fr', 'super_admin');
  wrap('agents');
  const account = screen.getByRole('link', { name: 'Compte, francois@cyran.fr' });
  expect(account).toHaveTextContent('F');
  expect(within(account).getByTestId('platform-badge-dot')).toHaveTextContent('★');
});
