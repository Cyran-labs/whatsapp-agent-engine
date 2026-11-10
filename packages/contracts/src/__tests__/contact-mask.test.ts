import { describe, expect, it } from 'vitest';
import { maskContactNumber } from '../index.js';

describe('maskContactNumber (spec navigation 9.2, choix P-3)', () => {
  it.each([
    ['+33612345678', '+33612 •• •• 78'],
    ['33699999999', '+33699 •• •• 99'],
    ['+123456789', '+12345 •• •• 89'],
    ['+1234', '••••'],
    ['12345678', '••••'],
    ['US.abc123', 'US••••'],
    ['abcde', 'ab••••'],
    ['', '••••'],
    ['abc', '••••'],
    ['+US1', '••••'],
  ])('%j donne %j', (value, masked) => {
    expect(maskContactNumber(value)).toBe(masked);
  });

  // Point d'attention 1 : ni la valeur entière, ni une suite de plus de 5 de ses chiffres consécutifs.
  it.each(['+33612345678', '33699999999', '+33333333333', '+123456789', '+1234', '12345678', 'US.abc123', 'US.123456789', '', 'abc'])(
    '%j : le masque ne contient ni la valeur ni plus de 5 de ses chiffres consécutifs',
    (value) => {
      const masked = maskContactNumber(value);
      if (value.length > 0) expect(masked).not.toContain(value);
      const digits = value.replace(/\D/g, '');
      for (let i = 0; i + 6 <= digits.length; i++) {
        expect(masked).not.toContain(digits.slice(i, i + 6));
      }
      expect(masked.replace(/\D/g, '').length).toBeLessThanOrEqual(7);
    },
  );
});
