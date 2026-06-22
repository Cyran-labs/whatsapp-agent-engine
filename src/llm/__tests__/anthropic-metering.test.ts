import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recorded: Array<{ model: string; callType: string; mode: string; clientId: string }> = [];
vi.mock('../usage-recorder.js', () => ({
  recordUsage: vi.fn(async (ev: { model: string; callType: string; mode: string; clientId: string }) => { recorded.push(ev); }),
}));
vi.mock('../../core/credentials/resolver.js', () => ({
  resolveLlmCredentials: vi.fn(async (clientId: string) =>
    clientId === 'plat'
      ? { apiKey: 'sk-plat', mode: 'platform' }
      : { apiKey: `sk-${clientId}`, mode: 'byo' },
  ),
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 10, output_tokens: 4 } })) };
    constructor(_opts: { apiKey: string }) {}
  },
}));

// Mock KeyPool : 1 clé pool dispo, withPlatformKey exécute fn avec cette clé.
vi.mock('../key-pool.js', () => ({
  keyPool: {
    size: () => 1,
    ensureLoaded: async () => {},
    async withPlatformKey<T>(fn: (k: string) => Promise<T>): Promise<T> {
      return fn('sk-pool-1');
    },
  },
}));

// Mock FairQueue : passe-plat (exécute immédiatement).
vi.mock('../client-fairness.js', () => ({
  clientFairQueue: { run: <T>(_c: string, fn: () => Promise<T>) => fn() },
}));

import { chat } from '../anthropic.js';

describe('chat enregistre l\'usage', () => {
  beforeEach(() => { recorded.length = 0; });
  afterEach(() => vi.clearAllMocks());

  it('byo : une ligne usage call_type=chat après succès', async () => {
    const out = await chat('sys', [{ role: 'user', content: 'hi' }], { clientId: 'c1', botId: 'b1' });
    expect(out).toBe('ok');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ callType: 'chat', mode: 'byo', clientId: 'c1' });
  });

  it('platform : une ligne usage call_type=chat mode=platform après succès', async () => {
    const out = await chat('sys', [{ role: 'user', content: 'hi' }], { clientId: 'plat', botId: 'b1' });
    expect(out).toBe('ok');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ callType: 'chat', mode: 'platform', clientId: 'plat' });
  });
});
