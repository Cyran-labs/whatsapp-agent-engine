/**
 * Webhook CM.com, un par compte WhatsApp CM.com : `/webhook/cm-com/<clé>` (spec §7.3, choix 2). CM.com ne
 * signe pas ses appels : la clé d'URL, 32 octets aléatoires dont la base ne garde que l'empreinte, est
 * l'authentification. Clé inconnue, compte déconnecté ou d'un autre mode : 404 avant toute lecture du corps.
 * Le numéro destinataire est cherché dans l'inventaire de CE compte seulement.
 */
import express from 'express';
import { getDatabase } from '../core/db.js';
import type { WhatsAppAccountRecord } from '../core/database/whatsapp-types.js';
import { normalizeWhatsAppNumber } from '../core/phone.js';
import type { InFlightTracker } from '../core/in-flight.js';
import { parseCmWebhook } from '../transport/cm-com.js';
import { findAccountByKey } from './account-key.js';
import { routeAndServe } from './pipeline.js';
import { webhookJsonParser } from './raw-body.js';

async function processMessage(account: WhatsAppAccountRecord, body: unknown, tracker: InFlightTracker): Promise<void> {
  const message = parseCmWebhook(body);
  if (!message) {
    console.warn(`[Webhook/CmCom] Corps sans message exploitable (compte ${account.id})`);
    return;
  }
  const waNumber = normalizeWhatsAppNumber(message.toNumber);
  const number = waNumber ? await getDatabase().findPresentNumber(account.id, { phoneE164: waNumber }) : undefined;
  await routeAndServe('Webhook/CmCom', account, number, message, tracker);
}

interface CmLocals { account?: WhatsAppAccountRecord }

export function createCmWebhookRouter(tracker: InFlightTracker): express.Router {
  const router = express.Router();

  // Compte identifié avant toute lecture du corps : un appel refusé répond 404 sans que son corps soit analysé.
  router.post('/webhook/cm-com/:key', async (req, res: express.Response<unknown, CmLocals>, next) => {
    let account: WhatsAppAccountRecord | null;
    try {
      account = await findAccountByKey(typeof req.params['key'] === 'string' ? req.params['key'] : '', 'cm_com');
    } catch (err) {
      console.error('[Webhook/CmCom] Recherche du compte impossible:', err instanceof Error ? err.message : String(err));
      res.sendStatus(500);
      return;
    }
    if (!account) {
      console.warn('[Webhook/CmCom] URL de webhook refusée');
      res.sendStatus(404);
      return;
    }
    res.locals.account = account;
    next();
  }, webhookJsonParser, (req, res: express.Response<unknown, CmLocals>) => {
    const account = res.locals.account;
    if (!account) { res.sendStatus(404); return; }
    void tracker.track(processMessage(account, req.body, tracker)).catch((err: unknown) => {
      console.error(`[Webhook/CmCom] Message non traité (compte ${account.id}):`, err instanceof Error ? err.message : String(err));
    });
    res.sendStatus(200);
  });

  return router;
}
