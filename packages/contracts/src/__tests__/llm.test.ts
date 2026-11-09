import { describe, expect, it } from 'vitest';
import { CLAUDE_CHAT_MODELS, CreateBotInput, SetLlmInput, UpdateBotInput } from '../index.js';

describe('contracts: modèles Claude', () => {
  it('la cascade commence par Claude Sonnet 5.5', () => {
    expect(CLAUDE_CHAT_MODELS[0]).toBe('claude-sonnet-5-5');
  });

  it('un modèle imposé à un agent IA doit être un modèle courant', () => {
    expect(SetLlmInput.parse({ mode: 'platform', model: 'claude-haiku-5-5' }).model).toBe('claude-haiku-5-5');
    // Modèle retiré par Anthropic : refusé à la saisie plutôt qu'en échec à chaque message.
    expect(SetLlmInput.safeParse({ mode: 'platform', model: 'claude-sonnet-4-20250514' }).success).toBe(false);
    expect(SetLlmInput.safeParse({ mode: 'byo', model: 'gpt-4o' }).success).toBe(false);
    expect(SetLlmInput.parse({ mode: 'platform' }).model).toBeUndefined();
  });

  it('création et modification d\'un agent IA : même contrôle du modèle', () => {
    const base = { bot_id: 'support', name: 'Support', welcome: { enabled: false, message: {} } };
    expect(CreateBotInput.parse({ ...base, llm: { model: 'claude-sonnet-5' } }).llm?.model).toBe('claude-sonnet-5');
    expect(CreateBotInput.safeParse({ ...base, llm: { model: 'claude-haiku-4-5-20251001' } }).success).toBe(false);
    expect(UpdateBotInput.safeParse({ llm: { model: 'claude-sonnet-4-5-20250929' } }).success).toBe(false);
  });
});
