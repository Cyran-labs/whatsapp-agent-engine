import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { vi, test, expect, beforeEach } from 'vitest';
import messages from '../../../../messages/fr.json';
import type { Session } from '@/components/providers/session-provider';
import type { OrganizationSummary } from '@/lib/organizations';
import { OrgBlock } from '../org-block';

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
    notice: null,
    dismissNotice: vi.fn(),
    refresh: vi.fn(),
    ...over,
  };
}

function ui() {
  return (
    <NextIntlClientProvider locale="fr" messages={messages}>
      <OrgBlock />
      <p>dehors</p>
    </NextIntlClientProvider>
  );
}

function wrap() {
  return render(ui());
}

/** Déclencheur du menu (le seul bouton qui porte aria-haspopup). */
function trigger(): HTMLElement {
  const el = document.querySelector('button[aria-haspopup]');
  if (!(el instanceof HTMLElement)) throw new Error('pas de déclencheur');
  return el;
}

beforeEach(() => {
  switchOrg.mockReset();
  switchOrg.mockResolvedValue({ ok: true });
});

// nav 15.2
test('membre d une seule organisation : en-tête fixe, ni flèche, ni menu, ni autre nom', () => {
  mockSession = session([ml]);
  wrap();
  expect(screen.getByText('Organisation')).toBeInTheDocument();
  expect(screen.getByText('Maison Lumière')).toBeInTheDocument();
  expect(screen.getByText('Admin')).toBeInTheDocument();
  // spec en-tête 2.3, C-16 : plus de monogramme dans le bloc
  expect(screen.queryByText('ML')).not.toBeInTheDocument();
  expect(document.querySelector('[data-org-block]')?.textContent).toBe('OrganisationMaison LumièreAdmin');
  expect(document.querySelector('button[aria-haspopup]')).toBeNull();
  expect(screen.queryByText('▾')).not.toBeInTheDocument();
  expect(screen.queryByText(/organisations/)).not.toBeInTheDocument();
});

// nav 15.2, prototype 2
test('membre de A et de B suspendue : flèche, sous-titre « Admin · 2 organisations », B grisée non ouvrable', async () => {
  mockSession = session([ml, so]);
  wrap();
  expect(screen.getByText('Admin · 2 organisations')).toBeInTheDocument();
  expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  expect(within(trigger()).getByText('▾')).toBeInTheDocument();
  expect(screen.queryByText('Studio Ocre')).not.toBeInTheDocument();
  await userEvent.click(trigger());
  const row = screen.getByRole('button', { name: /Studio Ocre/ });
  expect(row).toHaveAttribute('aria-disabled', 'true');
  expect(within(row).getByText('Suspendue')).toBeInTheDocument();
  expect(document.getElementById(row.getAttribute('aria-describedby') as string)).toHaveTextContent(
    'Ne peut pas être ouverte : contactez l\'administrateur de l\'organisation ou le support.',
  );
  await userEvent.click(row);
  expect(switchOrg).not.toHaveBeenCalled();
  expect(screen.getByText('Changer d\'organisation ramène à la liste des agents IA.')).toBeInTheDocument();
});

