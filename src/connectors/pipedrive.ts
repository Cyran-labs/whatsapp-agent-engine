/**
 * Connecteur Pipedrive — push de leads vers l'objet Person (+ note RDV).
 *
 * Modèle plat → la logique de mapping vit dans FieldMapper
 * (connectors-config/{client_id}/pipedrive.json), comme HubSpot.
 * Ce connecteur ne contient que la grammaire HTTP Pipedrive.
 *
 * Auth : API token (passé en query param ?api_token=). En P3, OAuth + token chiffré par client.
 * Le `companyDomain` détermine le base path : https://{companyDomain}.pipedrive.com/api/v1
 */

import type {
  CRMConnector,
  NormalizedLead,
  NormalizedBooking,
} from './types.js';
import { FieldMapper, type FieldMapping } from './field-mapper.js';
import { requestJson } from './http.js';

const SERVICE = 'Pipedrive';
/** Champs Pipedrive natifs qui attendent un tableau [{ value, primary }] et non un scalaire. */
const ARRAY_FIELDS = new Set(['email', 'phone']);

export interface PipedriveOptions {
  apiToken: string;
  /** Sous-domaine de l'entreprise : {companyDomain}.pipedrive.com (défaut: api). */
  companyDomain?: string;
  mapping?: FieldMapping;
  clientId?: string;
  timeoutMs?: number;
}

interface PipedrivePerson {
  id: number;
}

export class PipedriveConnector implements CRMConnector {
  readonly connectorName = 'pipedrive';

  private readonly apiToken: string;
  private readonly baseUrl: string;
  private readonly mapper: FieldMapper;
  private readonly timeoutMs?: number;

  constructor(options: PipedriveOptions) {
    if (!options.apiToken) {
      throw new Error('[Pipedrive] apiToken is required');
    }
    if (!options.mapping) {
      throw new Error('[Pipedrive] mapping is required');
    }
    this.apiToken = options.apiToken;
    this.baseUrl = `https://${options.companyDomain ?? 'api'}.pipedrive.com/api/v1`;
    this.timeoutMs = options.timeoutMs;
    this.mapper = new FieldMapper(options.mapping);
  }

  async pushLead(lead: NormalizedLead): Promise<void> {
    const existing = await this.findPerson(lead);

    if (existing) {
      const body = this.toPersonBody(this.mapper.apply(lead, 'update'));
      console.log(`[Pipedrive] Update person ${existing.id} (${lead.email ?? lead.phone})`);
      await this.request('PUT', `/persons/${existing.id}`, body);
    } else {
      const body = this.toPersonBody(this.mapper.apply(lead, 'create'));
      console.log(`[Pipedrive] Create person (${lead.email ?? lead.phone})`);
      await this.request('POST', '/persons', body);
    }
  }

  async updateLead(leadId: string, fields: Partial<NormalizedLead>): Promise<void> {
    const partial: Partial<NormalizedLead> = {
      ...fields,
      lead_id: leadId,
      updated_at: fields.updated_at ?? new Date().toISOString(),
    };
    const existing = await this.findPerson(partial);
    if (!existing) {
      console.warn(`[Pipedrive] updateLead: person not found (lead_id=${leadId}), ignoring`);
      return;
    }
    const body = this.toPersonBody(this.mapper.apply(partial, 'update'));
    await this.request('PUT', `/persons/${existing.id}`, body);
  }

  async pushBooking(booking: NormalizedBooking): Promise<void> {
    const partial: Partial<NormalizedLead> = {
      client_id: booking.client_id,
      bot_id: booking.bot_id,
      lead_id: booking.lead_id,
      phone: booking.phone,
      email: booking.invitee_email,
      source: booking.source,
      updated_at: new Date().toISOString(),
    };

    let person = await this.findPerson(partial);
    if (!person) {
      const created = await this.request<{ data?: PipedrivePerson }>(
        'POST',
        '/persons',
        this.toPersonBody(this.mapper.apply(partial, 'create')),
      );
      person = created?.data ?? null;
    }
    if (!person) {
      console.error(`[Pipedrive] pushBooking: person upsert failed (${booking.phone})`);
      throw new Error('[Pipedrive] person upsert failed');
    }

    const noteLines = [
      `RDV : ${booking.event_name}`,
      `Début : ${booking.start_time}`,
      ...(booking.end_time ? [`Fin : ${booking.end_time}`] : []),
      ...(booking.notes ? [`Notes : ${booking.notes}`] : []),
      `Source : ${booking.source}`,
    ];
    await this.request('POST', '/notes', {
      content: noteLines.join('\n'),
      person_id: person.id,
    });
    console.log(`[Pipedrive] Booking note added on person ${person.id}`);
  }

  // --- Private helpers ---

  private async findPerson(lead: Partial<NormalizedLead>): Promise<PipedrivePerson | null> {
    const dedup = this.mapper.resolveDedupKey(lead);
    if (!dedup) return null;

    const params = new URLSearchParams({
      term: dedup.value,
      fields: dedup.targetField,
      exact_match: 'true',
      limit: '1',
    });
    const data = await this.request<{ data?: { items?: Array<{ item: PipedrivePerson }> } }>(
      'GET',
      `/persons/search?${params.toString()}`,
    );
    return data?.data?.items?.[0]?.item ?? null;
  }

  /**
   * Transforme les propriétés plates du FieldMapper en corps Pipedrive.
   * Les champs email/phone natifs deviennent des tableaux [{ value, primary }].
   */
  private toPersonBody(props: Record<string, string>): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      if (ARRAY_FIELDS.has(key)) {
        body[key] = [{ value, primary: true }];
      } else {
        body[key] = value;
      }
    }
    return body;
  }

  private request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${this.baseUrl}${path}${sep}api_token=${this.apiToken}`;
    return requestJson<T>(method, url, {
      service: SERVICE,
      headers: { 'Content-Type': 'application/json' },
      body,
      timeoutMs: this.timeoutMs,
    });
  }
}
