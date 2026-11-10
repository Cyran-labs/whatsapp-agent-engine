import { describe, expect, it } from 'vitest';
import { contactMatchesAllowlist, isBsuid, maskContact, maskEmail, normalizeAllowlistEntry, normalizeWhatsAppNumber } from '../phone.js';

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

  it('refuse une entrée de plus de 64 caractères, BSUID compris', () => {
    const bsuid64 = `FR.${'a'.repeat(61)}`;
    expect(normalizeAllowlistEntry(bsuid64)).toBe(bsuid64);
    expect(normalizeAllowlistEntry(`${bsuid64}b`)).toBeNull();
    expect(normalizeAllowlistEntry(`${' '.repeat(60)}+33612345678`)).toBeNull();
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

// recette Q-9
describe('maskContact', () => {
  it.each([
    ['+33612345678', '+33•••••••78'],
    ['33612345678', '+33•••••••78'],
    ['+44 7700 900123', '+44••••••••23'],
    ['+15551234567', '+1••••••••67'],
    ['NL.84827364598365', 'NL.8•••'],
    ['abcdef', 'abcd•••'],
    ['abc', '•••'],
    ['', '•••'],
  ])('masque %s', (input, expected) => {
    expect(maskContact(input)).toBe(expected);
  });

  it('ne laisse jamais apparaître le milieu du numéro', () => {
    const masked = maskContact('+33612345678');
    expect(masked).not.toContain('61234');
    expect(masked).toHaveLength('+33612345678'.length);
  });
});

// recette Q-9
describe('maskEmail', () => {
  it.each([
    ['claire.bernard@x.fr', 'c•••@x.fr'],
    ['a@x.fr', 'a•••@x.fr'],
    ['@x.fr', '•••@x.fr'],
    ['pas-une-adresse', '•••'],
    ['', '•••'],
  ])('masque %s', (input, expected) => {
    expect(maskEmail(input)).toBe(expected);
  });
});
