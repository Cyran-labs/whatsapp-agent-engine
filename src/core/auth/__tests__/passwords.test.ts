import { describe, expect, it, beforeAll } from 'vitest';
import { hashPassword, verifyPassword } from '../passwords.js';

describe('passwords', () => {
  beforeAll(() => { process.env['ADMIN_BCRYPT_ROUNDS'] = '4'; }); // rapide en test

  it('hash != plain et verify OK', async () => {
    const h = await hashPassword('longenough1');
    expect(h).not.toBe('longenough1');
    expect(await verifyPassword('longenough1', h)).toBe(true);
  });

  it('verify échoue sur mauvais mot de passe', async () => {
    const h = await hashPassword('longenough1');
    expect(await verifyPassword('wrong-password', h)).toBe(false);
  });
});
