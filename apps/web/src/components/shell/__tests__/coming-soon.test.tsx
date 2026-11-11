import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, test, expect, vi } from 'vitest';
import messages from '../../../../messages/fr.json';
import { ComingSoon, NewBadge, SoonBadge } from '../coming-soon';

function wrap(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      {node}
      <button type="button">après</button>
    </NextIntlClientProvider>,
  );
}

test('élément sans effet : aria-disabled, focalisable, jamais un lien, bulle reliée', () => {
  wrap(<ComingSoon tooltip="Disponible prochainement : la facturation.">Facturation</ComingSoon>);
  const entry = screen.getByText('Facturation').closest('[aria-disabled]') as HTMLElement;
  expect(entry).toHaveAttribute('aria-disabled', 'true');
  expect(entry).toHaveAttribute('tabindex', '0');
  expect(entry).toHaveAttribute('role', 'link');
  expect(entry).toHaveAccessibleName('Facturation');
  expect(entry.tagName).not.toBe('A');
  expect(entry).not.toHaveAttribute('href');
  const bubble = screen.getByRole('tooltip', { hidden: true });
  expect(entry).toHaveAttribute('aria-describedby', bubble.id);
  expect(entry).toHaveAccessibleDescription('Disponible prochainement : la facturation.');
  expect(screen.queryByText('Soon')).not.toBeInTheDocument();
});

test('bulle visible au survol et au focus, masquée ensuite et par Échap', async () => {
  wrap(<ComingSoon tooltip="Disponible prochainement : la facturation.">Facturation</ComingSoon>);
  const entry = screen.getByText('Facturation').closest('[aria-disabled]') as HTMLElement;
  const bubble = screen.getByRole('tooltip', { hidden: true });
  expect(bubble).not.toBeVisible();
  await userEvent.hover(entry);
  expect(bubble).toBeVisible();
  // la bulle n'entre pas dans le nom de l'élément
  expect(entry).toHaveAccessibleName('Facturation');
  expect(entry).not.toContainElement(bubble);
  await userEvent.unhover(entry);
  expect(bubble).not.toBeVisible();
  await userEvent.tab();
  expect(entry).toHaveFocus();
  expect(bubble).toBeVisible();
  await userEvent.keyboard('{Escape}');
  expect(bubble).not.toBeVisible();
  await userEvent.tab();
  expect(bubble).not.toBeVisible();
});

test('badge : pastille « Soon » ; SoonBadge et NewBadge en anglais', () => {
  wrap(
    <>
      <ComingSoon tooltip="Disponible prochainement : la facturation." badge>Facturation</ComingSoon>
      <SoonBadge />
      <NewBadge />
    </>,
  );
  expect(screen.getAllByText('Soon')).toHaveLength(2);
  expect(screen.getByText('New')).toBeInTheDocument();
});

// relecture tâche 5, M-6 : la colonne du milieu défile ; une bulle placée dans son flux y serait coupée en bas. La bulle
// est en position fixe, calculée depuis l'élément, et passe au-dessus quand la fenêtre n'a pas la place dessous.
const RECT = { x: 96, y: 420, left: 96, top: 420, right: 304, bottom: 460, width: 208, height: 40, toJSON: () => ({}) };

afterEach(() => {
  vi.restoreAllMocks();
});

function anchorAt(rect: Partial<DOMRect>, bubbleHeight: number, viewportHeight: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ ...RECT, ...rect } as DOMRect);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(bubbleHeight);
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(viewportHeight);
}

test('relecture tâche 5, M-6 : bulle « dessous » en position fixe, sous l\'élément, hors du défilement de la colonne', async () => {
  anchorAt({}, 44, 900);
  wrap(<ComingSoon tooltip="Disponible prochainement : la facturation." badge>Facturation</ComingSoon>);
  await userEvent.hover(screen.getByRole('link', { name: /Facturation/ }));
  const tip = screen.getByRole('tooltip');
  expect(tip).toHaveClass('fixed');
  expect(tip).not.toHaveClass('absolute');
  expect(tip.style.top).toBe('464px');
  expect(tip.style.left).toBe('96px');
});

test('relecture tâche 5, M-6 : pas la place sous l\'élément dans la fenêtre, la bulle passe au-dessus', async () => {
  anchorAt({}, 44, 470);
  wrap(<ComingSoon tooltip="Disponible prochainement : la facturation." badge>Facturation</ComingSoon>);
  await userEvent.hover(screen.getByRole('link', { name: /Facturation/ }));
  expect(screen.getByRole('tooltip').style.top).toBe('372px');
});

test('relecture tâche 5, M-6 : bulle « à droite » (rail) en position fixe, centrée sur l\'élément', async () => {
  anchorAt({ left: 8, right: 76, top: 300, bottom: 360, height: 60 }, 30, 900);
  wrap(<ComingSoon tooltip="Disponible prochainement : l'aide." placement="right">Aide</ComingSoon>);
  await userEvent.hover(screen.getByRole('link', { name: /Aide/ }));
  const tip = screen.getByRole('tooltip');
  expect(tip).toHaveClass('fixed');
  expect(tip.style.top).toBe('315px');
  expect(tip.style.left).toBe('84px');
});

test('relecture tâche 5, M-6 : un défilement (colonne ou page) ferme la bulle, qui ne flotte jamais loin de son élément', async () => {
  anchorAt({}, 44, 900);
  wrap(<ComingSoon tooltip="Disponible prochainement : la facturation." badge>Facturation</ComingSoon>);
  await userEvent.hover(screen.getByRole('link', { name: /Facturation/ }));
  expect(screen.getByRole('tooltip')).toBeVisible();
  act(() => {
    fireEvent.scroll(document.body);
  });
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});
