/**
 * Transport WhatsApp via CM.com BSP.
 * Implémente l'interface Transport.
 */

import { randomUUID } from 'crypto';
import { isBsuid } from '../core/phone.js';
import { TransportSendError } from './types.js';
import type {
  Transport, ReplyButton, ListSection, ProductListSection, OrderItem, IncomingMessage, SendErrorKind,
} from './types.js';

const MAX_RETRIES = 2;
const RETRY_DELAYS = [1000, 3000];

/** Code d'erreur CM.com lu dans le corps JSON (`errorCode`) ; undefined si le corps n'est pas du JSON valide. */
export function parseCmErrorCode(body: string): number | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const code = (parsed as { errorCode?: unknown }).errorCode;
    return typeof code === 'number' ? code : undefined;
  } catch {
    return undefined;
  }
}

/** Code renvoyé par CM.com pour un jeton produit invalide, avec un statut HTTP 400 (observé en réel). */
const CM_INVALID_TOKEN_CODE = 103;

/**
 * Classe un échec d'envoi CM.com : errorCode 103, 401 ou 403 = auth (le code l'emporte sur le statut),
 * 429/5xx = transitoire. Seul le code 103 est connu ; les autres codes ne sont pas interprétés.
 */
export function classifyCmError(status: number, body: string): SendErrorKind {
  if (parseCmErrorCode(body) === CM_INVALID_TOKEN_CODE || status === 401 || status === 403) return 'auth';
  if (status === 429 || status >= 500) return 'transient';
  return 'other';
}

/** Normalise un numero vers le format CM.com (00XXXXXXXXXXXX). Un BSUID passe inchangé (doc CM.com : dans `to.number`). */
export function toCmNumber(phone: string): string {
  if (isBsuid(phone)) return phone;
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) return digits;
  return `00${digits}`;
}

/** Normalise un numero CM.com vers le format interne (sans 00 ni +) */
export function fromCmNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) return digits.slice(2);
  return digits;
}

interface CmOrderItem {
  product_retailer_id?: string;
  quantity?: string | number;
  item_price?: string | number;
  currency?: string;
}

interface CmWebhookPayload {
  reference?: string;
  messageContext?: string;
  from?: { number?: string; name?: string };
  to?: { number?: string };
  message?: {
    text?: string;
    media?: { mediaUri?: string; contentType?: string; title?: string };
    custom?: {
      interactive?: {
        type?: string;
        button_reply?: { id?: string; title?: string };
        list_reply?: { id?: string; title?: string };
      };
      order?: {
        catalog_id?: string;
        product_items?: CmOrderItem[];
        text?: string | null;
      };
      message_type?: string;
    };
  };
  channel?: string;
  timeUtc?: string;
}

function cmOrderItems(raw: CmOrderItem[]): OrderItem[] {
  return raw.map((i) => ({
    product_retailer_id: i.product_retailer_id || '',
    quantity: typeof i.quantity === 'string' ? parseInt(i.quantity, 10) || 1 : (i.quantity || 1),
    item_price: typeof i.item_price === 'string' ? parseFloat(i.item_price) || 0 : (i.item_price || 0),
    currency: i.currency || 'EUR',
  }));
}

/**
 * Parse un payload CM.com : pur, aucun identifiant requis, ne lève jamais.
 * Retourne null quand il n'y a pas d'expéditeur ni de message (accusé, événement).
 */
