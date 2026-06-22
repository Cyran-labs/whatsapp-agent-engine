import { describe, expect, it, beforeEach } from 'vitest';
import { signAccessToken, verifyAccessToken, generateRefreshToken, hashRefreshToken } from '../tokens.js';

describe('access tokens', () => {
  beforeEach(() => { process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!'; });

  it('sign → verify roundtrip restitue les claims', async () => {
    const t = await signAccessToken({ sub: '7', role: 'client_admin', client_id: 'acme' });
    const c = await verifyAccessToken(t);
    expect(c).toEqual({ sub: '7', role: 'client_admin', client_id: 'acme' });
  });

  it('super_admin : client_id null préservé', async () => {
    const t = await signAccessToken({ sub: '1', role: 'super_admin', client_id: null });
    expect((await verifyAccessToken(t))!.client_id).toBeNull();
  });

  it('token falsifié → null', async () => {
    const t = await signAccessToken({ sub: '1', role: 'super_admin', client_id: null });
    expect(await verifyAccessToken(t + 'x')).toBeNull();
  });

  it('token signé avec un autre secret → null', async () => {
    const t = await signAccessToken({ sub: '1', role: 'super_admin', client_id: null });
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
