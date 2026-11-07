import { describe, expect, it } from 'vitest';
import { maskEmail } from '../email.js';

describe('maskEmail', () => {
  it('garde la première lettre en minuscule et le domaine complet', () => {
    expect(maskEmail('lucas.petit@maison-lumiere.fr')).toBe('l•••••@maison-lumiere.fr');
    expect(maskEmail('A@x.fr')).toBe('a•••••@x.fr');
  });
});
