import { describe, expect, it } from 'vitest';
import { makeClientFairQueue } from '../client-fairness.js';

/** Promesse contrôlable manuellement. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('ClientFairQueue', () => {
  it('au-delà de N, la requête suivante attend (pas de rejet)', async () => {
    const q = makeClientFairQueue(2);
    const order: string[] = [];
    const d1 = deferred<void>();
    const d2 = deferred<void>();
    const d3 = deferred<void>();

    const p1 = q.run('c1', async () => { order.push('start1'); await d1.promise; order.push('end1'); });
    const p2 = q.run('c1', async () => { order.push('start2'); await d2.promise; order.push('end2'); });
    const p3 = q.run('c1', async () => { order.push('start3'); await d3.promise; order.push('end3'); });

    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    // 2 en vol max : start1 + start2, PAS start3
    expect(order).toEqual(['start1', 'start2']);

    d1.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toContain('start3'); // une place libérée -> start3 démarre

    d2.resolve(); d3.resolve();
    await Promise.all([p1, p2, p3]);
    expect(order).toContain('end3');
  });

  it('clients distincts sont indépendants', async () => {
    const q = makeClientFairQueue(1);
    const order: string[] = [];
    const dA = deferred<void>();
    const dB = deferred<void>();

    const pA = q.run('A', async () => { order.push('A-start'); await dA.promise; });
    const pB = q.run('B', async () => { order.push('B-start'); await dB.promise; });

    await new Promise((r) => setTimeout(r, 0));
    // concurrence 1 PAR client : A et B démarrent tous les deux (limiters séparés)
    expect(order.sort()).toEqual(['A-start', 'B-start']);

    dA.resolve(); dB.resolve();
    await Promise.all([pA, pB]);
  });

  it('libère la place après complétion et propage le résultat', async () => {
    const q = makeClientFairQueue(1);
    expect(await q.run('c1', async () => 42)).toBe(42);
    expect(await q.run('c1', async () => 43)).toBe(43);
  });

  it('une erreur libère la place (pas de blocage)', async () => {
    const q = makeClientFairQueue(1);
    await expect(q.run('c1', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    // la place doit être libérée malgré l'erreur
    expect(await q.run('c1', async () => 'ok')).toBe('ok');
  });
});
