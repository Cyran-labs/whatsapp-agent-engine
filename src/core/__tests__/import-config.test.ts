import { describe, expect, it } from 'vitest';
import { jsonBotToRecord, importBotRecord } from '../../../scripts/import-config-to-db.js';
import { createSqliteDriver } from '../database/sqlite.js';
import { ensureDefaultEntity } from '../database/migrate-accounts.js';

describe('jsonBotToRecord', () => {
  it('wrappe les strings de contenu en localisé FR et extrait les numéros', () => {
    const { record, numbers } = jsonBotToRecord({
      client_id: 'default', bot_id: 'example', name: 'Test Bot',
      system_prompt: 'Tu es...', lead_fields: 'email, stage',
      whatsapp_numbers: ['+15551412647'],
      welcome: { enabled: true, message: 'Bonjour {profileName}!' },
      crm: { connector: 'hubspot' },
    });
    expect(record.default_language).toBe('fr');
    expect(record.languages).toEqual(['fr']);
    expect(record.system_prompt).toEqual({ fr: 'Tu es...' });
    expect(record.welcome).toEqual({ enabled: true, message: { fr: 'Bonjour {profileName}!' } });
    expect(record.status).toBe('draft');
    expect(record.crm).toEqual({ connector: 'hubspot' });
    expect(numbers).toEqual(['+15551412647']);
  });

  it('gère les champs optionnels absents', () => {
    const { record, numbers } = jsonBotToRecord({
      client_id: 'c', bot_id: 'b', name: 'B',
      system_prompt: 'P', lead_fields: '', whatsapp_numbers: [], welcome: { enabled: false, message: '' },
    });
    expect(record.catalog).toBeNull();
    expect(record.llm).toBeNull();
    expect(record.crm).toBeNull();
    expect(numbers).toEqual([]);
  });

  describe('importBotRecord (rattachement à une entité)', () => {
    const json = {
      client_id: 'acme', bot_id: 'sales', name: 'Ventes',
      system_prompt: 'P', lead_fields: '', whatsapp_numbers: [], welcome: { enabled: false, message: '' },
    };

    it('rattache un nouvel agent IA à l\'entité par défaut de l\'organisation, en brouillon', async () => {
      const db = createSqliteDriver(':memory:');
      await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
      await importBotRecord(db, jsonBotToRecord(json).record);
      const def = await ensureDefaultEntity(db, 'acme');
      expect((await db.getBotRecord('acme', 'sales'))!.entity_id).toBe(def.id);
      expect((await db.getBotRecord('acme', 'sales'))!.status).toBe('draft');
      await db.close();
    });

    it('un second import ne réinitialise pas l\'entité enregistrée', async () => {
      const db = createSqliteDriver(':memory:');
      await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
      await ensureDefaultEntity(db, 'acme');
      const second = await db.createEntity('acme', 'Seconde');
      await importBotRecord(db, jsonBotToRecord(json).record);
      const stored = (await db.getBotRecord('acme', 'sales'))!;
      await db.upsertBotRecord({ ...stored, entity_id: second.id });
      await importBotRecord(db, jsonBotToRecord(json).record);
      const after = (await db.getBotRecord('acme', 'sales'))!;
      expect(after.entity_id).toBe(second.id);
      await db.close();
    });
  });
});
