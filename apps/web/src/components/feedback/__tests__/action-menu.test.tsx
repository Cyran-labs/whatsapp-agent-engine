import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { expect, test, vi } from 'vitest';
import fr from '../../../../messages/fr.json';
import en from '../../../../messages/en.json';
import { ActionMenu, type ActionMenuItem } from '../action-menu';

function renderIntl(ui: React.ReactNode, locale: 'fr' | 'en' = 'fr') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? fr : en}>
      {ui}
    </NextIntlClientProvider>,
  );
}

type Override = { disabled: true; disabledReason: string };
type Base = { key: string; label: string; onSelect: () => void; danger?: boolean };

/** Élément actif, ou désactivé avec sa raison (l'union du type interdit un `disabled` sans raison). */
function item(base: Base, over?: Override): ActionMenuItem {
  return over ? { ...base, ...over } : base;
}

function items(over: Partial<Record<'rename' | 'move' | 'archive', Override>> = {}) {
  const rename = vi.fn();
  const move = vi.fn();
  const archive = vi.fn();
  const list: ActionMenuItem[] = [
    item({ key: 'rename', label: 'Renommer', onSelect: rename }, over.rename),
    item({ key: 'move', label: 'Déplacer', onSelect: move }, over.move),
    item({ key: 'archive', label: 'Archiver', onSelect: archive, danger: true }, over.archive),
  ];
  return { list, rename, move, archive };
}

