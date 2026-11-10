import { describe, expect, it } from 'vitest';
import { maskContactNumber } from '../index.js';

describe('maskContactNumber (spec navigation 9.2, choix P-3 révisé à la relecture de la tâche 3)', () => {
  it.each([
    ['+33612345678', '+336 •• •• •• 78'],
    ['33699999999', '336 •• •• •• 99'],
    ['+4512345678', '+45 •• •• •• 78'],
    ['+376123456', '+3 •• •• •• 56'],
    ['12345678', ' •• •• •• 78'],
    ['+12345678', '+ •• •• •• 78'],
    ['+1234567', '••••'],
    ['+1234', '••••'],
    ['US.abc123', 'US••••'],
    ['abcde', 'ab••••'],
    ['', '••••'],
    ['abc', '••••'],
    ['+US1', '••••'],
  ])('%j donne %j', (value, masked) => {
    expect(maskContactNumber(value)).toBe(masked);
  });

  // Point d'attention 1 et revue tâche 3 I-1 : pour n de 8 à 15 chiffres, au plus n - 6 chiffres visibles, aucune
  // suite de plus de 3 chiffres consécutifs du numéro, jamais la valeur entière.
  const numbers = Array.from({ length: 8 }, (_, i) => 8 + i).flatMap((n) => {
    const digits = Array.from({ length: n }, (_, k) => String((k * 7 + 3) % 10)).join('');
    return [digits, `+${digits}`, `+${'3'.repeat(n)}`];
  });
  it.each(numbers)('%j : au moins 6 chiffres cachés, aucune suite de plus de 3 chiffres', (value) => {
    const masked = maskContactNumber(value);
    const digits = value.replace(/\D/g, '');
    expect(masked).not.toContain(value);
    expect(masked.replace(/\D/g, '').length).toBeLessThanOrEqual(digits.length - 6);
    for (let i = 0; i + 4 <= digits.length; i++) {
      expect(masked).not.toContain(digits.slice(i, i + 4));
    }
  });

  it.each(['+1234567', '+1234', '1234567', 'US.abc123', 'US.123456789', '', 'abc'])('%j : ni la valeur, ni plus de 3 de ses chiffres consécutifs', (value) => {
    const masked = maskContactNumber(value);
    if (value.length > 0) expect(masked).not.toContain(value);
    const digits = value.replace(/\D/g, '');
    for (let i = 0; i + 4 <= digits.length; i++) {
      expect(masked).not.toContain(digits.slice(i, i + 4));
    }
  });
});
