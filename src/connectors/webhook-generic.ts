/**
 * Connecteur générique webhook signé HMAC SHA-256.
 *
 * Utile pour les CRM qui n'ont pas de connecteur dédié : MAD CRM en V1,
 * CRM custom, intégration via n8n, Zapier, Make, etc.
 *
 * Voir docs/CRM_INTEGRATION.md pour le format du payload et la procédure
 * de vérification de signature côté CRM.
 */

import crypto from 'crypto';
import type {
  CRMConnector,
  NormalizedLead,
  NormalizedBooking,
  NormalizedOrder,
} from './types.js';

interface WebhookGenericOptions {
  url: string;
  secret: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export class WebhookGenericConnector implements CRMConnector {
  readonly connectorName = 'webhook-generic';

  private url: string;
  private secret: string;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(options: WebhookGenericOptions) {
    this.url = options.url;
    this.secret = options.secret;
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.maxRetries = options.maxRetries ?? 3;
  }

  async pushLead(lead: NormalizedLead): Promise<void> {
    await this.send('lead.qualified', lead);
  }

  async updateLead(leadId: string, fields: Partial<NormalizedLead>): Promise<void> {
    await this.send('lead.updated', { leadId, fields });
  }

  async pushBooking(booking: NormalizedBooking): Promise<void> {
    await this.send('rdv.created', booking);
  }

  async pushOrder(order: NormalizedOrder): Promise<void> {
    await this.send('order.placed', order);
  }

  /**
   * Envoie l'événement avec retry et backoff exponentiel.
   * 3 tentatives par défaut : 1s → 4s → 16s.
   */
  private async send(event: string, data: unknown): Promise<void> {
    const eventId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const body = JSON.stringify({ event, data });

    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(body)
      .digest('hex');

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delayMs = Math.pow(4, attempt - 1) * 1000; // 1s, 4s, 16s
        await new Promise((r) => setTimeout(r, delayMs));
      }

      try {
        const res = await fetch(this.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Cyran-Signature': `sha256=${signature}`,
            'X-Cyran-Timestamp': timestamp,
            'X-Cyran-Event-Id': eventId,
          },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (res.ok) {
          console.log(`[WebhookGeneric] ${event} → ${this.url} (attempt ${attempt + 1}, status ${res.status})`);
          return;
        }

        // 4xx ne devrait pas être retry sauf 429
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          const text = await res.text();
          console.error(`[WebhookGeneric] ${event} client error ${res.status}: ${text.slice(0, 300)}`);
          throw new Error(`Client error ${res.status}`);
        }

        lastError = new Error(`HTTP ${res.status}`);
      } catch (err) {
        lastError = err as Error;
        console.warn(`[WebhookGeneric] ${event} attempt ${attempt + 1} failed: ${lastError.message}`);
      }
    }

    // Toutes les tentatives ont échoué : à pousser en dead letter queue (TODO P1)
    console.error(`[WebhookGeneric] ${event} FAILED after ${this.maxRetries} attempts: ${lastError?.message}`);
    throw lastError ?? new Error('Webhook send failed');
  }
}
