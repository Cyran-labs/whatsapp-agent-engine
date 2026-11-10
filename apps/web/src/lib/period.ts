const PARIS_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
const PARIS_TIME = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** Écart de l'heure de Paris sur l'UTC à l'instant `at`, en millisecondes (+1 h en hiver, +2 h en été). */
function parisOffsetMs(at: number): number {
  const part = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  const parts = PARIS_TIME.formatToParts(new Date(at));
  const asUtc = Date.UTC(part(parts, 'year'), part(parts, 'month') - 1, part(parts, 'day'), part(parts, 'hour'), part(parts, 'minute'), part(parts, 'second'));
  return asUtc - at;
}

/**
 * Début d'une période de `days` jours : l'instant ISO (UTC) du minuit de Paris du jour de début, par exemple
 * `2026-11-02T23:00:00.000Z` pour le 3 novembre (revue finale M-10). Le jour suit le calendrier de Paris comme le reste
 * de l'application : juste après minuit à Paris, c'est déjà le jour suivant, alors qu'il est encore la veille en UTC.
 * Le recul se fait sur le calendrier, pas en multiples de 24 h, pour ne jamais se décaler d'un jour au changement d'heure.
 * Le moteur compare cet instant comme un instant sur SQLite et sur Postgres (`UsageQuery`).
 */
export function periodStart(days: number, now: Date = new Date()): string {
  const [y, m, d] = PARIS_DAY.format(now).split('-').map(Number) as [number, number, number];
  const utcMidnight = Date.UTC(y, m - 1, d - days);
  // Le changement d'heure de Paris a lieu à 1 h UTC : à minuit UTC, l'écart est déjà celui du minuit de Paris de ce jour.
  return new Date(utcMidnight - parisOffsetMs(utcMidnight)).toISOString();
}
