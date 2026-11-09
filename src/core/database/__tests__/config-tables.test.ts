import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../../test-support/test-database.js';
import type { Database, BotRecord } from '../types.js';

function bot(over: Partial<BotRecord> = {}): BotRecord {
  return {
    client_id: 'acme', bot_id: 'sales', name: 'Bot Ventes',
    status: 'active',
    status_reason: null,
    default_language: 'fr', languages: ['fr', 'en'],
    system_prompt: { fr: 'Tu es...', en: 'You are...' }, lead_fields: 'email, stage',
    welcome: { enabled: true, message: { fr: 'Bonjour', en: 'Hello' } },
    error_messages: { fr: 'Souci technique' },
    catalog: null, llm: { mode: 'platform' }, crm: { connector: 'hubspot' }, personality: null, entity_id: null,
    ...over,
  };
}

describe('config tables', () => {
  let db: Database;
  beforeEach(async () => { db = await createTestDatabase(); });
  afterEach(async () => { await db.close(); });

  it('upsert + get bot roundtrip (JSON localisé préservé)', async () => {
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.upsertBotRecord(bot());
    const got = await db.getBotRecord('acme', 'sales');
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

  it('deleteBotRecord supprime le bot', async () => {
    await db.upsertBotRecord(bot());
    await db.deleteBotRecord('acme', 'sales');
    expect(await db.getBotRecord('acme', 'sales')).toBeUndefined();
  });

  it('clients : upsert + list', async () => {
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.upsertClient({ client_id: 'acme', name: 'Acme Corp', status: 'active' });
    const clients = await db.listClients();
    expect(clients).toHaveLength(1);
    expect(clients[0]!.name).toBe('Acme Corp');
  });
});
