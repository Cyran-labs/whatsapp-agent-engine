import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encrypt, decrypt, encryptJson, decryptJson } from '../crypto.js';

const KEY_HEX = '0'.repeat(64); // 32 octets en hex

describe('crypto', () => {
  beforeEach(() => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', KEY_HEX);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('round-trip chaîne', () => {
    const { secret, keyVersion } = encrypt('hello secret');
    expect(keyVersion).toBe(1);
    expect(secret).not.toContain('hello');
    expect(decrypt(secret, keyVersion)).toBe('hello secret');
  });

  it('round-trip JSON', () => {
    const { secret, keyVersion } = encryptJson({ api_key: 'sk-123', n: 4 });
    expect(decryptJson(secret, keyVersion)).toEqual({ api_key: 'sk-123', n: 4 });
  });

  it('détecte la falsification (tag GCM)', () => {
    const { secret, keyVersion } = encrypt('data');
    const buf = Buffer.from(secret, 'base64');
    buf[buf.length - 1] ^= 0xff; // altère le dernier octet du ciphertext
    const tampered = buf.toString('base64');
    expect(() => decrypt(tampered, keyVersion)).toThrow();
  });

  it('mauvaise clé rejetée', () => {
    const { secret, keyVersion } = encrypt('data');
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', 'f'.repeat(64));
    expect(() => decrypt(secret, keyVersion)).toThrow();
  });

  it('KEK absente -> erreur explicite', () => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '');
    expect(() => encrypt('data')).toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
  });

  it('version de clé inconnue -> erreur', () => {
    const { secret } = encrypt('data');
    expect(() => decrypt(secret, 99)).toThrow(/key version/i);
  });
});
