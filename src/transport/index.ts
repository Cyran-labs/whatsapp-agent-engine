/**
 * Factory de transport — instancie le bon driver selon la config bot.
 *
 * Les credentials de transport sont résolus par tenant (resolveTransportCredentials).
 * Fallback config global (.env) quand aucun enregistrement n'existe.
 */

import { config } from '../core/config.js';
import type { BotConfig } from '../core/bot-config.js';
import type { Transport } from './types.js';
import { createCmComTransport } from './cm-com.js';
import { createMetaCloudTransport } from './meta-cloud.js';
import { resolveTransportCredentials } from '../core/credentials/resolver.js';

export type TransportId = 'cm-com' | 'meta-cloud';

// Cache global (config-based), utilisé pour le parse de webhook et le listing.
const cache = new Map<TransportId, Transport>();
// Cache par tenant : clé `${client_id}:${bot_id}:${transportId}`.
const tenantCache = new Map<string, Transport>();

export function getTransport(id: TransportId): Transport {
  const cached = cache.get(id);
  if (cached) return cached;

  let transport: Transport;
  if (id === 'cm-com') {
    transport = createCmComTransport();
  } else if (id === 'meta-cloud') {
    transport = createMetaCloudTransport({
      phoneNumberId: config.meta.phoneNumberId,
      accessToken: config.meta.accessToken,
      appSecret: config.meta.appSecret,
    });
  } else {
    throw new Error(`[Transport] Unknown transport id: ${id}`);
  }

  cache.set(id, transport);
  return transport;
}

export async function getTransportForBot(bot: BotConfig): Promise<Transport> {
  const id = bot.transport as TransportId;
  const key = `${bot.client_id}:${bot.bot_id}:${id}`;
  const cached = tenantCache.get(key);
  if (cached) return cached;

  const creds = await resolveTransportCredentials(bot.client_id, bot.bot_id, id);
  const hasCreds = Object.keys(creds).length > 0;

  let transport: Transport;
  if (id === 'cm-com') {
    transport = hasCreds
      ? createCmComTransport({
          productToken: creds['product_token'],
          fromNumber: creds['from_number'],
          serviceUrl: creds['service_url'],
        })
      : createCmComTransport();
  } else if (id === 'meta-cloud') {
    transport = createMetaCloudTransport(
      hasCreds
        ? {
            phoneNumberId: creds['phone_number_id'] ?? '',
            accessToken: creds['access_token'] ?? '',
            appSecret: creds['app_secret'] ?? '',
          }
        : {
            phoneNumberId: config.meta.phoneNumberId,
            accessToken: config.meta.accessToken,
            appSecret: config.meta.appSecret,
          }
    );
  } else {
    throw new Error(`[Transport] Unknown transport id: ${id}`);
  }

  tenantCache.set(key, transport);
  return transport;
}

export function listConfiguredTransports(): TransportId[] {
  const ids: TransportId[] = [];
  if (config.cm.productToken && config.cm.fromNumber) ids.push('cm-com');
  if (config.meta.phoneNumberId && config.meta.accessToken) ids.push('meta-cloud');
  return ids;
}

export type { Transport, IncomingMessage } from './types.js';
