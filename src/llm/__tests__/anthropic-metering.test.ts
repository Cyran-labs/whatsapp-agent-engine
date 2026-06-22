import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recorded: Array<{ model: string; callType: string; mode: string; clientId: string }> = [];
vi.mock('../usage-recorder.js', () => ({
  recordUsage: vi.fn(async (ev: { model: string; callType: string; mode: string; clientId: string }) => { recorded.push(ev); }),
}));
vi.mock('../../core/credentials/resolver.js', () => ({
  resolveLlmCredentials: vi.fn(async (clientId: string) => ({ apiKey: `sk-${clientId}`, mode: 'byo' })),
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 10, output_tokens: 4 } })) };
    constructor(_opts: { apiKey: string }) {}
  },
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
});
