import { test, expect } from 'vitest';
import { maskNumber } from '../mask-number';

test('maskNumber : E.164 français, cinq premiers chiffres puis les deux derniers', () => {
  expect(maskNumber('+33612345678')).toBe('+33612 •• •• 78');
});
test('maskNumber : numéro de test Meta', () => {
  expect(maskNumber('+15551412647')).toBe('+15551 •• •• 47');
});
test('maskNumber : chaîne vide', () => {
  expect(maskNumber('')).toBe('');
});
test('maskNumber : valeur trop courte laissée telle quelle', () => {
  expect(maskNumber('+3361')).toBe('+3361');
});
