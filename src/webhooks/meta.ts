/**
 * Webhooks Meta Cloud API, un par compte WhatsApp (mode manuel) : `/webhook/meta/<clé>` (spec §7.3, choix 2).
 *
 * POST, ordre strict : en-tête `x-hub-signature-256` présent (sinon 401, avant toute lecture du corps,
 * revue finale 2b-1 m7) ; compte identifié par l'empreinte de la clé d'URL, en mode Meta et non déconnecté
 * (sinon 404, avant lecture du corps) ; corps brut lu ; signature vérifiée UNE fois avec le secret d'app du
 * compte (revue 2b-1 M-3). Fausse : compteur en mémoire (choix 4), 200, rien d'autre. Bonne : chaque message
 * de la WABA du compte est routé par son phone_number_id dans l'inventaire de CE compte (point d'attention 1).
 * Rien n'est écrit ni journalisé de la requête avant la vérification de la signature (audit 4.2).
 *
 * GET : vérification d'abonnement par le jeton propre au compte, comparé en temps constant (audit 4.3). Sans compte
 * pour la clé, le registre des raccordements en cours (`pending-verification.ts`) peut répondre ; le POST jamais.
 */
import express from 'express';
import { getDatabase } from '../core/db.js';
import type { WhatsAppAccountRecord, WhatsAppNumberRecord } from '../core/database/whatsapp-types.js';
import type { InFlightTracker } from '../core/in-flight.js';
import { decryptAccountSecrets } from '../transport/index.js';
import { parseMetaWebhook } from '../transport/meta-cloud.js';
import type { IncomingMessage } from '../transport/types.js';
import { verifyMetaSignature } from './meta-signature.js';
import { recordSignatureFailure, recordSignatureSuccess } from './signature-monitor.js';
import { constantTimeEqual } from './constant-time.js';
import { routeAndServe } from './pipeline.js';
import { webhookJsonParser } from './raw-body.js';
import type { RawBodyRequest } from './raw-body.js';
import { findAccountByKey } from './account-key.js';
import { matchPendingVerification } from './pending-verification.js';
import { handleMetaEvents } from '../whatsapp/meta-events.js';
import type { RefreshScheduler } from '../whatsapp/refresh-scheduler.js';
import { NO_REFRESH_SCHEDULER } from '../whatsapp/refresh-scheduler.js';

/** Plafond de messages traités par POST : au-delà, les messages sont ignorés (journal du nombre seulement). */
export const MAX_MESSAGES_PER_WEBHOOK = 50;

/** `last_signature_ok_at` n'est réécrit qu'au-delà de ce délai : pas d'écriture à chaque POST. */
const SIGNATURE_OK_REFRESH_MS = 10 * 60_000;

/** Nom de champ Meta journalisable : minuscules et soulignés, 64 caractères au plus, sinon « autre ». */
export function safeFieldName(field: string): string {
  return /^[a-z_]{1,64}$/.test(field) ? field : 'autre';
}

/** Au plus ce nombre de noms de champ distincts dans le journal d'un lot. */
const MAX_LOGGED_FIELDS = 10;

// Valeur de comparaison quand aucun jeton n'est attendu (clé inconnue) : le refus coûte une comparaison complète.
const NO_VERIFY_TOKEN = 'aucun-jeton-attendu';

