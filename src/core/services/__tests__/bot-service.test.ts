import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import { __setDatabaseForTests } from '../../database/index.js';
import { resetConfigStore } from '../../config-store.js';
import { BotService } from '../bot-service.js';
import type { Database } from '../../database/types.js';
import type { CreateBotInput } from '../../../contracts/index.js';

const input = (over: Partial<CreateBotInput> = {}): CreateBotInput => ({
  bot_id: 'immo', name: 'Immo', transport: 'meta-cloud',
  default_language: 'fr', languages: ['fr'],
  system_prompt: { fr: 'Tu es un agent.' }, lead_fields: 'nom,email',
  welcome: { enabled: true, message: { fr: 'Bonjour' } },
  error_messages: {}, catalog: null, llm: null, crm: null, ...over,
});

describe('BotService', () => {
  let db: Database;
  let svc: BotService;
  beforeEach(async () => {
    db = createSqliteDriver(':memory:'); __setDatabaseForTests(db); resetConfigStore();
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.upsertClient({ client_id: 'other', name: 'Other', status: 'active' });
    svc = new BotService({ db });
  });
  afterEach(async () => { resetConfigStore(); await db.close(); });

  it('createBot crée un bot draft + audit', async () => {
    const bot = await svc.createBot('acme', 7, input());
    expect(bot.status).toBe('draft');
    expect(bot.client_id).toBe('acme');
    expect(bot.numbers).toEqual([]);
    expect(await db.listAuditLog('acme')).toHaveLength(1);
  });

  it('createBot en doublon → CONFLICT', async () => {
    await svc.createBot('acme', 7, input());
    await expect(svc.createBot('acme', 7, input())).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('setStatus active exige au moins un numéro', async () => {
    await svc.createBot('acme', 7, input());
    await expect(svc.setStatus('acme', 'immo', 7, 'active')).rejects.toMatchObject({ code: 'CONFLICT' });
    await svc.setNumbers('acme', 'immo', 7, ['+33611111111']);
    const bot = await svc.setStatus('acme', 'immo', 7, 'active');
    expect(bot.status).toBe('active');
  });

  it('setNumbers refuse un numéro déjà routé vers un autre bot', async () => {
    await svc.createBot('acme', 7, input());
    await svc.createBot('acme', 7, input({ bot_id: 'auto' }));
    await svc.setNumbers('acme', 'immo', 7, ['+33611111111']);
    await expect(svc.setNumbers('acme', 'auto', 7, ['33611111111'])).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('getBot inconnu → NOT_FOUND ; listBots scopé', async () => {
    await svc.createBot('acme', 7, input());
    await expect(svc.getBot('acme', 'ghost')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await svc.listBots('acme')).toHaveLength(1);
    expect(await svc.listBots('other')).toHaveLength(0);
  });

  it('updateBot merge le patch (nom) + audit', async () => {
    await svc.createBot('acme', 7, input());
    const bot = await svc.updateBot('acme', 'immo', 7, { name: 'Immobilier' });
    expect(bot.name).toBe('Immobilier');
    expect(bot.system_prompt).toEqual({ fr: 'Tu es un agent.' }); // inchangé
  });

  it('setNumbers accepte un numéro déjà possédé par le même bot (réassignation propre)', async () => {
    await svc.createBot('acme', 7, input());
    await svc.setNumbers('acme', 'immo', 7, ['+33611111111']);
    const bot = await svc.setNumbers('acme', 'immo', 7, ['33611111111', '+33622222222']);
    expect(bot.numbers).toContain('33611111111');
    expect(bot.numbers).toContain('33622222222');
  });

  it('setNumbers refuse un numéro routé vers un bot d\'un autre client', async () => {
    await svc.createBot('acme', 7, input());
    await svc.setNumbers('acme', 'immo', 7, ['+33611111111']);
    await svc.createBot('other', 9, input({ bot_id: 'x' }));
    await expect(svc.setNumbers('other', 'x', 9, ['33611111111'])).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('updateBot journalise une entrée d\'audit', async () => {
    await svc.createBot('acme', 7, input());
    await svc.updateBot('acme', 'immo', 7, { name: 'Immobilier' });
    expect(await db.listAuditLog('acme')).toHaveLength(2); // create + update
  });
});
