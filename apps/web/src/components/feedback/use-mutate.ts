'use client';

import { useLocale, useTranslations } from 'next-intl';
import { describeFailure, type DescribedFailure } from '@/lib/describe-failure';
import { sendMutation } from '@/lib/api-fetch';

/**
 * Issue d'une mutation vue par un écran : réussie (réponse), refusée (refus lu par `describeFailure`, avec le statut et
 * la clé du refus quand l'écran en tire une règle), ou `changed` (409 ORG_CHANGED : apiFetch recharge la page, l'écran
 * n'affiche rien).
 */
export type MutateOutcome =
  | { status: 'ok'; res: Response }
  | { status: 'changed' }
  | { status: 'refused'; failure: DescribedFailure; httpStatus: number; reason: string | null };

export type Mutate = (
  url: string,
  method: string,
  body?: unknown,
  fields?: readonly string[],
) => Promise<MutateOutcome>;

/**
 * Envoi d'une mutation d'administration lue avec `describeFailure` (audit §5.4). Le texte contextuel d'une panne
 * serveur ou réseau est `errors.generic.server`. `service` préfixe le journal de `sendMutation`.
 */
export function useMutate(service: string): Mutate {
  const t = useTranslations();
  const locale = useLocale() as 'fr' | 'en';
  return async (url, method, body, fields) => {
    const fallback = t('errors.generic.server');
    const result = await sendMutation(url, method, body, fallback, service);
    if ('res' in result) return { status: 'ok', res: result.res };
    if (result.orgChanged) return { status: 'changed' };
    const failure = describeFailure(result, {
      fallback,
      locale,
      t: (key) => t(key),
      has: (key) => t.has(key),
      ...(fields ? { fields } : {}),
    });
    return { status: 'refused', failure, httpStatus: result.status, reason: result.reason };
  };
}
