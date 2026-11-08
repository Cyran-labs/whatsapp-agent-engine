/**
 * Clé d'URL de webhook d'un compte WhatsApp et jeton de vérification Meta.
 * La clé n'est jamais stockée en clair côté recherche : seule son empreinte SHA-256 sert à retrouver le compte.
 */
import { createHash, randomBytes } from 'crypto';

/** Clé secrète de l'URL de webhook : 32 octets aléatoires, base64url. */
export function generateWebhookKey(): string {
  return randomBytes(32).toString('base64url');
}

/** Empreinte SHA-256 hexadécimale d'une clé d'URL, utilisée pour retrouver le compte. */
export function hashWebhookKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** Jeton du GET de vérification Meta, propre à chaque compte : 24 octets aléatoires, base64url. */
export function generateVerifyToken(): string {
  return randomBytes(24).toString('base64url');
}
