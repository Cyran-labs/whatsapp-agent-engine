/**
 * Connecteur MAD CRM — V1 webhook lead.qualified et lead.updated en temps réel.
 *
 * STATUS : squelette à compléter avec les endpoints réels de MAD CRM
 * une fois la spec API obtenue lors de la réunion lundi.
 *
 * Pour la V1, on peut utiliser WebhookGenericConnector si MAD CRM accepte
 * notre format normalisé. Ce fichier est ici pour préparer une intégration
 * native plus profonde (création de contact + association deal + workflow MAD).
 */

import type {
  CRMConnector,
  NormalizedLead,
  NormalizedBooking,
} from './types.js';

interface MadCrmOptions {
  apiUrl: string;
  apiKey: string;
}

export class MadCrmConnector implements CRMConnector {
  readonly connectorName = 'mad-crm';

  private apiUrl: string;
  private apiKey: string;

  constructor(options: MadCrmOptions) {
    this.apiUrl = options.apiUrl;
    this.apiKey = options.apiKey;
  }

  async pushLead(lead: NormalizedLead): Promise<void> {
    // TODO : remplacer par les endpoints réels MAD CRM après la réunion
    // Exemple supposé :
    // POST {apiUrl}/api/v1/leads
    // { external_id, source, contact: { ... }, custom: { ... } }
    console.log(`[MadCrm] pushLead à implémenter : ${lead.lead_id}`);
    throw new Error('MadCrmConnector.pushLead not yet implemented — voir docs/CRM_INTEGRATION.md');
  }

  async updateLead(leadId: string, fields: Partial<NormalizedLead>): Promise<void> {
    console.log(`[MadCrm] updateLead à implémenter : ${leadId}`);
    throw new Error('MadCrmConnector.updateLead not yet implemented');
  }

  async pushBooking(booking: NormalizedBooking): Promise<void> {
    console.log(`[MadCrm] pushBooking à implémenter : ${booking.lead_id}`);
    throw new Error('MadCrmConnector.pushBooking not yet implemented');
  }
}
