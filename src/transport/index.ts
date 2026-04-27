/**
 * Factory de transport — instancie le bon driver selon la config bot.
 *
 * En P0, les credentials de transport viennent du config global (.env).
 * En P3+, ils viendront de la DB tenant-spécifique (chiffrés avec MASTER_ENCRYPTION_KEY).
 */

import { config } from '../core/config.js';
import type { BotConfig } from '../core/bot-config.js';
import type { Transport } from './types.js';
import { createCmComTransport } from './cm-com.js';
import { createMetaCloudTransport } from './meta-cloud.js';

export type TransportId = 'cm-com' | 'meta-cloud';

const cache = new Map<TransportId, Transport>();

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

export function getTransportForBot(bot: BotConfig): Transport {
  return getTransport(bot.transport);
}

export function listConfiguredTransports(): TransportId[] {
  const ids: TransportId[] = [];
  if (config.cm.productToken && config.cm.fromNumber) ids.push('cm-com');
  if (config.meta.phoneNumberId && config.meta.accessToken) ids.push('meta-cloud');
  return ids;
}

export type { Transport, IncomingMessage } from './types.js';
