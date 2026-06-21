import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock du SDK Anthropic : enregistre les apiKey construites ; create() configurable.
const constructedKeys: string[] = [];
let createImpl: (args: { model: string }) => Promise<unknown>;
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    apiKey: string;
    messages = { create: vi.fn((args: { model: string }) => createImpl(args)) };
    constructor(opts: { apiKey: string }) {
      this.apiKey = opts.apiKey;
      constructedKeys.push(opts.apiKey);
    }
  },
}));

// Mock resolver : renvoie apiKey + mode. clientId 'plat' -> platform ; sinon byo.
vi.mock('../../core/credentials/resolver.js', () => ({
  resolveLlmCredentials: vi.fn(async (clientId: string) => ({
    apiKey: clientId === 'empty' ? '' : `sk-${clientId}`,
    mode: clientId === 'plat' ? 'platform' : 'byo',
  })),
}));

// Mock KeyPool : deux clés plateforme, bascule sur 429.
const poolKeys = ['sk-pool-1', 'sk-pool-2'];
vi.mock('../key-pool.js', () => {
  return {
    keyPool: {
      size: () => poolKeys.length,
      async withPlatformKey<T>(fn: (k: string) => Promise<T>): Promise<T> {
        // essaie chaque clé jusqu'à succès (simulé) ; sinon relève la dernière erreur
        let lastErr: unknown;
        for (const k of poolKeys) {
          try { return await fn(k); } catch (e) { lastErr = e; }
        }
        throw lastErr;
      },
    },
  };
});

// Mock FairQueue : passe-plat (exécute immédiatement).
vi.mock('../client-fairness.js', () => ({
  clientFairQueue: { run: <T>(_c: string, fn: () => Promise<T>) => fn() },
}));

import { getClientForTenant, getClientForApiKey, chat } from '../anthropic.js';

function ok(text = 'ok') { return { content: [{ type: 'text', text }], usage: {} }; }
function err(status: number) { const e = new Error('x') as Error & { status: number }; e.status = status; return e; }

describe('anthropic per-tenant', () => {
  beforeEach(() => {
    constructedKeys.length = 0;
    createImpl = async () => ok();
  });
  afterEach(() => vi.clearAllMocks());

  it('byo : résout et met en cache par apiKey', async () => {
    const a = await getClientForTenant('c1', null);
    const b = await getClientForTenant('c1', null);
    expect(a).toBe(b);
    expect(constructedKeys.filter((k) => k === 'sk-c1')).toHaveLength(1);
  });

  it('getClientForApiKey met en cache par clé', async () => {
    const a = getClientForApiKey('sk-x');
    const b = getClientForApiKey('sk-x');
    expect(a).toBe(b);
  });

  it('byo apiKey vide -> erreur explicite', async () => {
    await expect(getClientForTenant('empty', null)).rejects.toThrow(/\[LLM\]/);
  });

  it('byo : chat utilise le client résolu (pas le pool)', async () => {
    const out = await chat('sys', [{ role: 'user', content: 'hi' }], { clientId: 'c3', botId: null });
    expect(out).toBe('ok');
    expect(constructedKeys).toContain('sk-c3');
  });

  it('platform : chat passe par le pool (clé pool, pas la clé client)', async () => {
    const out = await chat('sys', [{ role: 'user', content: 'hi' }], { clientId: 'plat', botId: null });
    expect(out).toBe('ok');
    expect(constructedKeys).toContain('sk-pool-1');
    expect(constructedKeys).not.toContain('sk-plat');
  });

  it('platform : 429 sur 1re clé -> bascule sur 2e clé (même modèle)', async () => {
    let calls = 0;
    createImpl = async () => { calls++; if (calls === 1) throw err(429); return ok(); };
    const out = await chat('sys', [{ role: 'user', content: 'hi' }], { clientId: 'plat', botId: null });
    expect(out).toBe('ok');
    expect(constructedKeys).toContain('sk-pool-2');
  });

  it('platform : échec total -> throw', async () => {
    createImpl = async () => { throw err(429); };
    await expect(
      chat('sys', [{ role: 'user', content: 'hi' }], { clientId: 'plat', botId: null })
    ).rejects.toThrow();
  });
});
