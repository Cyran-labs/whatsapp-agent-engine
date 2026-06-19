/**
 * Connecteur Salesforce — push de leads vers le sObject Lead (par défaut) via REST API.
 *
 * Modèle plat → mapping dans FieldMapper (connectors-config/{client_id}/salesforce.json).
 * NB : le sObject Lead exige LastName et Company. Ces invariants doivent être garantis
 * côté mapping (default_values / fixed_values), pas hardcodés ici.
 *
 * Auth : OAuth 2.0. Ce connecteur attend un accessToken déjà obtenu + l'instanceUrl de l'org.
 * Le refresh de token (et le flow OAuth complet) est hors P1 → géré en P3 onboarding.
 */

import type {
  CRMConnector,
  NormalizedLead,
  NormalizedBooking,
} from './types.js';
import { FieldMapper, loadMappingConfig, type FieldMapping } from './field-mapper.js';
import { requestJson } from './http.js';

const SERVICE = 'Salesforce';
const DEFAULT_API_VERSION = 'v59.0';

/** Un sObject ou un champ SOQL est un identifiant simple (lettres/chiffres/_/. pour les relations). */
function assertSoqlIdentifier(name: string, label: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_.]*$/.test(name)) {
    throw new Error(`[Salesforce] invalid ${label}: ${name}`);
  }
}

export interface SalesforceOptions {
  instanceUrl: string;            // ex: https://mycompany.my.salesforce.com
  accessToken: string;
  apiVersion?: string;            // défaut v59.0
  sobject?: string;               // défaut 'Lead'
  mapping?: FieldMapping;
  clientId?: string;
  timeoutMs?: number;
}

interface SalesforceCreateResult {
  id: string;
  success: boolean;
}

export class SalesforceConnector implements CRMConnector {
  readonly connectorName = 'salesforce';

  private readonly baseUrl: string;
  private readonly accessToken: string;
  private readonly sobject: string;
  private readonly mapper: FieldMapper;
  private readonly timeoutMs?: number;

  constructor(options: SalesforceOptions) {
    if (!options.instanceUrl) {
      throw new Error('[Salesforce] instanceUrl is required');
    }
    if (!options.accessToken) {
      throw new Error('[Salesforce] accessToken is required');
    }
    if (!options.mapping && !options.clientId) {
      throw new Error('[Salesforce] mapping or clientId is required');
    }

    this.accessToken = options.accessToken;
    this.sobject = options.sobject ?? 'Lead';
    assertSoqlIdentifier(this.sobject, 'sobject');
    this.baseUrl = `${options.instanceUrl.replace(/\/$/, '')}/services/data/${options.apiVersion ?? DEFAULT_API_VERSION}`;
    this.timeoutMs = options.timeoutMs;

    const mapping = options.mapping ?? loadMappingConfig('salesforce', options.clientId!);
    this.mapper = new FieldMapper(mapping);
  }

  async pushLead(lead: NormalizedLead): Promise<void> {
    const existingId = await this.findRecordId(lead);

    if (existingId) {
      const fields = this.mapper.apply(lead, 'update');
      console.log(`[Salesforce] Update ${this.sobject} ${existingId} (${lead.email ?? lead.phone})`);
      await this.request('PATCH', `/sobjects/${this.sobject}/${existingId}`, fields);
    } else {
      const fields = this.mapper.apply(lead, 'create');
      console.log(`[Salesforce] Create ${this.sobject} (${lead.email ?? lead.phone})`);
      await this.request('POST', `/sobjects/${this.sobject}`, fields);
    }
  }

  async updateLead(leadId: string, fields: Partial<NormalizedLead>): Promise<void> {
    const partial: Partial<NormalizedLead> = {
      ...fields,
      lead_id: leadId,
      updated_at: fields.updated_at ?? new Date().toISOString(),
    };
    const existingId = await this.findRecordId(partial);
    if (!existingId) {
      console.warn(`[Salesforce] updateLead: ${this.sobject} not found (lead_id=${leadId}), ignoring`);
      return;
    }
    await this.request('PATCH', `/sobjects/${this.sobject}/${existingId}`, this.mapper.apply(partial, 'update'));
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

    let recordId = await this.findRecordId(partial);
    if (!recordId) {
      const created = await this.request<SalesforceCreateResult>(
        'POST',
        `/sobjects/${this.sobject}`,
        this.mapper.apply(partial, 'create'),
      );
      recordId = created?.id ?? null;
    }
    if (!recordId) {
      console.error(`[Salesforce] pushBooking: upsert failed (${booking.phone})`);
      throw new Error('[Salesforce] record upsert failed');
    }

    await this.request('POST', '/sobjects/Task', {
      Subject: `RDV : ${booking.event_name}`,
      ActivityDate: booking.start_time.slice(0, 10), // YYYY-MM-DD
      Status: 'Not Started',
      WhoId: recordId,
      Description: [booking.notes, `Source : ${booking.source}`].filter(Boolean).join('\n'),
    });
    console.log(`[Salesforce] Booking task created for ${recordId}`);
  }

  // --- Private helpers ---

  private async findRecordId(lead: Partial<NormalizedLead>): Promise<string | null> {
    const dedup = this.mapper.resolveDedupKey(lead);
    if (!dedup) return null;

    // targetField vient de la config (operator-authored) mais on le valide quand même :
    // c'est un identifiant SOQL, jamais une valeur libre.
    assertSoqlIdentifier(dedup.targetField, 'dedup field');
    // value vient du lead (email/phone → user-controlled) : on échappe pour le littéral SOQL.
    // Backslash AVANT quote, sinon `\'` casserait l'échappement.
    const value = dedup.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const soql = `SELECT Id FROM ${this.sobject} WHERE ${dedup.targetField} = '${value}' LIMIT 1`;
    const data = await this.request<{ records?: Array<{ Id: string }> }>(
      'GET',
      `/query?q=${encodeURIComponent(soql)}`,
    );
    return data?.records?.[0]?.Id ?? null;
  }

  private request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return requestJson<T>(method, `${this.baseUrl}${path}`, {
      service: SERVICE,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body,
      timeoutMs: this.timeoutMs,
    });
  }
}
