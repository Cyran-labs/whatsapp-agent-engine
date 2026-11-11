import { test, expect } from 'vitest';
import { lastParisDays, periodStart } from '../period';

// 2026-11-09 23:30 UTC = 10 novembre 00 h 30 à Paris (UTC+1)
const JUST_AFTER_PARIS_MIDNIGHT = new Date('2026-11-09T23:30:00.000Z');

// revue finale 2b-3, fuseau ; revue finale M-10 : l'instant envoyé est le minuit de Paris, pas le minuit UTC
test('juste après minuit à Paris (encore la veille en UTC) : la période commence au minuit de Paris du jour de Paris', () => {
  expect(periodStart(7, JUST_AFTER_PARIS_MIDNIGHT)).toBe('2026-11-02T23:00:00.000Z');
  expect(periodStart(30, JUST_AFTER_PARIS_MIDNIGHT)).toBe('2026-10-10T22:00:00.000Z');
  expect(periodStart(90, JUST_AFTER_PARIS_MIDNIGHT)).toBe('2026-08-11T22:00:00.000Z');
});

test('en été (UTC+2), 22 h 30 UTC est déjà le lendemain à Paris : minuit de Paris à 22 h UTC la veille', () => {
  expect(periodStart(7, new Date('2026-07-14T22:30:00.000Z'))).toBe('2026-07-07T22:00:00.000Z');
});

test('avant minuit à Paris : le jour de Paris est celui de l\'UTC', () => {
  expect(periodStart(7, new Date('2026-11-09T22:30:00.000Z'))).toBe('2026-11-01T23:00:00.000Z');
});

test('le recul traverse un changement d\'heure sans se décaler d\'un jour ni d\'une heure', () => {
  // 2026-10-25 : passage à l'heure d'hiver. Minuit passé à Paris le 26 octobre ; le 26 septembre était en heure d'été.
  expect(periodStart(30, new Date('2026-10-25T23:30:00.000Z'))).toBe('2026-09-25T22:00:00.000Z');
  // Jour même du changement d'heure : le 25 octobre commence encore en heure d'été (minuit = 22 h UTC la veille).
  expect(periodStart(1, new Date('2026-10-26T10:00:00.000Z'))).toBe('2026-10-24T22:00:00.000Z');
  // 29 mars 2026 : passage à l'heure d'été à 2 h ; ce jour commence en heure d'hiver (minuit = 23 h UTC la veille).
  expect(periodStart(1, new Date('2026-03-30T10:00:00.000Z'))).toBe('2026-03-28T23:00:00.000Z');
});

// revue finale M-10 : à cheval sur minuit de Paris, l'instant suit le calendrier de Paris, à la minute près
test('à cheval sur minuit de Paris : une minute avant et une minute après donnent deux débuts distants d\'un jour', () => {
  expect(periodStart(7, new Date('2026-11-09T22:59:00.000Z'))).toBe('2026-11-01T23:00:00.000Z');
  expect(periodStart(7, new Date('2026-11-09T23:01:00.000Z'))).toBe('2026-11-02T23:00:00.000Z');
});

// relecture tâche 9, I-1 : les jours du graphique de coût suivent le calendrier de Paris
test('lastParisDays : 7 jours de Paris finissant aujourd\'hui, du plus ancien au plus récent', () => {
  expect(lastParisDays(7, JUST_AFTER_PARIS_MIDNIGHT)).toEqual(['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10']);
});

test('lastParisDays : traverse le changement d\'heure sans sauter ni doubler un jour', () => {
  expect(lastParisDays(3, new Date('2026-10-26T12:00:00.000Z'))).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
});
