import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import fr from '../../../../messages/fr.json';
import en from '../../../../messages/en.json';
import { PageLoader } from '../page-loader';

const css = readFileSync(join(__dirname, '../page-loader.module.css'), 'utf8');

test.each([
  ['fr', fr, 'Chargement…'],
  ['en', en, 'Loading…'],
] as const)('%s : role="status" et libellé masqué', (locale, messages, label) => {
  render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <PageLoader />
    </NextIntlClientProvider>,
  );
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent(label);
  expect(screen.getByText(label)).toHaveClass('sr-only');
});

test('plein écran : occupe la hauteur de la fenêtre, fond de page, centré', () => {
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <PageLoader fullScreen />
    </NextIntlClientProvider>,
  );
  const status = screen.getByRole('status');
  expect(status.className).toContain('min-h-screen');
  expect(status.className).toContain('bg-bg');
  expect(status.className).toContain('items-center');
  expect(status.className).toContain('justify-center');
});

test('CSS : deux pastilles de 48 px, couleurs en jetons de la charte, aucune couleur codée en dur', () => {
  expect(css).toMatch(/--size:\s*1px/);
  expect(css).toMatch(/width:\s*calc\(48 \* var\(--size\)\)/);
  expect(css).toMatch(/--color-1:\s*var\(--loader-1\)/);
  expect(css).toMatch(/--color-2:\s*var\(--loader-2\)/);
  expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
});

test('jetons du loader : couleurs choisies par François, #1C3814 et #6EE7B7', () => {
  const globals = readFileSync(join(__dirname, '../../../app/globals.css'), 'utf8');
  expect(globals).toMatch(/--loader-1:\s*#1C3814/);
  expect(globals).toMatch(/--loader-2:\s*#6EE7B7/);
});

test('CSS : rotation et pulsation, arrêtées en mouvement réduit', () => {
  expect(css).toMatch(/animation:\s*rotation 1s linear infinite/);
  expect(css).toMatch(/animation:\s*animloader 1s infinite ease-in-out/);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  expect(reduced).toMatch(/animation:\s*none/);
});
