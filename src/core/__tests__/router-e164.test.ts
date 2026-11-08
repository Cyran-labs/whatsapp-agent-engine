import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Seul l'accès aux sessions est simulé : le routage par numéro passe par le vrai config-store.
vi.mock('../db.js', () => ({
  getSession: vi.fn().mockResolvedValue(undefined),
  createSession: vi.fn(),
}));

import { createSqliteDriver } from '../database/sqlite.js';
import { __setDatabaseForTests } from '../database/index.js';
import { resetConfigStore, upsertBot } from '../config-store.js';
import { findBotByNumber } from '../bot-config.js';
import { routeIncomingMessage } from '../router.js';
import type { BotRecord, Database } from '../database/types.js';

const botRec: BotRecord = {
  client_id: 'acme', bot_id: 'sales', name: 'Ventes', transport: 'meta-cloud', status: 'active',
  default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'a' }, lead_fields: '',
  welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null,
};

describe('routage : numéro destinataire en chiffres seuls vers un numéro stocké en E.164', () => {
  let db: Database;
  beforeEach(async () => {
    db = createSqliteDriver(':memory:');
    __setDatabaseForTests(db);
    resetConfigStore();
    await upsertBot(botRec, ['+33612345678']);
  });
  afterEach(async () => { resetConfigStore(); await db.close(); });

  it('findBotByNumber résout 33612345678 vers le bot stocké en +33612345678', () => {
    expect(findBotByNumber('33612345678')?.bot_id).toBe('sales');
  });

  it('routeIncomingMessage route un destinataire 33612345678', async () => {
    const route = await routeIncomingMessage('33600000000', '33612345678');
    expect(route).toMatchObject({ client_id: 'acme', bot_id: 'sales', is_new_session: true });
  });
});
