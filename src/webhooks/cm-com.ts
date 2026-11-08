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
import { webhookJsonParser } from './raw-body.js';

function findBot(clientId: string, botId: string): BotConfig | null {
  try {
    return getBotConfig(clientId, botId);
  } catch {
    return null;
  }
}

// Valeur de comparaison quand aucun secret n'est attendu : le refus coûte une comparaison complète,
// que l'agent IA de l'URL existe ou non.
const NO_SECRET = 'aucun-secret-attendu';

/**
 * Le secret est lu et comparé dans tous les cas (agent IA inconnu, autre transport, secret absent) :
 * la durée de la réponse ne révèle pas l'existence de l'organisation ou de l'agent IA.
 */
async function isAuthorized(clientId: string, botId: string, bot: BotConfig | null, secret: string): Promise<boolean> {
  let expected: string | null = null;
  try {
    expected = await getCmWebhookSecret(clientId, botId);
  } catch (err) {
    console.error('[Webhook/CmCom] Secret de webhook illisible:', err instanceof Error ? err.message : String(err));
  }
  const matches = constantTimeEqual(secret, expected ?? NO_SECRET);
  return matches && expected !== null && bot !== null && bot.transport === 'cm-com';
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

interface CmLocals { bot?: BotConfig }

export function createCmWebhookRouter(tracker: InFlightTracker): express.Router {
  const router = express.Router();
  const path = '/webhook/cm-com/:clientId/:botId/:secret';

  // URL vérifiée avant toute lecture du corps : un appel refusé répond 404 sans que son corps soit analysé.
  router.post(path, async (req, res: express.Response<unknown, CmLocals>, next) => {
    const { clientId, botId, secret } = req.params;
    const bot = findBot(clientId, botId);
    if (!(await isAuthorized(clientId, botId, bot, secret)) || !bot) {
      console.warn('[Webhook/CmCom] URL de webhook refusée');
      res.sendStatus(404);
      return;
    }
    res.locals.bot = bot;
    next();
  }, webhookJsonParser, (req, res: express.Response<unknown, CmLocals>) => {
    const bot = res.locals.bot;
    if (!bot) { res.sendStatus(404); return; }
    void tracker.track(processMessage(bot, req.body, tracker)).catch((err: unknown) => {
      console.error(`[Webhook/CmCom] Message non traité (${bot.client_id}/${bot.bot_id}):`, err instanceof Error ? err.message : String(err));
    });
    res.sendStatus(200);
  });

  return router;
}
