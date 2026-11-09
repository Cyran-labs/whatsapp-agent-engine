import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Vérifie l'en-tête `x-hub-signature-256` : `sha256=` suivi du HMAC-SHA256 des octets reçus (jamais d'une
 * re-sérialisation du JSON, audit 4.2) avec le secret d'application. Fonction pure : ne lit ni la base ni
 * l'environnement, ne journalise rien, ne lève jamais. Faux si l'en-tête manque, a une autre longueur ou si
 * le secret est vide.
 */
export function verifyMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (appSecret === '' || typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from('sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex'), 'utf8');
  const received = Buffer.from(header, 'utf8');
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}
