const PARIS_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * Jour de début d'une période de `days` jours (AAAA-MM-JJ), selon le calendrier de Paris comme le reste de l'application :
 * juste après minuit à Paris, c'est déjà le jour suivant, alors qu'il est encore la veille en UTC. Le recul se fait sur
 * le calendrier, pas en multiples de 24 h, pour ne jamais se décaler d'un jour au changement d'heure.
 */
export function periodStart(days: number, now: Date = new Date()): string {
  const [y, m, d] = PARIS_DAY.format(now).split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}
