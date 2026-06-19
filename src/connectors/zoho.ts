/**
 * Connecteur Zoho CRM — push de leads vers le module Leads (par défaut) via API v2.
 *
 * Modèle plat → mapping dans FieldMapper (connectors-config/{client_id}/zoho.json).
 * NB : le module Leads exige Last_Name (garanti côté mapping, pas hardcodé ici).
 *
 * Auth : OAuth 2.0 (Authorization: Zoho-oauthtoken {token}). Le data center compte :
 * apiDomain doit pointer sur la bonne région (.com / .eu / .in / .com.au / ...).
 * Le refresh de token est hors P1 → P3 onboarding.
 *
 * Particularité : l'endpoint /search renvoie HTTP 204 (corps vide) quand aucun
 * enregistrement ne matche — géré par le helper http (204 → undefined).
 */

import type {
  CRMConnector,
  NormalizedLead,
  NormalizedBooking,
} from './types.js';
import { FieldMapper, loadMappingConfig, type FieldMapping } from './field-mapper.js';
import { requestJson } from './http.js';

const SERVICE = 'Zoho';
const DEFAULT_API_DOMAIN = 'https://www.zohoapis.com';

/** Module ou champ API Zoho : identifiant simple (lettres/chiffres/_). */
function assertZohoIdentifier(name: string, label: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`[Zoho] invalid ${label}: ${name}`);
  }
}

/**
 * La grammaire criteria Zoho `(field:op:value)` n'offre pas d'échappement de la value.
 * On rejette donc toute valeur contenant un caractère structurel — la value vient du lead
 * (email/phone, user-controlled) et n'a légitimement besoin que d'un charset restreint.
 */
function assertSafeCriteriaValue(value: string): void {
  if (!/^[A-Za-z0-9._%+@-]+$/.test(value)) {
    throw new Error('[Zoho] unsafe dedup value for search criteria');
  }
}

export interface ZohoOptions {
  accessToken: string;
  apiDomain?: string;             // défaut https://www.zohoapis.com
  module?: string;                // défaut 'Leads'
  mapping?: FieldMapping;
  clientId?: string;
  timeoutMs?: number;
}

interface ZohoRecord {
  id: string;
}

export class ZohoConnector implements CRMConnector {
  readonly connectorName = 'zoho';

  private readonly baseUrl: string;
  private readonly accessToken: string;
  private readonly module: string;
  private readonly mapper: FieldMapper;
  private readonly timeoutMs?: number;

  constructor(options: ZohoOptions) {
    if (!options.accessToken) {
      throw new Error('[Zoho] accessToken is required');
    }
    if (!options.mapping && !options.clientId) {
      throw new Error('[Zoho] mapping or clientId is required');
    }

    this.accessToken = options.accessToken;
    this.module = options.module ?? 'Leads';
    assertZohoIdentifier(this.module, 'module');
    this.baseUrl = `${(options.apiDomain ?? DEFAULT_API_DOMAIN).replace(/\/$/, '')}/crm/v2`;
    this.timeoutMs = options.timeoutMs;

    const mapping = options.mapping ?? loadMappingConfig('zoho', options.clientId!);
    this.mapper = new FieldMapper(mapping);
  }

  async pushLead(lead: NormalizedLead): Promise<void> {
    const existing = await this.findRecord(lead);

    if (existing) {
      const fields = this.mapper.apply(lead, 'update');
      console.log(`[Zoho] Update ${this.module} ${existing.id} (${lead.email ?? lead.phone})`);
      await this.request('PUT', `/${this.module}/${existing.id}`, { data: [fields] });
    } else {
      const fields = this.mapper.apply(lead, 'create');
      console.log(`[Zoho] Create ${this.module} (${lead.email ?? lead.phone})`);
      await this.request('POST', `/${this.module}`, { data: [fields] });
    }
  }

  async updateLead(leadId: string, fields: Partial<NormalizedLead>): Promise<void> {
    const partial: Partial<NormalizedLead> = {
      ...fields,
      lead_id: leadId,
      updated_at: fields.updated_at ?? new Date().toISOString(),
    };
    const existing = await this.findRecord(partial);
    if (!existing) {
      console.warn(`[Zoho] updateLead: ${this.module} not found (lead_id=${leadId}), ignoring`);
      return;
    }
    await this.request('PUT', `/${this.module}/${existing.id}`, { data: [this.mapper.apply(partial, 'update')] });
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

    let record = await this.findRecord(partial);
    if (!record) {
      const created = await this.request<{ data?: Array<{ details?: ZohoRecord }> }>(
        'POST',
        `/${this.module}`,
        { data: [this.mapper.apply(partial, 'create')] },
      );
      record = created?.data?.[0]?.details ?? null;
    }
    if (!record) {
      console.error(`[Zoho] pushBooking: upsert failed (${booking.phone})`);
      throw new Error('[Zoho] record upsert failed');
    }

    const noteContent = [
      `RDV : ${booking.event_name}`,
      `Début : ${booking.start_time}`,
      ...(booking.end_time ? [`Fin : ${booking.end_time}`] : []),
      ...(booking.notes ? [`Notes : ${booking.notes}`] : []),
      `Source : ${booking.source}`,
    ].join('\n');

    await this.request('POST', '/Notes', {
      data: [{
        Note_Title: `RDV confirmé : ${booking.event_name}`,
        Note_Content: noteContent,
        Parent_Id: record.id,
        se_module: this.module,
      }],
    });
    console.log(`[Zoho] Booking note added on ${record.id}`);
  }

  // --- Private helpers ---

  private async findRecord(lead: Partial<NormalizedLead>): Promise<ZohoRecord | null> {
    const dedup = this.mapper.resolveDedupKey(lead);
    if (!dedup) return null;

    assertZohoIdentifier(dedup.targetField, 'dedup field');
    assertSafeCriteriaValue(dedup.value);
    const criteria = `(${dedup.targetField}:equals:${dedup.value})`;
    const data = await this.request<{ data?: ZohoRecord[] } | undefined>(
      'GET',
      `/${this.module}/search?criteria=${encodeURIComponent(criteria)}`,
    );
    return data?.data?.[0] ?? null;
  }

  private request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return requestJson<T>(method, `${this.baseUrl}${path}`, {
      service: SERVICE,
      headers: {
        'Authorization': `Zoho-oauthtoken ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body,
      timeoutMs: this.timeoutMs,
    });
  }
}
