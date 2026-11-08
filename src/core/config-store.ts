/**
 * Source de vérité runtime des configs d'agents IA, adossée à la base avec un cache mémoire chaud.
 *
 * initConfigStore() charge tous les agents IA au démarrage ; les getters restent synchrones.
 * upsertBot() écrit la base, relit l'enregistrement et le met en cache, sous un verrou par agent IA.
 * Les champs de contenu sont stockés localisés ; le runtime lit default_language.
 *
 * Aucun routage ici (choix 1 du lot 2b-2) : le numéro destinataire est cherché en base à chaque message,
 * dans l'inventaire du compte WhatsApp de l'URL (src/webhooks/). Le statut mis en cache n'est jamais
 * celui qui décide de servir un message : il est relu en base (src/core/router.ts).
 */

import { getDatabase } from './database/index.js';
import type { BotRecord } from './database/types.js';
import type { BotConfig, TransportId, CrmConnectorId } from './bot-config.js';
import type { FieldMapping } from '../connectors/field-mapper.js';
import { createKeyedLock } from './conversation-lock.js';

const cache = new Map<string, BotConfig>();
// Écriture puis relecture d'un agent IA sérialisées par agent IA : deux upsertBot concurrents ne laissent
// jamais en cache une version plus ancienne que la base (revue d'isolation I-1).
const botLock = createKeyedLock();

function key(clientId: string, botId: string): string { return `${clientId}/${botId}`; }

function pickLocalized(map: Record<string, string>, defaultLang: string): string {
  if (map[defaultLang]) return map[defaultLang];
  const first = Object.values(map)[0];
  return first ?? '';
}

export function botRecordToConfig(rec: BotRecord): BotConfig {
  return {
    client_id: rec.client_id,
    bot_id: rec.bot_id,
    name: rec.name,
    status: rec.status,
    transport: rec.transport as TransportId,
    system_prompt: pickLocalized(rec.system_prompt, rec.default_language),
    lead_fields: rec.lead_fields,
    welcome: {
      enabled: rec.welcome.enabled,
      message: pickLocalized(rec.welcome.message, rec.default_language),
    },
    ...(rec.catalog ? { catalog: rec.catalog } : {}),
    ...(rec.llm ? { llm: { ...(rec.llm.model ? { model: rec.llm.model } : {}) } } : {}),
    ...(rec.crm ? { crm: { connector: rec.crm.connector as CrmConnectorId } } : {}),
  };
}

export async function initConfigStore(): Promise<void> {
  resetConfigStore();
  const bots = await getDatabase().listBotRecords();
  for (const rec of bots) cache.set(key(rec.client_id, rec.bot_id), botRecordToConfig(rec));
  console.log(`[ConfigStore] Loaded ${cache.size} bot(s)`);
}

export function getBotConfig(clientId: string, botId: string): BotConfig {
  const cfg = cache.get(key(clientId, botId));
  if (!cfg) throw new Error(`[ConfigStore] Bot not found: ${clientId}/${botId}`);
  return cfg;
}

/** Configuration en cache de l'agent IA, ou null s'il est inconnu. */
export function findBotConfig(clientId: string, botId: string): BotConfig | null {
  return cache.get(key(clientId, botId)) ?? null;
}

export function listBotConfigs(): BotConfig[] {
  return Array.from(cache.values());
}

/**
 * Écrit l'agent IA, relit son enregistrement en base et met cette lecture en cache, sous le verrou
 * `<organisation>/<agent IA>`. `numbers` fourni : remplace les lignes `bot_numbers` de l'agent IA, encore
 * écrites par BotService jusqu'à la tâche 8 du lot 2b-2 ; le chemin des messages ne les lit pas.
 */
export async function upsertBot(rec: BotRecord, numbers?: string[]): Promise<void> {
  const k = key(rec.client_id, rec.bot_id);
  await botLock.run(k, async () => {
    const db = getDatabase();
    await db.upsertBotRecord(rec);
    if (numbers !== undefined) await db.setBotNumbers(rec.client_id, rec.bot_id, numbers);
    const stored = await db.getBotRecord(rec.client_id, rec.bot_id);
    if (stored) cache.set(k, botRecordToConfig(stored));
    else cache.delete(k);
  });
}

/**
 * Résout le mapping CRM d'un bot : bot-scope d'abord, fallback client-level.
 * Async (DB): utilisé au bind du CrmBridge et par les endpoints admin, pas sur le hot path runtime.
 */
export async function getMapping(clientId: string, botId: string | null, connector: string): Promise<FieldMapping | null> {
  const db = getDatabase();
  const bot = botId !== null ? await db.getConnectorMapping(clientId, botId, connector) : null;
  if (bot) return bot.mapping as unknown as FieldMapping;
  const client = await db.getConnectorMapping(clientId, null, connector);
  return client ? (client.mapping as unknown as FieldMapping) : null;
}

export async function upsertMapping(clientId: string, botId: string | null, connector: string, mapping: FieldMapping): Promise<void> {
  const db = getDatabase();
  await db.upsertConnectorMapping({ client_id: clientId, bot_id: botId, connector, mapping: mapping as unknown as Record<string, unknown> });
}

export function resetConfigStore(): void {
  cache.clear();
}
