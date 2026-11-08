import { describe, expect, it } from 'vitest';
import { createInFlightTracker } from '../in-flight.js';

describe('createInFlightTracker', () => {
  // audit 5.5
  it('drain renvoie true quand les traitements suivis se terminent avant le délai', async () => {
    const tracker = createInFlightTracker();
    const p = tracker.track(new Promise<number>((resolve) => setTimeout(() => resolve(7), 10)));
    expect(tracker.size()).toBe(1);
    expect(await tracker.drain(50)).toBe(true);
    expect(await p).toBe(7);
    expect(tracker.size()).toBe(0);
  });

  // audit 5.5
  it('drain renvoie false quand un traitement dépasse le délai', async () => {
    const tracker = createInFlightTracker();
    let release!: () => void;
    void tracker.track(new Promise<void>((resolve) => { release = resolve; }));
    expect(await tracker.drain(50)).toBe(false);
    expect(tracker.size()).toBe(1);
    release();
    expect(await tracker.drain(50)).toBe(true);
  });

  it("un traitement qui échoue est retiré du suivi et son erreur reste visible pour l'appelant", async () => {
    const tracker = createInFlightTracker();
    const p = tracker.track(Promise.reject(new Error('échec')));
    await expect(p).rejects.toThrow('échec');
    expect(await tracker.drain(50)).toBe(true);
    expect(tracker.size()).toBe(0);
  });

  it('attend aussi un traitement suivi pendant le drain', async () => {
    const tracker = createInFlightTracker();
    let done = false;
    void tracker.track(new Promise<void>((resolve) => setTimeout(() => {
      void tracker.track(new Promise<void>((r) => setTimeout(() => { done = true; r(); }, 10)));
      resolve();
    }, 10)));
    expect(await tracker.drain(200)).toBe(true);
    expect(done).toBe(true);
  });

  it('sans traitement en cours : true immédiatement', async () => {
    expect(await createInFlightTracker().drain(0)).toBe(true);
  });
});
