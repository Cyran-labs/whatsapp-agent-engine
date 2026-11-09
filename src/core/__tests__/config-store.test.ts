import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteDriver } from '../database/sqlite.js';
import { __setDatabaseForTests } from '../database/index.js';
import {
  initConfigStore, getBotConfig, findBotConfig, listBotConfigs,
  upsertBot, refreshBotConfig, resetConfigStore, botRecordToConfig,
} from '../config-store.js';
import type { BotRecord, Database } from '../database/types.js';

function rec(over: Partial<BotRecord> = {}): BotRecord {
  return {
    client_id: 'acme', bot_id: 'sales', name: 'Bot Ventes',
    status: 'active',
    status_reason: null,
    default_language: 'fr', languages: ['fr', 'en'],
    system_prompt: { fr: 'Prompt FR', en: 'Prompt EN' }, lead_fields: 'email',
    welcome: { enabled: true, message: { fr: 'Bonjour', en: 'Hello' } },
    error_messages: { fr: 'Erreur' }, catalog: null, llm: { model: 'x' }, crm: { connector: 'hubspot' }, personality: null, entity_id: null,
    ...over,
  };
}

describe('botRecordToConfig (pur)', () => {
  it('aplatit le localisé sur default_language', () => {
    const cfg = botRecordToConfig(rec());
    expect(cfg.system_prompt).toBe('Prompt FR');
    expect(cfg.welcome.message).toBe('Bonjour');
    expect(cfg.crm).toEqual({ connector: 'hubspot' });
    expect(cfg).not.toHaveProperty('transport');
  });

  it('fallback sur la 1re langue si default_language absent du map', () => {
    const cfg = botRecordToConfig(rec({ default_language: 'de', system_prompt: { fr: 'FR' }, welcome: { enabled: false, message: { fr: 'B' } } }));
    expect(cfg.system_prompt).toBe('FR');
  });
});

describe('ConfigStore (cache chaud)', () => {
  let db: Database;

  beforeEach(async () => {
    db = createSqliteDriver(':memory:');
    __setDatabaseForTests(db);
    resetConfigStore();
  });
  afterEach(() => { resetConfigStore(); });

  it('init charge les agents IA', async () => {
    await db.upsertBotRecord(rec());
    await initConfigStore();
    expect(listBotConfigs()).toHaveLength(1);
    expect(getBotConfig('acme', 'sales').name).toBe('Bot Ventes');
    expect(findBotConfig('acme', 'sales')?.bot_id).toBe('sales');
    expect(findBotConfig('acme', 'inconnu')).toBeNull();
  });

  it('upsertBot écrit en base et met en cache la relecture de la base', async () => {
    await initConfigStore();
    await upsertBot(rec());
    expect(getBotConfig('acme', 'sales').name).toBe('Bot Ventes');
    // upsertBotRecord n'écrit pas le statut d'un agent IA existant (revue 2b-1 I-3) : le cache suit la base, pas l'argument.
    await upsertBot(rec({ name: 'Renommé', status: 'paused' }));
    expect(getBotConfig('acme', 'sales')).toMatchObject({ name: 'Renommé', status: 'active' });
  });

  it("refreshBotConfig relit l'agent IA sans rien écrire, et l'oublie s'il n'existe plus", async () => {
    await upsertBot(rec());
    await db.transitionBotStatus('acme', 'sales', 'draft');
    const write = vi.spyOn(db, 'upsertBotRecord');
    await refreshBotConfig('acme', 'sales');
    expect(write).not.toHaveBeenCalled();
    expect(getBotConfig('acme', 'sales').status).toBe('draft');
    await db.deleteBotRecord('acme', 'sales');
    await refreshBotConfig('acme', 'sales');
    expect(findBotConfig('acme', 'sales')).toBeNull();
    write.mockRestore();
  });

  // audit 3.1, revue d'isolation I-1 (choix 1 du lot 2b-2 : écriture et relecture sous verrou par agent IA)
  it('deux upsertBot concurrents dont la première relecture revient en retard : le cache garde la dernière écriture', async () => {
    const original = db.getBotRecord.bind(db);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let firstReadDone!: () => void;
    const firstRead = new Promise<void>((resolve) => { firstReadDone = resolve; });
    let reads = 0;
    const spy = vi.spyOn(db, 'getBotRecord').mockImplementation(async (clientId, botId) => {
      reads += 1;
      const snapshot = await original(clientId, botId);
      if (reads === 1) { firstReadDone(); await gate; } // la relecture de « Un » revient après l'écriture de « Deux »
      return snapshot;
    });

    const first = upsertBot(rec({ name: 'Un' }));
    await firstRead;
    const second = upsertBot(rec({ name: 'Deux' }));
    // Laisse au second appel le temps d'écrire s'il n'attendait pas le premier.
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    release();
    await Promise.all([first, second]);
    spy.mockRestore();

    expect((await db.getBotRecord('acme', 'sales'))?.name).toBe('Deux');
    expect(getBotConfig('acme', 'sales').name).toBe('Deux');
  });

  it('getBotConfig throw si absent', () => {
    expect(() => getBotConfig('x', 'y')).toThrow(/\[ConfigStore\]/);
  });
});
