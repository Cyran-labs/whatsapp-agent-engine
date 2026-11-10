import { test, expect } from 'vitest';
import { periodStart } from '../period';

// 2026-11-09 23:30 UTC = 10 novembre 00 h 30 à Paris (UTC+1)
const JUST_AFTER_PARIS_MIDNIGHT = new Date('2026-11-09T23:30:00.000Z');

// revue finale 2b-3, fuseau
test('juste après minuit à Paris (encore la veille en UTC) : la période se compte depuis le jour de Paris', () => {
  expect(periodStart(7, JUST_AFTER_PARIS_MIDNIGHT)).toBe('2026-11-03');
  expect(periodStart(30, JUST_AFTER_PARIS_MIDNIGHT)).toBe('2026-10-11');
  expect(periodStart(90, JUST_AFTER_PARIS_MIDNIGHT)).toBe('2026-08-12');
});

test('en été (UTC+2), 22 h 30 UTC est déjà le lendemain à Paris', () => {
  expect(periodStart(7, new Date('2026-07-14T22:30:00.000Z'))).toBe('2026-07-08');
});

test('avant minuit à Paris : le jour de Paris est celui de l\'UTC', () => {
  expect(periodStart(7, new Date('2026-11-09T22:30:00.000Z'))).toBe('2026-11-02');
});

test('le recul traverse un changement d\'heure sans se décaler d\'un jour', () => {
  // 2026-10-25 : passage à l'heure d'hiver. Minuit passé à Paris le 26 octobre.
  expect(periodStart(30, new Date('2026-10-25T23:30:00.000Z'))).toBe('2026-09-26');
});
