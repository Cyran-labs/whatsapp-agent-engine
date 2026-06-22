import {
  getBotConfig, findBotConfigByNumber, listBotConfigs, resetConfigStore,
} from './config-store.js';

export type TransportId = 'cm-com' | 'meta-cloud';
export type CrmConnectorId = 'hubspot' | 'mad-crm' | 'webhook-generic' | 'attio' | 'pipedrive' | 'salesforce' | 'zoho';

export interface BotConfig {
  client_id: string;
  bot_id: string;
  name: string;
  /** Transport WhatsApp utilisé par ce bot. Doit être configuré dans .env (CM_* ou META_*). */
  transport: TransportId;
  system_prompt: string;
  lead_fields: string;
  whatsapp_numbers: string[];
  welcome: {
    enabled: boolean;
    message: string;
  };
  catalog?: {
    meta_catalog_id?: string;
  };
  llm?: {
    model?: string;
  };
  /**
   * Connecteur CRM cible. Si présent, les événements lead.qualified / lead.updated
   * sont automatiquement poussés vers ce connecteur. Mapping des champs lu depuis
   * connectors-config/{client_id}/{connector}.json.
   */
  crm?: {
    connector: CrmConnectorId;
  };
}

export function loadBotConfig(clientId: string, botId: string): BotConfig {
  return getBotConfig(clientId, botId);
}

export function findBotByNumber(toNumber: string): BotConfig | null {
  return findBotConfigByNumber(toNumber);
}

export function listBots(): BotConfig[] {
  return listBotConfigs();
}

export function resetBotConfigCache(): void {
  resetConfigStore();
}
