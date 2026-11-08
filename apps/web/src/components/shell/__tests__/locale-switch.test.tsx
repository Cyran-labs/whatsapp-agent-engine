import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import { LocaleSwitch } from '../locale-switch';

const replace = vi.fn();
vi.mock('@/i18n/routing', () => ({
  usePathname: () => '/agents',
  useRouter: () => ({ replace }),
  routing: { locales: ['fr', 'en'], defaultLocale: 'fr' },
}));

beforeEach(() => replace.mockReset());

function renderSwitch() {
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <LocaleSwitch />
    </NextIntlClientProvider>,
  );
}

test('deux positions, la langue courante est cochée', () => {
  renderSwitch();
  expect(screen.getByRole('radiogroup', { name: "Langue de l'interface" })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Français' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'false');
});

test('bascule fr → en sur le même chemin', async () => {
  renderSwitch();
  await userEvent.click(screen.getByRole('radio', { name: 'English' }));
  expect(replace).toHaveBeenCalledWith('/agents', { locale: 'en' });
});
