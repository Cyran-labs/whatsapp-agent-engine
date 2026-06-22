import { describe, expect, it } from 'vitest';
import { jsonBotToRecord } from '../../../scripts/import-config-to-db.js';

describe('jsonBotToRecord', () => {
  it('wrappe les strings de contenu en localisé FR et extrait les numéros', () => {
    const { record, numbers } = jsonBotToRecord({
      client_id: 'default', bot_id: 'example', name: 'Test Bot', transport: 'meta-cloud',
      system_prompt: 'Tu es...', lead_fields: 'email, stage',
      whatsapp_numbers: ['+15551412647'],
      welcome: { enabled: true, message: 'Bonjour {profileName}!' },
      crm: { connector: 'hubspot' },
    });
    expect(record.default_language).toBe('fr');
    expect(record.languages).toEqual(['fr']);
    expect(record.system_prompt).toEqual({ fr: 'Tu es...' });
    expect(record.welcome).toEqual({ enabled: true, message: { fr: 'Bonjour {profileName}!' } });
    expect(record.status).toBe('active');
    expect(record.crm).toEqual({ connector: 'hubspot' });
    expect(numbers).toEqual(['+15551412647']);
  });

  it('gère les champs optionnels absents', () => {
    const { record, numbers } = jsonBotToRecord({
      client_id: 'c', bot_id: 'b', name: 'B', transport: 'cm-com',
      system_prompt: 'P', lead_fields: '', whatsapp_numbers: [], welcome: { enabled: false, message: '' },
    });
    expect(record.catalog).toBeNull();
    expect(record.llm).toBeNull();
    expect(record.crm).toBeNull();
    expect(numbers).toEqual([]);
  });
});
