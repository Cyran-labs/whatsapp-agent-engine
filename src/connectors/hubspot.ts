/**
 * Connecteur HubSpot — push de leads vers l'objet Contact HubSpot.
 *
 * La logique de mapping (champs Cyran -> propriétés HubSpot) est externalisée
 * dans connectors-config/{client_id}/hubspot.json via FieldMapper.
 * Ce connecteur ne contient que la grammaire HTTP HubSpot.
 *
 * Auth : Private App access token (format pat-eu1-...).
 * En P3 onboarding self-service, OAuth + token chiffré par client en DB.
 */

import type {
  CRMConnector,
  NormalizedLead,
  NormalizedBooking,
} from './types.js';
import { FieldMapper, type FieldMapping } from './field-mapper.js';

const HUBSPOT_API_BASE = 'https://api.hubapi.com';
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 4000, 16000];

export interface HubSpotOptions {
  accessToken: string;
  /** Mapping inline (priorité sur clientId si fourni) */
  mapping?: FieldMapping;
  /** ID client utilisé pour charger le mapping depuis connectors-config/{clientId}/hubspot.json */
  clientId?: string;
  timeoutMs?: number;
}

interface HubSpotContact {
  id: string;
  properties: Record<string, string | null>;
}

export class HubSpotConnector implements CRMConnector {
  readonly connectorName = 'hubspot';

  private readonly accessToken: string;
  private readonly mapper: FieldMapper;
  private readonly timeoutMs: number;

  constructor(options: HubSpotOptions) {
    if (!options.accessToken) {
      throw new Error('[HubSpot] accessToken is required');
    }
    if (!options.mapping) {
      throw new Error('[HubSpot] mapping is required');
    }
    this.accessToken = options.accessToken;
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.mapper = new FieldMapper(options.mapping);
  }

  async pushLead(lead: NormalizedLead): Promise<void> {
    const existing = await this.findContact(lead);

    if (existing) {
      const properties = this.mapper.apply(lead, 'update');
      console.log(`[HubSpot] Update contact ${existing.id} (${lead.email ?? lead.phone})`);
      await this.patchContact(existing.id, properties);
    } else {
      const properties = this.mapper.apply(lead, 'create');
      console.log(`[HubSpot] Create contact (${lead.email ?? lead.phone})`);
      await this.createContact(properties);
    }
  }

  async updateLead(leadId: string, fields: Partial<NormalizedLead>): Promise<void> {
    const partial: Partial<NormalizedLead> = {
      ...fields,
      lead_id: leadId,
      updated_at: fields.updated_at ?? new Date().toISOString(),
    };

    const existing = await this.findContact(partial);
    if (!existing) {
      console.warn(`[HubSpot] updateLead: contact not found (lead_id=${leadId}), ignoring`);
      return;
    }

    const properties = this.mapper.apply(partial, 'update');
    await this.patchContact(existing.id, properties);
  }

  async pushBooking(booking: NormalizedBooking): Promise<void> {
    // P1 minimal : on enrichit le contact (existant ou créé) avec les infos RDV
    // sous forme de custom_fields (qui partent dans le fallback message via le mapping).
    // Une vraie intégration Meeting/Engagement HubSpot demanderait plus de scopes.
    const partial: Partial<NormalizedLead> = {
      client_id: booking.client_id,
      bot_id: booking.bot_id,
      lead_id: booking.lead_id,
      phone: booking.phone,
      email: booking.invitee_email,
      source: booking.source,
      updated_at: new Date().toISOString(),
      custom_fields: {
        rdv_date: booking.start_time,
        rdv_event: booking.event_name,
        ...(booking.invitee_name ? { rdv_invitee_name: booking.invitee_name } : {}),
        ...(booking.notes ? { rdv_notes: booking.notes } : {}),
      },
    };

    const existing = await this.findContact(partial);
    if (existing) {
      const properties = this.mapper.apply(partial, 'update');
      await this.patchContact(existing.id, properties);
      console.log(`[HubSpot] Booking attached to contact ${existing.id} (${booking.start_time})`);
    } else {
      const properties = this.mapper.apply(partial, 'create');
      await this.createContact(properties);
      console.log(`[HubSpot] Booking → new contact (${booking.invitee_email ?? booking.phone})`);
    }
  }

  // --- Private helpers ---

  private async findContact(lead: Partial<NormalizedLead>): Promise<HubSpotContact | null> {
    const dedup = this.mapper.resolveDedupKey(lead);
    if (!dedup) return null;

    const data = await this.request<{ results: HubSpotContact[] }>(
      'POST',
      '/crm/v3/objects/contacts/search',
      {
        filterGroups: [{
          filters: [{
            propertyName: dedup.targetField,
            operator: 'EQ',
            value: dedup.value,
          }],
        }],
        properties: ['email', 'phone', 'firstname', 'lastname'],
        limit: 1,
      }
    );
    return data.results[0] ?? null;
  }

  private async createContact(properties: Record<string, string>): Promise<HubSpotContact> {
    return this.request<HubSpotContact>(
      'POST',
      '/crm/v3/objects/contacts',
      { properties }
    );
  }

  private async patchContact(id: string, properties: Record<string, string>): Promise<HubSpotContact> {
    return this.request<HubSpotContact>(
      'PATCH',
      `/crm/v3/objects/contacts/${id}`,
      { properties }
    );
  }

  /**
   * Requête HTTP avec retry exponentiel + timeout.
   * Retry sur 429 et 5xx, fail-fast sur 4xx.
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${HUBSPOT_API_BASE}${path}`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
      }

      try {
        const res = await fetch(url, {
          method,
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (res.ok) {
          return (await res.json()) as T;
        }

        const text = await res.text();

        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          console.error(`[HubSpot] ${method} ${path} client error ${res.status}: ${text.slice(0, 300)}`);
          throw new Error(`HubSpot ${res.status}: ${text.slice(0, 200)}`);
        }

        lastError = new Error(`HubSpot ${res.status}: ${text.slice(0, 200)}`);
        console.warn(`[HubSpot] ${method} ${path} retryable error ${res.status} (attempt ${attempt + 1}/${MAX_RETRIES})`);
      } catch (err) {
        lastError = err as Error;
        if (lastError.message.startsWith('HubSpot 4')) throw lastError;
        console.warn(`[HubSpot] ${method} ${path} attempt ${attempt + 1} failed: ${lastError.message}`);
      }
    }

    console.error(`[HubSpot] ${method} ${path} FAILED after ${MAX_RETRIES} attempts`);
    throw lastError ?? new Error('HubSpot request failed');
  }
}
