/**
 * Registry des connecteurs CRM disponibles.
 *
 * Chaque tenant a un `crm_connector` dans sa config qui pointe vers une clé
 * de ce registry. Au boot, on instancie le bon connecteur avec les credentials
 * du tenant.
 *
 * Pour ajouter un nouveau CRM :
 *   1. Créer src/connectors/{nom}.ts implémentant CRMConnector
 *   2. L'enregistrer ici
 *   3. Pas d'autre modification du moteur nécessaire
 */

import type { CRMConnector, ConnectorConfig } from './types.js';
import { WebhookGenericConnector } from './webhook-generic.js';
import { MadCrmConnector } from './mad-crm.js';
// import { HubSpotConnector } from './hubspot.js';      // À migrer
// import { AttioConnector } from './attio.js';          // À migrer

export type ConnectorType = 'webhook-generic' | 'mad-crm' | 'hubspot' | 'attio';

export function createConnector(config: ConnectorConfig): CRMConnector {
  switch (config.type) {
    case 'webhook-generic':
      return new WebhookGenericConnector({
        url: config.credentials['url'] ?? '',
        secret: config.credentials['secret'] ?? '',
      });

    case 'mad-crm':
      return new MadCrmConnector({
        apiUrl: config.credentials['api_url'] ?? '',
        apiKey: config.credentials['api_key'] ?? '',
      });

    // case 'hubspot':
    //   return new HubSpotConnector({ accessToken: config.credentials['access_token'] });

    // case 'attio':
    //   return new AttioConnector({ apiKey: config.credentials['api_key'] });

    default:
      throw new Error(`Unknown connector type: ${config.type}`);
  }
}
