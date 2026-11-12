import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { vi, test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import type { Session } from '@/components/providers/session-provider';
import type { OrganizationSummary } from '@/lib/organizations';
import tailwindConfig from '../../../../tailwind.config';
import { AppRail, AppRailView, type Space } from '../app-rail';

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

/** Bulle reliée à une entrée par `aria-describedby`. */
function bubbleOf(entry: HTMLElement): HTMLElement {
  const id = entry.getAttribute('aria-describedby');
  expect(id).toBeTruthy();
  const bubble = document.getElementById(id as string) as HTMLElement;
  expect(bubble).toHaveAttribute('role', 'tooltip');
  return bubble;
}

/** Bulle du rail (C-17, recette 3.11) : le nom en gras sur la première ligne, puis la phrase. */
function expectRailBubble(bubble: HTMLElement, name: string, sentence: string) {
  const [title, text] = Array.from(bubble.children) as HTMLElement[];
  expect(title).toHaveTextContent(name);
  expect(title).toHaveClass('block', 'font-semibold');
  expect(text).toHaveTextContent(sentence);
  expect(text).toHaveClass('block');
}

// prototype 16 ; recette 3.11 : nom en gras puis la phrase, comme les autres entrées
test.each([
  ['Leads', 'Disponible prochainement : suivi des conversations et des leads.'],
  ['Reprise', 'Disponible prochainement : un conseiller reprend la conversation.'],
  ['Aide', 'Disponible prochainement : aide en ligne et contact du support.'],
])('%s : grisée, pas un lien, bulle au focus clavier', async (word, tip) => {
  mockSession = session();
  wrap('agents');
  const entry = screen.getByRole('link', { name: word });
  expect(entry).toHaveAttribute('aria-disabled', 'true');
  // annoncée comme lien indisponible (M-2), sans être un vrai lien
  expect(entry).toHaveAttribute('role', 'link');
  expect(entry.tagName).not.toBe('A');
  expect(entry).not.toHaveAttribute('href');
  expect(entry.closest('a')).toBeNull();
  const bubble = bubbleOf(entry);
  expectRailBubble(bubble, word, tip);
  expect(entry).toHaveAccessibleName(word);
  expect(bubble).not.toBeVisible();
  // tabulation jusqu'à l'entrée : la bulle s'affiche ; la description est la phrase seule, le nom n'y est pas répété
  while (document.activeElement !== entry) await userEvent.tab();
  expect(bubble).toBeVisible();
  expect(entry).toHaveAccessibleDescription(tip);
  await userEvent.tab();
  expect(bubble).not.toBeVisible();
});

// recette 3.11 (C-17) : bulle courte sur chaque espace, active comprise, sans changer le nom accessible
const SPACE_HINTS: [Space, string, string, string][] = [
  ['organisation', 'Organisation', 'Organisation', 'Entités, utilisateurs, connexions et réglages.'],
  ['agents', 'Agents IA', 'Agents IA', 'La liste et la page de chaque agent IA.'],
  ['usage', 'Usage', 'Usage', 'Coûts des agents IA de l\'organisation.'],
  ['account', 'Compte, claire.bernard@maison-lumiere.fr', 'Compte', 'Vos organisations, préférences et sécurité.'],
];

test.each(SPACE_HINTS)('entrée %s active : bulle au survol et au focus, nom accessible inchangé', async (space, name, title, sentence) => {
  mockSession = session();
  wrap(space);
  const entry = screen.getByRole('link', { name });
  expect(entry).toHaveAttribute('aria-current', 'page');
  const bubble = bubbleOf(entry);
  expectRailBubble(bubble, title, sentence);
  expect(entry).toHaveAccessibleName(name);
  expect(bubble).not.toBeVisible();
  await userEvent.hover(entry);
  expect(bubble).toBeVisible();
  expect(entry).toHaveAccessibleName(name);
  expect(entry).toHaveAccessibleDescription(sentence);
  await userEvent.unhover(entry);
  expect(bubble).not.toBeVisible();
  while (document.activeElement !== entry) await userEvent.tab();
  expect(bubble).toBeVisible();
  await userEvent.keyboard('{Escape}');
  expect(bubble).not.toBeVisible();
});

test.each(SPACE_HINTS)('entrée %s inactive : même bulle au survol', async (_space, name, title, sentence) => {
  mockSession = session();
  wrap(null);
  const entry = screen.getByRole('link', { name });
  const bubble = bubbleOf(entry);
  expectRailBubble(bubble, title, sentence);
  await userEvent.hover(entry);
  expect(bubble).toBeVisible();
});

test('la marque n a pas de bulle', () => {
  mockSession = session();
  wrap('agents');
  expect(screen.getByRole('link', { name: 'WABAGENT' })).not.toHaveAttribute('aria-describedby');
});

// recette 3.11 : icône de l'entrée active en menthe clair, sur les quatre espaces ; les autres non
test.each<Space>(['organisation', 'agents', 'usage', 'account'])('entrée %s active : icône text-brand-mint, seule du rail', (space) => {
  mockSession = session();
  wrap(space);
  const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
  const entry = nav.querySelector(`[data-rail-entry="${space}"]`) as HTMLElement;
  expect(entry.querySelector('[data-rail-icon]')).toHaveClass('text-brand-mint');
  const mint = Array.from(nav.querySelectorAll('[data-rail-icon]')).filter((el) => el.classList.contains('text-brand-mint'));
  expect(mint).toHaveLength(1);
});

// relecture tâche 5, I-1
test.each(['Leads', 'Reprise', 'Aide'])('%s : au survol, bulle à contraste plein (aucun parent à opacité réduite)', async (word) => {
  mockSession = session();
  wrap('agents');
  const entry = screen.getByRole('link', { name: word });
  await userEvent.hover(entry);
  const bubble = document.getElementById(entry.getAttribute('aria-describedby') as string) as HTMLElement;
  expect(bubble).toBeVisible();
  // le mot reste grisé
  expect(within(entry).getByText(word).closest('[class*="opacity-"]')).not.toBeNull();
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

// entête 5 : cadre neutre d'une session illisible, sans aucune donnée de compte ni d'organisation
test('AppRailView sans compte : marque, Aide et Compte (icône, sans initiales ni adresse)', () => {
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AppRailView active={null} withOrg={false} isAdmin={false} account={null} />
    </NextIntlClientProvider>,
  );
  expect(words()).toEqual(['brand', 'help', 'account']);
  const account = screen.getByRole('link', { name: 'Compte' });
  expect(account).toHaveAttribute('href', '/account/organisations');
  expect(account.querySelector('svg')).not.toBeNull();
  expect(screen.queryByTestId('platform-badge-dot')).not.toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: 'Navigation principale' })).not.toHaveTextContent('@');
});
