import { describe, expect, it } from 'vitest';
import { generateVerifyToken, generateWebhookKey, hashWebhookKey } from '../webhook-key.js';

describe('webhook-key', () => {
  it('clé d\'URL : 32 octets en base64url, différente à chaque appel', () => {
    const a = generateWebhookKey();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
    expect(generateWebhookKey()).not.toBe(a);
  });

  it('jeton de vérification : 24 octets en base64url, différent à chaque appel', () => {
    const t = generateVerifyToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(Buffer.from(t, 'base64url')).toHaveLength(24);
    expect(generateVerifyToken()).not.toBe(t);
  });

  it('empreinte : SHA-256 hexadécimal, déterministe, distincte pour deux clés', () => {
    expect(hashWebhookKey('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hashWebhookKey('abc')).toBe(hashWebhookKey('abc'));
    expect(hashWebhookKey('abc')).not.toBe(hashWebhookKey('abd'));
  });

  it("l'empreinte ne contient pas la clé", () => {
    const key = generateWebhookKey();
    expect(hashWebhookKey(key)).not.toContain(key);
    expect(hashWebhookKey(key)).toMatch(/^[0-9a-f]{64}$/);
  });
});
