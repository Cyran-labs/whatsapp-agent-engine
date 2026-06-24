import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import { ThemeToggle } from '../theme-toggle';

const setTheme = vi.fn();
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme }) }));

beforeEach(() => setTheme.mockReset());

test('bascule light → dark', async () => {
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <ThemeToggle />
    </NextIntlClientProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Changer de thème' }));
  expect(setTheme).toHaveBeenCalledWith('dark');
});
