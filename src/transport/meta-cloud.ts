/**
 * Transport WhatsApp via Meta Cloud API (officielle).
 * Implémente l'interface Transport.
 *
 * Doc : https://developers.facebook.com/docs/whatsapp/cloud-api
 */

import crypto from 'crypto';
import { config } from '../core/config.js';
import { isBsuid } from '../core/phone.js';
import { TransportSendError } from './types.js';
import type {
  Transport, ReplyButton, ListSection, ProductListSection, OrderItem, IncomingMessage, SendErrorKind,
} from './types.js';

export const META_API_BASE = 'https://graph.facebook.com';
const MAX_RETRIES = 2;
const RETRY_DELAYS = [1000, 3000];

/** Code d'erreur Graph (error.code) lu dans le corps d'une réponse, undefined si illisible. */
export function parseMetaErrorCode(body: string): number | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const error = (parsed as { error?: unknown }).error;
    if (typeof error !== 'object' || error === null) return undefined;
    const code = (error as { code?: unknown }).code;
    return typeof code === 'number' ? code : undefined;
  } catch {
    return undefined;
  }
}

/** Classe un échec d'envoi Meta : 190 ou 401 = auth, 131047 = fenêtre fermée, 429/5xx/130429/131056 = transitoire. */
export function classifyMetaError(status: number, body: string): SendErrorKind {
  const code = parseMetaErrorCode(body);
  if (code === 190 || status === 401) return 'auth';
  if (code === 131047) return 'window_closed';
  if (status === 429 || status >= 500 || code === 130429 || code === 131056) return 'transient';
  return 'other';
}

/** Normalise un numero pour Meta Cloud API : digits only, sans + ni 00. Un BSUID passe inchangé. */
export function toMetaNumber(phone: string): string {
  if (isBsuid(phone)) return phone;
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) return digits.slice(2);
  return digits;
}

