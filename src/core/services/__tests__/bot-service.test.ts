import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import { __setDatabaseForTests } from '../../database/index.js';
import { findBotConfig, resetConfigStore } from '../../config-store.js';
import { BotService } from '../bot-service.js';
import type { Database } from '../../database/types.js';
import type { CreateBotInput } from '@wabagent/contracts';
import { ensureDefaultEntity } from '../../database/migrate-accounts.js';
import { upsertBot } from '../../config-store.js';
import { createTestDatabase } from '../../../test-support/test-database.js';
import { botRecord, createConnectedBot, createMetaAccount } from '../../../test-support/whatsapp.js';

const input = (over: Partial<CreateBotInput> = {}): CreateBotInput => ({
  bot_id: 'sales', name: 'Ventes',
  default_language: 'fr', languages: ['fr'],
  system_prompt: { fr: 'Tu es un agent.' }, lead_fields: 'nom,email',
  welcome: { enabled: true, message: { fr: 'Bonjour' } },
  error_messages: {}, catalog: null, llm: null, crm: null, personality: null, ...over,
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
    expect(bot).toMatchObject({ whatsapp_number: null, allowlist: [], unserved: { count: 0, last_at: null } });
    expect(bot).not.toHaveProperty('transport');
    expect(await db.listAuditLog('acme')).toHaveLength(1);
  });

  it('createBot en doublon → CONFLICT', async () => {
    await svc.createBot('acme', 7, input());
    await expect(svc.createBot('acme', 7, input())).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it("setStatus : l'agent IA supprimé après la transition répond introuvable, sans être recréé ni remis en cache", async () => {
    await svc.createBot('acme', 7, input());
    const real = db.transitionBotStatus.bind(db);
    const spy = vi.spyOn(db, 'transitionBotStatus').mockImplementation(async (clientId, botId, to, opts) => {
      const result = await real(clientId, botId, to, opts);
      await db.deleteBotRecord(clientId, botId);
      return result;
    });
    try {
      await expect(svc.setStatus('acme', 'sales', 7, 'draft')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      spy.mockRestore();
    }
    expect(await db.getBotRecord('acme', 'sales')).toBeUndefined();
    expect(findBotConfig('acme', 'sales')).toBeNull();
  });

  it('setStatus, setAllowlist, assignNumber, unassignNumber, activate : agent IA inconnu ou d\'une autre organisation → NOT_FOUND', async () => {
    await svc.createBot('acme', 7, input());
    await expect(svc.setStatus('other', 'sales', 7, 'draft')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(svc.setAllowlist('other', 'sales', 7, ['+33612345678'])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(svc.assignNumber('other', 'sales', 7, { number_id: 1, expected_bot_id: null })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(svc.unassignNumber('other', 'sales', 7, { expected_number_id: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(svc.activate('other', 'sales', 7, { number_id: 1, expected_bot_id: null, status: 'limited', allowlist: ['+33612345678'] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await db.getAllowlist('other', 'sales')).toEqual([]);
    expect((await db.listAuditLog('other')).length).toBe(0);
  });

  it('setAllowlist : une erreur par indice invalide, plus de 20 entrées refusé sur entries, rien écrit', async () => {
    await svc.createBot('acme', 7, input());
    await expect(svc.setAllowlist('acme', 'sales', 7, ['+33612345678', 'abc def', '0612345678'])).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [
        { path: 'entries.1', message: 'Numéro au format international (ex. +33612345678) ou identifiant WhatsApp attendu.' },
        { path: 'entries.2', message: 'Numéro au format international (ex. +33612345678) ou identifiant WhatsApp attendu.' },
      ],
    });
    await expect(svc.setAllowlist('acme', 'sales', 7, [`FR.${'a'.repeat(62)}`])).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ path: 'entries.0', message: 'Numéro au format international (ex. +33612345678) ou identifiant WhatsApp attendu.' }],
    });
    const many = Array.from({ length: 21 }, (_, i) => `+336120000${String(i).padStart(2, '0')}`);
    await expect(svc.setAllowlist('acme', 'sales', 7, many)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: [{ path: 'entries' }] });
    expect(await db.getAllowlist('acme', 'sales')).toEqual([]);
  });

  it("unassignNumber : l'audit porte le numéro libéré renvoyé par le store dans sa transaction", async () => {
    await svc.createBot('acme', 7, input());
    const spy = vi.spyOn(db, 'unassignNumber').mockResolvedValue({ ok: true, number_id: 42 });
    try {
      await svc.unassignNumber('acme', 'sales', 7, { expected_number_id: 42 });
    } finally {
      spy.mockRestore();
    }
    const audit = (await db.listAuditLog('acme')).find((a) => a.action === 'bot.number');
    expect(audit?.metadata).toEqual({ from_number_id: 42, to_number_id: null, previous_bot_id: null });
  });

  // revue finale 2b-3 I-2 : le service transmet le numéro attendu au store, sans repli
  it('unassignNumber : le numéro attendu est transmis au store', async () => {
    await svc.createBot('acme', 7, input());
    const spy = vi.spyOn(db, 'unassignNumber').mockResolvedValue({ ok: true, number_id: 42 });
    try {
      await svc.unassignNumber('acme', 'sales', 7, { expected_number_id: 42 });
      expect(spy).toHaveBeenCalledWith('acme', 'sales', 42);
    } finally {
      spy.mockRestore();
    }
  });

  it('unassignNumber sans numéro branché : 409 « numéro changé », sans effet ni audit', async () => {
    await svc.createBot('acme', 7, input());
    await expect(svc.unassignNumber('acme', 'sales', 7, { expected_number_id: 5 })).rejects.toMatchObject({
      code: 'CONFLICT', details: [{ path: 'expected_bot_id' }],
    });
    expect((await db.listAuditLog('acme')).map((a) => a.action)).toEqual(['bot.create']);
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

// nav 15.1 : mention « Ne répond pas » portée par le détail de l'agent IA (`GET /bots`, `GET /bots/:botId`).
describe('BotService : mention « Ne répond pas »', () => {
  let db: Database;
  let svc: BotService;
  let numberId: number;

  beforeEach(async () => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '0'.repeat(64));
    db = await createTestDatabase(); __setDatabaseForTests(db); resetConfigStore();
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    const fixture = await createMetaAccount(db, {
      clientId: 'acme', wabaId: 'WABA-A', metaAppId: 'APP-A', accessToken: 'T', appSecret: 'S', verifyToken: 'V', webhookKey: 'cle-a',
      numbers: [{ phone: '+33100000001', providerNumberId: 'PN-A' }],
    });
    numberId = fixture.numbers['+33100000001']!.id;
    svc = new BotService({ db });
  });
  afterEach(async () => { resetConfigStore(); vi.unstubAllEnvs(); await db.close(); });

  it("agent IA Preview à liste vide : not_responding vaut empty_allowlist, dans la lecture et dans la liste", async () => {
    await createConnectedBot(db, { clientId: 'acme', botId: 'ventes', numberId, status: 'limited', allowlist: ['+33600000001'] });
    expect((await svc.getBot('acme', 'ventes')).not_responding).toBeNull();
    await svc.setAllowlist('acme', 'ventes', 7, []);
    expect((await svc.getBot('acme', 'ventes')).not_responding).toBe('empty_allowlist');
    expect((await svc.listBots('acme')).map((b) => [b.bot_id, b.not_responding])).toEqual([['ventes', 'empty_allowlist']]);
  });

  it('agent IA Draft : not_responding nul, même sans numéro', async () => {
    await createConnectedBot(db, { clientId: 'acme', botId: 'ventes', numberId, status: 'draft' });
    await upsertBot(botRecord('acme', 'brouillon', { status: 'draft' }));
    expect((await svc.getBot('acme', 'ventes')).not_responding).toBeNull();
    expect((await svc.getBot('acme', 'brouillon')).not_responding).toBeNull();
  });
});
