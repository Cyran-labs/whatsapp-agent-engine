/**
 * Webhook CM.com : CM.com ne signe pas ses appels, l'URL porte l'organisation, l'agent IA et un secret
 * généré par la plateforme (audit 4.1). Tout écart (agent IA inconnu, autre transport, secret faux)
 * répond 404 sans effet ; le numéro destinataire doit appartenir à l'agent IA de l'URL.
 */
import express from 'express';
import { getBotConfig } from '../core/config-store.js';
import type { BotConfig } from '../core/bot-config.js';
import { normalizeWhatsAppNumber } from '../core/phone.js';
import type { InFlightTracker } from '../core/in-flight.js';
import { getCmWebhookSecret, getTransportForBot } from '../transport/index.js';
import { parseCmWebhook } from '../transport/cm-com.js';
import { constantTimeEqual } from './constant-time.js';
import { serveMessage, shortMessageId } from './pipeline.js';

function findBot(clientId: string, botId: string): BotConfig | null {
  try {
    return getBotConfig(clientId, botId);
  } catch {
    return null;
  }
}

async function isAuthorized(bot: BotConfig | null, secret: string): Promise<boolean> {
  if (!bot || bot.transport !== 'cm-com') return false;
  try {
    const expected = await getCmWebhookSecret(bot.client_id, bot.bot_id);
    return expected !== null && constantTimeEqual(secret, expected);
  } catch (err) {
    console.error(`[Webhook/CmCom] Secret illisible pour ${bot.client_id}/${bot.bot_id}:`, err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function processMessage(bot: BotConfig, body: unknown, tracker: InFlightTracker): Promise<void> {
  const label = `${bot.client_id}/${bot.bot_id}`;
  const message = parseCmWebhook(body);
  if (!message) {
    console.warn(`[Webhook/CmCom] Corps sans message exploitable (${label})`);
    return;
  }
  const shortId = shortMessageId(message.messageId);
  const waNumber = normalizeWhatsAppNumber(message.toNumber);
  if (!waNumber || !bot.whatsapp_numbers.includes(waNumber)) {
    console.warn(`[Webhook/CmCom] Numéro destinataire du message ${shortId} étranger à ${label}, ignoré`);
    return;
  }
  const transport = await getTransportForBot(bot);
  if (!transport) {
    console.warn(`[Webhook/CmCom] Identifiants de transport incomplets pour ${label}, message ${shortId} ignoré`);
    return;
  }
  await serveMessage({ bot, transport, waNumber, message }, tracker);
}

export function createCmWebhookRouter(tracker: InFlightTracker): express.Router {
  const router = express.Router();

  router.post('/webhook/cm-com/:clientId/:botId/:secret', async (req, res) => {
    const { clientId, botId, secret } = req.params;
    const bot = findBot(clientId, botId);
    if (!(await isAuthorized(bot, secret)) || !bot) {
      console.warn('[Webhook/CmCom] URL de webhook refusée');
      res.sendStatus(404);
      return;
    }
    void tracker.track(processMessage(bot, req.body, tracker)).catch((err: unknown) => {
      console.error(`[Webhook/CmCom] Message non traité (${bot.client_id}/${bot.bot_id}):`, err instanceof Error ? err.message : String(err));
    });
    res.sendStatus(200);
  });

  return router;
}
