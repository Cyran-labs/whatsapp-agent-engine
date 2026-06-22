import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../database/sqlite.js';
import { __setDatabaseForTests, getDatabase } from '../database/index.js';
import { initConfigStore, resetConfigStore } from '../config-store.js';
import { loadBotConfig, findBotByNumber, listBots } from '../bot-config.js';
import type { BotRecord } from '../database/types.js';

const rec: BotRecord = {
  client_id: 'acme', bot_id: 'immo', name: 'Bot Immo', transport: 'meta-cloud', status: 'active',
  default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'P' }, lead_fields: 'email',
  welcome: { enabled: false, message: { fr: 'B' } }, error_messages: {}, catalog: null, llm: null, crm: null,
};

describe('bot-config délègue au ConfigStore', () => {
  beforeEach(async () => {
    __setDatabaseForTests(createSqliteDriver(':memory:'));
    resetConfigStore();
    await getDatabase().upsertBotRecord(rec);
    await getDatabase().setBotNumbers('acme', 'immo', ['+33 6 11']);
    await initConfigStore();
  });
  afterEach(() => resetConfigStore());

  it('loadBotConfig / findBotByNumber / listBots fonctionnent via la DB', () => {
    expect(loadBotConfig('acme', 'immo').name).toBe('Bot Immo');
    expect(findBotByNumber('+33 6 11')!.bot_id).toBe('immo');
    expect(listBots()).toHaveLength(1);
  });
});
