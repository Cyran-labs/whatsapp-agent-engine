import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../database/sqlite.js';
import { __setDatabaseForTests, getDatabase } from '../database/index.js';
import { initConfigStore, resetConfigStore } from '../config-store.js';
import { loadBotConfig, listBots } from '../bot-config.js';
import type { BotRecord } from '../database/types.js';

const rec: BotRecord = {
  client_id: 'acme', bot_id: 'sales', name: 'Bot Ventes', status: 'active',
  status_reason: null,
  default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'P' }, lead_fields: 'email',
  welcome: { enabled: false, message: { fr: 'B' } }, error_messages: {}, catalog: null, llm: null, crm: null, personality: null, entity_id: null,
};

describe('bot-config délègue au ConfigStore', () => {
  beforeEach(async () => {
    __setDatabaseForTests(createSqliteDriver(':memory:'));
    resetConfigStore();
    await getDatabase().upsertBotRecord(rec);
    await initConfigStore();
  });
  afterEach(() => resetConfigStore());

  it('loadBotConfig / listBots fonctionnent via la DB', () => {
    expect(loadBotConfig('acme', 'sales').name).toBe('Bot Ventes');
    expect(listBots()).toHaveLength(1);
  });
});
