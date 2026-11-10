import { expect, test } from 'vitest';
import { parseEngineDate } from '../engine-date';

// recette 10 nov. 2026 : le moteur SQLite renvoie « 2026-11-09 20:09:02 », en UTC, sans fuseau.
test('une date sans fuseau est lue en UTC, quel que soit le fuseau de la machine', () => {
  expect(parseEngineDate('2026-11-09 20:09:02')?.toISOString()).toBe('2026-11-09T20:09:02.000Z');
});

test('ISO avec Z ou décalage : lue telle quelle', () => {
  expect(parseEngineDate('2026-11-09T20:09:02.000Z')?.toISOString()).toBe('2026-11-09T20:09:02.000Z');
  expect(parseEngineDate('2026-11-09T21:09:02+01:00')?.toISOString()).toBe('2026-11-09T20:09:02.000Z');
});

test('forme texte de Postgres (« +00 », microsecondes) : lue', () => {
  expect(parseEngineDate('2026-11-09 20:09:02.123456+00')?.toISOString()).toBe('2026-11-09T20:09:02.123Z');
  expect(parseEngineDate('2026-11-09 21:09:02+01')?.toISOString()).toBe('2026-11-09T20:09:02.000Z');
});

test('texte qui n\'est pas une date, vide ou nul : null', () => {
  expect(parseEngineDate('2 min')).toBeNull();
  expect(parseEngineDate('')).toBeNull();
  expect(parseEngineDate(null)).toBeNull();
  expect(parseEngineDate('2026-13-45 99:99:99')).toBeNull();
});
