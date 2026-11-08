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

test('CSS : taille 1,25 px, couleurs en jetons de la charte', () => {
  expect(css).toMatch(/--size:\s*1\.25px/);
  expect(css).toMatch(/--liquid:\s*var\(--accent\)/);
  expect(css).not.toMatch(/#fff\b|#00FFA3|rgba\(255/i);
});

test('CSS : contour --brand-deep en clair (au moins 1,5 px), --brand-mint en sombre', () => {
  const [light, dark] = css.split(':global(.dark)');
  expect(light).toMatch(/--contour:\s*var\(--brand-deep\)/);
  expect(dark).toMatch(/--contour:\s*var\(--brand-mint\)/);
  expect(css).toMatch(/--stroke:\s*1\.5px/);
  expect(css).toMatch(/border:\s*var\(--stroke\) solid var\(--contour\)/);
});

test('CSS : bulles en --accent-ink, opacités du modèle (0, 50 %, 40 %)', () => {
  expect(css).toMatch(/--bubble-0:\s*color-mix\(in srgb, var\(--bubble\) 0%, transparent\)/);
  expect(css).toMatch(/--bubble-50:\s*color-mix\(in srgb, var\(--bubble\) 50%, transparent\)/);
  expect(css).toMatch(/--bubble-40:\s*color-mix\(in srgb, var\(--bubble\) 40%, transparent\)/);
  expect(css).toMatch(/--bubble:\s*var\(--accent-ink\)/);
});

test('CSS : mouvement réduit, animation arrêtée, éprouvette à moitié remplie', () => {
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  expect(reduced.length).toBeGreaterThan(0);
  expect(reduced).toMatch(/animation:\s*none/);
  expect(reduced).toMatch(/background-position:\s*0 calc\(40 \* var\(--size\)\)/);
});
