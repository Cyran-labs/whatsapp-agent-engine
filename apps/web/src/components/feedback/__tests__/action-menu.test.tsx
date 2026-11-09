import { render, screen, within } from '@testing-library/react';
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

function items(over: Partial<Record<'rename' | 'move' | 'archive', Partial<ActionMenuItem>>> = {}) {
  const rename = vi.fn();
  const move = vi.fn();
  const archive = vi.fn();
  const list: ActionMenuItem[] = [
    { key: 'rename', label: 'Renommer', onSelect: rename, ...over.rename },
    { key: 'move', label: 'Déplacer', onSelect: move, ...over.move },
    { key: 'archive', label: 'Archiver', onSelect: archive, danger: true, ...over.archive },
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

test('élément désactivé : sa raison est visible et le décrit, il est sauté par les flèches et sans effet', async () => {
  const user = userEvent.setup();
  const { list, move } = items({ move: { disabled: true, disabledReason: 'Aucun agent IA dans cette entité.' } });
  renderIntl(<ActionMenu items={list} />);
  await user.click(screen.getByRole('button', { name: 'Gérer' }));
  const disabled = screen.getByRole('menuitem', { name: 'Déplacer' });
  expect(disabled).toBeDisabled();
  expect(screen.getByText('Aucun agent IA dans cette entité.')).toBeVisible();
  expect(disabled).toHaveAccessibleDescription('Aucun agent IA dans cette entité.');
  const rename = screen.getByRole('menuitem', { name: 'Renommer' });
  const archive = screen.getByRole('menuitem', { name: 'Archiver' });
  expect(rename).toHaveFocus();
  await user.keyboard('{ArrowDown}');
  expect(archive).toHaveFocus();
  await user.click(disabled);
  expect(move).not.toHaveBeenCalled();
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

test('le bouton est retrouvé par useReturnFocus (button[aria-haspopup="menu"])', () => {
  const { container } = renderIntl(<ActionMenu items={items().list} />);
  expect(container.querySelector('button[aria-haspopup="menu"]')).toBe(screen.getByRole('button', { name: 'Gérer' }));
});
