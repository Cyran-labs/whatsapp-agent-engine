'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { MutationFailure } from '@/lib/api-fetch';
import { describeFailure, type DescribedFailure } from '@/lib/describe-failure';

/** Lecture d'un refus par un écran : son texte contextuel en `fallback`, ses champs affichés en `fields`. */
export type DescribeScreenFailure = (failure: MutationFailure, fallback: string, fields?: readonly string[]) => DescribedFailure;

/**
 * `describeFailure` lié à la langue et au traducteur de la racine de l'écran, pour les écrans qui gardent le refus brut
 * (`failure.details`, `failure.reason`, `failure.status`) à côté de sa lecture : contrôles d'une vérification, numéro
 * changé, entrées refusées d'une liste. Les clés de contrôle d'une vérification ne sont jamais des `fields` (la clé
 * `app_secret` est aussi un champ du formulaire).
 */
export function useDescribeFailure(): DescribeScreenFailure {
  const t = useTranslations();
  const locale = useLocale() as 'fr' | 'en';
  return (failure, fallback, fields) =>
    describeFailure(failure, {
      fallback,
      locale,
      t: (key) => t(key),
      has: (key) => t.has(key),
      ...(fields ? { fields } : {}),
    });
}
