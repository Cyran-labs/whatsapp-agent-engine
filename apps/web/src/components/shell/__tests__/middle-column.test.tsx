import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { vi, test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import type { Session } from '@/components/providers/session-provider';
import type { OrganizationSummary } from '@/lib/organizations';
import { STATUS_STYLE, MENTION_STYLE } from '@/components/agents/status-style';
import { MiddleColumn, type ColumnGroup } from '../middle-column';

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

mockSession = {
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

const groups: ColumnGroup[] = [
  {
    items: [
      { key: 'all', label: 'Tous les agents IA', href: '/', count: 7 },
      { key: 'brand', label: 'Marque et connaissances', href: null, tooltip: 'Disponible prochainement : la marque.' },
    ],
  },
  {
    label: 'Par entité',
    tag: 'Entité',
    items: [{ key: 'entity-1', label: 'Boutique Lyon', href: '/?entity=1', countLoading: true }],
  },
  {
    label: 'Statut',
    items: [
      { key: 'status-active', label: 'Online', href: '/?status=active', dot: 'active', count: 2 },
      { key: 'status-draft', label: 'Draft', href: '/?status=draft', dot: 'draft', count: 1 },
      { key: 'not-responding', label: 'Ne répond pas', href: '/?status=not_responding', dot: 'danger', count: 3 },
      { key: 'connexions', label: 'Connexions', href: '/organisation/connexions', alert: '1 en erreur', count: 4 },
      { key: 'numbers', label: 'Numéros WhatsApp de l\'organisation', href: '/organisation/connexions', external: 'Connexions' },
    ],
  },
];

function wrap(props: Partial<React.ComponentProps<typeof MiddleColumn>> = {}) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <MiddleColumn kicker="Agents IA" groups={groups} activeKey="all" {...props} />
    </NextIntlClientProvider>,
  );
}

test('commence par le bloc Organisation', () => {
  const { container } = wrap();
  expect(screen.getByText('Maison Lumière')).toBeInTheDocument();
  const aside = container.querySelector('aside') as HTMLElement;
  expect(aside.firstElementChild).toHaveTextContent('Organisation');
  expect(aside.firstElementChild).toHaveTextContent('Maison Lumière');
});

test('withOrg={false} (pages du compte) : pas de bloc Organisation', () => {
  wrap({ withOrg: false, kicker: 'Mon compte', title: 'claire@x.fr' });
  expect(screen.queryByText('Maison Lumière')).not.toBeInTheDocument();
  expect(screen.getByText('Mon compte')).toBeInTheDocument();
  expect(screen.getByText('claire@x.fr')).toBeInTheDocument();
});

test('entrée active : aria-current, les autres non', () => {
  wrap({ activeKey: 'status-active' });
  expect(screen.getByRole('link', { name: /Online/ })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: /Tous les agents IA/ })).not.toHaveAttribute('aria-current');
});

test('entrée Soon : pas un lien, pastille « Soon », bulle au focus', async () => {
  wrap();
  const entry = screen.getByText('Marque et connaissances').closest('[aria-disabled]') as HTMLElement;
  expect(entry).toHaveAttribute('aria-disabled', 'true');
  expect(entry.closest('a')).toBeNull();
  expect(entry).toHaveTextContent('Soon');
  expect(screen.queryByText('à venir')).not.toBeInTheDocument();
  const bubble = screen.getByRole('tooltip', { hidden: true });
  expect(bubble).toHaveTextContent('Disponible prochainement : la marque.');
  expect(bubble).not.toBeVisible();
  while (document.activeElement !== entry) await userEvent.tab();
  expect(bubble).toBeVisible();
});

test('points de statut et point danger tirés de STATUS_STYLE et MENTION_STYLE', () => {
  wrap();
  const online = screen.getByRole('link', { name: /Online/ }).querySelector('[data-dot]') as HTMLElement;
  expect(online.className).toContain(STATUS_STYLE.active.dot);
  const draft = screen.getByRole('link', { name: /Draft/ }).querySelector('[data-dot]') as HTMLElement;
  expect(draft.className).toContain(STATUS_STYLE.draft.dot);
  const danger = screen.getByRole('link', { name: /Ne répond pas/ }).querySelector('[data-dot]') as HTMLElement;
  expect(danger.className).toContain(MENTION_STYLE.dot);
  expect(screen.getByRole('link', { name: /Ne répond pas/ })).toHaveTextContent('3');
});

test('alert : texte rouge à droite à la place du compteur', () => {
  wrap();
  const alert = screen.getByText('1 en erreur');
  const link = alert.closest('a') as HTMLElement;
  expect(link).toHaveAttribute('href', '/organisation/connexions');
  expect(link).toHaveTextContent('Connexions');
  expect(alert.className).toContain('text-danger-ink');
  expect(link).not.toHaveTextContent('4');
});

test('étiquette de groupe « Entité »', () => {
  wrap();
  const tag = screen.getByText('Entité');
  expect(tag.parentElement).toHaveTextContent('Par entitéEntité');
});

test('lien qui change d espace : « ↗ » et l espace de destination après le libellé (A-7)', () => {
  wrap();
  const link = screen.getByRole('link', { name: /Numéros WhatsApp/ });
  expect(link).toHaveTextContent('Numéros WhatsApp de l\'organisation↗ Connexions');
});

test('compteur en chargement : squelette à la place du nombre', () => {
  wrap();
  const link = screen.getByRole('link', { name: /Boutique Lyon/ });
  expect(link.querySelector('[data-skeleton]')).not.toBeNull();
  expect(link.textContent).toBe('Boutique Lyon');
});

test('pied de colonne (par exemple « Se déconnecter »)', () => {
  wrap({ footer: <button type="button">Se déconnecter</button> });
  expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeInTheDocument();
});
