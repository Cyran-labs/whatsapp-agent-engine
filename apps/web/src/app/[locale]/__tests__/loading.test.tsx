import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import RootLoading from '../loading';
import AppLoading from '../(app)/loading';

const wrap = (node: React.ReactNode) =>
  render(<NextIntlClientProvider locale="fr" messages={messages}>{node}</NextIntlClientProvider>);

test('transition de route hors app : loader plein écran', () => {
  wrap(<RootLoading />);
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('Chargement…');
  expect(status.className).toContain('min-h-screen');
});

test('transition de route dans l\'app : loader centré dans la zone disponible', () => {
  wrap(<AppLoading />);
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('Chargement…');
  expect(status.className).toContain('flex-1');
  expect(status.className).not.toContain('min-h-screen');
});
