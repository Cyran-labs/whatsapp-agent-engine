import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as transports from '../../transport/index.js';
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
    status_reason: null, default_language: 'fr', languages: ['fr', 'en'],
    system_prompt: { fr: 'Prompt FR', en: 'Prompt EN' }, lead_fields: 'email',
    welcome: { enabled: true, message: { fr: 'Bonjour', en: 'Hello' } },
    error_messages: { fr: 'Erreur' }, catalog: null, llm: { model: 'x' }, crm: { connector: 'hubspot' }, personality: null, entity_id: null,
    ...over,
  };
}

describe('botRecordToConfig (pur)', () => {
  it('aplatit le localisé sur default_language', () => {
    const cfg = botRecordToConfig(rec(), ['+33611111111']);
    expect(cfg.system_prompt).toBe('Prompt FR');
    expect(cfg.welcome.message).toBe('Bonjour');
    expect(cfg.whatsapp_numbers).toEqual(['+33611111111']);
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
    await getDatabase().setBotNumbers('acme', 'sales', ['+33 6 11 11 11 11']);
    await initConfigStore();
    expect(listBotConfigs()).toHaveLength(1);
    expect(getBotConfig('acme', 'sales').name).toBe('Bot Ventes');
    expect(findBotConfigByNumber('33611111111')!.bot_id).toBe('sales');
    expect(findBotConfigByNumber('+33 6 11 11 11 11')!.bot_id).toBe('sales');
    expect(findBotConfigByNumber('0033611111111')!.bot_id).toBe('sales');
    expect(findBotConfigByNumber('0611111111')).toBeNull();
    expect(findBotConfigByNumber('+33699999999')).toBeNull();
  });

  it('upsertBot écrit en DB et rafraîchit le cache à chaud', async () => {
    await initConfigStore();
    await upsertBot(rec(), ['+33 6 22 22 22 22']);
    expect(getBotConfig('acme', 'sales')).toBeDefined();
    expect(findBotConfigByNumber('33622222222')!.bot_id).toBe('sales');
  });

  it('upsertBot purge les numéros retirés du bot (routage)', async () => {
    await initConfigStore();
    await upsertBot(rec(), ['+33 6 11 11 11 11']);
    expect(findBotConfigByNumber('33611111111')!.bot_id).toBe('sales');

    await upsertBot(rec(), ['+33 6 22 22 22 22']);
    expect(findBotConfigByNumber('33611111111')).toBeNull();
    expect(findBotConfigByNumber('33622222222')!.bot_id).toBe('sales');
  });

  // audit 5.8
  it("upsertBot invalide le cache de transports de l'agent IA, avec ou sans numéros", async () => {
    await initConfigStore();
    const spy = vi.spyOn(transports, 'invalidateTransports');
    await upsertBot(rec(), ['+33611111111']);
    expect(spy).toHaveBeenLastCalledWith('acme', 'sales');
    spy.mockClear();
    await upsertBot(rec({ transport: 'cm-com' }));
    expect(spy).toHaveBeenCalledWith('acme', 'sales');
    spy.mockRestore();
  });

  it('getBotConfig throw si absent', () => {
    expect(() => getBotConfig('x', 'y')).toThrow(/\[ConfigStore\]/);
  });
});
