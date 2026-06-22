/**
 * Transport WhatsApp via CM.com BSP.
 * Implémente l'interface Transport.
 */

import { config } from '../core/config.js';
import type {
  Transport, ReplyButton, ListSection, ProductListSection, OrderItem,
} from './types.js';

const MAX_RETRIES = 2;
const RETRY_DELAYS = [1000, 3000];

/** Normalise un numero vers le format CM.com (00XXXXXXXXXXXX) */
export function toCmNumber(phone: string): string {
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

export interface CmComTransportOptions {
  productToken: string;
  serviceUrl: string;
  fromNumber: string;
}

export function createCmComTransport(opts?: Partial<CmComTransportOptions>): Transport {
  const productToken = opts?.productToken ?? config.cm.productToken;
  const serviceUrl = opts?.serviceUrl ?? config.cm.serviceUrl;
  const fromNumber = opts?.fromNumber ?? config.cm.fromNumber;

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

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(serviceUrl, {
        method: 'POST',
        headers: {
          'X-CM-PRODUCTTOKEN': productToken,
          'Content-Type': 'application/json',
        },
        body: payload,
        signal: AbortSignal.timeout(10000),
      });

      const responseText = await res.text();

      if (res.ok) {
        const logLength = (payload.includes('product') || payload.includes('"type":"image"')) ? 800 : 150;
        console.log(`[CmCom] Sent OK: ${res.status} ${responseText.slice(0, logLength)}`);
        return;
      }

      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < MAX_RETRIES) {
        console.log(`[CmCom] Retryable error ${res.status}, attempt ${attempt + 1}/${MAX_RETRIES}`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
        continue;
      }

      console.error(`[CmCom] Send failed: ${res.status} ${responseText.slice(0, 200)}`);
      throw new Error(`[CmCom] ${res.status}: ${responseText.slice(0, 200)}`);
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

    parseWebhookPayload(body) {
      try {
        const payload = body as CmWebhookPayload;
        if (!payload.from?.number) return null;

        const phone = fromCmNumber(payload.from.number);
        const toNumber = payload.to?.number ? fromCmNumber(payload.to.number) : '';
        const messageId = payload.messageContext || payload.reference || `cm_${Date.now()}`;
        console.log(`[CmCom] messageId=${messageId.slice(0, 40)}, context=${payload.messageContext?.slice(0, 40) || 'none'}, ref=${payload.reference || 'none'}`);
        const timestamp = payload.timeUtc || new Date().toISOString();
        const profileName = payload.from.name || undefined;

        const msg = payload.message;
        if (!msg) return null;

        if (msg.media?.mediaUri && msg.media.contentType) {
          const contentType = msg.media.contentType;
          if (contentType.startsWith('audio/')) {
            return {
              phone, toNumber, text: '[audio]', messageId, timestamp, profileName,
              mediaUrl: msg.media.mediaUri, mediaType: contentType,
            };
          }
          return {
            phone, toNumber, text: '[message non-texte]', messageId, timestamp, profileName,
            mediaUrl: msg.media.mediaUri, mediaType: contentType,
          };
        }

        if (msg.custom?.order && msg.custom.order.product_items && msg.custom.order.product_items.length > 0) {
          const items: OrderItem[] = msg.custom.order.product_items.map(i => ({
            product_retailer_id: i.product_retailer_id || '',
            quantity: typeof i.quantity === 'string' ? parseInt(i.quantity, 10) : (i.quantity || 1),
            item_price: typeof i.item_price === 'string' ? parseFloat(i.item_price) : (i.item_price || 0),
            currency: i.currency || 'EUR',
          }));
          const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
          return {
            phone, toNumber, text: `[ORDER_RECEIVED] ${itemCount} produit(s)`,
            messageId, timestamp, profileName,
            order: { catalog_id: msg.custom.order.catalog_id || '', items },
          };
        }

        if (msg.custom?.interactive) {
          const interactive = msg.custom.interactive;
          const text =
            interactive.button_reply?.title ||
            interactive.list_reply?.title ||
            '';
          if (text) {
            return { phone, toNumber, text, messageId, timestamp, profileName };
          }
        }

        if (msg.text) {
          const truncatedText = msg.text.length > 2000 ? msg.text.slice(0, 2000) : msg.text;
          return { phone, toNumber, text: truncatedText, messageId, timestamp, profileName };
        }

        return null;
      } catch (err) {
        console.error('[CmCom] Failed to parse webhook payload:', err);
        return null;
      }
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

// Re-export types pour compat (handler les utilise)
export type { IncomingMessage, ReplyButton, ListSection, OrderItem } from './types.js';