// recette Q-7 : le menu d'actions est un bouton visible, libellé « Gérer », et non un « ⋯ » invisible.
test('bouton contour visible avec son libellé « Gérer » par défaut', () => {
  renderIntl(<ActionMenu items={items().list} />);
  const trigger = screen.getByRole('button', { name: 'Gérer' });
  expect(trigger).toBeVisible();
  expect(trigger).toHaveTextContent('Gérer');
  expect(trigger).toHaveTextContent('▾');
  expect(trigger).toHaveClass('border');
  expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

// recette Q-7
test('libellé fourni et objet nommé dans le nom accessible', () => {
  renderIntl(<ActionMenu label="Actions" subject="Boutique principale" items={items().list} />);
  const trigger = screen.getByRole('button', { name: 'Actions (Boutique principale)' });
  expect(trigger).toHaveTextContent('Actions');
});

test('libellé « Manage » en anglais', () => {
  renderIntl(<ActionMenu subject="Main store" items={items().list} />, 'en');
  expect(screen.getByRole('button', { name: 'Manage (Main store)' })).toBeInTheDocument();
});

// recette Q-7 : ouvert au clavier, flèches, Échap rend le focus au bouton.
test('clavier : Entrée ouvre, focus sur le premier élément, flèches, Échap ferme et rend le focus', async () => {
  const user = userEvent.setup();
  renderIntl(<ActionMenu subject="Nord" items={items().list} />);
  const trigger = screen.getByRole('button', { name: 'Gérer (Nord)' });
  trigger.focus();
  await user.keyboard('{Enter}');
  const menu = screen.getByRole('menu', { name: 'Gérer (Nord)' });
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const entries = within(menu).getAllByRole('menuitem');
  expect(entries.map((e) => e.textContent)).toEqual(['Renommer', 'Déplacer', 'Archiver']);
  expect(entries[0]).toHaveFocus();
  await user.keyboard('{ArrowDown}');
  expect(entries[1]).toHaveFocus();
  await user.keyboard('{ArrowUp}{ArrowUp}');
  expect(entries[2]).toHaveFocus();
  await user.keyboard('{Home}');
  expect(entries[0]).toHaveFocus();
  await user.keyboard('{End}');
  expect(entries[2]).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test('choisir un élément ferme le menu et lance son action', async () => {
  const user = userEvent.setup();
  const { list, move } = items();
  renderIntl(<ActionMenu items={list} />);
  await user.click(screen.getByRole('button', { name: 'Gérer' }));
  await user.click(screen.getByRole('menuitem', { name: 'Déplacer' }));
  expect(move).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

test('clic hors du menu : fermeture', async () => {
  const user = userEvent.setup();
  renderIntl(
    <>
      <ActionMenu items={items().list} />
      <p>Ailleurs</p>
    </>,
  );
  await user.click(screen.getByRole('button', { name: 'Gérer' }));
  expect(screen.getByRole('menu')).toBeInTheDocument();
  await user.click(screen.getByText('Ailleurs'));
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

// Motif des menus WAI-ARIA : un élément désactivé reste joignable au clavier, sinon sa raison n'est jamais lue.
test('élément désactivé : joignable par les flèches, sa raison visible est lue, le choisir ne fait rien', async () => {
  const user = userEvent.setup();
  const { list, move } = items({ move: { disabled: true, disabledReason: 'Aucun agent IA dans cette entité.' } });
  renderIntl(<ActionMenu items={list} />);
  await user.click(screen.getByRole('button', { name: 'Gérer' }));
  const rename = screen.getByRole('menuitem', { name: 'Renommer' });
  const disabled = screen.getByRole('menuitem', { name: 'Déplacer' });
  const archive = screen.getByRole('menuitem', { name: 'Archiver' });
  expect(disabled).toHaveAttribute('aria-disabled', 'true');
  expect(disabled).not.toHaveAttribute('disabled');
  expect(screen.getByText('Aucun agent IA dans cette entité.')).toBeVisible();
  expect(rename).toHaveFocus();
  await user.keyboard('{ArrowDown}');
  expect(disabled).toHaveFocus();
  expect(document.activeElement).toHaveAccessibleDescription('Aucun agent IA dans cette entité.');
  await user.keyboard('{Enter}');
  expect(move).not.toHaveBeenCalled();
  expect(screen.getByRole('menu')).toBeInTheDocument();
  await user.click(disabled);
  expect(move).not.toHaveBeenCalled();
  await user.keyboard('{ArrowDown}');
  expect(archive).toHaveFocus();
});

test('élément actif : ni aria-disabled ni description', async () => {
  const user = userEvent.setup();
  renderIntl(<ActionMenu items={items().list} />);
  await user.click(screen.getByRole('button', { name: 'Gérer' }));
  const rename = screen.getByRole('menuitem', { name: 'Renommer' });
  expect(rename).not.toHaveAttribute('aria-disabled');
  expect(rename).not.toHaveAttribute('aria-describedby');
});

test('élément lien : ouvert dans un nouvel onglet, menu fermé', async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  renderIntl(
    <ActionMenu items={[{ key: 'manager', label: 'Voir dans le gestionnaire WhatsApp ↗', href: 'https://business.facebook.com/wa/manage/home/?waba_id=1', onSelect }]} />,
  );
  await user.click(screen.getByRole('button', { name: 'Gérer' }));
  const link = screen.getByRole('menuitem', { name: 'Voir dans le gestionnaire WhatsApp ↗' });
  expect(link.tagName).toBe('A');
  expect(link).toHaveAttribute('href', 'https://business.facebook.com/wa/manage/home/?waba_id=1');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(link).toHaveFocus();
  link.addEventListener('click', (e) => e.preventDefault());
  await user.click(link);
  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

test('élément dangereux : jeton de couleur danger, aucune couleur en dur', async () => {
  const user = userEvent.setup();
  renderIntl(<ActionMenu items={items().list} />);
  await user.click(screen.getByRole('button', { name: 'Gérer' }));
  const archive = screen.getByRole('menuitem', { name: 'Archiver' });
  expect(archive).toHaveClass('text-danger');
  expect(archive.className).not.toMatch(/#/);
});

test('type : un élément désactivé sans raison est refusé par le compilateur', () => {
  // @ts-expect-error disabledReason obligatoire avec disabled: true
  const invalid: ActionMenuItem = { key: 'x', label: 'X', onSelect: () => undefined, disabled: true };
  expect(invalid.disabled).toBe(true);
});

test('le bouton est retrouvé par useReturnFocus (button[aria-haspopup="menu"])', () => {
  const { container } = renderIntl(<ActionMenu items={items().list} />);
  expect(container.querySelector('button[aria-haspopup="menu"]')).toBe(screen.getByRole('button', { name: 'Gérer' }));
});

// recette 10 nov. 2026 : le menu de la dernière ligne d'un tableau était rogné par `overflow-hidden` de la carte.
test('le menu est rendu hors du conteneur du bouton (portail), en position fixe', async () => {
  const user = userEvent.setup();
  const { container } = renderIntl(
    <div className="overflow-hidden">
      <ActionMenu subject="Nord" items={items().list} />
    </div>,
  );
  await user.click(screen.getByRole('button', { name: 'Gérer (Nord)' }));
  const menu = screen.getByRole('menu', { name: 'Gérer (Nord)' });
  expect(container).not.toContainElement(menu);
  expect(menu.parentElement).toBe(document.body);
  expect(menu).toHaveClass('fixed');
});

test('près du bas de la fenêtre : le menu s\'ouvre vers le haut', async () => {
  const user = userEvent.setup();
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
  const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.getAttribute('role') === 'menu') return { top: 0, bottom: 160, left: 0, right: 230, width: 230, height: 160, x: 0, y: 0, toJSON: () => ({}) };
    return { top: 540, bottom: 570, left: 800, right: 900, width: 100, height: 30, x: 800, y: 540, toJSON: () => ({}) };
  });
  try {
    renderIntl(<ActionMenu subject="Nord" items={items().list} />);
    await user.click(screen.getByRole('button', { name: 'Gérer (Nord)' }));
    const menu = screen.getByRole('menu');
    expect(menu.style.top).toBe(`${540 - 4 - 160}px`);
    expect(menu.style.left).toBe('670px');
  } finally {
    spy.mockRestore();
  }
});

test('un défilement de la page ferme le menu (il est en position fixe)', async () => {
  const user = userEvent.setup();
  renderIntl(<ActionMenu items={items().list} />);
  await user.click(screen.getByRole('button', { name: 'Gérer' }));
  expect(screen.getByRole('menu')).toBeInTheDocument();
  fireEvent.scroll(document.body);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

test('défiler dans le menu lui-même ne le ferme pas', async () => {
  const user = userEvent.setup();
  renderIntl(<ActionMenu items={items().list} />);
  await user.click(screen.getByRole('button', { name: 'Gérer' }));
  fireEvent.scroll(screen.getByRole('menu'));
  expect(screen.getByRole('menu')).toBeInTheDocument();
});
