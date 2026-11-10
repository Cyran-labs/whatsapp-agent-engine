import { test, expect } from 'vitest';
import { formatEurApprox, formatInteger, formatRate, formatRateDate, formatUsd, readUsdEurRate, usableRate } from '../money';

const NBSP = '\u00a0';
const env = (vars: Record<string, string>): NodeJS.ProcessEnv => vars as NodeJS.ProcessEnv;

// recette Q-2
test('formatUsd : virgule et « $ » en français, point et « $ » devant en anglais', () => {
  expect(formatUsd(1.234, 'fr')).toBe(`1,23${NBSP}$`);
  expect(formatUsd(1.234, 'en')).toBe('$1.23');
  expect(formatUsd(0, 'fr')).toBe(`0,00${NBSP}$`);
  expect(formatUsd(1234.5, 'en')).toBe('$1,234.50');
});

test('formatUsd : milliers séparés par une espace fine insécable en français', () => {
  expect(formatUsd(1234.5, 'fr')).toBe(`1\u202f234,50${NBSP}$`);
});

// recette Q-2
test('formatEurApprox : « ≈ » devant, euro après le montant en français, devant en anglais', () => {
  expect(formatEurApprox(1.234, 0.92, 'fr')).toBe(`≈${NBSP}1,14${NBSP}€`);
  expect(formatEurApprox(1.234, 0.92, 'en')).toBe(`≈${NBSP}€1.14`);
});

test('formatInteger : séparateur de milliers de la langue', () => {
  expect(formatInteger(184000, 'fr')).toBe('184\u202f000');
  expect(formatInteger(184000, 'en')).toBe('184,000');
  expect(formatInteger(312, 'fr')).toBe('312');
});

test('formatRate et formatRateDate : taux et date dans la langue', () => {
  expect(formatRate(0.92, 'fr')).toBe('0,92');
  expect(formatRate(0.92, 'en')).toBe('0.92');
  expect(formatRateDate('2026-11-09', 'fr')).toBe('9 novembre 2026');
  expect(formatRateDate('2026-11-09', 'en')).toBe('November 9, 2026');
});

// recette Q-2 (point d'attention 4 du plan : taux absent, 0, négatif, illisible)
test('readUsdEurRate : taux et date valides', () => {
  expect(readUsdEurRate(env({ USD_EUR_RATE: '0.92', USD_EUR_RATE_DATE: '2026-11-09' }))).toEqual({ rate: 0.92, date: '2026-11-09' });
});

test.each([
  ['absent', {}],
  ['date absente', { USD_EUR_RATE: '0.92' }],
  ['taux absent', { USD_EUR_RATE_DATE: '2026-11-09' }],
  ['taux 0', { USD_EUR_RATE: '0', USD_EUR_RATE_DATE: '2026-11-09' }],
  ['taux négatif', { USD_EUR_RATE: '-1', USD_EUR_RATE_DATE: '2026-11-09' }],
  ['taux illisible', { USD_EUR_RATE: 'abc', USD_EUR_RATE_DATE: '2026-11-09' }],
  ['taux vide', { USD_EUR_RATE: '', USD_EUR_RATE_DATE: '2026-11-09' }],
  ['taux infini', { USD_EUR_RATE: 'Infinity', USD_EUR_RATE_DATE: '2026-11-09' }],
  ['taux en notation hexadécimale', { USD_EUR_RATE: '0x10', USD_EUR_RATE_DATE: '2026-11-09' }],
  ['date illisible', { USD_EUR_RATE: '0.92', USD_EUR_RATE_DATE: 'hier' }],
  ['date impossible', { USD_EUR_RATE: '0.92', USD_EUR_RATE_DATE: '2026-13-45' }],
  ['date vide', { USD_EUR_RATE: '0.92', USD_EUR_RATE_DATE: '' }],
])('readUsdEurRate : %s donne null', (_name, vars) => {
  expect(readUsdEurRate(env(vars))).toBeNull();
});

test('readUsdEurRate : espaces autour du taux et de la date ignorés', () => {
  expect(readUsdEurRate(env({ USD_EUR_RATE: ' 0.9 ', USD_EUR_RATE_DATE: ' 2026-11-09 ' }))).toEqual({ rate: 0.9, date: '2026-11-09' });
});

// recette Q-2 : l'affichage ignore aussi un taux reçu illisible
test('usableRate : taux fini strictement positif et date ISO, sinon null', () => {
  expect(usableRate({ rate: 0.92, date: '2026-11-09' })).toEqual({ rate: 0.92, date: '2026-11-09' });
  expect(usableRate(null)).toBeNull();
  expect(usableRate(undefined)).toBeNull();
  for (const rate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(usableRate({ rate, date: '2026-11-09' })).toBeNull();
  expect(usableRate({ rate: 0.92, date: 'hier' })).toBeNull();
});
