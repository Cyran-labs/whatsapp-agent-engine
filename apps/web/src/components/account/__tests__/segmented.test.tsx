import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect } from 'vitest';
import { Segmented } from '../segmented';

const options = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
];

test('groupe radio : option courante cochée, les autres non', () => {
  render(<Segmented options={options} value="fr" onChange={vi.fn()} ariaLabel="Langue" />);
  expect(screen.getByRole('radiogroup', { name: 'Langue' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Français' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'false');
});

test('clic sur une autre option : onChange avec sa valeur', async () => {
  const onChange = vi.fn();
  render(<Segmented options={options} value="fr" onChange={onChange} ariaLabel="Langue" />);
  await userEvent.click(screen.getByRole('radio', { name: 'English' }));
  expect(onChange).toHaveBeenCalledWith('en');
});

test('flèche droite depuis l\'option courante : sélectionne la suivante', async () => {
  const onChange = vi.fn();
  render(<Segmented options={options} value="fr" onChange={onChange} ariaLabel="Langue" />);
  screen.getByRole('radio', { name: 'Français' }).focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(onChange).toHaveBeenCalledWith('en');
});
