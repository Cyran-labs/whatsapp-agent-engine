import { describe, expect, it } from 'vitest';
import { normalizeWhatsAppNumber } from '../phone.js';

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
