/**
 * Fabrique de transports WhatsApp.
 *
 * Les identifiants viennent exclusivement de la base, par compte WhatsApp d'organisation : aucun repli sur les
 * variables d'environnement de la plateforme, ni pour envoyer ni pour vérifier un webhook, et plus aucun
 * identifiant de transport par agent IA (lot 2b-2, tâche 8). Des identifiants absents ou incomplets donnent null,
 * jamais une exception.
 */

import { createHash } from 'crypto';
import type { Transport } from './types.js';
import { createCmComTransport } from './cm-com.js';
import { createMetaCloudTransport } from './meta-cloud.js';
import type { WhatsAppAccountRecord, WhatsAppNumberRecord } from '../core/database/whatsapp-types.js';
import { decryptJson, encryptJson } from '../core/credentials/crypto.js';

// ---------------------------------------------------------------------------
// Transports par compte WhatsApp d'organisation
// ---------------------------------------------------------------------------

/** Secrets d'un compte WhatsApp, chiffrés ensemble dans `secret_encrypted`. */
export type AccountSecrets =
  | { mode: 'meta_manual'; access_token: string; app_secret: string; verify_token: string; webhook_key: string }
  | { mode: 'cm_com'; product_token: string; webhook_key: string };

export function encryptAccountSecrets(s: AccountSecrets): { secret_encrypted: string; key_version: number } {
  const { secret, keyVersion } = encryptJson(s);
  return { secret_encrypted: secret, key_version: keyVersion };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Secrets du compte, ou null si le contenu est vide, illisible (clé ou version inconnue), d'un autre mode
 * que le compte ou incomplet. Ne lève jamais et ne journalise rien du contenu.
 */
export function decryptAccountSecrets(rec: WhatsAppAccountRecord): AccountSecrets | null {
  try {
    if (rec.secret_encrypted === '') return null;
    const raw = decryptJson(rec.secret_encrypted, rec.key_version);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const o = raw as Record<string, unknown>;
    if (o['mode'] !== rec.mode) return null;
    if (rec.mode === 'meta_manual') {
      const { access_token, app_secret, verify_token, webhook_key } = o;
      if (!nonEmpty(access_token) || !nonEmpty(app_secret) || !nonEmpty(verify_token) || !nonEmpty(webhook_key)) return null;
      return { mode: 'meta_manual', access_token, app_secret, verify_token, webhook_key };
    }
    const { product_token, webhook_key } = o;
    if (!nonEmpty(product_token) || !nonEmpty(webhook_key)) return null;
    return { mode: 'cm_com', product_token, webhook_key };
  } catch {
    return null;
  }
}

// Cache par compte puis par numéro (identifiants numériques uniques : aucune clé concaténée).
// Chaque entrée garde l'empreinte des entrées qui ont servi à construire le transport : si l'une change
// (secrets, version de clé, identifiant ou numéro du fournisseur), le transport est reconstruit sans qu'un
// appel à invalidateAccountTransports soit nécessaire. Construction synchrone : aucune résolution
// asynchrone ne peut finir après une invalidation, donc pas de garde de génération ici.
interface AccountCacheEntry { fingerprint: string; transport: Transport; }
const accountCache = new Map<number, Map<number, AccountCacheEntry>>();

/** Empreinte des entrées du transport. Le contenu chiffré n'y figure que sous forme de SHA-256. */
function transportFingerprint(account: WhatsAppAccountRecord, number: WhatsAppNumberRecord): string {
  return JSON.stringify([
    account.mode,
    account.key_version,
    createHash('sha256').update(account.secret_encrypted, 'utf8').digest('hex'),
    number.provider_number_id,
    number.phone_e164,
  ]);
}

/**
 * Transport d'un numéro d'un compte WhatsApp d'organisation, ou null si le compte est déconnecté, si le
 * numéro est retiré chez le fournisseur, s'il n'appartient pas à ce compte ou à cette organisation
 * (audit 1.5), ou si les secrets sont incomplets. Ces contrôles passent avant le cache : un numéro
 * refusé n'est jamais servi, et un transport en cache dont les entrées ont changé est reconstruit.
 */
export function getTransportForNumber(account: WhatsAppAccountRecord, number: WhatsAppNumberRecord): Transport | null {
  if (account.state === 'disconnected') return null;
  if (number.account_id !== account.id || number.client_id !== account.client_id) return null;
  if (number.provider_state === 'removed') {
    accountCache.get(account.id)?.delete(number.id);
    return null;
  }

  const fingerprint = transportFingerprint(account, number);
  const cached = accountCache.get(account.id)?.get(number.id);
  if (cached && cached.fingerprint === fingerprint) return cached.transport;

  const secrets = decryptAccountSecrets(account);
  if (!secrets) {
    accountCache.get(account.id)?.delete(number.id);
    return null; // null jamais mis en cache : des secrets corrigés ensuite sont vus aussitôt
  }
  const transport = secrets.mode === 'meta_manual'
    ? createMetaCloudTransport({ phoneNumberId: number.provider_number_id, accessToken: secrets.access_token })
    : createCmComTransport({ productToken: secrets.product_token, fromNumber: number.phone_e164.replace(/\D/g, '') });

  let perAccount = accountCache.get(account.id);
  if (!perAccount) { perAccount = new Map(); accountCache.set(account.id, perAccount); }
  perAccount.set(number.id, { fingerprint, transport });
  return transport;
}

/** Oublie les transports du compte (secrets remplacés, compte déconnecté, numéro retiré). */
export function invalidateAccountTransports(accountId: number): void {
  accountCache.delete(accountId);
}

export type { Transport, IncomingMessage } from './types.js';
