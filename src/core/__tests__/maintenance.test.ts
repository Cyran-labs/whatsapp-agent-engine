import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../database/types.js';
import { startMaintenance } from '../maintenance.js';

interface FakeDb {
  cleanupProcessedMessages: ReturnType<typeof vi.fn>;
  purgeOldConversations: ReturnType<typeof vi.fn>;
  purgeInactiveSessions: ReturnType<typeof vi.fn>;
}

function fakeDb(): FakeDb {
  return {
    cleanupProcessedMessages: vi.fn(async () => undefined),
    purgeOldConversations: vi.fn(async () => undefined),
    purgeInactiveSessions: vi.fn(async () => 0),
  };
}

describe('startMaintenance', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  // audit 6.6
  it('purge tout de suite puis à chaque intervalle', async () => {
    const db = fakeDb();
    const stop = startMaintenance(db as unknown as Database, { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(db.cleanupProcessedMessages).toHaveBeenCalledTimes(1);
    expect(db.purgeOldConversations).toHaveBeenCalledWith(90);
    expect(db.purgeInactiveSessions).toHaveBeenCalledWith(30);

    await vi.advanceTimersByTimeAsync(999);
    expect(db.cleanupProcessedMessages).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(db.cleanupProcessedMessages).toHaveBeenCalledTimes(2);
    expect(db.purgeOldConversations).toHaveBeenCalledTimes(2);
    expect(db.purgeInactiveSessions).toHaveBeenCalledTimes(2);
    stop();
  });

  // audit 6.6
  it('intervalle par défaut de 6 h et durées de rétention configurables', async () => {
    const db = fakeDb();
    const stop = startMaintenance(db as unknown as Database, { conversationDays: 10, sessionDays: 2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(db.purgeOldConversations).toHaveBeenCalledWith(10);
    expect(db.purgeInactiveSessions).toHaveBeenCalledWith(2);
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 - 1);
    expect(db.cleanupProcessedMessages).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(db.cleanupProcessedMessages).toHaveBeenCalledTimes(2);
    stop();
  });

  // audit 6.6
  it("une purge qui lève n'empêche pas les autres et n'est jamais propagée", async () => {
    const db = fakeDb();
    db.cleanupProcessedMessages.mockRejectedValue(new Error('base indisponible'));
    db.purgeOldConversations.mockImplementation(() => { throw new Error('synchrone'); });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stop = startMaintenance(db as unknown as Database, { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(db.purgeOldConversations).toHaveBeenCalledTimes(1);
    expect(db.purgeInactiveSessions).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(db.purgeInactiveSessions).toHaveBeenCalledTimes(2);
    stop();
    errors.mockRestore();
  });

  // audit 6.6
  it("la fonction renvoyée arrête le minuteur", async () => {
    const db = fakeDb();
    const stop = startMaintenance(db as unknown as Database, { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(db.cleanupProcessedMessages).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
