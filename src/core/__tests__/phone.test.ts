import { describe, expect, it } from 'vitest';
import { contactMatchesAllowlist, isBsuid, normalizeAllowlistEntry, normalizeWhatsAppNumber } from '../phone.js';

describe('normalizeWhatsAppNumber', () => {
  it.each([
    ['+33 6 12 34 56 78', '+33612345678'],
    ['0033612345678', '+33612345678'],
    ['33612345678', '+33612345678'],
    ['+1 (555) 123-4567', '+15551234567'],
    ['+33.6.12.34.56.78', '+33612345678'],
    ['+33-6-12-34-56-78', '+33612345678'],
    ['0612345678', null],
    ['', null],
    ['abc', null],
    ['+1234567', null],
    ['+1234567890123456', null],
    ['+33 6 12 AB 56 78', null],
    ['+0612345678', null],
    ['00', null],
  ])('normalise %s', (input, expected) => {
    expect(normalizeWhatsAppNumber(input)).toBe(expected);
  });
});

describe('isBsuid', () => {
  it('reconnait un identifiant BSUID et refuse un numéro', () => {
    expect(isBsuid('NL.84827364598365')).toBe(true);
    expect(isBsuid('+33612345678')).toBe(false);
  });
});

describe('normalizeAllowlistEntry', () => {
  it('garde un BSUID après trim, normalise un numéro, refuse le reste', () => {
    expect(normalizeAllowlistEntry(' FR.ab_1 ')).toBe('FR.ab_1');
    expect(normalizeAllowlistEntry('0033612345678')).toBe('+33612345678');
    expect(normalizeAllowlistEntry('06')).toBeNull();
  });
});

describe('contactMatchesAllowlist', () => {
  it('compare un numéro en E.164 et un BSUID tel quel, sans les mélanger', () => {
    expect(contactMatchesAllowlist('33612345678', ['+33612345678'])).toBe(true);
    expect(contactMatchesAllowlist('FR.abc', ['+33612345678'])).toBe(false);
    expect(contactMatchesAllowlist('33612345678', ['FR.abc'])).toBe(false);
    expect(contactMatchesAllowlist('FR.abc', ['FR.abc'])).toBe(true);
  });
});
