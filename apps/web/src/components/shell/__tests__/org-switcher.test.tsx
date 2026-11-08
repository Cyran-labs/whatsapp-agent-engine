import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { vi, test, expect, beforeEach } from 'vitest';
import messages from '../../../../messages/fr.json';
import type { Session } from '@/components/providers/session-provider';
import type { OrganizationSummary } from '@/lib/organizations';
import { OrgSwitcher } from '../org-switcher';

let mockSession: Session;
vi.mock('@/components/providers/session-provider', () => ({
  useSession: () => mockSession,
}));

const ml: OrganizationSummary = { client_id: 'ml', name: 'Maison Lumière', role: 'admin', read_only: false };
const an: OrganizationSummary = { client_id: 'an', name: 'Atelier Nord', role: 'advisor', read_only: false };
const gv: OrganizationSummary = { client_id: 'gv', name: 'Groupe Valmont', role: 'super_manager', read_only: true };
const so: OrganizationSummary = { client_id: 'so', name: 'Studio Ocre', role: 'admin', read_only: false, status: 'suspended' };

const switchOrg = vi.fn();

function session(orgs: OrganizationSummary[], over: Partial<Session> = {}): Session {
  return {
    me: { id: 1, email: 'claire@x.fr', role: 'user', status: 'active', organizations: orgs },
    activeOrg: orgs[0] ?? null,
    isPlatformAdmin: false,
    isAdmin: true,
    readOnly: false,
    switchOrg,
    refresh: vi.fn(),
    ...over,
  };
}

function wrap() {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <OrgSwitcher />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  switchOrg.mockReset();
  switchOrg.mockResolvedValue(undefined);
});

test('absent avec une seule organisation (membre)', () => {
  mockSession = session([ml]);
  const { container } = wrap();
  expect(container).toBeEmptyDOMElement();
});

test('présent avec deux organisations', () => {
  mockSession = session([ml, an]);
  wrap();
  const btn = screen.getByRole('button', { name: /Maison Lumière/ });
  expect(btn).toHaveTextContent('ML');
  expect(btn).toHaveAttribute('aria-expanded', 'false');
});

test('toujours présent pour le super admin, même avec une seule organisation', () => {
  mockSession = session([ml], { isPlatformAdmin: true });
  wrap();
  expect(screen.getByRole('button', { name: /Maison Lumière/ })).toBeInTheDocument();
});

test('absent sans organisation active', () => {
  mockSession = session([so], { isPlatformAdmin: true, activeOrg: null });
  const { container } = wrap();
  expect(container).toBeEmptyDOMElement();
});

test('menu : nom + rôle (lecture seule) et coche sur l active', async () => {
  mockSession = session([ml, an, gv]);
  wrap();
  await userEvent.click(screen.getByRole('button', { name: /Maison Lumière/ }));
  const active = screen.getByRole('button', { name: /Maison Lumière Admin/ });
  expect(active).toHaveAttribute('aria-current', 'true');
  expect(within(active).getByTestId('org-check')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Atelier Nord Conseiller/ })).not.toHaveAttribute('aria-current');
  expect(screen.getByText('Super manager · lecture seule')).toBeInTheDocument();
  expect(screen.queryByPlaceholderText('Rechercher une organisation')).not.toBeInTheDocument();
});

function many(n: number): OrganizationSummary[] {
  return Array.from({ length: n }, (_, i) => ({
    client_id: `c${i}`,
    name: i === 3 ? 'Épicerie Vauban' : `Boutique ${i}`,
    role: 'manager' as const,
    read_only: false,
  }));
}

test('pas de recherche à 6 organisations', async () => {
  mockSession = session(many(6));
  wrap();
  await userEvent.click(screen.getByRole('button', { name: /Boutique 0/ }));
  expect(screen.queryByPlaceholderText('Rechercher une organisation')).not.toBeInTheDocument();
});

test('recherche au-delà de 6 organisations, insensible à la casse et aux accents', async () => {
  mockSession = session(many(7));
  wrap();
  await userEvent.click(screen.getByRole('button', { name: /Boutique 0/ }));
  const search = screen.getByPlaceholderText('Rechercher une organisation');
  await userEvent.type(search, 'EPICERIE');
  expect(screen.getByRole('button', { name: /Épicerie Vauban/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Boutique 1/ })).not.toBeInTheDocument();
});

test('ligne suspendue (super admin) : non cliquable, avec « Suspendue »', async () => {
  mockSession = session([ml, so], { isPlatformAdmin: true });
  wrap();
  await userEvent.click(screen.getByRole('button', { name: /Maison Lumière/ }));
  const row = screen.getByRole('button', { name: /Studio Ocre/ });
  expect(row).toHaveAttribute('aria-disabled', 'true');
  expect(within(row).getByText('Suspendue')).toBeInTheDocument();
  await userEvent.click(row);
  expect(switchOrg).not.toHaveBeenCalled();
});

test('clic sur une autre organisation : switchOrg appelé', async () => {
  mockSession = session([ml, an]);
  wrap();
  await userEvent.click(screen.getByRole('button', { name: /Maison Lumière/ }));
  await userEvent.click(screen.getByRole('button', { name: /Atelier Nord/ }));
  expect(switchOrg).toHaveBeenCalledWith('an');
});

test('clic sur l organisation active : ferme le menu sans changer', async () => {
  mockSession = session([ml, an]);
  wrap();
  await userEvent.click(screen.getByRole('button', { name: /Maison Lumière/ }));
  await userEvent.click(screen.getByRole('button', { name: /Maison Lumière Admin/ }));
  expect(switchOrg).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /Atelier Nord/ })).not.toBeInTheDocument();
});

test('Échap et clic extérieur ferment le menu', async () => {
  mockSession = session([ml, an]);
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <OrgSwitcher />
      <p>dehors</p>
    </NextIntlClientProvider>,
  );
  const trigger = screen.getByRole('button', { name: /Maison Lumière/ });
  await userEvent.click(trigger);
  expect(screen.getByRole('button', { name: /Atelier Nord/ })).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('button', { name: /Atelier Nord/ })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  await userEvent.click(trigger);
  await userEvent.click(screen.getByText('dehors'));
  expect(screen.queryByRole('button', { name: /Atelier Nord/ })).not.toBeInTheDocument();
});

test('flèches : naviguent entre les lignes', async () => {
  mockSession = session([ml, an, gv]);
  wrap();
  await userEvent.click(screen.getByRole('button', { name: /Maison Lumière/ }));
  expect(screen.getByRole('button', { name: /Maison Lumière Admin/ })).toHaveFocus();
  await userEvent.keyboard('{ArrowDown}');
  expect(screen.getByRole('button', { name: /Atelier Nord/ })).toHaveFocus();
  await userEvent.keyboard('{ArrowUp}');
  expect(screen.getByRole('button', { name: /Maison Lumière Admin/ })).toHaveFocus();
});
