import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../database/sqlite.js';
import { __setDatabaseForTests } from '../database/index.js';
import {
  initConfigStore, getBotConfig, findBotConfigByNumber, listBotConfigs,
  upsertBot, resetConfigStore, botRecordToConfig,
} from '../config-store.js';
import type { BotRecord } from '../database/types.js';

function rec(over: Partial<BotRecord> = {}): BotRecord {
  return {
    client_id: 'acme', bot_id: 'sales', name: 'Bot Ventes',
    transport: 'meta-cloud', status: 'active',
    default_language: 'fr', languages: ['fr', 'en'],
    system_prompt: { fr: 'Prompt FR', en: 'Prompt EN' }, lead_fields: 'email',
    welcome: { enabled: true, message: { fr: 'Bonjour', en: 'Hello' } },
    error_messages: { fr: 'Erreur' }, catalog: null, llm: { model: 'x' }, crm: { connector: 'hubspot' },
    ...over,
  };
}

describe('botRecordToConfig (pur)', () => {
  it('aplatit le localisé sur default_language', () => {
    const cfg = botRecordToConfig(rec(), ['33611']);
    expect(cfg.system_prompt).toBe('Prompt FR');
    expect(cfg.welcome.message).toBe('Bonjour');
    expect(cfg.whatsapp_numbers).toEqual(['33611']);
    expect(cfg.crm).toEqual({ connector: 'hubspot' });
    expect(cfg.transport).toBe('meta-cloud');
  });

  it('fallback sur la 1re langue si default_language absent du map', () => {
    const cfg = botRecordToConfig(rec({ default_language: 'de', system_prompt: { fr: 'FR' }, welcome: { enabled: false, message: { fr: 'B' } } }), []);
    expect(cfg.system_prompt).toBe('FR');
  });
});

describe('ConfigStore (cache chaud)', () => {
  beforeEach(async () => {
    const db = createSqliteDriver(':memory:');
    __setDatabaseForTests(db);
    resetConfigStore();
  });
  afterEach(() => { resetConfigStore(); });

  it('init charge les bots et findBotConfigByNumber résout', async () => {
    const { getDatabase } = await import('../database/index.js');
    await getDatabase().upsertBotRecord(rec());
    await getDatabase().setBotNumbers('acme', 'sales', ['+33 6 11']);
    await initConfigStore();
    expect(listBotConfigs()).toHaveLength(1);
    expect(getBotConfig('acme', 'sales').name).toBe('Bot Ventes');
    expect(findBotConfigByNumber('33611')!.bot_id).toBe('sales');
    expect(findBotConfigByNumber('00000')).toBeNull();
  });

  it('upsertBot écrit en DB et rafraîchit le cache à chaud', async () => {
    await initConfigStore();
    await upsertBot(rec(), ['+33 6 22']);
    expect(getBotConfig('acme', 'sales')).toBeDefined();
    expect(findBotConfigByNumber('33622')!.bot_id).toBe('sales');
  });

  it('upsertBot purge les numéros retirés du bot (routage)', async () => {
    await initConfigStore();
    await upsertBot(rec(), ['+33 6 11']);
    expect(findBotConfigByNumber('33611')!.bot_id).toBe('sales');

    await upsertBot(rec(), ['+33 6 22']);
    expect(findBotConfigByNumber('33611')).toBeNull();
    expect(findBotConfigByNumber('33622')!.bot_id).toBe('sales');
  });

  it('getBotConfig throw si absent', () => {
    expect(() => getBotConfig('x', 'y')).toThrow(/\[ConfigStore\]/);
  });
});
