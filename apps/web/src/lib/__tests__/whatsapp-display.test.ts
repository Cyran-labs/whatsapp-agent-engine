import { test, expect } from 'vitest';
import { formatPhone, waMeUrl, daysUntil, whatsAppManagerUrl, metaAppUrl } from '../whatsapp-display';

test('formatPhone : indicatif 33 en groupes français', () => {
  expect(formatPhone('+33612457890')).toBe('+33 6 12 45 78 90');
});

test('formatPhone : indicatif 1 en 3 + 3 + 4', () => {
  expect(formatPhone('+15551649072')).toBe('+1 555 164 9072');
});

test('formatPhone : autre indicatif, reste par groupes de 3', () => {
  expect(formatPhone('+447911123456')).toBe('+44 791 112 345 6');
  expect(formatPhone('+573001234567')).toBe('+57 300 123 456 7');
  expect(formatPhone('+74951234567')).toBe('+7 495 123 456 7');
});

test('formatPhone : indicatifs à 3 chiffres reconnus par la table E.164', () => {
  expect(formatPhone('+212612345678')).toBe('+212 612 345 678');
  expect(formatPhone('+351912345678')).toBe('+351 912 345 678');
  expect(formatPhone('+21698123456')).toBe('+216 981 234 56');
});

test('formatPhone : entrée non E.164 rendue telle quelle', () => {
  expect(formatPhone('0612457890')).toBe('0612457890');
  expect(formatPhone('+33 6 12')).toBe('+33 6 12');
  expect(formatPhone('')).toBe('');
  expect(formatPhone('abc')).toBe('abc');
});

test('waMeUrl : chiffres seuls', () => {
  expect(waMeUrl('+33612457890')).toBe('https://wa.me/33612457890');
  expect(waMeUrl('+1 555-164 9072')).toBe('https://wa.me/15551649072');
});

test('daysUntil : arrondi vers le haut', () => {
  const now = new Date('2026-11-09T10:00:00.000Z');
  expect(daysUntil('2026-11-21T10:00:00.000Z', now)).toBe(12);
  expect(daysUntil('2026-11-21T10:00:01.000Z', now)).toBe(13);
  expect(daysUntil('2026-11-09T10:00:01.000Z', now)).toBe(1);
});

test('daysUntil : 0 si la date est dépassée ou égale', () => {
  const now = new Date('2026-11-09T10:00:00.000Z');
  expect(daysUntil('2026-11-09T10:00:00.000Z', now)).toBe(0);
  expect(daysUntil('2026-11-01T00:00:00.000Z', now)).toBe(0);
});

test('whatsAppManagerUrl : numéros de téléphone du compte WhatsApp Business', () => {
  expect(whatsAppManagerUrl('123456789012345')).toBe('https://business.facebook.com/wa/manage/phone-numbers/?waba_id=123456789012345');
});

test('metaAppUrl : app Meta du compte, repli sur la liste des apps si inconnue', () => {
  expect(metaAppUrl('1424483510748297')).toBe('https://developers.facebook.com/apps/1424483510748297/');
  expect(metaAppUrl(null)).toBe('https://developers.facebook.com/apps/');
});
