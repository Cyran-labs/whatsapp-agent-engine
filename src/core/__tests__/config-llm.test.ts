import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config.js';

describe('config.llm', () => {
  beforeEach(() => {
    // config.anthropic.apiKey est required() eager : il faut une clé au chargement du module.
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-boot');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('clientConcurrency défaut 3, override par env', () => {
    expect(config.llm.clientConcurrency).toBe(3);
    vi.stubEnv('LLM_CLIENT_CONCURRENCY', '5');
    expect(config.llm.clientConcurrency).toBe(5);
  });

  it('keyCooldownMs défaut 30000, override par env', () => {
    expect(config.llm.keyCooldownMs).toBe(30000);
    vi.stubEnv('LLM_KEY_COOLDOWN_MS', '1000');
    expect(config.llm.keyCooldownMs).toBe(1000);
  });

  it('apiKeys parse ANTHROPIC_API_KEYS séparé par virgules', () => {
    vi.stubEnv('ANTHROPIC_API_KEYS', 'sk-a, sk-b ,sk-c');
    expect(config.llm.apiKeys).toEqual(['sk-a', 'sk-b', 'sk-c']);
  });

  it('apiKeys retombe sur ANTHROPIC_API_KEY si ANTHROPIC_API_KEYS absent', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-single');
    expect(config.llm.apiKeys).toEqual(['sk-single']);
  });

  it('apiKeys vide si aucune source', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEYS', '');
    expect(config.llm.apiKeys).toEqual([]);
  });
});
