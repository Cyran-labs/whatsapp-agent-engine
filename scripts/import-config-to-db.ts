/**
 * Import one-shot des configs bot JSON (bots/{client}/{bot}.json) vers la DB.
 * Idempotent (upsert), non destructif. Exécuter : npx tsx scripts/import-config-to-db.ts
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, getDatabase } from '../src/core/database/index.js';
import type { BotRecord } from '../src/core/database/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOTS_DIR = path.join(__dirname, '..', 'bots');

export function jsonBotToRecord(json: Record<string, unknown>): { record: BotRecord; numbers: string[] } {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const welcome = (json.welcome ?? {}) as { enabled?: boolean; message?: unknown };
  const record: BotRecord = {
    client_id: str(json.client_id),
    bot_id: str(json.bot_id),
    name: str(json.name),
    transport: str(json.transport),
    status: 'active',
    default_language: 'fr',
    languages: ['fr'],
    system_prompt: { fr: str(json.system_prompt) },
    lead_fields: str(json.lead_fields),
    welcome: { enabled: Boolean(welcome.enabled), message: { fr: str(welcome.message) } },
    error_messages: {},
    catalog: (json.catalog as BotRecord['catalog']) ?? null,
    llm: (json.llm as BotRecord['llm']) ?? null,
    crm: (json.crm as BotRecord['crm']) ?? null,
  };
  const numbers = Array.isArray(json.whatsapp_numbers) ? (json.whatsapp_numbers as string[]) : [];
  return { record, numbers };
}

async function main(): Promise<void> {
  await initDatabase();
  const db = getDatabase();
  if (!fs.existsSync(BOTS_DIR)) { console.log('[Import] no bots/ directory'); await db.close(); return; }

  const clients = fs.readdirSync(BOTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  let count = 0;
  for (const clientId of clients) {
    await db.upsertClient({ client_id: clientId, name: clientId, status: 'active' });
    const files = fs.readdirSync(path.join(BOTS_DIR, clientId)).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const raw = fs.readFileSync(path.join(BOTS_DIR, clientId, file), 'utf-8');
      const { record, numbers } = jsonBotToRecord(JSON.parse(raw) as Record<string, unknown>);
      await db.upsertBotRecord(record);
      await db.setBotNumbers(record.client_id, record.bot_id, numbers);
      count++;
      console.log(`[Import] ${record.client_id}/${record.bot_id} (${numbers.length} numéro(s))`);
    }
  }
  console.log(`[Import] ${count} bot(s) importé(s).`);
  await db.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error('[Import] échec:', err); process.exit(1); });
}
