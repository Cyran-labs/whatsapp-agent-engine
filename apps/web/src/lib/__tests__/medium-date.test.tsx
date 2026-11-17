import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import { formatMediumDate, useMediumDate } from '../medium-date';

// Revue finale M-b (PO-2) : en français, le premier jour du mois s'écrit « 1er » (« 1er déc. 2026 »), jamais « 1 déc. ».
const PARIS = 'Europe/Paris';

test('français : « 1er » pour le premier jour du mois, date seule et avec l\'heure', () => {
  expect(formatMediumDate(new Date('2026-12-01T10:00:00.000Z'), { locale: 'fr', timeZone: PARIS })).toBe('1er déc. 2026');
  expect(formatMediumDate(new Date('2026-12-01T10:00:00.000Z'), { locale: 'fr', timeZone: PARIS, time: true })).toBe('1er déc. 2026, 11:00');
});

test('français : les autres jours sont inchangés (2, 11, 21, 31)', () => {
  for (const [iso, text] of [
    ['2026-12-02T10:00:00.000Z', '2 déc. 2026'],
    ['2026-12-11T10:00:00.000Z', '11 déc. 2026'],
    ['2026-12-21T10:00:00.000Z', '21 déc. 2026'],
    ['2026-12-31T10:00:00.000Z', '31 déc. 2026'],
  ] as const) {
    expect(formatMediumDate(new Date(iso), { locale: 'fr', timeZone: PARIS })).toBe(text);
  }
});

test('français : le premier jour se lit dans le fuseau demandé', () => {
  // 30 nov. à 23 h 30 UTC : déjà le 1er déc. à Paris.
  expect(formatMediumDate(new Date('2026-11-30T23:30:00.000Z'), { locale: 'fr', timeZone: PARIS })).toBe('1er déc. 2026');
});

test('anglais : inchangé, même pour le premier jour', () => {
  expect(formatMediumDate(new Date('2026-12-01T10:00:00.000Z'), { locale: 'en', timeZone: PARIS })).toBe('Dec 1, 2026');
  expect(formatMediumDate(new Date('2026-12-01T10:00:00.000Z'), { locale: 'en', timeZone: PARIS, time: true })).toBe(
    new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: PARIS }).format(new Date('2026-12-01T10:00:00.000Z')),
  );
});

function Probe({ iso }: { iso: string }) {
  const date = useMediumDate();
  return <p>{date(new Date(iso))}</p>;
}

test('crochet : langue et fuseau de next-intl', () => {
  render(
    <NextIntlClientProvider locale="fr" messages={{}} timeZone={PARIS}>
      <Probe iso="2026-11-30T23:30:00.000Z" />
    </NextIntlClientProvider>,
  );
  expect(screen.getByText('1er déc. 2026')).toBeInTheDocument();
});
