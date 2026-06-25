import { describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../sqlite.js';
import type { BotRecord } from '../types.js';

function baseBot(over: Partial<BotRecord> = {}): BotRecord {
  return {
    client_id: 'c1', bot_id: 'b1', name: 'Agent', transport: 'meta-cloud', status: 'draft',
    default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'Agent.' },
    lead_fields: '', welcome: { enabled: false, message: {} }, error_messages: {},
    catalog: null, llm: null, crm: null, personality: null, ...over,
  };
}

describe('DB: colonne personality', () => {
  it('round-trip personality (ecriture/lecture)', async () => {
    const db = createSqliteDriver(':memory:');
    const rec = baseBot({ personality: { fr: { role: 'Conseiller', tones: ['concis'], objective: 'aider', info: '' } } });
    await db.upsertBotRecord(rec);
    const back = await db.getBotRecord('c1', 'b1');
    expect(back?.personality).toEqual(rec.personality);
  });

  it('personality null par defaut', async () => {
    const db = createSqliteDriver(':memory:');
    await db.upsertBotRecord(baseBot());
    const back = await db.getBotRecord('c1', 'b1');
    expect(back?.personality).toBeNull();
  });
});
