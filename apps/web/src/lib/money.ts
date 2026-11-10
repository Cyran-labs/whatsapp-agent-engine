/**
 * Montants et nombres affichés par le back-office. Anthropic facture en dollars : le montant exact est toujours
 * en dollars, et un équivalent en euros s'y ajoute seulement si la plateforme a fixé un taux (recette Q-2).
 * Ce module est importé par des composants client : il ne lit jamais `process.env` hors de `readUsdEurRate`,
 * que seules les routes du BFF appellent.
 */

export type MoneyLocale = 'fr' | 'en';

export interface UsdEurRate {
  rate: number;
  /** Date ISO (AAAA-MM-JJ) à laquelle la plateforme a relevé le taux. */
  date: string;
}

const NUMBER_LOCALES: Record<MoneyLocale, string> = { fr: 'fr-FR', en: 'en-US' };
const NBSP = '\u00a0';
const RATE_PATTERN = /^\d+(\.\d+)?$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Taux dollar vers euro fixé par la plateforme (`USD_EUR_RATE`, `USD_EUR_RATE_DATE`). Nombre fini strictement
 * positif avec point décimal et date ISO existante, sinon null : l'écran n'affiche alors que les dollars.
 */
export function readUsdEurRate(env: NodeJS.ProcessEnv): UsdEurRate | null {
  const rawRate = env.USD_EUR_RATE?.trim();
  const rawDate = env.USD_EUR_RATE_DATE?.trim();
  if (!rawRate || !rawDate || !RATE_PATTERN.test(rawRate)) return null;
  const rate = Number(rawRate);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const m = DATE_PATTERN.exec(rawDate);
  if (!m) return null;
  const parsed = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (parsed.toISOString().slice(0, 10) !== rawDate) return null;
  return { rate, date: rawDate };
}

/** Défense de l'affichage : un taux reçu qui n'est pas un nombre fini strictement positif est ignoré (jamais « NaN »). */
export function usableRate(value: UsdEurRate | null | undefined): UsdEurRate | null {
  if (!value || typeof value.rate !== 'number' || !Number.isFinite(value.rate) || value.rate <= 0) return null;
  if (typeof value.date !== 'string' || !DATE_PATTERN.test(value.date)) return null;
  return value;
}

function decimals(locale: MoneyLocale): Intl.NumberFormat {
  return new Intl.NumberFormat(NUMBER_LOCALES[locale], { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Positif mais plus petit que ce que deux décimales savent montrer : afficher « 0,00 » le ferait passer pour nul. */
function belowCent(amount: number): boolean {
  return amount > 0 && amount < 0.005;
}

/**
 * `1.234` donne « 1,23 $ » en français et « $1.23 » en anglais. Un coût strictement positif sous 0,005 donne
 * « < 0,01 $ » (« < $0.01 ») ; seul un zéro exact reste « 0,00 $ ».
 */
export function formatUsd(amount: number, locale: MoneyLocale): string {
  if (belowCent(amount)) return locale === 'fr' ? `<${NBSP}0,01${NBSP}$` : `<${NBSP}$0.01`;
  const n = decimals(locale).format(amount);
  return locale === 'fr' ? `${n}${NBSP}$` : `$${n}`;
}

/** Équivalent indicatif en euros : « ≈ 1,14 € » en français, « ≈ €1.14 » en anglais, « < 0,01 € » sous le demi-centime. */
export function formatEurApprox(amountUsd: number, rate: number, locale: MoneyLocale): string {
  const eur = amountUsd * rate;
  if (belowCent(eur)) return locale === 'fr' ? `<${NBSP}0,01${NBSP}€` : `<${NBSP}€0.01`;
  const n = decimals(locale).format(eur);
  return locale === 'fr' ? `≈${NBSP}${n}${NBSP}€` : `≈${NBSP}€${n}`;
}

/** Entier de la langue (tokens, appels, messages) : espace fine insécable des milliers en français. */
export function formatInteger(n: number, locale: MoneyLocale): string {
  return new Intl.NumberFormat(NUMBER_LOCALES[locale], { maximumFractionDigits: 0 }).format(n);
}

/** Taux affiché dans la note (jusqu'à 4 décimales). */
export function formatRate(rate: number, locale: MoneyLocale): string {
  return new Intl.NumberFormat(NUMBER_LOCALES[locale], { maximumFractionDigits: 4 }).format(rate);
}

/** Date ISO (AAAA-MM-JJ) du taux, lue en UTC pour ne jamais changer de jour selon le fuseau. */
export function formatRateDate(isoDate: string, locale: MoneyLocale): string {
  return new Intl.DateTimeFormat(NUMBER_LOCALES[locale], { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${isoDate}T00:00:00Z`));
}