/** Lot lu dans un POST Meta : messages entrants, statuts d'envoi et événements de compte. */
export interface MetaWebhookBatch {
  messages: IncomingMessage[];
  /**
   * `recipientId` : phone_number_id du numéro de l'organisation concerné (jamais le numéro du contact) ;
   * `providerAccountId` : WABA de l'entrée (`entry.id`).
   */
  statuses: Array<{ recipientId: string; providerAccountId: string; status: string; errorCodes: number[] }>;
  /** Changements dont le champ n'est pas `messages` (account_update, phone_number_quality_update, ...). */
  accountEvents: Array<{ field: string; entryId: string }>;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function toQuantity(value: unknown): number {
  if (typeof value === 'string') return parseInt(value, 10) || 1;
  return typeof value === 'number' && value ? value : 1;
}

function toPrice(value: unknown): number {
  if (typeof value === 'string') return parseFloat(value) || 0;
  return typeof value === 'number' ? value : 0;
}

function readOrderItems(order: JsonObject): OrderItem[] {
  return asArray(order.product_items).flatMap((raw) => {
    const item = asObject(raw);
    if (!item) return [];
    return [{
      product_retailer_id: asString(item.product_retailer_id) ?? '',
      quantity: toQuantity(item.quantity),
      item_price: toPrice(item.item_price),
      currency: asString(item.currency) ?? 'EUR',
    }];
  });
}

/**
 * Nom de profil du contact : celui dont wa_id (numéro) ou user_id (BSUID) correspond à l'expéditeur, sinon
 * l'unique contact du changement.
 */
function readProfileName(contacts: unknown[], from: string): string | undefined {
  const objects = contacts.map(asObject).filter((c): c is JsonObject => c !== null);
  const match = objects.find((c) => c.wa_id === from || c.user_id === from) ?? (objects.length === 1 ? objects[0] : undefined);
  return asString(asObject(match?.profile)?.name);
}

function parseMetaMessage(raw: unknown, metadata: JsonObject | null, contacts: unknown[], entryId: string): IncomingMessage | null {
  const msg = asObject(raw);
  if (!msg) return null;
  // Numéro du contact d'abord ; BSUID (`from_user_id`) quand le numéro est masqué (tâche 0, f4).
  const contactId = asString(msg.from) ?? asString(msg.from_user_id);
  if (!contactId) return null;

  const providerType = asString(msg.type) ?? 'unknown';
  const messageId = asString(msg.id) ?? `meta_${crypto.randomUUID()}`;
  const date = new Date(parseInt(asString(msg.timestamp) ?? '', 10) * 1000);
  // Une date invalide (NaN, valeur démesurée) ferait lever toISOString : repli sur l'heure courante.
  const timestamp = Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();

  const base = {
    contactId,
    toNumber: asString(metadata?.display_phone_number) ?? '',
    recipientId: asString(metadata?.phone_number_id),
    providerAccountId: entryId,
    providerType,
    messageId,
    timestamp,
    profileName: readProfileName(contacts, contactId),
  };
  const unsupported: IncomingMessage = { ...base, kind: 'unsupported', text: '' };

  switch (providerType) {
    case 'text': {
      const body = asString(asObject(msg.text)?.body);
      if (!body) return { ...base, kind: 'ignored', text: '' };
      return { ...base, kind: 'text', text: body.length > 2000 ? body.slice(0, 2000) : body };
    }
    case 'interactive': {
      const interactive = asObject(msg.interactive);
      const title = asString(asObject(interactive?.button_reply)?.title) ?? asString(asObject(interactive?.list_reply)?.title);
      return title ? { ...base, kind: 'text', text: title } : unsupported;
    }
    case 'button': {
      // Réponse rapide d'un modèle : le texte du bouton tient lieu de message.
      const text = asString(asObject(msg.button)?.text);
      return text ? { ...base, kind: 'text', text } : unsupported;
    }
    case 'audio': {
      const audio = asObject(msg.audio);
      return { ...base, kind: 'audio', text: '', mediaUrl: asString(audio?.id), mediaType: asString(audio?.mime_type) ?? 'audio/ogg' };
    }
    case 'image':
    case 'video':
    case 'document': {
      const media = asObject(msg[providerType]);
      return { ...base, kind: 'media', text: '', mediaUrl: asString(media?.id), mediaType: asString(media?.mime_type) };
    }
    case 'order': {
      const order = asObject(msg.order);
      const items = order ? readOrderItems(order) : [];
      if (!order || items.length === 0) return unsupported;
      const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
      return {
        ...base,
        kind: 'order',
        text: `[ORDER_RECEIVED] ${itemCount} produit(s)`,
        order: { catalog_id: asString(order.catalog_id) ?? '', items },
      };
    }
    case 'reaction':
      // Une réaction n'appelle pas de réponse ; l'appelant la journalise.
      return { ...base, kind: 'ignored', text: '' };
    default:
      return unsupported;
  }
}

/**
 * Lit un POST Meta en entier : toutes les entrées, tous les changements, tous les messages et statuts.
 * Pure : aucun identifiant requis, ne lève jamais (un corps invalide donne un lot vide).
 */
export function parseMetaWebhook(body: unknown): MetaWebhookBatch {
  const batch: MetaWebhookBatch = { messages: [], statuses: [], accountEvents: [] };
  try {
    for (const rawEntry of asArray(asObject(body)?.entry)) {
      const entry = asObject(rawEntry);
      if (!entry) continue;
      const entryId = asString(entry.id) ?? '';
      for (const rawChange of asArray(entry.changes)) {
        const change = asObject(rawChange);
        if (!change) continue;
        const field = asString(change.field);
        if (!field) continue;
        if (field !== 'messages') {
          batch.accountEvents.push({ field, entryId });
          continue;
        }
        const value = asObject(change.value);
        if (!value) continue;
        const metadata = asObject(value.metadata);
        const contacts = asArray(value.contacts);

        for (const rawMessage of asArray(value.messages)) {
          try {
            const parsed = parseMetaMessage(rawMessage, metadata, contacts, entryId);
            if (parsed) batch.messages.push(parsed);
          } catch (err) {
            // Un message mal formé n'écarte pas les suivants du lot.
            console.error('[MetaCloud] Message de webhook illisible:', err instanceof Error ? err.message : 'erreur inconnue');
          }
        }
        for (const rawStatus of asArray(value.statuses)) {
          try {
            const status = asObject(rawStatus);
            if (!status) continue;
            batch.statuses.push({
              recipientId: asString(metadata?.phone_number_id) ?? '',
              providerAccountId: entryId,
              status: asString(status.status) ?? 'unknown',
              errorCodes: asArray(status.errors).flatMap((e) => {
                const code = asObject(e)?.code;
                return typeof code === 'number' ? [code] : [];
              }),
            });
          } catch (err) {
            console.error('[MetaCloud] Statut de webhook illisible:', err instanceof Error ? err.message : 'erreur inconnue');
          }
        }
      }
    }
  } catch (err) {
    console.error('[MetaCloud] Corps de webhook illisible:', err instanceof Error ? err.message : 'erreur inconnue');
  }
  return batch;
}

export interface MetaCloudTransportOptions {
  /** Phone Number ID Meta (depuis Meta Business Manager) */
  phoneNumberId: string;
  /** Access token Meta (long-lived) */
  accessToken: string;
}

export function createMetaCloudTransport(opts: MetaCloudTransportOptions): Transport {
  const { phoneNumberId, accessToken } = opts;

  if (!phoneNumberId) throw new Error('[MetaCloud] phoneNumberId is required');
  if (!accessToken) throw new Error('[MetaCloud] accessToken is required');

  // Version Graph lue à l'appel (config.meta.graphVersion), pas figée à la création du transport.
  const graphBase = (): string => `${META_API_BASE}/${config.meta.graphVersion}`;
  const sendUrl = (): string => `${graphBase()}/${phoneNumberId}/messages`;

  async function sendRequest(payload: Record<string, unknown>): Promise<void> {
    const body = JSON.stringify(payload);

    if (body.includes('product_list') || body.includes('"type":"product"') || body.includes('"type":"image"')) {
      console.log(`[MetaCloud] Interactive payload: ${body}`);
    }

    // Seules les erreurs transitoires sont réessayées ; les autres échouent tout de suite.
    // Attention : réessayer après un délai dépassé peut dupliquer un message déjà accepté
    // (l'API Cloud n'offre pas de clé d'idempotence). Comportement volontaire.
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let status: number;
      let ok: boolean;
      let responseText: string;
      try {
        const res = await fetch(sendUrl(), {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body,
          signal: AbortSignal.timeout(10000),
        });
        status = res.status;
        ok = res.ok;
        responseText = await res.text();
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        if (attempt < MAX_RETRIES) {
          console.log(`[MetaCloud] Network error, attempt ${attempt + 1}/${MAX_RETRIES}: ${reason}`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
          continue;
        }
        console.error(`[MetaCloud] Send failed (network): ${reason}`);
        throw new TransportSendError(`[MetaCloud] network error: ${reason}`, 'transient');
      }

      if (ok) {
        const logLength = (body.includes('product') || body.includes('"type":"image"')) ? 800 : 150;
        console.log(`[MetaCloud] Sent OK: ${status} ${responseText.slice(0, logLength)}`);
        return;
      }

      const kind = classifyMetaError(status, responseText);
      if (kind === 'transient' && attempt < MAX_RETRIES) {
        console.log(`[MetaCloud] Retryable error ${status}, attempt ${attempt + 1}/${MAX_RETRIES}`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
        continue;
      }

      console.error(`[MetaCloud] Send failed: ${status} (${kind}) ${responseText.slice(0, 200)}`);
      throw new TransportSendError(
        `[MetaCloud] ${status}: ${responseText.slice(0, 200)}`,
        kind,
        { status, code: parseMetaErrorCode(responseText) },
      );
    }
  }

  /** Destinataire : un BSUID va dans `recipient` et le corps n'a pas de `to` (doc Meta), un numéro garde `to`. */
  function buildBase(to: string): Record<string, unknown> {
    const recipient = toMetaNumber(to);
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      ...(isBsuid(recipient) ? { recipient } : { to: recipient }),
    };
  }

  const transport: Transport = {
    id: 'meta-cloud',
    senderId: phoneNumberId,

    async sendText(to, text) {
      await sendRequest({
        ...buildBase(to),
        type: 'text',
        text: { body: text, preview_url: false },
      });
    },

    async sendImage(to, imageUrl, caption) {
      await sendRequest({
        ...buildBase(to),
        type: 'image',
        image: { link: imageUrl, ...(caption ? { caption } : {}) },
      });
    },

    async sendButtons(to, bodyText, buttons) {
      await sendRequest({
        ...buildBase(to),
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText },
          action: {
            buttons: buttons.slice(0, 3).map((b: ReplyButton) => ({
              type: 'reply',
              reply: { id: b.id, title: b.title.slice(0, 20) },
            })),
          },
        },
      });
    },