async function touchSignatureIfStale(account: WhatsAppAccountRecord): Promise<void> {
  const last = account.last_signature_ok_at === null ? Number.NaN : Date.parse(account.last_signature_ok_at);
  if (!Number.isNaN(last) && Date.now() - last <= SIGNATURE_OK_REFRESH_MS) return;
  try {
    await getDatabase().touchSignatureOk(account.id, new Date().toISOString());
  } catch (err) {
    console.error(`[Webhook/Meta] Dernière signature valide non enregistrée (compte ${account.id}):`, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Compte `connected` de la même organisation et de la même app Meta que le compte de l'URL, pour la WABA donnée (spec R1
 * §5.4) : seule façon de reconnaître une WABA étrangère d'un lot. Jamais un compte d'une autre organisation ni d'une
 * autre app ; une lecture en échec compte comme « aucun ».
 */
function siblingFinder(account: WhatsAppAccountRecord): (wabaId: string) => Promise<WhatsAppAccountRecord | undefined> {
  const found = new Map<string, WhatsAppAccountRecord | undefined>();
  const metaAppId = account.meta_app_id;
  return async (wabaId) => {
    if (metaAppId === null || wabaId === account.provider_account_id) return undefined;
    if (!found.has(wabaId)) {
      let sibling: WhatsAppAccountRecord | undefined;
      try {
        sibling = await getDatabase().findConnectedMetaAccountByWaba(account.client_id, metaAppId, wabaId);
      } catch (err) {
        console.error(`[Webhook/Meta] Recherche d'un compte de la même app impossible (compte ${account.id}):`, err instanceof Error ? err.message : String(err));
      }
      // Défense : le pilote filtre déjà par organisation et par app.
      found.set(wabaId, sibling !== undefined && sibling.id !== account.id && sibling.client_id === account.client_id
        && sibling.meta_app_id === metaAppId ? sibling : undefined);
    }
    return found.get(wabaId);
  };
}

/**
 * Lot authentifié (signature vérifiée avec le secret de l'app du compte). Messages et statuts : seuls ceux de la WABA du
 * compte sont traités, les messages routés dans son inventaire ; ceux d'une autre WABA ne sont jamais routés (une seule
 * façon de router un message : l'adresse propre de sa WABA, puis le numéro destinataire). Événements de compte : ceux
 * d'une WABA B sont traités pour B seulement si B est un compte `connected` de la même organisation et de la même app
 * (spec R1 §5.4, le webhook de l'app porte les événements de toutes ses WABA). Un message de B reçu ici dit que
 * l'adresse propre de B a disparu chez Meta : B est marqué `waba: missing`, au plus une fois par lot.
 */
async function processBatch(
  account: WhatsAppAccountRecord, body: unknown, tracker: InFlightTracker, scheduler: RefreshScheduler,
): Promise<void> {
  await touchSignatureIfStale(account);
  const batch = parseMetaWebhook(body);
  const waba = account.provider_account_id;
  const sibling = siblingFinder(account);

  const own = batch.messages.filter((m) => m.providerAccountId === waba);
  const statuses = batch.statuses.filter((s) => s.providerAccountId === waba);
  const events = batch.accountEvents.filter((e) => e.entryId === waba);

  // Événements de compte d'une autre WABA de la même organisation et de la même app, regroupés par compte.
  const siblingEvents = new Map<number, { target: WhatsAppAccountRecord; events: typeof events }>();
  let ignoredEvents = 0;
  for (const event of batch.accountEvents) {
    if (event.entryId === waba) continue;
    const target = await sibling(event.entryId);
    if (target === undefined) { ignoredEvents++; continue; }
    const group = siblingEvents.get(target.id) ?? { target, events: [] };
    group.events.push(event);
    siblingEvents.set(target.id, group);
  }

  const foreignMessages = batch.messages.filter((m) => m.providerAccountId !== waba);
  const foreign = foreignMessages.length + (batch.statuses.length - statuses.length) + ignoredEvents;
  if (foreign > 0) {
    console.warn(`[Webhook/Meta] ${foreign} élément(s) d'une autre WABA ignoré(s) (compte ${account.id})`);
  }

  if (statuses.length > 0 || events.length > 0) {
    // Statuts et événements de compte (échecs de livraison, alertes, rafraîchissement d'inventaire) : une erreur
    // ici n'empêche pas le routage des messages du même lot. Journal : nombre et champs filtrés seulement.
    try {
      await handleMetaEvents(account, { statuses, accountEvents: events }, { db: getDatabase(), scheduler });
    } catch (err) {
      console.error(`[Webhook/Meta] Statuts et événements non traités (compte ${account.id}):`, err instanceof Error ? err.message : String(err));
    }
    const fields = [...new Set(events.map((e) => safeFieldName(e.field)))].slice(0, MAX_LOGGED_FIELDS);
    console.log(`[Webhook/Meta] ${statuses.length} statut(s), ${events.length} événement(s) de compte${fields.length > 0 ? ` (${fields.join(', ')})` : ''} (compte ${account.id})`);
  }

  for (const { target, events: targetEvents } of siblingEvents.values()) {
    // Événements de compte seulement : aucun statut ni message d'une autre WABA n'est passé ici.
    try {
      await handleMetaEvents(target, { statuses: [], accountEvents: targetEvents }, { db: getDatabase(), scheduler });
    } catch (err) {
      console.error(`[Webhook/Meta] Événements d'un compte de la même app non traités (compte ${target.id}):`, err instanceof Error ? err.message : String(err));
    }
    console.log(`[Webhook/Meta] ${targetEvents.length} événement(s) de compte du compte ${target.id} reçu(s) sur l'adresse du compte ${account.id}`);
  }

  await markMissingWabaWebhooks(
    foreignMessages.flatMap((m) => (m.providerAccountId === undefined ? [] : [m.providerAccountId])), sibling, account.id,
  );

  let messages: IncomingMessage[] = own;
  if (messages.length > MAX_MESSAGES_PER_WEBHOOK) {
    console.warn(`[Webhook/Meta] Lot de ${messages.length} messages : ${messages.length - MAX_MESSAGES_PER_WEBHOOK} message(s) ignoré(s) au-delà de ${MAX_MESSAGES_PER_WEBHOOK}`);
    messages = messages.slice(0, MAX_MESSAGES_PER_WEBHOOK);
  }

  // Numéro cherché une fois par phone_number_id du lot, dans l'inventaire de ce compte seulement.
  const numbers = new Map<string, WhatsAppNumberRecord | undefined>();
  const findNumber = async (providerNumberId: string | undefined): Promise<WhatsAppNumberRecord | undefined> => {
    if (providerNumberId === undefined) return undefined;
    if (!numbers.has(providerNumberId)) {
      numbers.set(providerNumberId, await getDatabase().findPresentNumber(account.id, { providerNumberId }));
    }
    return numbers.get(providerNumberId);
  };

  // Séquentiel jusqu'à la mise en file : l'ordre du lot est conservé au sein de chaque conversation.
  for (const message of messages) {
    try {
      await routeAndServe('Webhook/Meta', account, await findNumber(message.recipientId), message, tracker);
    } catch (err) {
      console.error(`[Webhook/Meta] Message non traité (compte ${account.id}):`, err instanceof Error ? err.message : String(err));
    }
  }
}

/**
 * Messages d'une WABA B reçus sur l'adresse d'un autre compte : l'adresse propre de B a disparu chez Meta. B (même
 * organisation, même app, retrouvé par `sibling` seulement) est marqué `waba: missing` par une écriture partielle du
 * store, ses autres champs gardés ; au plus un appel par lot et par compte. Journal : nombre seulement.
 */
async function markMissingWabaWebhooks(
  wabaIds: string[], sibling: (wabaId: string) => Promise<WhatsAppAccountRecord | undefined>, receiverId: number,
): Promise<void> {
  const marked = new Set<number>();
  for (const wabaId of new Set(wabaIds)) {
    const target = await sibling(wabaId);
    if (target === undefined || marked.has(target.id)) continue;
    marked.add(target.id);
    let written = false;
    try {
      // Écriture partielle en une requête : un état écrit entre-temps par une vérification (app, app_host) est gardé.
      written = await getDatabase().markWhatsAppAccountWabaWebhookMissing(target.client_id, target.id);
    } catch (err) {
      console.error(`[Webhook/Meta] Webhook absent non enregistré (compte ${target.id}):`, err instanceof Error ? err.message : String(err));
      continue;
    }
    if (!written) continue;
    console.warn(`[Webhook/Meta] Compte ${target.id} : messages reçus sur l'adresse du compte ${receiverId}, webhook de la WABA marqué absent`);
  }
}

function queryString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

interface MetaLocals { account?: WhatsAppAccountRecord }

export function createMetaWebhookRouter(tracker: InFlightTracker, scheduler: RefreshScheduler = NO_REFRESH_SCHEDULER): express.Router {
  const router = express.Router();

  router.get('/webhook/meta/:key', async (req, res) => {
    let account: WhatsAppAccountRecord | null = null;
    try {
      account = await findAccountByKey(queryString(req.params['key']), 'meta_manual');
    } catch (err) {
      console.error('[Webhook/Meta] Recherche du compte impossible:', err instanceof Error ? err.message : String(err));
      res.sendStatus(500);
      return;
    }
    const key = queryString(req.params['key']);
    const mode = queryString(req.query['hub.mode']);
    const token = queryString(req.query['hub.verify_token']);
    const challenge = queryString(req.query['hub.challenge']);
    const reply = (): void => {
      res.status(200).type('text/plain').set('X-Content-Type-Options', 'nosniff').send(challenge);
    };
    if (!account) {
      // Raccordement en cours : Meta vérifie l'URL avant que le compte existe. Même réponse que pour un compte.
      if (matchPendingVerification(key, token) && mode === 'subscribe') {
        console.log('[Webhook/Meta] Vérification acceptée (raccordement en cours)');
        reply();
        return;
      }
      console.warn('[Webhook/Meta] Vérification refusée');
      res.sendStatus(403);
      return;
    }
    const secrets = decryptAccountSecrets(account);
    const expected = secrets?.mode === 'meta_manual' ? secrets.verify_token : NO_VERIFY_TOKEN;
    const matches = constantTimeEqual(token, expected);
    if (secrets === null || mode !== 'subscribe' || !matches) {
      console.warn('[Webhook/Meta] Vérification refusée');
      res.sendStatus(403);
      return;
    }
    console.log(`[Webhook/Meta] Vérification acceptée (compte ${account.id})`);
    reply();
  });

  // Signature exigée puis compte identifié, tous deux avant toute lecture du corps.
  router.post('/webhook/meta/:key', async (req, res: express.Response<unknown, MetaLocals>, next) => {
    const signature = req.headers['x-hub-signature-256'];
    if (typeof signature !== 'string' || signature === '') {
      console.warn('[Webhook/Meta] Requête sans signature, refusée');
      res.sendStatus(401);
      return;
    }
    let account: WhatsAppAccountRecord | null;
    try {
      account = await findAccountByKey(queryString(req.params['key']), 'meta_manual');
    } catch (err) {
      console.error('[Webhook/Meta] Recherche du compte impossible:', err instanceof Error ? err.message : String(err));
      res.sendStatus(500);
      return;
    }
    if (!account) {
      console.warn('[Webhook/Meta] URL de webhook inconnue, refusée');
      res.sendStatus(404);
      return;
    }
    res.locals.account = account;
    next();
  }, webhookJsonParser, (req: RawBodyRequest, res: express.Response<unknown, MetaLocals>) => {
    const account = res.locals.account;
    if (!account) { res.sendStatus(404); return; }
    const rawBody = req.rawBody;
    const signature = req.headers['x-hub-signature-256'];
    if (!rawBody || rawBody.length === 0 || typeof signature !== 'string') {
      console.warn(`[Webhook/Meta] Requête sans corps JSON, refusée (compte ${account.id})`);
      res.sendStatus(401);
      return;
    }
    const secrets = decryptAccountSecrets(account);
    if (!secrets || secrets.mode !== 'meta_manual') {
      // Aucun repli sur un secret de la plateforme : sans secret d'app du compte, rien n'est vérifié ni servi.
      console.warn(`[Webhook/Meta] Secrets du compte ${account.id} illisibles ou incomplets, lot ignoré`);
      res.sendStatus(200);
      return;
    }
    // Une seule vérification par POST, quel que soit le nombre de messages (revue 2b-1 M-3).
    if (!verifyMetaSignature(rawBody, signature, secrets.app_secret)) {
      recordSignatureFailure(account.id);
      console.warn(`[Webhook/Meta] Signature invalide pour le compte ${account.id}, lot ignoré`);
      res.sendStatus(200);
      return;
    }
    recordSignatureSuccess(account.id);
    // Suivi avant la réponse : l'arrêt propre attend ce lot même s'il vient d'être accusé.
    void tracker.track(processBatch(account, req.body, tracker, scheduler)).catch((err: unknown) => {
      console.error(`[Webhook/Meta] Lot non traité (compte ${account.id}):`, err instanceof Error ? err.message : String(err));
    });
    res.sendStatus(200);
  });

  return router;
}
