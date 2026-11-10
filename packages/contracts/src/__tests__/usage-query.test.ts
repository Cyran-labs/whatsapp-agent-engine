import { describe, expect, it } from 'vitest';
import { UsageQuery } from '../index.js';

// revue finale M-10 : début de période d'usage, instant ISO (minuit de Paris envoyé par le web) ou date seule
describe('UsageQuery.since', () => {
  it("garde un instant ISO en UTC canonique (minuit de Paris du 3 novembre)", () => {
    expect(UsageQuery.parse({ since: '2026-11-02T23:00:00.000Z' })).toEqual({ since: '2026-11-02T23:00:00.000Z' });
    expect(UsageQuery.parse({ since: '2026-11-03T00:00:00+01:00' })).toEqual({ since: '2026-11-02T23:00:00.000Z' });
    expect(UsageQuery.parse({ since: '2026-07-14T22:00Z' })).toEqual({ since: '2026-07-14T22:00:00.000Z' });
  });

  it("une date seule reste acceptée : minuit UTC de ce jour, comme avant", () => {
    expect(UsageQuery.parse({ since: '2026-11-03' })).toEqual({ since: '2026-11-03T00:00:00.000Z' });
  });

  it('absent ou vide : aucun début (le moteur prend ses 30 derniers jours)', () => {
    expect(UsageQuery.parse({})).toEqual({});
    expect(UsageQuery.parse({ since: '' })).toEqual({});
  });

  it.each([
    ['texte libre', 'hier'],
    ['date impossible', '2026-02-30'],
    ['instant sans fuseau (ambigu)', '2026-11-02T23:00:00'],
    ['mois hors bornes', '2026-13-01'],
    ['valeur répétée', ['2026-11-03', '2026-11-04']],
  ])('refuse %s', (_label, since) => {
    const parsed = UsageQuery.safeParse({ since });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['since']);
  });
});