// recette 3.13, spec en-tête 3.13 (P26) : la phrase passe sous le nom, nom sur toute la largeur, jamais tronqué
test('organisation suspendue dans le menu : nom entier sur toute la largeur, pastille et phrase dessous', async () => {
  const long: OrganizationSummary = { ...so, name: 'Studio Ocre et Associés, Paris' };
  expect(long.name).toHaveLength(30);
  mockSession = session([ml, long]);
  wrap();
  await userEvent.click(trigger());
  const row = screen.getByRole('button', { name: /Studio Ocre et Associés, Paris/ });
  const name = within(row).getByText(long.name);
  expect(name.textContent).toBe(long.name);
  expect(name.className).not.toContain('truncate');
  expect(name.className).toContain('break-words');
  // une seule colonne, qui prend toute la largeur de la ligne : nom, puis rôle et pastille, puis la phrase
  const column = name.parentElement as HTMLElement;
  expect(column.className).toContain('flex-1');
  const pill = within(row).getByText('Suspendue');
  const hint = document.getElementById(row.getAttribute('aria-describedby') as string) as HTMLElement;
  expect(column.contains(pill)).toBe(true);
  expect(column.contains(hint)).toBe(true);
  expect(name.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(pill.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // rien à côté de la colonne qui la rétrécirait
  expect(Array.from(row.children)).toEqual([column]);
});

// recette 3.13 (C-15) : un refus pour suspension se lit dans le bandeau ; le menu se ferme, sans message en double
test('refus pour suspension : menu fermé, aucun message dans le menu', async () => {
  switchOrg.mockResolvedValueOnce({ ok: false, suspended: true });
  mockSession = session([ml, an]);
  wrap();
  await userEvent.click(trigger());
  await userEvent.click(screen.getByRole('button', { name: /Atelier Nord/ }));
  expect(switchOrg).toHaveBeenCalledWith('an');
  expect(screen.queryByRole('group', { name: 'Changer d\'organisation' })).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(trigger()).toHaveAttribute('aria-expanded', 'false');
});

test('le menu se déroule sous le bloc, dans la colonne', async () => {
  mockSession = session([ml, an]);
  wrap();
  await userEvent.click(trigger());
  const menu = screen.getByRole('group', { name: 'Changer d\'organisation' });
  expect(menu.className).toContain('top-full');
  expect(menu.className).toContain('left-0');
  expect(menu.className).toContain('right-0');
});

test('opérateur avec une seule organisation : flèche et « Admin implicite »', () => {
  mockSession = session([ml], { isPlatformAdmin: true, me: { id: 1, email: 'f@cyran.fr', role: 'super_admin', status: 'active', organizations: [ml] } });
  wrap();
  expect(screen.getByText('Admin implicite')).toBeInTheDocument();
  expect(trigger()).toBeInTheDocument();
});

test('sous-titre : rôle de l organisation active (lecture seule comprise)', () => {
  mockSession = session([gv, ml, an]);
  wrap();
  expect(screen.getByText('Super manager · lecture seule · 3 organisations')).toBeInTheDocument();
});

// point d'attention 3
test('nom de 80 caractères : tronqué sur une ligne, nom entier en title', () => {
  const long = { ...ml, name: 'A'.repeat(40) + ' ' + 'B'.repeat(39) };
  mockSession = session([long, an]);
  wrap();
  const name = screen.getByText(long.name);
  expect(name).toHaveAttribute('title', long.name);
  expect(name.className).toContain('truncate');
  // la chaîne qui le contient peut rétrécir sous la largeur de la colonne
  expect(name.parentElement?.className).toContain('min-w-0');
});

test('sans organisation active : rien', () => {
  mockSession = session([so], { isPlatformAdmin: true, activeOrg: null });
  const { container } = render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <OrgBlock />
    </NextIntlClientProvider>,
  );
  expect(container).toBeEmptyDOMElement();
});

test('menu : nom + rôle (lecture seule) et coche sur l active', async () => {
  mockSession = session([ml, an, gv]);
  wrap();
  await userEvent.click(trigger());
  const menu = screen.getByRole('group', { name: 'Changer d\'organisation' });
  const active = within(menu).getByRole('button', { name: /Maison Lumière Admin/ });
  expect(active).toHaveAttribute('aria-current', 'true');
  expect(within(active).getByTestId('org-check')).toBeInTheDocument();
  expect(within(menu).getByRole('button', { name: /Atelier Nord Conseiller/ })).not.toHaveAttribute('aria-current');
  expect(within(menu).getByText('Super manager · lecture seule')).toBeInTheDocument();
  // C-16 : les lignes du menu n'ont plus de monogramme, ni le bloc au-dessus
  for (const mono of ['ML', 'AN', 'GV']) expect(screen.queryByText(mono)).not.toBeInTheDocument();
  expect(active.textContent).toBe('Maison Lumière Admin');
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
  await userEvent.click(trigger());
  expect(screen.queryByPlaceholderText('Rechercher une organisation')).not.toBeInTheDocument();
});

test('recherche au-delà de 6 organisations, insensible à la casse et aux accents', async () => {
  mockSession = session(many(7));
  wrap();
  await userEvent.click(trigger());
  const search = screen.getByPlaceholderText('Rechercher une organisation');
  await userEvent.type(search, 'EPICERIE');
  expect(screen.getByRole('button', { name: /Épicerie Vauban/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Boutique 1/ })).not.toBeInTheDocument();
});

// repris d'org-switcher.test.tsx (supprimé avec le sélecteur de la barre sombre, amendement A-1)
test('Début et Fin restent dans le champ de recherche', async () => {
  mockSession = session(many(7));
  wrap();
  await userEvent.click(trigger());
  const search = screen.getByPlaceholderText('Rechercher une organisation');
  expect(search).toHaveFocus();
  await userEvent.type(search, 'bou');
  await userEvent.keyboard('{Home}');
  expect(search).toHaveFocus();
  await userEvent.keyboard('{End}');
  expect(search).toHaveFocus();
});

test('clic sur une autre organisation : switchOrg appelé, menu fermé', async () => {
  mockSession = session([ml, an]);
  wrap();
  await userEvent.click(trigger());
  await userEvent.click(screen.getByRole('button', { name: /Atelier Nord/ }));
  expect(switchOrg).toHaveBeenCalledWith('an');
  expect(screen.queryByRole('group', { name: 'Changer d\'organisation' })).not.toBeInTheDocument();
});

test('clic sur l organisation active : ferme le menu sans changer', async () => {
  mockSession = session([ml, an]);
  wrap();
  await userEvent.click(trigger());
  const menu = screen.getByRole('group', { name: 'Changer d\'organisation' });
  await userEvent.click(within(menu).getByRole('button', { name: /Maison Lumière Admin/ }));
  expect(switchOrg).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /Atelier Nord/ })).not.toBeInTheDocument();
});

