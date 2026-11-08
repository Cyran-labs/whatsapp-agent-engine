/**
 * Fabrique de transports WhatsApp.
 *
 * Les identifiants viennent exclusivement de la base : aucun repli sur les variables d'environnement
 * de la plateforme, ni pour envoyer ni pour vérifier un webhook.
 *
 * Deux fabriques coexistent jusqu'à la tâche 6 du lot 2b-2 :
 *   - par agent IA (`getTransportForBot`, identifiants de l'agent IA puis de l'organisation), ancienne ;
 *   - par compte WhatsApp d'organisation (`getTransportForNumber`), qui la remplacera.
 * Dans les deux cas, des identifiants absents ou incomplets donnent null, jamais une exception.
 */

import type { BotConfig, TransportId } from '../core/bot-config.js';
import { createHash } from 'crypto';
import type { Transport } from './types.js';
import { createCmComTransport } from './cm-com.js';
import { createMetaCloudTransport } from './meta-cloud.js';
import type { WhatsAppAccountRecord, WhatsAppNumberRecord } from '../core/database/whatsapp-types.js';
import { getProviderDef } from '../core/providers.js';
import { resolveTransportCredentials } from '../core/credentials/resolver.js';
import { getCredentialRecord } from '../core/credentials/store.js';
import { decryptJson, encryptJson } from '../core/credentials/crypto.js';

export type { TransportId } from '../core/bot-config.js';

interface CachedTransport { id: TransportId; transport: Transport; }

// Cache par organisation puis par agent IA (pas de clé concaténée : aucun risque de collision d'identifiants).
const cache = new Map<string, Map<string, CachedTransport>>();
// Incrémenté à chaque invalidation : une résolution commencée avant une invalidation ne remplit jamais le cache.
let generation = 0;

function isTransportId(value: string): value is TransportId {
  return value === 'cm-com' || value === 'meta-cloud';
}

/**
 * Fabrique de transport par agent IA (ancienne). Renvoie null si un champ requis du fournisseur manque ou est vide,
 * sans jamais lever pour des identifiants incomplets.
 */
export function buildTransport(provider: TransportId, creds: Record<string, string>): Transport | null {
  const def = getProviderDef('transport', provider);
  if (!def) return null;
  for (const field of def.fields) {
    const value = creds[field.name];
    if (typeof value !== 'string' || value.trim() === '') return null;
  }
  if (provider === 'meta-cloud') {
    return createMetaCloudTransport({
      phoneNumberId: creds['phone_number_id'] as string,
      accessToken: creds['access_token'] as string,
    });
  }
  return createCmComTransport({
    productToken: creds['product_token'] as string,
    fromNumber: creds['from_number'] as string,
  });
}

/** Transport de l'agent IA : identifiants de l'agent IA puis de son organisation, jamais l'environnement. */
export async function getTransportForBot(bot: BotConfig): Promise<Transport | null> {
  const id = bot.transport;
  if (!isTransportId(id)) return null;
  const cached = cache.get(bot.client_id)?.get(bot.bot_id);
  if (cached && cached.id === id) return cached.transport;

  const startedAt = generation;
  const creds = await resolveTransportCredentials(bot.client_id, bot.bot_id, id);
  const transport = buildTransport(id, creds);
  if (!transport) return null; // null jamais mis en cache : un enregistrement ajouté ensuite est vu aussitôt

  if (startedAt === generation) {
    let perClient = cache.get(bot.client_id);
    if (!perClient) { perClient = new Map(); cache.set(bot.client_id, perClient); }
    perClient.set(bot.bot_id, { id, transport });
  }
  return transport;
}

/** Oublie les transports de l'agent IA, ou de toute l'organisation si botId est omis. */
export function invalidateTransports(clientId: string, botId?: string): void {
  generation++;
  if (botId === undefined) {
    cache.delete(clientId);
    return;
  }
  cache.get(clientId)?.delete(botId);
}

/**
 * Secret de l'URL de webhook CM.com de l'agent IA, posé par la plateforme à l'enregistrement des identifiants.
 * Lu au niveau de l'agent IA uniquement : jamais d'héritage depuis un enregistrement d'organisation.
 */
export async function getCmWebhookSecret(clientId: string, botId: string): Promise<string | null> {
  const rec = await getCredentialRecord(clientId, botId, 'transport', 'cm-com');
  if (!rec) return null;
  const secret = (decryptJson(rec.secret_encrypted, rec.key_version) as Record<string, unknown>)['webhook_secret'];
  return typeof secret === 'string' && secret !== '' ? secret : null;
}

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
// asynchrone ne peut finir après une invalidation, donc pas de garde de génération ici (contrairement
// au cache par agent IA).
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
