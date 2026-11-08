/**
 * Fabrique de transports WhatsApp.
 *
 * Les identifiants viennent exclusivement de la base (agent IA, puis organisation) : aucun repli
 * sur les variables d'environnement de la plateforme, ni pour envoyer ni pour vérifier un webhook.
 * Un agent IA dont les identifiants manquent ou sont incomplets n'a pas de transport (null).
 */

import type { BotConfig, TransportId } from '../core/bot-config.js';
import type { Transport } from './types.js';
import { createCmComTransport } from './cm-com.js';
import { createMetaCloudTransport } from './meta-cloud.js';
import { getProviderDef } from '../core/providers.js';
import { resolveTransportCredentials } from '../core/credentials/resolver.js';

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
 * Seule fabrique de transport. Renvoie null si un champ requis du fournisseur manque ou est vide,
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
      appSecret: creds['app_secret'] as string,
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

/** Secret de l'URL de webhook CM.com de l'agent IA, posé par la plateforme à l'enregistrement des identifiants. */
export async function getCmWebhookSecret(clientId: string, botId: string): Promise<string | null> {
  const creds = await resolveTransportCredentials(clientId, botId, 'cm-com');
  const secret = creds['webhook_secret'];
  return typeof secret === 'string' && secret !== '' ? secret : null;
}

export type { Transport, IncomingMessage } from './types.js';
