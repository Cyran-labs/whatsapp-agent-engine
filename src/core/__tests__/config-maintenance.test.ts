import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config.js';

describe('config.maintenance.conversationRetentionDays', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    warn.mockRestore();
  });

  it('vaut 90 par défaut, sans avertissement, quand la variable est absente ou vide', () => {
    expect(config.maintenance.conversationRetentionDays).toBe(90);
    vi.stubEnv('CONVERSATION_RETENTION_DAYS', '');
    expect(config.maintenance.conversationRetentionDays).toBe(90);
    expect(warn).not.toHaveBeenCalled();
  });

  it('lit CONVERSATION_RETENTION_DAYS quand c\'est un entier supérieur ou égal à 1', () => {
    vi.stubEnv('CONVERSATION_RETENTION_DAYS', '30');
    expect(config.maintenance.conversationRetentionDays).toBe(30);
    vi.stubEnv('CONVERSATION_RETENTION_DAYS', ' 365 ');
    expect(config.maintenance.conversationRetentionDays).toBe(365);
    vi.stubEnv('CONVERSATION_RETENTION_DAYS', '1');
    expect(config.maintenance.conversationRetentionDays).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['0', '-5', '12.5', 'abc', '1e2', '30 jours', 'NaN'])(
    'valeur invalide %j : retombe sur 90 avec un avertissement [Config]',
    (raw) => {
      vi.stubEnv('CONVERSATION_RETENTION_DAYS', raw);
      expect(config.maintenance.conversationRetentionDays).toBe(90);
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0]?.[0]);
      expect(message).toMatch(/^\[Config\] /);
      expect(message).toContain('CONVERSATION_RETENTION_DAYS');
    },
  );

  it('n\'avertit qu\'une fois pour une même valeur invalide', () => {
    vi.stubEnv('CONVERSATION_RETENTION_DAYS', 'une-seule-fois');
    void config.maintenance.conversationRetentionDays;
    void config.maintenance.conversationRetentionDays;
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
