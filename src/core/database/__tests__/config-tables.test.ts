import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../sqlite.js';
import type { Database, BotRecord } from '../types.js';

function bot(over: Partial<BotRecord> = {}): BotRecord {
  return {
    client_id: 'acme', bot_id: 'immo', name: 'Bot Immo',
    transport: 'meta-cloud', status: 'active',
    default_language: 'fr', languages: ['fr', 'en'],
    system_prompt: { fr: 'Tu es...', en: 'You are...' }, lead_fields: 'email, stage',
    welcome: { enabled: true, message: { fr: 'Bonjour', en: 'Hello' } },
    error_messages: { fr: 'Souci technique' },
    catalog: null, llm: { mode: 'platform' }, crm: { connector: 'hubspot' },
    ...over,
  };
}

describe('config tables (sqlite)', () => {
  let db: Database;
  beforeEach(() => { db = createSqliteDriver(':memory:'); });
  afterEach(async () => { await db.close(); });

  it('upsert + get bot roundtrip (JSON localisé préservé)', async () => {
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.upsertBotRecord(bot());
    const got = await db.getBotRecord('acme', 'immo');
    expect(got).toBeDefined();
    expect(got!.system_prompt).toEqual({ fr: 'Tu es...', en: 'You are...' });
    expect(got!.languages).toEqual(['fr', 'en']);
    expect(got!.welcome.message.fr).toBe('Bonjour');
    expect(got!.crm).toEqual({ connector: 'hubspot' });
  });

  it('upsert est idempotent (update, pas de doublon)', async () => {
    await db.upsertBotRecord(bot());
    await db.upsertBotRecord(bot({ name: 'Renommé' }));
    const all = await db.listBotRecords();
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe('Renommé');
  });

  it('setBotNumbers remplace le set et listBotNumbers les renvoie', async () => {
    await db.upsertBotRecord(bot());
    await db.setBotNumbers('acme', 'immo', ['+33 6 11', '+33 6 22']);
    await db.setBotNumbers('acme', 'immo', ['+33 6 33']); // remplace
    const nums = await db.listBotNumbers();
    expect(nums.map((n) => n.whatsapp_number)).toEqual(['33633']); // normalisé
    expect(nums[0]!.bot_id).toBe('immo');
  });

  it('deleteBotRecord supprime le bot et ses numéros', async () => {
    await db.upsertBotRecord(bot());
    await db.setBotNumbers('acme', 'immo', ['+33 6 33']);
    await db.deleteBotRecord('acme', 'immo');
    expect(await db.getBotRecord('acme', 'immo')).toBeUndefined();
    expect(await db.listBotNumbers()).toHaveLength(0);
  });

  it('clients : upsert + list', async () => {
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.upsertClient({ client_id: 'acme', name: 'Acme Corp', status: 'active' });
    const clients = await db.listClients();
    expect(clients).toHaveLength(1);
    expect(clients[0]!.name).toBe('Acme Corp');
  });
});
