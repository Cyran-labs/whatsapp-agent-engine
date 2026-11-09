/**
 * Planificateur de rafraîchissements d'inventaire déclenchés par les événements Meta (spec §7.4, point d'attention 3
 * du plan 2b-2) : au plus un rafraîchissement par compte et par intervalle, jamais deux en parallèle pour un même
 * compte. Une demande reçue pendant l'intervalle (ou pendant un rafraîchissement en cours) est reportée à la fin de
 * l'intervalle, une seule fois quel que soit le nombre de demandes : une rafale de 50 événements donne au plus deux
 * rafraîchissements.
 *
 * L'état est propre au processus (mémoire) et clé par organisation et compte. Le résultat du rafraîchissement est
 * jeté : le planificateur ne voit jamais le contenu de l'inventaire ni les agents IA mis en pause.
 */

export interface RefreshScheduler {
  schedule(clientId: string, accountId: number): void;
  /** Annule les reports en attente. Un rafraîchissement déjà lancé va à son terme. */
  stop(): void;
}

export const REFRESH_MIN_INTERVAL_MS = 60_000;

/** Planificateur sans effet, pour une application montée sans rafraîchissement automatique (tests). */
export const NO_REFRESH_SCHEDULER: RefreshScheduler = { schedule: () => undefined, stop: () => undefined };

const MAX_LOGGED_ERROR_CHARS = 200;

/** Message d'erreur journalisable : une ligne, 200 caractères au plus (le détail du fournisseur n'est pas conservé au-delà). */
function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-control-regex
  return message.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, MAX_LOGGED_ERROR_CHARS);
}

interface AccountState {
  running: boolean;
  /** Début du dernier rafraîchissement (ms), null si aucun. */
  lastStartAt: number | null;
  /** Une demande attend la fin de l'intervalle ou la fin du rafraîchissement en cours. */
  pending: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createRefreshScheduler(
  refresh: (clientId: string, accountId: number) => Promise<void>,
  minIntervalMs: number = REFRESH_MIN_INTERVAL_MS,
): RefreshScheduler {
  const states = new Map<string, AccountState>();
  let stopped = false;

  const armTimer = (key: string, state: AccountState, clientId: string, accountId: number): void => {
    const waitMs = Math.max(0, (state.lastStartAt ?? 0) + minIntervalMs - Date.now());
    state.timer = setTimeout(() => {
      state.timer = null;
      if (stopped || !state.pending || state.running) return;
      state.pending = false;
      void start(key, state, clientId, accountId);
    }, waitMs);
    // Un report en attente ne retient pas le processus.
    state.timer.unref?.();
  };

  const start = async (key: string, state: AccountState, clientId: string, accountId: number): Promise<void> => {
    state.running = true;
    state.lastStartAt = Date.now();
    try {
      await refresh(clientId, accountId);
    } catch (err) {
      console.error(`[RefreshScheduler] Rafraîchissement du compte ${accountId} en échec: ${describeError(err)}`);
    } finally {
      state.running = false;
    }
    if (!stopped && state.pending && state.timer === null) armTimer(key, state, clientId, accountId);
  };

  return {
    schedule(clientId: string, accountId: number): void {
      if (stopped) return;
      const key = `${clientId}/${accountId}`;
      let state = states.get(key);
      if (!state) {
        state = { running: false, lastStartAt: null, pending: false, timer: null };
        states.set(key, state);
      }
      if (state.pending) return;
      const recent = state.lastStartAt !== null && Date.now() - state.lastStartAt < minIntervalMs;
      if (state.running || recent) {
        state.pending = true;
        // En cours : le report est armé à la fin du rafraîchissement (voir `start`).
        if (!state.running) armTimer(key, state, clientId, accountId);
        return;
      }
      void start(key, state, clientId, accountId);
    },

    stop(): void {
      stopped = true;
      for (const state of states.values()) {
        if (state.timer !== null) clearTimeout(state.timer);
        state.timer = null;
        state.pending = false;
      }
    },
  };
}
