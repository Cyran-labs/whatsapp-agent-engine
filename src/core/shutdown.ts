import type { InFlightTracker } from './in-flight.js';

export interface ShutdownDeps {
  /** Serveur HTTP : cesse d'accepter des connexions, puis coupe celles qui restent après l'attente. */
  server: { close(callback?: (err?: Error) => void): unknown; closeAllConnections(): void };
  tracker: InFlightTracker;
  stopMaintenance: () => void;
  closeDatabase: () => Promise<void>;
  timeoutMs: number;
  exit: (code: number) => void;
}

/**
 * Arrêt propre (audit 5.5) : fin de l'écoute, arrêt des purges, attente des traitements en cours
 * pendant `timeoutMs` (journal du nombre abandonné), fermeture de la base, sortie.
 * Le gestionnaire renvoyé n'agit qu'une fois : un second signal pendant l'attente ne relance rien.
 */
export function createShutdownHandler(deps: ShutdownDeps): (signal: string) => Promise<void> {
  let started: Promise<void> | null = null;

  async function run(signal: string): Promise<void> {
    const { server, tracker } = deps;
    console.log(`[Server] Arrêt demandé (${signal}) : ${tracker.size()} traitement(s) en cours`);
    server.close((err) => {
      if (err) console.error('[Server] Fermeture de l\'écoute:', err.message);
    });
    deps.stopMaintenance();
    const drained = await tracker.drain(deps.timeoutMs);
    if (drained) {
      console.log('[Server] Traitements en cours terminés');
    } else {
      console.warn(`[Server] Délai d'arrêt de ${deps.timeoutMs} ms dépassé : ${tracker.size()} traitement(s) abandonné(s)`);
    }
    server.closeAllConnections();
    let exitCode = 0;
    try {
      await deps.closeDatabase();
      console.log('[Server] Base fermée, arrêt');
    } catch (err) {
      console.error('[Server] Fermeture de la base:', err instanceof Error ? err.message : String(err));
      exitCode = 1;
    }
    deps.exit(exitCode);
  }

  return (signal: string): Promise<void> => {
    if (started) {
      console.warn(`[Server] Arrêt déjà en cours, ${signal} ignoré`);
      return started;
    }
    started = run(signal);
    return started;
  };
}
