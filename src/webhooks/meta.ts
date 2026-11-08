/**
 * Webhooks Meta Cloud API.
 *
 * POST : signature `x-hub-signature-256` exigée, calculée sur les octets reçus avec le secret d'app de
 * l'agent IA routé par le numéro destinataire ; le `phone_number_id` du message doit être celui des
 * identifiants de cet agent IA (audit 1.5, 4.2). Rien n'est écrit avant ces contrôles.
 * GET : vérification d'abonnement par jeton global (META_VERIFY_TOKEN), refusée s'il n'est pas configuré (audit 4.3).
 */
import express from 'express';
import { config } from '../core/config.js';
import { findRoute } from '../core/router.js';
import type { BotConfig } from '../core/bot-config.js';
import { normalizeWhatsAppNumber } from '../core/phone.js';
import type { InFlightTracker } from '../core/in-flight.js';
import { getTransportForBot } from '../transport/index.js';
import { parseMetaWebhook } from '../transport/meta-cloud.js';
import type { Transport, IncomingMessage } from '../transport/types.js';
import { constantTimeEqual } from './constant-time.js';
import { serveMessage, shortMessageId } from './pipeline.js';

/** Plafond de messages traités par POST : au-delà, les messages sont ignorés (journal du nombre seulement). */
export const MAX_MESSAGES_PER_WEBHOOK = 50;

type Headers = Record<string, string | string[] | undefined>;

/** Requête dont le corps brut a été conservé par express.json (voir createApp). */
export type RawBodyRequest = express.Request & { rawBody?: Buffer };

/**
 * Transport authentifié de chaque agent IA rencontré dans le lot, ou null si son authentification a échoué.
 * Clé à deux niveaux (organisation puis agent IA) : aucune collision possible entre identifiants.
 */
type Verdicts = Map<string, Map<string, Transport | null>>;

async function authenticatedTransport(
  verdicts: Verdicts,
  bot: BotConfig,
  rawBody: Buffer,
  headers: Headers,
): Promise<Transport | null> {
  let perClient = verdicts.get(bot.client_id);
  if (!perClient) { perClient = new Map(); verdicts.set(bot.client_id, perClient); }
  if (perClient.has(bot.bot_id)) return perClient.get(bot.bot_id) ?? null;

  const label = `${bot.client_id}/${bot.bot_id}`;
  let verdict: Transport | null = null;
  const transport = await getTransportForBot(bot);
  if (!transport) {
    // Aucun repli sur la plateforme : sans identifiants complets, on ne vérifie ni ne répond.
    console.warn(`[Webhook/Meta] Identifiants de transport incomplets pour ${label}, messages ignorés`);
  } else if (!transport.verifyWebhookSignature || !transport.verifyWebhookSignature(rawBody, headers)) {
    console.warn(`[Webhook/Meta] Signature invalide pour ${label}, messages ignorés`);
  } else {
    verdict = transport;
  }
  perClient.set(bot.bot_id, verdict);
  return verdict;
}

async function routeMessage(
  message: IncomingMessage,
  rawBody: Buffer,
  headers: Headers,
  verdicts: Verdicts,
  tracker: InFlightTracker,
): Promise<void> {
  const shortId = shortMessageId(message.messageId);
  const waNumber = normalizeWhatsAppNumber(message.toNumber);
  const bot = waNumber ? findRoute(waNumber) : null;
  if (!waNumber || !bot) {
    console.warn(`[Webhook/Meta] Aucun agent IA pour le numéro destinataire du message ${shortId}, ignoré`);
    return;
  }
  if (bot.transport !== 'meta-cloud') {
    console.warn(`[Webhook/Meta] Agent IA ${bot.client_id}/${bot.bot_id} de transport ${bot.transport}, message ${shortId} ignoré`);
    return;
  }
  const transport = await authenticatedTransport(verdicts, bot, rawBody, headers);
  if (!transport) return;
  if (message.recipientId !== transport.senderId) {
    console.warn(`[Webhook/Meta] phone_number_id du message ${shortId} différent de celui de ${bot.client_id}/${bot.bot_id}, ignoré`);
    return;
  }
  await serveMessage({ bot, transport, waNumber, message }, tracker);
}

async function processBatch(body: unknown, rawBody: Buffer, headers: Headers, tracker: InFlightTracker): Promise<void> {
  const batch = parseMetaWebhook(body);
  if (batch.statuses.length > 0 || batch.accountEvents.length > 0) {
    const fields = [...new Set(batch.accountEvents.map((e) => e.field))];
    console.log(`[Webhook/Meta] ${batch.statuses.length} statut(s), ${batch.accountEvents.length} événement(s) de compte${fields.length > 0 ? ` (${fields.join(', ')})` : ''}`);
  }

  let messages = batch.messages;
  if (messages.length > MAX_MESSAGES_PER_WEBHOOK) {
    console.warn(`[Webhook/Meta] Lot de ${messages.length} messages : ${messages.length - MAX_MESSAGES_PER_WEBHOOK} message(s) ignoré(s) au-delà de ${MAX_MESSAGES_PER_WEBHOOK}`);
    messages = messages.slice(0, MAX_MESSAGES_PER_WEBHOOK);
  }

  const verdicts: Verdicts = new Map();
  // Séquentiel jusqu'à la mise en file : l'ordre du lot est conservé au sein de chaque conversation.
  for (const message of messages) {
    try {
      await routeMessage(message, rawBody, headers, verdicts, tracker);
    } catch (err) {
      console.error(`[Webhook/Meta] Message ${shortMessageId(message.messageId)} non traité:`, err instanceof Error ? err.message : String(err));
    }
  }
}

function queryString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function createMetaWebhookRouter(tracker: InFlightTracker): express.Router {
  const router = express.Router();

  router.get('/webhook/meta', (req, res) => {
    const expected = config.meta.verifyToken;
    const mode = queryString(req.query['hub.mode']);
    const token = queryString(req.query['hub.verify_token']);
    if (expected === '' || mode !== 'subscribe' || !constantTimeEqual(token, expected)) {
      console.warn(`[Webhook/Meta] Vérification refusée (jeton ${expected === '' ? 'non configuré' : 'invalide'})`);
      res.sendStatus(403);
      return;
    }
    console.log('[Webhook/Meta] Vérification acceptée');
    res.status(200).type('text/plain').set('X-Content-Type-Options', 'nosniff').send(queryString(req.query['hub.challenge']));
  });

  router.post('/webhook/meta', (req: RawBodyRequest, res) => {
    const rawBody = req.rawBody;
    const signature = req.headers['x-hub-signature-256'];
    if (!rawBody || rawBody.length === 0 || typeof signature !== 'string' || signature === '') {
      console.warn('[Webhook/Meta] Requête sans corps brut ou sans signature, refusée');
      res.sendStatus(401);
      return;
    }
    // Suivi avant la réponse : l'arrêt propre attend ce lot même s'il vient d'être accusé.
    void tracker.track(processBatch(req.body, rawBody, req.headers, tracker)).catch((err: unknown) => {
      console.error('[Webhook/Meta] Lot non traité:', err instanceof Error ? err.message : String(err));
    });
    res.sendStatus(200);
  });

  return router;
}