export function parseCmWebhook(body: unknown): IncomingMessage | null {
  try {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
    const payload = body as CmWebhookPayload;
    if (!payload.from?.number) return null;
    const msg = payload.message;
    if (!msg) return null;

    const base = {
      contactId: fromCmNumber(payload.from.number),
      toNumber: payload.to?.number ?? '',
      messageId: payload.messageContext || payload.reference || `cm_${randomUUID()}`,
      timestamp: payload.timeUtc || new Date().toISOString(),
      profileName: payload.from.name || undefined,
    };

    if (msg.media?.mediaUri && msg.media.contentType) {
      const contentType = msg.media.contentType;
      return {
        ...base,
        kind: contentType.startsWith('audio/') ? 'audio' : 'media',
        providerType: contentType,
        text: '',
        mediaUrl: msg.media.mediaUri,
        mediaType: contentType,
      };
    }

    const order = msg.custom?.order;
    if (order?.product_items && order.product_items.length > 0) {
      const items = cmOrderItems(order.product_items);
      const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
      return {
        ...base,
        kind: 'order',
        providerType: 'order',
        text: `[ORDER_RECEIVED] ${itemCount} produit(s)`,
        order: { catalog_id: order.catalog_id || '', items },
      };
    }

    const interactive = msg.custom?.interactive;
    if (interactive) {
      const title = interactive.button_reply?.title || interactive.list_reply?.title || '';
      if (title) return { ...base, kind: 'text', providerType: 'interactive', text: title };
    }

    if (msg.text) {
      return { ...base, kind: 'text', providerType: 'text', text: msg.text.length > 2000 ? msg.text.slice(0, 2000) : msg.text };
    }

    return { ...base, kind: 'unsupported', providerType: msg.custom?.message_type || 'unknown', text: '' };
  } catch (err) {
    console.error('[CmCom] Corps de webhook illisible:', err instanceof Error ? err.message : 'erreur inconnue');
    return null;
  }
}

export interface CmComTransportOptions {
  productToken: string;
  fromNumber: string;
}

/** URL d'envoi CM.com : constante du module, jamais configurable (ni par l'environnement, ni par l'organisation). */
export const CM_SEND_URL = 'https://gw.cmtelecom.com/v1.0/message';

