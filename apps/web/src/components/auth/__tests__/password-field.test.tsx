import { test, expect } from 'vitest';
import { passwordStrength } from '../password-field';

test('jauge : 0 sous 10 caractères, puis un segment par critère rempli', () => {
  expect(passwordStrength('')).toBe(0);
  expect(passwordStrength('Abc1!')).toBe(0);
  expect(passwordStrength('abcdefghij')).toBe(1);
  expect(passwordStrength('abcdefghiJ')).toBe(2);
  expect(passwordStrength('abcdefghiJ1')).toBe(3);
  expect(passwordStrength('abcdefghiJ1!')).toBe(4);
});
