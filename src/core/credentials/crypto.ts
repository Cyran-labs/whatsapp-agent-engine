/**
 * Chiffrement des credentials par tenant — AES-256-GCM authentifié.
 *
 * Pur : ne dépend que de la KEK (CREDENTIALS_ENCRYPTION_KEY). Aucune dépendance DB.
 * Enveloppe stockée = base64( iv(12) ‖ authTag(16) ‖ ciphertext ).
 * key_version permet la rotation future sans changement de schéma.
 */

import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const CURRENT_KEY_VERSION = 1;

function decodeKey(raw: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  return Buffer.from(raw, 'base64');
}

function getKey(version: number): Buffer {
  if (version !== CURRENT_KEY_VERSION) {
    throw new Error(`[Credentials] Unknown key version: ${version}`);
  }
  const raw = process.env['CREDENTIALS_ENCRYPTION_KEY'] || '';
  if (!raw) {
    throw new Error('[Credentials] CREDENTIALS_ENCRYPTION_KEY is required');
  }
  const key = decodeKey(raw);
  if (key.length !== 32) {
    throw new Error('[Credentials] CREDENTIALS_ENCRYPTION_KEY must decode to 32 bytes');
  }
  return key;
}

export function encrypt(plaintext: string): { secret: string; keyVersion: number } {
  const key = getKey(CURRENT_KEY_VERSION);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    secret: Buffer.concat([iv, tag, ct]).toString('base64'),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

export function decrypt(secret: string, keyVersion: number): string {
  const key = getKey(keyVersion);
  const buf = Buffer.from(secret, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export function encryptJson(value: unknown): { secret: string; keyVersion: number } {
  return encrypt(JSON.stringify(value));
}

export function decryptJson(secret: string, keyVersion: number): unknown {
  return JSON.parse(decrypt(secret, keyVersion));
}
