'use client';

import { useEffect, useRef } from 'react';

/** Intervalle minimal entre deux relectures au retour sur l'onglet : un va-et-vient rapide ne relit pas à chaque fois. */
export const REFRESH_MIN_INTERVAL_MS = 5000;

/**
 * Appelle `refresh` quand l'onglet redevient visible (un compte raccordé, un numéro pris ou un statut changé dans un
 * autre onglet : l'écran se relit au retour). Source unique de cet écouteur pour tous les écrans (revue finale 2b-3 m-2).
 * Deux retours séparés de moins de `minIntervalMs` ne donnent qu'une relecture ; le premier retour est toujours pris.
 * Le dernier `refresh` fourni est appelé : l'écouteur n'est posé qu'une fois.
 */
export function useRefreshOnVisible(refresh: () => void, { minIntervalMs = REFRESH_MIN_INTERVAL_MS }: { minIntervalMs?: number } = {}): void {
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });
  useEffect(() => {
    let last = Number.NEGATIVE_INFINITY;
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - last < minIntervalMs) return;
      last = now;
      latest.current();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [minIntervalMs]);
}
