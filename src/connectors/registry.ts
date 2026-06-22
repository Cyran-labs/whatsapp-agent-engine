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
import { HubSpotConnector } from './hubspot.js';
import { AttioConnector } from './attio.js';
import { PipedriveConnector } from './pipedrive.js';
import { SalesforceConnector } from './salesforce.js';
import { ZohoConnector } from './zoho.js';

export type ConnectorType =
  | 'webhook-generic'
  | 'mad-crm'
  | 'hubspot'
  | 'attio'
  | 'pipedrive'
  | 'salesforce'
  | 'zoho';

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

    case 'hubspot':
      return new HubSpotConnector({
        accessToken: config.credentials['access_token'] ?? '',
        clientId: config.credentials['client_id'] ?? 'default',
        mapping: config.mapping,
      });

    case 'attio':
      return new AttioConnector({
        apiKey: config.credentials['api_key'] ?? '',
        createDeal: config.options?.['create_deal'] === true,
        dealStageId: config.options?.['deal_stage_id'] as string | undefined,
        ownerMemberId: config.options?.['owner_member_id'] as string | undefined,
        createTask: config.options?.['create_task'] === true,
        noteTitle: config.options?.['note_title'] as string | undefined,
      });

    case 'pipedrive':
      return new PipedriveConnector({
        apiToken: config.credentials['api_token'] ?? '',
        companyDomain: config.credentials['company_domain'],
        clientId: config.credentials['client_id'] ?? 'default',
        mapping: config.mapping,
      });

    case 'salesforce':
      return new SalesforceConnector({
        instanceUrl: config.credentials['instance_url'] ?? '',
        accessToken: config.credentials['access_token'] ?? '',
        apiVersion: config.options?.['api_version'] as string | undefined,
        sobject: config.options?.['sobject'] as string | undefined,
        clientId: config.credentials['client_id'] ?? 'default',
        mapping: config.mapping,
      });

    case 'zoho':
      return new ZohoConnector({
        accessToken: config.credentials['access_token'] ?? '',
        apiDomain: config.credentials['api_domain'],
        module: config.options?.['module'] as string | undefined,
        clientId: config.credentials['client_id'] ?? 'default',
        mapping: config.mapping,
      });

    default:
      throw new Error(`Unknown connector type: ${config.type}`);
  }
}
