import { describe, expect, it } from 'vitest';
import { lockedConversationCount, withConversationLock } from '../conversation-lock.js';

interface Deferred { promise: Promise<void>; resolve: () => void; reject: (err: Error) => void }

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('withConversationLock', () => {
  // audit 5.7
  it('même clé : le second traitement commence après la fin du premier', async () => {
    const events: string[] = [];
    const gate = deferred();
    const first = withConversationLock('k', async () => {
      events.push('debut 1');
      await gate.promise;
      events.push('fin 1');
    });
    const second = withConversationLock('k', async () => { events.push('debut 2'); });
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(['debut 1']);
    gate.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual(['debut 1', 'fin 1', 'debut 2']);
  });

  // audit 5.7
  it("une erreur dans le premier traitement est propagée sans bloquer le second", async () => {
    const first = withConversationLock('k-erreur', async () => { throw new Error('échec'); });
    let ran = false;
    const second = withConversationLock('k-erreur', async () => { ran = true; });
    await expect(first).rejects.toThrow('échec');
    await second;
    expect(ran).toBe(true);
  });

  it('deux clés différentes tournent en parallèle', async () => {
    const gate = deferred();
    const events: string[] = [];
    const a = withConversationLock('a', async () => { events.push('debut a'); await gate.promise; events.push('fin a'); });
    const b = withConversationLock('b', async () => { events.push('b'); });
    await b;
    expect(events).toEqual(['debut a', 'b']);
    gate.resolve();
    await a;
  });

  it('la clé est libérée en fin de file', async () => {
    const before = lockedConversationCount();
    const gate = deferred();
    const p1 = withConversationLock('liberee', async () => { await gate.promise; });
    const p2 = withConversationLock('liberee', async () => undefined);
    expect(lockedConversationCount()).toBe(before + 1);
    gate.resolve();
    await Promise.all([p1, p2]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(lockedConversationCount()).toBe(before);
  });
});
