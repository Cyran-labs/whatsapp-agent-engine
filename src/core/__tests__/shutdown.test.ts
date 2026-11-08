import { describe, expect, it, vi } from 'vitest';
import { createInFlightTracker } from '../in-flight.js';
import { createShutdownHandler } from '../shutdown.js';
import type { ShutdownDeps } from '../shutdown.js';

function deps(overrides: Partial<ShutdownDeps> = {}): ShutdownDeps & { order: string[] } {
  const order: string[] = [];
  return {
    order,
    server: {
      close: vi.fn(() => { order.push('close'); }),
      closeAllConnections: vi.fn(() => { order.push('closeAllConnections'); }),
    },
    tracker: createInFlightTracker(),
    stopMaintenance: vi.fn(async () => { order.push('stopMaintenance'); }),
    closeDatabase: vi.fn(async () => { order.push('closeDatabase'); }),
    timeoutMs: 50,
    exit: vi.fn((code: number) => { order.push(`exit ${code}`); }),
    ...overrides,
  };
}

describe('createShutdownHandler', () => {
  // audit 5.5
  it("cesse d'écouter, arrête les purges, attend les traitements, ferme la base puis sort", async () => {
    const d = deps();
    let finished = false;
    void d.tracker.track(new Promise<void>((resolve) => setTimeout(() => { finished = true; d.order.push('traitement fini'); resolve(); }, 10)));
    await createShutdownHandler(d)('SIGTERM');
    expect(finished).toBe(true);
    expect(d.order).toEqual(['close', 'stopMaintenance', 'traitement fini', 'closeAllConnections', 'closeDatabase', 'exit 0']);
  });

  // audit 5.5
  it('délai dépassé : journal du nombre de traitements abandonnés, puis sortie', async () => {
    const d = deps({ timeoutMs: 20 });
    void d.tracker.track(new Promise<void>(() => undefined));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await createShutdownHandler(d)('SIGINT');
    expect(warn.mock.calls.some((args) => String(args[0]).includes('1 traitement(s) abandonné(s)'))).toBe(true);
    expect(d.exit).toHaveBeenCalledWith(0);
    warn.mockRestore();
  });

  // audit 5.5
  it("un second signal pendant l'attente ne relance pas l'arrêt", async () => {
    const d = deps();
    let release!: () => void;
    void d.tracker.track(new Promise<void>((resolve) => { release = resolve; }));
    const shutdown = createShutdownHandler(d);
    const first = shutdown('SIGTERM');
    const second = shutdown('SIGINT');
    release();
    await Promise.all([first, second]);
    expect(d.server.close).toHaveBeenCalledTimes(1);
    expect(d.stopMaintenance).toHaveBeenCalledTimes(1);
    expect(d.closeDatabase).toHaveBeenCalledTimes(1);
    expect(d.exit).toHaveBeenCalledTimes(1);
  });

  // audit 5.5
  it("fermeture de la base bloquée par un traitement abandonné : sortie forcée en erreur après le délai", async () => {
    vi.useFakeTimers();
    try {
      const d = deps({ timeoutMs: 1000, closeDatabase: vi.fn(() => new Promise<void>(() => undefined)) });
      void d.tracker.track(new Promise<void>(() => undefined));
      const quiet = (['warn', 'error', 'log'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
      void createShutdownHandler(d)('SIGTERM');
      await vi.advanceTimersByTimeAsync(1000);
      expect(d.closeDatabase).toHaveBeenCalledTimes(1);
      expect(d.exit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(999);
      expect(d.exit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(d.exit).toHaveBeenCalledTimes(1);
      expect(d.exit).toHaveBeenCalledWith(1);
      for (const q of quiet) q.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  // audit 6.6
  it('la base est fermée après la fin de la purge en cours', async () => {
    let finishPurge!: () => void;
    const d = deps();
    d.stopMaintenance = vi.fn(() => new Promise<void>((resolve) => {
      finishPurge = () => { d.order.push('purge finie'); resolve(); };
    }));
    const done = createShutdownHandler(d)('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(d.closeDatabase).not.toHaveBeenCalled();
    finishPurge();
    await done;
    expect(d.order.indexOf('purge finie')).toBeLessThan(d.order.indexOf('closeDatabase'));
    expect(d.exit).toHaveBeenCalledWith(0);
  });

  it('échec de fermeture de la base : sortie en erreur', async () => {
    const d = deps({ closeDatabase: vi.fn(async () => { throw new Error('base occupée'); }) });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await createShutdownHandler(d)('SIGTERM');
    expect(d.exit).toHaveBeenCalledWith(1);
    error.mockRestore();
  });
});
