import { getBotConfig, listBotConfigs, resetConfigStore } from './config-store.js';

export type CrmConnectorId = 'hubspot' | 'mad-crm' | 'webhook-generic' | 'attio' | 'pipedrive' | 'salesforce' | 'zoho';

export interface BotConfig {
  client_id: string;
  bot_id: string;
  name: string;
  /**
   * Statut de l'agent IA (`draft`, `limited`, `active`, `paused`), copié de la base au dernier upsertBot.
   * Informatif seulement : le statut qui décide de servir un message est relu en base (src/core/router.ts).
   */
  status: string;
  system_prompt: string;
  lead_fields: string;
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

export function listBots(): BotConfig[] {
  return listBotConfigs();
}

export function resetBotConfigCache(): void {
  resetConfigStore();
}
