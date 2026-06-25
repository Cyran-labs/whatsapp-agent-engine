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

test('bascule fr → en sur le même chemin', async () => {
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <LocaleSwitch />
    </NextIntlClientProvider>,
  );
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Langue' }), 'en');
  expect(replace).toHaveBeenCalledWith('/agents', { locale: 'en' });
});
