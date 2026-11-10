const ENGINE_DATE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/;

/**
 * Lit une date renvoyée par le moteur. SQLite renvoie « 2026-11-09 20:09:02 » (UTC, sans fuseau), Postgres
 * « 2026-11-09 20:09:02.123456+00 », les autres champs de l'ISO 8601. Sans fuseau, la date est en UTC : `new Date()` la
 * lirait dans le fuseau du navigateur. Texte vide, nul ou qui n'est pas une date : `null`.
 */
export function parseEngineDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = ENGINE_DATE.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '00', fraction = '', zone = 'Z'] = m;
  let offset = 'Z';
  if (zone !== 'Z') {
    const digits = zone.slice(1).replace(':', '');
    offset = `${zone[0]}${digits.slice(0, 2)}:${digits.slice(2) || '00'}`;
  }
  const millis = fraction.slice(0, 3).padEnd(3, '0');
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}.${millis}${offset}`);
  return Number.isNaN(date.getTime()) ? null : date;
}
