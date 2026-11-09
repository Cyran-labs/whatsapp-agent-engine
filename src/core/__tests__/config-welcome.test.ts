import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config.js';

describe('config.welcome.delayMs', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    warn.mockRestore();
  });

  it('vaut 1500 par défaut, sans avertissement, quand la variable est absente ou vide', () => {
    expect(config.welcome.delayMs).toBe(1500);
    vi.stubEnv('WELCOME_DELAY_MS', '');
    expect(config.welcome.delayMs).toBe(1500);
    expect(warn).not.toHaveBeenCalled();
  });

  it('lit WELCOME_DELAY_MS entre 0 et 10000 inclus, relu à chaque accès', () => {
    vi.stubEnv('WELCOME_DELAY_MS', '0');
    expect(config.welcome.delayMs).toBe(0);
    vi.stubEnv('WELCOME_DELAY_MS', ' 250 ');
    expect(config.welcome.delayMs).toBe(250);
    vi.stubEnv('WELCOME_DELAY_MS', '10000');
    expect(config.welcome.delayMs).toBe(10000);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['-1', '10001', '99999999', '12.5', 'abc', '1e3', '1500 ms', 'NaN', 'Infinity'])(
    'valeur hors bornes ou illisible %j : 1500, avertissement [Config], sans lever',
    (raw) => {
      vi.stubEnv('WELCOME_DELAY_MS', raw);
      expect(() => config.welcome.delayMs).not.toThrow();
      expect(config.welcome.delayMs).toBe(1500);
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0]?.[0]);
      expect(message).toMatch(/^\[Config\] /);
      expect(message).toContain('WELCOME_DELAY_MS');
    },
  );
});
