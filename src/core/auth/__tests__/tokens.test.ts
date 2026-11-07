import { describe, expect, it, beforeEach } from 'vitest';
import { SignJWT, decodeJwt } from 'jose';
import { signAccessToken, verifyAccessToken, generateRefreshToken, hashRefreshToken } from '../tokens.js';

const SECRET = 'test-secret-at-least-32-bytes-long!!';

/** Jeton au format antérieur au modèle de comptes (porte client_id). */
async function signLegacyToken(sub: string, role: string, clientId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role, client_id: clientId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt(now)
    .setExpirationTime(now + 900)
    .sign(new TextEncoder().encode(SECRET));
}

describe('access tokens', () => {
  beforeEach(() => { process.env['ADMIN_JWT_SECRET'] = SECRET; });

  it('sign → verify roundtrip restitue sub et role', async () => {
    const t = await signAccessToken({ sub: '7', role: 'member' });
    const c = await verifyAccessToken(t);
    expect(c).toEqual({ sub: '7', role: 'member', legacy_client_id: null });
  });

  it('le jeton émis ne porte plus de client_id', async () => {
    const t = await signAccessToken({ sub: '7', role: 'member' });
    const payload = decodeJwt(t);
    expect(payload['client_id']).toBeUndefined();
    expect(payload.sub).toBe('7');
    expect(payload['role']).toBe('member');
  });

  it('jeton hérité avec client_id : accepté, client_id exposé seulement comme hérité', async () => {
    const t = await signLegacyToken('5', 'client_admin', 'acme');
    const c = await verifyAccessToken(t);
    expect(c).toEqual({ sub: '5', role: 'client_admin', legacy_client_id: 'acme' });
  });

  it('token falsifié → null', async () => {
    const t = await signAccessToken({ sub: '1', role: 'super_admin' });
    expect(await verifyAccessToken(t + 'x')).toBeNull();
  });

  it('token signé avec un autre secret → null', async () => {
    const t = await signAccessToken({ sub: '1', role: 'super_admin' });
    process.env['ADMIN_JWT_SECRET'] = 'another-secret-at-least-32-bytes-long!';
    expect(await verifyAccessToken(t)).toBeNull();
  });
});

describe('refresh tokens', () => {
  it('generate produit des valeurs uniques, hash déterministe', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
    expect(hashRefreshToken(a)).toBe(hashRefreshToken(a));
    expect(hashRefreshToken(a)).not.toBe(hashRefreshToken(b));
    expect(hashRefreshToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});
