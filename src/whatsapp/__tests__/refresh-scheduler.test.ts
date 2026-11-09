import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRefreshScheduler } from '../refresh-scheduler.js';

const MINUTE = 60_000;

describe('createRefreshScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('première demande : rafraîchissement immédiat', () => {
    const refresh = vi.fn(async () => undefined);
    createRefreshScheduler(refresh).schedule('acme', 1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('acme', 1);
  });

  // point d'attention 3 (plan 2b-2)
  it('50 demandes en une minute : un rafraîchissement immédiat puis un seul reporté, jamais en parallèle', async () => {
    let active = 0;
    let maxActive = 0;
    const refresh = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 100));
      active -= 1;
    });
    const scheduler = createRefreshScheduler(refresh);
    for (let i = 0; i < 50; i += 1) {
      scheduler.schedule('acme', 1);
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
  });

  it('un rafraîchissement plus long que l\'intervalle : le report attend sa fin, jamais en parallèle', async () => {
    let active = 0;
    let maxActive = 0;
    const refresh = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 3 * MINUTE));
      active -= 1;
    });
    const scheduler = createRefreshScheduler(refresh);
    scheduler.schedule('acme', 1);
    await vi.advanceTimersByTimeAsync(10_000);
    scheduler.schedule('acme', 1);
    scheduler.schedule('acme', 1);
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
  });

  it('après l\'intervalle sans demande en attente : nouveau rafraîchissement immédiat', async () => {
    const refresh = vi.fn(async () => undefined);
    const scheduler = createRefreshScheduler(refresh);
    scheduler.schedule('acme', 1);
    await vi.advanceTimersByTimeAsync(MINUTE + 1);
    scheduler.schedule('acme', 1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('un compte ne retarde pas un autre (clé par organisation et compte)', () => {
    const refresh = vi.fn(async () => undefined);
    const scheduler = createRefreshScheduler(refresh);
    scheduler.schedule('acme', 1);
    scheduler.schedule('acme', 2);
    scheduler.schedule('beta', 1);
    expect(refresh.mock.calls).toEqual([['acme', 1], ['acme', 2], ['beta', 1]]);
  });

  it('stop() annule les reports', async () => {
    const refresh = vi.fn(async () => undefined);
    const scheduler = createRefreshScheduler(refresh);
    scheduler.schedule('acme', 1);
    scheduler.schedule('acme', 1);
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    scheduler.schedule('acme', 2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('stop() pendant un rafraîchissement en cours : aucun report armé à sa fin', async () => {
    const refresh = vi.fn(async () => { await new Promise((resolve) => setTimeout(resolve, 1_000)); });
    const scheduler = createRefreshScheduler(refresh);
    scheduler.schedule('acme', 1);
    scheduler.schedule('acme', 1);
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('erreur de refresh : journalisée sur 200 caractères, une ligne, le planificateur continue', async () => {
    const refresh = vi.fn()
      .mockRejectedValueOnce(new Error(`détail fournisseur\n${'x'.repeat(500)}`))
      .mockResolvedValue(undefined);
    const scheduler = createRefreshScheduler(refresh);
    scheduler.schedule('acme', 1);
    await vi.advanceTimersByTimeAsync(0);
    const lines = vi.mocked(console.error).mock.calls.map((args) => args.map(String).join(' '));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[RefreshScheduler]');
    expect(lines[0]).not.toContain('\n');
    expect(lines[0]?.length).toBeLessThan(300);
    scheduler.schedule('acme', 1);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
