/**
 * Suivi des traitements en cours, pour l'arrêt propre (audit 5.5) : le serveur cesse d'écouter,
 * puis attend la fin des traitements suivis pendant un délai maximal.
 */
export interface InFlightTracker {
  /** Suit la promesse jusqu'à son règlement et la renvoie telle quelle. */
  track<T>(p: Promise<T>): Promise<T>;
  /** Attend la fin de tous les traitements suivis, y compris ceux ajoutés pendant l'attente ; `true` si tout s'est terminé à temps. */
  drain(timeoutMs: number): Promise<boolean>;
  /** Nombre de traitements en cours. */
  size(): number;
}

export function createInFlightTracker(): InFlightTracker {
  const pending = new Set<Promise<void>>();

  return {
    track<T>(p: Promise<T>): Promise<T> {
      const settled = p.then(() => undefined, () => undefined);
      pending.add(settled);
      void settled.then(() => { pending.delete(settled); });
      return p;
    },

    async drain(timeoutMs: number): Promise<boolean> {
      if (pending.size === 0) return true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), Math.max(0, timeoutMs));
      });
      try {
        while (pending.size > 0) {
          const outcome = await Promise.race([Promise.all([...pending]).then(() => 'done' as const), timedOut]);
          if (outcome === 'timeout') return false;
          // Un règlement retire la promesse du suivi au tour suivant : on laisse ce tour se faire.
          await Promise.resolve();
        }
        return true;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },

    size(): number {
      return pending.size;
    },
  };
}
