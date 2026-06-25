import { beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import { __setDatabaseForTests } from '../../database/index.js';
import { resetConfigStore } from '../../config-store.js';
import { BotService } from '../bot-service.js';
import type { CreateBotInput } from '@wabagent/contracts';

function input(over: Partial<CreateBotInput> = {}): CreateBotInput {
  return {
    bot_id: 'sales', name: 'Ventes', transport: 'meta-cloud',
    default_language: 'fr', languages: ['fr'], system_prompt: {},
    lead_fields: '', welcome: { enabled: false, message: {} }, error_messages: {},
    catalog: null, llm: null, crm: null, personality: null, ...over,
  } as CreateBotInput;
}

describe('BotService — personality', () => {
  let svc: BotService;
  beforeEach(() => {
    const db = createSqliteDriver(':memory:'); __setDatabaseForTests(db); resetConfigStore();
    svc = new BotService({ db });
  });

  it('compose le system_prompt depuis personality (langue guidee)', async () => {
    const bot = await svc.createBot('c1', null, input({ personality: { fr: { role: 'Conseiller', tones: [], objective: '', info: '' } } }));
    expect(bot.system_prompt.fr).toContain('Tu es Conseiller.');
    expect(bot.personality?.fr.role).toBe('Conseiller');
  });

  it('preserve le system_prompt brut (langue sans personality)', async () => {
    const bot = await svc.createBot('c1', null, input({ system_prompt: { fr: 'Prompt brut.' } }));
    expect(bot.system_prompt.fr).toBe('Prompt brut.');
    expect(bot.personality).toBeNull();
  });

  it('mixte : fr guide, en brut', async () => {
    const bot = await svc.createBot('c1', null, input({
      languages: ['fr', 'en'], default_language: 'fr',
      system_prompt: { en: 'Raw EN.' },
      personality: { fr: { role: 'Conseiller', tones: [], objective: '', info: '' } },
    }));
    expect(bot.system_prompt.fr).toContain('Tu es Conseiller.');
    expect(bot.system_prompt.en).toBe('Raw EN.');
  });

  it('rejette si aucune source pour default_language', async () => {
    await expect(svc.createBot('c1', null, input({ default_language: 'fr', system_prompt: {}, personality: null })))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejette une langue guidee non supportee (de)', async () => {
    await expect(svc.createBot('c1', null, input({
      default_language: 'fr',
      languages: ['fr', 'de'],
      system_prompt: { fr: 'Prompt brut fr.' },
      personality: { de: { role: 'X', tones: [], objective: '', info: '' } },
    }))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('updateBot recompose quand personality change et preserve les champs non patches', async () => {
    await svc.createBot('c1', null, input({ name: 'Ventes', personality: { fr: { role: 'A', tones: [], objective: '', info: '' } } }));
    const upd = await svc.updateBot('c1', 'sales', null, { personality: { fr: { role: 'B', tones: [], objective: '', info: '' } } });
    expect(upd.system_prompt.fr).toContain('Tu es B.');
    expect(upd.name).toBe('Ventes');
  });
});
