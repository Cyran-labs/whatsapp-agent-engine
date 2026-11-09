import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock du SDK Anthropic : enregistre les apiKey construites ; create() configurable.
const constructedKeys: string[] = [];
interface CreateArgs { model: string; max_tokens: number; output_config?: { effort?: string } }
let createImpl: (args: CreateArgs) => Promise<unknown>;
const createCalls: CreateArgs[] = [];
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    apiKey: string;
    messages = { create: vi.fn((args: CreateArgs) => { createCalls.push(args); return createImpl(args); }) };
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

// Mock KeyPool : sémantique fidèle = 1 clé par appel, cooldown sur 429/529.
const poolKeys = ['sk-pool-1', 'sk-pool-2'];
const cooldown = new Set<string>();
vi.mock('../key-pool.js', () => ({
  keyPool: {
    size: () => poolKeys.length,
    ensureLoaded: async () => {},
    async withPlatformKey<T>(fn: (k: string) => Promise<T>): Promise<T> {
      const available = poolKeys.find((k) => !cooldown.has(k));
      if (!available) throw new Error('[LLMPool] all keys in cooldown');
      try {
        return await fn(available);
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 429 || status === 529) cooldown.add(available);
        throw e;
      }
    },
  },
}));

// Mock FairQueue : passe-plat (exécute immédiatement).
vi.mock('../client-fairness.js', () => ({
  clientFairQueue: { run: <T>(_c: string, fn: () => Promise<T>) => fn() },
}));

import { getClientForTenant, getClientForApiKey, chat } from '../anthropic.js';

function ok(text = 'ok') { return { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: {} }; }
function refusal() { return { content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' }, usage: {} }; }
function err(status: number) { const e = new Error('x') as Error & { status: number }; e.status = status; return e; }

describe('anthropic per-tenant', () => {
  beforeEach(() => {
    constructedKeys.length = 0;
    createCalls.length = 0;
    cooldown.clear();
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

describe('cascade des modèles courants', () => {
  const ask = (clientId: string, model?: string) =>
    chat('sys', [{ role: 'user', content: 'hi' }], { clientId, botId: null, ...(model ? { model } : {}) });

  beforeEach(() => {
    createCalls.length = 0;
    cooldown.clear();
    createImpl = async () => ok();
  });
  afterEach(() => vi.restoreAllMocks());

  for (const clientId of ['c-byo', 'plat']) {
    const mode = clientId === 'plat' ? 'platform' : 'byo';

    it(`${mode} : premier appel sur Claude Sonnet 5.5 avec un effort bas`, async () => {
      await ask(clientId);
      expect(createCalls[0]).toMatchObject({ model: 'claude-sonnet-5-5', output_config: { effort: 'low' } });
    });

    it(`${mode} : bloc de réflexion en tête, le contact reçoit le texte`, async () => {
      createImpl = async () => ({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Bonjour !' }], stop_reason: 'end_turn', usage: {} });
      expect(await ask(clientId)).toBe('Bonjour !');
    });

    it(`${mode} : modèle retiré (404) -> modèle suivant, cause journalisée`, async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      createImpl = async (args) => { if (args.model === 'claude-sonnet-5-5') throw err(404); return ok('suite'); };
      expect(await ask(clientId)).toBe('suite');
      expect(createCalls.map((c) => c.model)).toEqual(['claude-sonnet-5-5', 'claude-sonnet-5']);
      expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/404/);
    });

    it(`${mode} : refus de sécurité -> modèle suivant`, async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      createImpl = async (args) => (args.model === 'claude-sonnet-5-5' ? refusal() : ok('servi'));
      expect(await ask(clientId)).toBe('servi');
      expect(createCalls.map((c) => c.model)).toEqual(['claude-sonnet-5-5', 'claude-sonnet-5']);
    });

    it(`${mode} : refus sur toute la cascade -> erreur (le contact reçoit le message de repli)`, async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      createImpl = async () => refusal();
      await expect(ask(clientId)).rejects.toThrow(/refus/i);
      expect(createCalls.map((c) => c.model)).toEqual(['claude-sonnet-5-5', 'claude-sonnet-5', 'claude-haiku-5-5']);
    });

    it(`${mode} : réponse sans texte -> modèle suivant, jamais un texte de remplacement envoyé`, async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      createImpl = async (args) => (args.model === 'claude-sonnet-5-5'
        ? { content: [{ type: 'thinking', thinking: '' }], stop_reason: 'max_tokens', usage: {} }
        : ok('rattrapé'));
      expect(await ask(clientId)).toBe('rattrapé');
    });

    it(`${mode} : modèle imposé à l'agent IA -> lui seul, même effort`, async () => {
      await ask(clientId, 'claude-haiku-5-5');
      expect(createCalls).toHaveLength(1);
      expect(createCalls[0]).toMatchObject({ model: 'claude-haiku-5-5', output_config: { effort: 'low' } });
    });
  }
});
