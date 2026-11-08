import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import { __setDatabaseForTests } from '../../database/index.js';
import { resetConfigStore } from '../../config-store.js';
import { BotService } from '../bot-service.js';
import type { Database } from '../../database/types.js';
import type { CreateBotInput } from '@wabagent/contracts';
import { ensureDefaultEntity } from '../../database/migrate-accounts.js';

const input = (over: Partial<CreateBotInput> = {}): CreateBotInput => ({
  bot_id: 'sales', name: 'Ventes', transport: 'meta-cloud',
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
    await ensureDefaultEntity(db, 'acme');
    await ensureDefaultEntity(db, 'other');
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
    await expect(svc.setStatus('acme', 'sales', 7, 'active')).rejects.toMatchObject({ code: 'CONFLICT' });
    await svc.setNumbers('acme', 'sales', 7, ['+33611111111']);
    await db.setTransportValidation('acme', 'sales', '2026-06-22T00:00:00.000Z', null);
    const bot = await svc.setStatus('acme', 'sales', 7, 'active');
    expect(bot.status).toBe('active');
  });

  it('setNumbers refuse un numéro déjà routé vers un autre bot', async () => {
    await svc.createBot('acme', 7, input());
    await svc.createBot('acme', 7, input({ bot_id: 'support' }));
    await svc.setNumbers('acme', 'sales', 7, ['+33611111111']);
    await expect(svc.setNumbers('acme', 'support', 7, ['33611111111'])).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('getBot inconnu → NOT_FOUND ; listBots scopé', async () => {
    await svc.createBot('acme', 7, input());
    await expect(svc.getBot('acme', 'ghost')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await svc.listBots('acme')).toHaveLength(1);
    expect(await svc.listBots('other')).toHaveLength(0);
  });

  it('updateBot merge le patch (nom) + audit', async () => {
    await svc.createBot('acme', 7, input());
    const bot = await svc.updateBot('acme', 'sales', 7, { name: 'Ventes' });
    expect(bot.name).toBe('Ventes');
    expect(bot.system_prompt).toEqual({ fr: 'Tu es un agent.' }); // inchangé
  });

  it('setNumbers accepte un numéro déjà possédé par le même bot (réassignation propre)', async () => {
    await svc.createBot('acme', 7, input());
    await svc.setNumbers('acme', 'sales', 7, ['+33611111111']);
    const bot = await svc.setNumbers('acme', 'sales', 7, ['33611111111', '+33622222222']);
    expect(bot.numbers).toContain('+33611111111');
    expect(bot.numbers).toContain('+33622222222');
  });

  it('setNumbers dédoublonne après normalisation : une seule entrée E.164', async () => {
    await svc.createBot('acme', 7, input());
    const bot = await svc.setNumbers('acme', 'sales', 7, ['0033612345678', '+33 6 12 34 56 78']);
    expect(bot.numbers).toEqual(['+33612345678']);
    expect((await db.listBotNumbers()).map((n) => n.whatsapp_number)).toEqual(['+33612345678']);
  });

  it('setNumbers refuse un numéro national sans indicatif (validation sur numbers.0)', async () => {
    await svc.createBot('acme', 7, input());
    await expect(svc.setNumbers('acme', 'sales', 7, ['0612345678'])).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ path: 'numbers.0', message: 'Numéro au format international attendu (ex. +33612345678).' }],
    });
  });

  it('setNumbers signale toutes les entrées invalides, une erreur par indice', async () => {
    await svc.createBot('acme', 7, input());
    await expect(svc.setNumbers('acme', 'sales', 7, ['+33612345678', 'abc', '0612345678'])).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [
        { path: 'numbers.1', message: 'Numéro au format international attendu (ex. +33612345678).' },
        { path: 'numbers.2', message: 'Numéro au format international attendu (ex. +33612345678).' },
      ],
    });
  });

  // audit 6.1
  it('setNumbers refuse un numéro pris par un autre agent IA même écrit autrement (0033...)', async () => {
    await svc.createBot('acme', 7, input());
    await svc.createBot('acme', 7, input({ bot_id: 'support' }));
    await svc.setNumbers('acme', 'sales', 7, ['+33612345678']);
    await expect(svc.setNumbers('acme', 'support', 7, ['0033612345678'])).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('setNumbers refuse un numéro routé vers un bot d\'un autre client', async () => {
    await svc.createBot('acme', 7, input());
    await svc.setNumbers('acme', 'sales', 7, ['+33611111111']);
    await svc.createBot('other', 9, input({ bot_id: 'x' }));
    await expect(svc.setNumbers('other', 'x', 9, ['33611111111'])).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('updateBot journalise une entrée d\'audit', async () => {
    await svc.createBot('acme', 7, input());
    await svc.updateBot('acme', 'sales', 7, { name: 'Ventes' });
    expect(await db.listAuditLog('acme')).toHaveLength(2); // create + update
  });
  describe('rattachement à une entité', () => {
    it('createBot sans entity_id dans une organisation à une entité : rattaché à cette entité', async () => {
      const only = (await db.listEntities('acme'))[0]!;
      const bot = await svc.createBot('acme', 7, input());
      expect(bot.entity_id).toBe(only.id);
      expect((await db.getBotRecord('acme', 'sales'))!.entity_id).toBe(only.id);
    });

    it('createBot sans entity_id avec deux entités actives : validationError « Choisissez une entité. »', async () => {
      await db.createEntity('acme', 'Seconde');
      await expect(svc.createBot('acme', 7, input())).rejects.toMatchObject({
        code: 'VALIDATION_ERROR', details: [{ path: 'entity_id', message: 'Choisissez une entité.' }],
      });
    });

    it('createBot avec entity_id valide : rattaché à l\'entité demandée', async () => {
      const second = await db.createEntity('acme', 'Seconde');
      const bot = await svc.createBot('acme', 7, input({ entity_id: second.id }));
      expect(bot.entity_id).toBe(second.id);
    });

    it('createBot avec entity_id d\'une autre organisation, archivée ou inconnue : validationError entity_id', async () => {
      const foreign = (await db.listEntities('other'))[0]!;
      await expect(svc.createBot('acme', 7, input({ entity_id: foreign.id }))).rejects.toMatchObject({
        code: 'VALIDATION_ERROR', details: [{ path: 'entity_id' }],
      });
      const archived = await db.createEntity('acme', 'Ancienne');
      await db.updateEntity('acme', archived.id, { status: 'archived' });
      await expect(svc.createBot('acme', 7, input({ entity_id: archived.id }))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(svc.createBot('acme', 7, input({ entity_id: 99999 }))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(await svc.listBots('acme')).toHaveLength(0);
    });

    it('updateBot sans entity_id conserve l\'entité ; avec entity_id la déplace (audit bot.entity) ; contrôle identique', async () => {
      const second = await db.createEntity('acme', 'Seconde');
      const first = (await db.listEntities('acme'))[0]!;
      await svc.createBot('acme', 7, input({ entity_id: second.id }));
      const kept = await svc.updateBot('acme', 'sales', 7, { name: 'Ventes 2' });
      expect(kept.entity_id).toBe(second.id);
      const moved = await svc.updateBot('acme', 'sales', 7, { entity_id: first.id });
      expect(moved.entity_id).toBe(first.id);
      expect((await db.getBotRecord('acme', 'sales'))!.entity_id).toBe(first.id);
      expect((await db.listAuditLog('acme')).some((a) => a.action === 'bot.entity')).toBe(true);
      const foreign = (await db.listEntities('other'))[0]!;
      await expect(svc.updateBot('acme', 'sales', 7, { entity_id: foreign.id })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR', details: [{ path: 'entity_id' }],
      });
    });
  });
});
