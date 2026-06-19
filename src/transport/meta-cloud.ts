/**
 * Transport WhatsApp via Meta Cloud API (officielle).
 * Implémente l'interface Transport.
 *
 * Doc : https://developers.facebook.com/docs/whatsapp/cloud-api
 */

import crypto from 'crypto';
import type {
  Transport, ReplyButton, ListSection, ProductListSection, OrderItem,
} from './types.js';

const META_API_VERSION = 'v22.0';
const META_API_BASE = 'https://graph.facebook.com';
const MAX_RETRIES = 2;
const RETRY_DELAYS = [1000, 3000];

/** Normalise un numero pour Meta Cloud API : digits only, sans + ni 00 */
export function toMetaNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) return digits.slice(2);
  return digits;
}

interface MetaWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: { display_phone_number?: string; phone_number_id?: string };
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
        messages?: Array<MetaIncomingMessage>;
      };
    }>;
  }>;
}

interface MetaIncomingMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  audio?: { id?: string; mime_type?: string };
  image?: { id?: string; mime_type?: string };
  video?: { id?: string; mime_type?: string };
  document?: { id?: string; mime_type?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  order?: {
    catalog_id?: string;
    product_items?: Array<{
      product_retailer_id?: string;
      quantity?: number | string;
      item_price?: number | string;
      currency?: string;
    }>;
  };
}

export interface MetaCloudTransportOptions {
  /** Phone Number ID Meta (depuis Meta Business Manager) */
  phoneNumberId: string;
  /** Access token Meta (long-lived) */
  accessToken: string;
  /** App secret Meta (pour vérifier la signature HMAC des webhooks) */
  appSecret?: string;
}

export function createMetaCloudTransport(opts: MetaCloudTransportOptions): Transport {
  const { phoneNumberId, accessToken, appSecret } = opts;

  if (!phoneNumberId) throw new Error('[MetaCloud] phoneNumberId is required');
  if (!accessToken) throw new Error('[MetaCloud] accessToken is required');
  // Fail-closed : sans app_secret, la vérification de signature webhook serait inopérante.
  // On refuse de démarrer plutôt que d'accepter des webhooks non authentifiés.
  if (!appSecret) throw new Error('[MetaCloud] appSecret is required for webhook signature verification');

  const sendUrl = `${META_API_BASE}/${META_API_VERSION}/${phoneNumberId}/messages`;

  async function sendRequest(payload: Record<string, unknown>): Promise<void> {
    const body = JSON.stringify(payload);

    if (body.includes('product_list') || body.includes('"type":"product"') || body.includes('"type":"image"')) {
      console.log(`[MetaCloud] Interactive payload: ${body}`);
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(sendUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(10000),
      });

      const responseText = await res.text();

      if (res.ok) {
        const logLength = (body.includes('product') || body.includes('"type":"image"')) ? 800 : 150;
        console.log(`[MetaCloud] Sent OK: ${res.status} ${responseText.slice(0, logLength)}`);
        return;
      }

      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < MAX_RETRIES) {
        console.log(`[MetaCloud] Retryable error ${res.status}, attempt ${attempt + 1}/${MAX_RETRIES}`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
        continue;
      }

      console.error(`[MetaCloud] Send failed: ${res.status} ${responseText.slice(0, 200)}`);
      throw new Error(`[MetaCloud] ${res.status}: ${responseText.slice(0, 200)}`);
    }
  }

  function buildBase(to: string): Record<string, unknown> {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toMetaNumber(to),
    };
  }

  const transport: Transport = {
    id: 'meta-cloud',

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
        const res = await fetch(sendUrl, {
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
        const res = await fetch(sendUrl, {
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

    parseWebhookPayload(body) {
      try {
        const payload = body as MetaWebhookPayload;
        const change = payload.entry?.[0]?.changes?.[0]?.value;
        if (!change?.messages || change.messages.length === 0) return null;

        const msg = change.messages[0];
        if (!msg.from) return null;

        const phone = toMetaNumber(msg.from);
        const toNumber = change.metadata?.display_phone_number
          ? toMetaNumber(change.metadata.display_phone_number)
          : '';
        const messageId = msg.id || `meta_${Date.now()}`;
        const timestamp = msg.timestamp
          ? new Date(parseInt(msg.timestamp, 10) * 1000).toISOString()
          : new Date().toISOString();
        const profileName = change.contacts?.[0]?.profile?.name || undefined;

        // Audio
        if (msg.type === 'audio' && msg.audio?.id) {
          return {
            phone, toNumber, text: '[audio]', messageId, timestamp, profileName,
            mediaUrl: msg.audio.id,
            mediaType: msg.audio.mime_type || 'audio/ogg',
          };
        }

        // Image / video / document
        if (msg.type === 'image' || msg.type === 'video' || msg.type === 'document') {
          const media = msg.image || msg.video || msg.document;
          return {
            phone, toNumber, text: '[message non-texte]', messageId, timestamp, profileName,
            mediaUrl: media?.id,
            mediaType: media?.mime_type,
          };
        }

        // Order (catalog cart submit)
        if (msg.type === 'order' && msg.order?.product_items && msg.order.product_items.length > 0) {
          const items: OrderItem[] = msg.order.product_items.map(i => ({
            product_retailer_id: i.product_retailer_id || '',
            quantity: typeof i.quantity === 'string' ? parseInt(i.quantity, 10) : (i.quantity || 1),
            item_price: typeof i.item_price === 'string' ? parseFloat(i.item_price) : (i.item_price || 0),
            currency: i.currency || 'EUR',
          }));
          const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
          return {
            phone, toNumber, text: `[ORDER_RECEIVED] ${itemCount} produit(s)`,
            messageId, timestamp, profileName,
            order: { catalog_id: msg.order.catalog_id || '', items },
          };
        }

        // Interactive (button_reply / list_reply)
        if (msg.type === 'interactive' && msg.interactive) {
          const text =
            msg.interactive.button_reply?.title ||
            msg.interactive.list_reply?.title ||
            '';
          if (text) {
            return { phone, toNumber, text, messageId, timestamp, profileName };
          }
        }

        // Text standard
        if (msg.type === 'text' && msg.text?.body) {
          const truncatedText = msg.text.body.length > 2000 ? msg.text.body.slice(0, 2000) : msg.text.body;
          return { phone, toNumber, text: truncatedText, messageId, timestamp, profileName };
        }

        return null;
      } catch (err) {
        console.error('[MetaCloud] Failed to parse webhook payload:', err);
        return null;
      }
    },

    verifyWebhookSignature(rawBody, headers) {
      // appSecret est garanti au boot (cf. createMetaCloudTransport). Défense en profondeur :
      // si jamais il manquait, on rejette (fail-closed) au lieu d'accepter.
      if (!appSecret) {
        console.error('[MetaCloud] appSecret missing at runtime, rejecting webhook');
        return false;
      }

      const signatureHeader = headers['x-hub-signature-256'];
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
      if (!signature || typeof signature !== 'string' || !signature.startsWith('sha256=')) {
        console.warn('[MetaCloud] Missing or invalid x-hub-signature-256 header');
        return false;
      }

      const expected = 'sha256=' + crypto
        .createHmac('sha256', appSecret)
        .update(rawBody, 'utf8')
        .digest('hex');

      // Constant-time comparison
      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expected);
      if (sigBuf.length !== expBuf.length) return false;
      return crypto.timingSafeEqual(sigBuf, expBuf);
    },
  };

  return transport;
}

// Re-export types
export type { IncomingMessage } from './types.js';
