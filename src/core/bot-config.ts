import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOTS_DIR = path.join(__dirname, '..', '..', 'bots');

export type TransportId = 'cm-com' | 'meta-cloud';
export type CrmConnectorId = 'hubspot' | 'mad-crm' | 'webhook-generic' | 'attio';

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

const cache = new Map<string, BotConfig>();
const numberIndex = new Map<string, BotConfig>();
let indexBuilt = false;

function configKey(clientId: string, botId: string): string {
  return `${clientId}/${botId}`;
}

function normalizeNumber(num: string): string {
  return num.replace(/\D/g, '');
}

export function loadBotConfig(clientId: string, botId: string): BotConfig {
  const key = configKey(clientId, botId);
  const cached = cache.get(key);
  if (cached) return cached;

  const filePath = path.join(BOTS_DIR, clientId, `${botId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`[BotConfig] Not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const cfg = JSON.parse(raw) as BotConfig;

  if (cfg.client_id !== clientId || cfg.bot_id !== botId) {
    throw new Error(
      `[BotConfig] Mismatch in ${filePath}: file path says (${clientId}/${botId}) but content says (${cfg.client_id}/${cfg.bot_id})`
    );
  }

  cache.set(key, cfg);
  return cfg;
}

function buildIndex(): void {
  if (indexBuilt) return;

  if (!fs.existsSync(BOTS_DIR)) {
    indexBuilt = true;
    return;
  }

  const clients = fs.readdirSync(BOTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const clientId of clients) {
    const clientDir = path.join(BOTS_DIR, clientId);
    const files = fs.readdirSync(clientDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const botId = file.replace(/\.json$/, '');
      const cfg = loadBotConfig(clientId, botId);
      for (const num of cfg.whatsapp_numbers) {
        const key = normalizeNumber(num);
        const existing = numberIndex.get(key);
        if (existing) {
          throw new Error(
            `[BotConfig] WhatsApp number conflict: ${num} mapped to both ${existing.client_id}/${existing.bot_id} and ${cfg.client_id}/${cfg.bot_id}`
          );
        }
        numberIndex.set(key, cfg);
      }
    }
  }

  indexBuilt = true;
  console.log(`[BotConfig] Indexed ${cache.size} bot(s) across ${clients.length} client(s)`);
}

export function findBotByNumber(toNumber: string): BotConfig | null {
  buildIndex();
  return numberIndex.get(normalizeNumber(toNumber)) ?? null;
}

export function listBots(): BotConfig[] {
  buildIndex();
  return Array.from(cache.values());
}

export function resetBotConfigCache(): void {
  cache.clear();
  numberIndex.clear();
  indexBuilt = false;
}
