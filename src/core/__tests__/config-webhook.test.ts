import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config.js';
import { PROCESSED_MESSAGES_RETENTION_HOURS } from '../database/types.js';

// Revue finale m5 : un message plus ancien que la rétention du dédoublonnage ne doit jamais être accepté,
// sinon un webhook rejoué après la purge de sa clé serait servi une seconde fois.
describe('config.webhook.maxMessageAgeHours', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    warn.mockRestore();
  });

  it('la rétention du dédoublonnage est de 168 h (7 jours)', () => {
    expect(PROCESSED_MESSAGES_RETENTION_HOURS).toBe(168);
  });

  it('vaut 24 par défaut et suit une valeur réglée sous la rétention, sans avertissement', () => {
    expect(config.webhook.maxMessageAgeHours).toBe(24);
    vi.stubEnv('MESSAGE_MAX_AGE_HOURS', '48');
    expect(config.webhook.maxMessageAgeHours).toBe(48);
    vi.stubEnv('MESSAGE_MAX_AGE_HOURS', String(PROCESSED_MESSAGES_RETENTION_HOURS - 1));
    expect(config.webhook.maxMessageAgeHours).toBe(PROCESSED_MESSAGES_RETENTION_HOURS - 1);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['168', '169', '1000'])(
    'valeur %s supérieure ou égale à la rétention : ramenée à 167 avec un avertissement [Config]',
    (raw) => {
      vi.stubEnv('MESSAGE_MAX_AGE_HOURS', raw);
      expect(config.webhook.maxMessageAgeHours).toBe(PROCESSED_MESSAGES_RETENTION_HOURS - 1);
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0]?.[0]);
      expect(message).toMatch(/^\[Config\] /);
      expect(message).toContain('MESSAGE_MAX_AGE_HOURS');
    },
  );

  it('n\'avertit qu\'une fois pour une même valeur lue à chaque message', () => {
    vi.stubEnv('MESSAGE_MAX_AGE_HOURS', '5000');
    void config.webhook.maxMessageAgeHours;
    void config.webhook.maxMessageAgeHours;
    void config.webhook.maxMessageAgeHours;
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('valeur invalide : retombe sur 24 comme avant', () => {
    vi.stubEnv('MESSAGE_MAX_AGE_HOURS', 'abc');
    expect(config.webhook.maxMessageAgeHours).toBe(24);
  });
});
