import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
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