export function createCmComTransport(opts: CmComTransportOptions): Transport {
  const { productToken, fromNumber } = opts;

  async function sendRequest(
    to: string,
    conversation: Array<Record<string, unknown>>
  ): Promise<void> {
    const payload = JSON.stringify({
      messages: {
        msg: [
          {
            body: { type: 'auto', content: '' },
            to: [{ number: toCmNumber(to) }],
            from: fromNumber,
            allowedChannels: ['WhatsApp'],
            richContent: { conversation },
          },
        ],
      },
    });

    if (payload.includes('product_list') || payload.includes('"type":"product"') || payload.includes('"type":"image"')) {
      console.log(`[CmCom] Interactive payload: ${payload}`);
    }

    // Seules les erreurs transitoires sont réessayées ; les autres échouent tout de suite.
    // Attention : réessayer après un délai dépassé peut dupliquer un message déjà accepté
    // (pas de clé d'idempotence côté envoi). Comportement volontaire.
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let status: number;
      let ok: boolean;
      let responseText: string;
      try {
        const res = await fetch(CM_SEND_URL, {
          method: 'POST',
          headers: {
            'X-CM-PRODUCTTOKEN': productToken,
            'Content-Type': 'application/json',
          },
          body: payload,
          signal: AbortSignal.timeout(10000),
        });
        status = res.status;
        ok = res.ok;
        responseText = await res.text();
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        if (attempt < MAX_RETRIES) {
          console.log(`[CmCom] Network error, attempt ${attempt + 1}/${MAX_RETRIES}: ${reason}`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
          continue;
        }
        console.error(`[CmCom] Send failed (network): ${reason}`);
        throw new TransportSendError(`[CmCom] network error: ${reason}`, 'transient');
      }

      if (ok) {
        const logLength = (payload.includes('product') || payload.includes('"type":"image"')) ? 800 : 150;
        console.log(`[CmCom] Sent OK: ${status} ${responseText.slice(0, logLength)}`);
        return;
      }

      const kind = classifyCmError(status, responseText);
      if (kind === 'transient' && attempt < MAX_RETRIES) {
        console.log(`[CmCom] Retryable error ${status}, attempt ${attempt + 1}/${MAX_RETRIES}`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
        continue;
      }

      console.error(`[CmCom] Send failed: ${status} (${kind}) ${responseText.slice(0, 200)}`);
      throw new TransportSendError(
        `[CmCom] ${status}: ${responseText.slice(0, 200)}`,
        kind,
        { status, code: parseCmErrorCode(responseText) },
      );
    }
  }

  const CM_EVENT_URL = 'https://gw.messaging.cm.com/v1.0/event';

  async function sendCmEvent(eventType: string, from: string, to: string, messageId: string, custom?: Record<string, string>): Promise<void> {
    try {
      const res = await fetch(CM_EVENT_URL, {
        method: 'POST',
        headers: {
          'X-CM-PRODUCTTOKEN': productToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: 'WhatsApp',
          event: {
            type: eventType,
            custom: { message_id: messageId, ...custom },
          },
          from: { number: from },
          to: { number: toCmNumber(to) },
        }),
      });
      const body = await res.text();
      if (!res.ok) {
        console.error(`[CmCom] ${eventType} failed ${res.status}: ${body.slice(0, 200)}`);
      } else {
        console.log(`[CmCom] ${eventType} sent OK`);
      }
    } catch (err) {
      console.error(`[CmCom] ${eventType} error:`, err);
    }
  }

  const transport: Transport = {
    id: 'cm-com',
    senderId: fromNumber,

    async sendText(to, text) {
      await sendRequest(to, [{ text }]);
    },

    async sendImage(to, imageUrl, caption) {
      await sendRequest(to, [{
        media: {
          mediaName: caption || 'image.jpg',
          mediaUri: imageUrl,
          mimeType: 'image/jpeg',
        },
      }]);
    },

    async sendButtons(to, bodyText, buttons) {
      await sendRequest(to, [{
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
      }]);
    },

    async sendList(to, bodyText, buttonLabel, sections) {
      await sendRequest(to, [{
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
      }]);
    },

    async sendImageButtons(to, imageUrl, bodyText, buttons) {
      await sendRequest(to, [{
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
      }]);
    },

    async sendCta(to, bodyText, buttonLabel, url) {
      await sendRequest(to, [{
        interactive: {
          type: 'button',
          body: { text: bodyText },
          action: {
            buttons: [{
              type: 'openurl',
              id: 'cta_0',
              title: buttonLabel.slice(0, 20),
              url,
            }],
          },
        },
      }]);
    },

    async sendCatalog(to, bodyText, footerText) {
      await sendRequest(to, [{
        interactive: {
          type: 'catalog_message',
          body: { text: bodyText },
          ...(footerText ? { footer: { text: footerText } } : {}),
          action: { name: 'catalog_message' },
        },
      }]);
    },

    async sendProduct(to, bodyText, catalogId, productRetailerId, footerText) {
      await sendRequest(to, [{
        interactive: {
          type: 'product',
          body: { text: bodyText },
          ...(footerText ? { footer: { text: footerText } } : {}),
          action: { catalog_id: catalogId, product_retailer_id: productRetailerId },
        },
      }]);
    },

    async sendProductList(to, bodyText, headerText, catalogId, sections) {
      await sendRequest(to, [{
        interactive: {
          type: 'product_list',
          body: { text: bodyText },
          header: { type: 'text', text: headerText },
          action: {
            catalog_id: catalogId,
            sections: sections.map((s: ProductListSection) => ({
              title: s.title,
              product_items: s.product_retailer_ids.map(id => ({ product_retailer_id: id })),
            })),
          },
        },
      }]);
    },

    async sendReadReceipt(messageId) {
      if (!messageId || messageId.startsWith('cm_')) return;
      await sendCmEvent('MarkAsRead', fromNumber, '', messageId);
    },

    async sendTypingIndicator(to, messageId) {
      if (!messageId || messageId.startsWith('cm_')) return;
      await sendCmEvent('Typing', fromNumber, to, messageId, { typing_indicator: 'text' });
    },

    async validateCredentials(): Promise<{ ok: boolean; error?: string }> {
      // CM.com n'expose pas d'endpoint de test simple : on valide la présence des identifiants requis.
      if (!productToken || !fromNumber) {
        return { ok: false, error: 'CM.com : product_token et from_number sont requis.' };
      }
      return { ok: true };
    },
  };

  return transport;
}
