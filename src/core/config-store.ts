/**
 * Source de vérité runtime des configs bot, adossée à la DB avec un cache mémoire chaud.
 *
 * initConfigStore() charge tous les bots au démarrage ; les getters restent synchrones
 * (hot path runtime inchangé). upsertBot() écrit la DB puis rafraîchit le cache à chaud.
 * Les champs de contenu sont stockés localisés ; le runtime lit default_language.
 */

import { getDatabase } from './database/index.js';
import type { BotRecord, BotNumberRecord } from './database/types.js';
import type { BotConfig, TransportId, CrmConnectorId } from './bot-config.js';
import type { FieldMapping } from '../connectors/field-mapper.js';

const cache = new Map<string, BotConfig>();
const numberIndex = new Map<string, BotConfig>();

function key(clientId: string, botId: string): string { return `${clientId}/${botId}`; }
function normalizePhone(num: string): string { return num.replace(/\D/g, ''); }

function pickLocalized(map: Record<string, string>, defaultLang: string): string {
  if (map[defaultLang]) return map[defaultLang];
  const first = Object.values(map)[0];
  return first ?? '';
}

export function botRecordToConfig(rec: BotRecord, numbers: string[]): BotConfig {
  return {
    client_id: rec.client_id,
    bot_id: rec.bot_id,
    name: rec.name,
    transport: rec.transport as TransportId,
    system_prompt: pickLocalized(rec.system_prompt, rec.default_language),
    lead_fields: rec.lead_fields,
    whatsapp_numbers: numbers.map(normalizePhone).filter(Boolean),
    welcome: {
      enabled: rec.welcome.enabled,
      message: pickLocalized(rec.welcome.message, rec.default_language),
    },
    ...(rec.catalog ? { catalog: rec.catalog } : {}),
    ...(rec.llm ? { llm: { ...(rec.llm.model ? { model: rec.llm.model } : {}) } } : {}),
    ...(rec.crm ? { crm: { connector: rec.crm.connector as CrmConnectorId } } : {}),
  };
}

function indexConfig(cfg: BotConfig): void {
  cache.set(key(cfg.client_id, cfg.bot_id), cfg);
  for (const num of cfg.whatsapp_numbers) {
    const existing = numberIndex.get(num);
    if (existing && key(existing.client_id, existing.bot_id) !== key(cfg.client_id, cfg.bot_id)) {
      throw new Error(`[ConfigStore] WhatsApp number conflict: ${num} -> ${existing.client_id}/${existing.bot_id} et ${cfg.client_id}/${cfg.bot_id}`);
    }
    numberIndex.set(num, cfg);
  }
}

export async function initConfigStore(): Promise<void> {
  resetConfigStore();
  const db = getDatabase();
  const [bots, numbers] = await Promise.all([db.listBotRecords(), db.listBotNumbers()]);
  const numsByBot = new Map<string, string[]>();
  for (const n of numbers as BotNumberRecord[]) {
    const k = key(n.client_id, n.bot_id);
    (numsByBot.get(k) ?? numsByBot.set(k, []).get(k)!).push(n.whatsapp_number);
  }
  for (const rec of bots) {
    indexConfig(botRecordToConfig(rec, numsByBot.get(key(rec.client_id, rec.bot_id)) ?? []));
  }
  console.log(`[ConfigStore] Loaded ${cache.size} bot(s)`);
}

export function getBotConfig(clientId: string, botId: string): BotConfig {
  const cfg = cache.get(key(clientId, botId));
  if (!cfg) throw new Error(`[ConfigStore] Bot not found: ${clientId}/${botId}`);
  return cfg;
}

export function findBotConfigByNumber(toNumber: string): BotConfig | null {
  return numberIndex.get(normalizePhone(toNumber)) ?? null;
}

export function listBotConfigs(): BotConfig[] {
  return Array.from(cache.values());
}

export async function upsertBot(rec: BotRecord, numbers: string[]): Promise<void> {
  const db = getDatabase();
  await db.upsertBotRecord(rec);
  await db.setBotNumbers(rec.client_id, rec.bot_id, numbers);
  // Rafraîchit le cache à chaud : purge les anciens numéros de ce bot puis ré-indexe.
  const k = key(rec.client_id, rec.bot_id);
  for (const [num, cfg] of numberIndex) {
    if (key(cfg.client_id, cfg.bot_id) === k) numberIndex.delete(num);
  }
  cache.delete(k);
  indexConfig(botRecordToConfig(rec, numbers));
}

/**
 * Résout le mapping CRM d'un bot : bot-scope d'abord, fallback client-level.
 * Async (DB) — utilisé au bind du CrmBridge et par les endpoints admin, pas sur le hot path runtime.
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
  numberIndex.clear();
}