test('Échap et clic extérieur ferment le menu', async () => {
  mockSession = session([ml, an]);
  wrap();
  await userEvent.click(trigger());
  expect(screen.getByRole('button', { name: /Atelier Nord/ })).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('button', { name: /Atelier Nord/ })).not.toBeInTheDocument();
  expect(trigger()).toHaveFocus();
  await userEvent.click(trigger());
  await userEvent.click(screen.getByText('dehors'));
  expect(screen.queryByRole('button', { name: /Atelier Nord/ })).not.toBeInTheDocument();
});

test('flèches, Début et Fin : naviguent entre les lignes', async () => {
  mockSession = session([ml, an, gv]);
  wrap();
  await userEvent.click(trigger());
  const menu = screen.getByRole('group', { name: 'Changer d\'organisation' });
  const first = within(menu).getByRole('button', { name: /Maison Lumière Admin/ });
  expect(first).toHaveFocus();
  await userEvent.keyboard('{ArrowDown}');
  expect(screen.getByRole('button', { name: /Atelier Nord/ })).toHaveFocus();
  await userEvent.keyboard('{End}');
  expect(screen.getByRole('button', { name: /Groupe Valmont/ })).toHaveFocus();
  await userEvent.keyboard('{Home}');
  expect(first).toHaveFocus();
});

// audit R-12
test('double clic : un seul appel à switchOrg tant que la réponse n\'est pas arrivée', async () => {
  let release: (value: { ok: true }) => void = () => undefined;
  switchOrg.mockReturnValue(new Promise((resolve) => { release = resolve; }));
  mockSession = session([ml, an]);
  wrap();
  await userEvent.click(trigger());
  const row = screen.getByRole('button', { name: /Atelier Nord/ });
  await userEvent.dblClick(row);
  expect(switchOrg).toHaveBeenCalledTimes(1);
  expect(row).toHaveAttribute('aria-busy', 'true');
  release({ ok: true });
});

// audit R-14 (tâche 16b)
test('panne serveur : la référence de la requête suit le message dans le menu', async () => {
  switchOrg.mockResolvedValueOnce({ ok: false, message: 'Impossible d\'ouvrir Atelier Nord : l\'opération a échoué, réessayez.', reference: 'req-org-switch' });
  mockSession = session([ml, an]);
  wrap();
  await userEvent.click(trigger());
  await userEvent.click(screen.getByRole('button', { name: /Atelier Nord/ }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Impossible d\'ouvrir Atelier Nord : l\'opération a échoué, réessayez.');
  expect(alert).toHaveTextContent('Référence : req-org-switch');
});

// audit R-12
test('refus : le message reste dans le menu ouvert, le menu reste utilisable ensuite', async () => {
  switchOrg.mockResolvedValueOnce({ ok: false, message: 'Impossible d\'ouvrir Atelier Nord : elle est suspendue.' });
  mockSession = session([ml, an, gv]);
  wrap();
  await userEvent.click(trigger());
  await userEvent.click(screen.getByRole('button', { name: /Atelier Nord/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Impossible d\'ouvrir Atelier Nord : elle est suspendue.');
  await userEvent.click(screen.getByRole('button', { name: /Groupe Valmont/ }));
  expect(switchOrg).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

// audit R-12
test('refus : le message est lu même si la session relue n a plus qu une organisation', async () => {
  switchOrg.mockResolvedValueOnce({ ok: false, message: 'Impossible d\'ouvrir Atelier Nord : vous n\'y avez plus accès.' });
  mockSession = session([ml, an]);
  const view = wrap();
  await userEvent.click(trigger());
  await userEvent.click(screen.getByRole('button', { name: /Atelier Nord/ }));
  mockSession = session([ml]);
  view.rerender(ui());
  expect(await screen.findByRole('alert')).toHaveTextContent('vous n\'y avez plus accès');
});

test('refus : fermer le menu efface le message', async () => {
  switchOrg.mockResolvedValueOnce({ ok: false, message: 'Impossible d\'ouvrir Atelier Nord : elle est suspendue.' });
  mockSession = session([ml, an]);
  wrap();
  await userEvent.click(trigger());
  await userEvent.click(screen.getByRole('button', { name: /Atelier Nord/ }));
  await screen.findByRole('alert');
  await userEvent.keyboard('{Escape}');
  await userEvent.click(trigger());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