    async sendList(to, bodyText, buttonLabel, sections) {
      await sendRequest({
        ...buildBase(to),
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: bodyText },
          action: {
            button: buttonLabel.slice(0, 20),
            sections: sections.map((s: ListSection) => ({
              title: s.title.slice(0, 24),
              rows: s.options.slice(0, 10).map((opt, i) => ({
                id: `opt_${i}_${opt.slice(0, 10).replace(/\s/g, '_')}`,
                title: opt.slice(0, 24),
              })),
            })),
          },
        },
      });
    },

    async sendImageButtons(to, imageUrl, bodyText, buttons) {
      await sendRequest({
        ...buildBase(to),
        type: 'interactive',
        interactive: {
          type: 'button',
          header: { type: 'image', image: { link: imageUrl } },
          body: { text: bodyText },
          action: {
            buttons: buttons.slice(0, 3).map((b: ReplyButton, i) => ({
              type: 'reply',
              reply: { id: b.id || `btn_${i}`, title: b.title.slice(0, 20) },
            })),
          },
        },
      });
    },

    async sendCta(to, bodyText, buttonLabel, url) {
      await sendRequest({
        ...buildBase(to),
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          body: { text: bodyText },
          action: {
            name: 'cta_url',
            parameters: { display_text: buttonLabel.slice(0, 20), url },
          },
        },
      });
    },

    async sendCatalog(to, bodyText, footerText) {
      await sendRequest({
        ...buildBase(to),
        type: 'interactive',
        interactive: {
          type: 'catalog_message',
          body: { text: bodyText },
          ...(footerText ? { footer: { text: footerText } } : {}),
          action: { name: 'catalog_message' },
        },
      });
    },

    async sendProduct(to, bodyText, catalogId, productRetailerId, footerText) {
      await sendRequest({
        ...buildBase(to),
        type: 'interactive',
        interactive: {
          type: 'product',
          body: { text: bodyText },
          ...(footerText ? { footer: { text: footerText } } : {}),
          action: { catalog_id: catalogId, product_retailer_id: productRetailerId },
        },
      });
    },

    async sendProductList(to, bodyText, headerText, catalogId, sections) {
      await sendRequest({
        ...buildBase(to),
        type: 'interactive',
        interactive: {
          type: 'product_list',
          header: { type: 'text', text: headerText },
          body: { text: bodyText },
          action: {
            catalog_id: catalogId,
            sections: sections.map((s: ProductListSection) => ({
              title: s.title.slice(0, 24),
              product_items: s.product_retailer_ids.map(id => ({ product_retailer_id: id })),
            })),
          },
        },
      });
    },

    async sendReadReceipt(messageId) {
      if (!messageId) return;
      try {
        const res = await fetch(sendUrl(), {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: messageId,
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          console.error(`[MetaCloud] read receipt failed ${res.status}: ${text.slice(0, 200)}`);
        }
      } catch (err) {
        console.error('[MetaCloud] read receipt error:', err);
      }
    },

    async sendTypingIndicator(_to, messageId) {
      // Meta Cloud API : typing indicator est envoyé en marquant le message comme "read"
      // avec un typing_indicator (ajout récent). Combiné avec sendReadReceipt côté caller.
      if (!messageId) return;
      try {
        const res = await fetch(sendUrl(), {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: messageId,
            typing_indicator: { type: 'text' },
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          console.error(`[MetaCloud] typing indicator failed ${res.status}: ${text.slice(0, 200)}`);
        }
      } catch (err) {
        console.error('[MetaCloud] typing indicator error:', err);
      }
    },

    async validateCredentials(): Promise<{ ok: boolean; error?: string }> {
      try {
        const url = `${graphBase()}/${phoneNumberId}?fields=id`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (res.ok) return { ok: true };
        const body = await res.text();
        return { ok: false, error: `Meta a répondu ${res.status}: ${body.slice(0, 200)}` };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  return transport;
}
