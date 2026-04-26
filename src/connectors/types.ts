/**
 * Types partagés des connecteurs CRM.
 *
 * Tout connecteur (MAD CRM, HubSpot, Attio, ...) implémente l'interface CRMConnector.
 * Voir docs/CRM_INTEGRATION.md pour le format des événements et le contrat.
 */

export interface NormalizedLead {
  // Identification
  client_id: string;
  bot_id: string;
  lead_id: string;
  phone: string;
  profile_name?: string;

  // Identité (extraits par le LLM d'extraction)
  prenom?: string;
  nom?: string;
  email?: string;
  societe?: string;
  fonction?: string;

  // Contexte métier (variable selon bot)
  besoin?: string;
  budget?: string;
  custom_fields?: Record<string, string>;

  // Métadonnées
  source: string;
  created_at: string;
  updated_at: string;
}

export interface NormalizedBooking {
  client_id: string;
  bot_id: string;
  lead_id: string;
  phone: string;
  event_name: string;
  start_time: string;       // ISO 8601
  end_time?: string;        // ISO 8601
  invitee_name?: string;
  invitee_email?: string;
  notes?: string;
  source: string;
}

export interface NormalizedOrder {
  client_id: string;
  bot_id: string;
  lead_id: string;
  phone: string;
  items: Array<{
    product_id: string;
    name: string;
    quantity: number;
    unit_price: number;
    currency: string;
  }>;
  total: number;
  currency: string;
  ordered_at: string;
}

/**
 * Interface commune à tous les connecteurs CRM.
 *
 * Les connecteurs sont stateless : pas de session, pas de cache.
 * L'instanciation se fait au boot avec les credentials du tenant.
 */
export interface CRMConnector {
  readonly connectorName: string;

  /**
   * Push d'un nouveau lead qualifié vers le CRM.
   * Le CRM doit gérer l'idempotency via le `lead_id` (upsert).
   */
  pushLead(lead: NormalizedLead): Promise<void>;

  /**
   * Update partiel d'un lead existant.
   * Émis pendant la conversation au fur et à mesure que des champs sont enrichis.
   */
  updateLead(leadId: string, fields: Partial<NormalizedLead>): Promise<void>;

  /**
   * Push d'une réservation (RDV via Calendly ou équivalent).
   */
  pushBooking(booking: NormalizedBooking): Promise<void>;

  /**
   * (Optionnel) Push d'un order WhatsApp natif.
   * Tous les CRM ne gèrent pas les orders — implémentation optionnelle.
   */
  pushOrder?(order: NormalizedOrder): Promise<void>;
}

export interface ConnectorConfig {
  type: string;                       // 'mad-crm' | 'hubspot' | 'attio' | 'webhook-generic'
  credentials: Record<string, string>; // Selon le connecteur (api_key, oauth_token, etc.)
  options?: Record<string, unknown>;   // Configuration spécifique
}
