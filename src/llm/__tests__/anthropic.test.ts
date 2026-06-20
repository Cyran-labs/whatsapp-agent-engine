import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock du SDK Anthropic : enregistre les apiKey construites, messages.create renvoie un texte.
const constructedKeys: string[] = [];
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    apiKey: string;
    messages = { create: vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }], usage: {} })) };
    constructor(opts: { apiKey: string }) {
      this.apiKey = opts.apiKey;
      constructedKeys.push(opts.apiKey);
    }
  },
}));

// Mock du resolver : clé par client.
vi.mock('../../core/credentials/resolver.js', () => ({
  resolveLlmCredentials: vi.fn(async (clientId: string) => ({
    apiKey: clientId === 'empty' ? '' : `sk-${clientId}`,
  })),
}));

import { getClientForTenant, chat } from '../anthropic.js';

describe('anthropic per-tenant', () => {
  beforeEach(() => {
    constructedKeys.length = 0;
  });
  afterEach(() => vi.clearAllMocks());

  it('résout et met en cache par apiKey', async () => {
    const a = await getClientForTenant('c1', null);
    const b = await getClientForTenant('c1', null);
    expect(a).toBe(b); // même instance (cache)
    expect(constructedKeys.filter((k) => k === 'sk-c1')).toHaveLength(1);
  });

  it('deux clés distinctes -> deux clients distincts', async () => {
    const a = await getClientForTenant('c1', null);
    const b = await getClientForTenant('c2', null);
    expect(a).not.toBe(b);
  });

  it('apiKey vide -> erreur explicite', async () => {
    await expect(getClientForTenant('empty', null)).rejects.toThrow(/\[LLM\]/);
  });

  it('chat utilise le client résolu et renvoie le texte', async () => {
    const out = await chat('sys', [{ role: 'user', content: 'hi' }], { clientId: 'c3', botId: null });
    expect(out).toBe('ok');
    expect(constructedKeys).toContain('sk-c3');
  });
});
