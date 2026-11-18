import { useCallback } from 'react';
import { useLocale, useTimeZone } from 'next-intl';

interface MediumDateOptions {
  locale: string;
  /** Fuseau de next-intl (`Europe/Paris` pour l'application) ; absent : celui du navigateur. */
  timeZone?: string | undefined;
  /** Ajoute l'heure (`timeStyle: 'short'`). */
  time?: boolean;
}

/**
 * Date en style moyen (« 2 déc. 2026 », « Dec 2, 2026 »), avec l'heure si demandé. En français, le premier jour du mois
 * s'écrit « 1er » (« 1er déc. 2026 ») ; `Intl` écrit « 1 déc. » (revue finale M-b). Les autres langues sont inchangées.
 */
export function formatMediumDate(date: Date, { locale, timeZone, time = false }: MediumDateOptions): string {
  const formatter = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    ...(time ? { timeStyle: 'short' as const } : {}),
    ...(timeZone !== undefined ? { timeZone } : {}),
  });
  if (new Intl.Locale(locale).language !== 'fr') return formatter.format(date);
  const parts = formatter.formatToParts(date);
  // `format` et `formatToParts` peuvent différer par leurs espaces (V8 remplace l'espace fine insécable dans `format`) :
  // les parties ne servent que pour le premier jour du mois.
  if (!parts.some((part) => part.type === 'day' && Number(part.value) === 1)) return formatter.format(date);
  return parts.map((part) => (part.type === 'day' && Number(part.value) === 1 ? '1er' : part.value)).join('');
}

/** `formatMediumDate` dans la langue et le fuseau de next-intl. */
export function useMediumDate(): (date: Date, opts?: { time?: boolean }) => string {
  const locale = useLocale();
  const timeZone = useTimeZone();
  return useCallback(
    (date: Date, opts: { time?: boolean } = {}) => formatMediumDate(date, { locale, timeZone, time: opts.time ?? false }),
    [locale, timeZone],
  );
}
