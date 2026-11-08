import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import { ThemeToggle } from '../theme-toggle';

let currentTheme = 'light';
const setTheme = vi.fn();
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: currentTheme, setTheme }) }));

beforeEach(() => {
  currentTheme = 'light';
  setTheme.mockReset();
});

function renderToggle() {
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <ThemeToggle />
    </NextIntlClientProvider>,
  );
}

test('thème clair : Clair coché', () => {
  renderToggle();
  expect(screen.getByRole('radiogroup', { name: 'Thème' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Clair' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('radio', { name: 'Sombre' })).toHaveAttribute('aria-checked', 'false');
});

test('thème sombre : Sombre coché', () => {
  currentTheme = 'dark';
  renderToggle();
  expect(screen.getByRole('radio', { name: 'Sombre' })).toHaveAttribute('aria-checked', 'true');
});

test('bascule light → dark puis dark → light', async () => {
  renderToggle();
  await userEvent.click(screen.getByRole('radio', { name: 'Sombre' }));
  expect(setTheme).toHaveBeenCalledWith('dark');
  await userEvent.click(screen.getByRole('radio', { name: 'Clair' }));
  expect(setTheme).toHaveBeenCalledWith('light');
});
