/**
 * Test TDD : crm-bridge — persistance de la dernière erreur de push CRM.
 *
 * Stratégie : on ne peut pas importer handleLeadEvent (non exporté), donc on
 * passe par le bus d'événements après initCrmBridge. Pour stubb le connecteur,
 * on utilise vi.doMock + vi.resetModules() avant chaque réimport de crm-bridge.
 *
 * Chaque it() réinitialise les modules, ré-injecte la DB, puis réimporte
 * crm-bridge et events depuis les modules frais.
 *
 * Important : vi.resetModules() reset aussi database/index.js (son singleton _db
 * redevient null). Il faut donc ré-injecter la DB après le reset, avant l'import
 * des modules qui l'utilisent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteDriver } from '../database/sqlite.js';
import { encryptJson } from '../credentials/crypto.js';
import type { Database, BotRecord } from '../database/types.js';

const botRec: BotRecord = {
  client_id: 'acme',
  bot_id: 'sales',
  name: 'Ventes',
  transport: 'meta-cloud',
  status: 'active',
  default_language: 'fr',
  languages: ['fr'],
  system_prompt: { fr: 'p' },
  lead_fields: '',
  welcome: { enabled: false, message: {} },
  error_messages: {},
  catalog: null,
  llm: null,
  crm: { connector: 'webhook-generic' },
};

/** Prépare la DB in-memory et renvoie le driver pour les assertions. */
async function setupDb(): Promise<Database> {
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = '0'.repeat(64);
  const db = createSqliteDriver(':memory:');

  // Ré-injecte la DB dans le module fresh (déjà resetté par vi.resetModules).
  const dbIndex = await import('../database/index.js');
  dbIndex.__setDatabaseForTests(db);

  const { resetConfigStore, upsertBot } = await import('../config-store.js');
  resetConfigStore();

  await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
  await upsertBot(botRec, ['+33611111111']);

  // Credential webhook-generic avec url pour que instantiateConnector ne throw pas.
  const { secret, keyVersion } = encryptJson({ url: 'https://example.test/hook' });
  await db.upsertCredential({
    client_id: 'acme',
    bot_id: 'sales',
    service: 'crm',
    provider: 'webhook-generic',
    mode: 'byo',
    secret_encrypted: secret,
    key_version: keyVersion,
  });

  return db;
}

describe('crm-bridge — persistance erreur push', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stocke l\'erreur quand pushLead echoue', async () => {
    vi.doMock('../../connectors/registry.js', () => ({
      createConnector: () => ({
        connectorName: 'webhook-generic',
        pushLead: async () => { throw new Error('boom 500'); },
        updateLead: async () => {},
        pushBooking: async () => {},
      }),
    }));

    const db = await setupDb();
    const { initCrmBridge } = await import('../crm-bridge.js');
    const { events } = await import('../events.js');

    await initCrmBridge();

    events.publishLead({
      type: 'qualified',
      lead: {
        phone: '+33611111111',
        client_id: 'acme',
        bot_id: 'sales',
        name: null,
        qualified_data: {},
        stage: 'new',
      } as never,
      changed_fields: ['name'],
    });

    // Laisse le fire-and-forget se terminer
    await new Promise((r) => setTimeout(r, 30));

    const state = await db.getBotRuntimeState('acme', 'sales');
    expect(state?.last_crm_error).toContain('boom 500');
    expect(state?.last_crm_error_at).not.toBeNull();
  });

  it('efface l\'erreur quand pushLead reussit', async () => {
    vi.doMock('../../connectors/registry.js', () => ({
      createConnector: () => ({
        connectorName: 'webhook-generic',
        pushLead: async () => {},
        updateLead: async () => {},
        pushBooking: async () => {},
      }),
    }));

    const db = await setupDb();

    // Pré-condition : une erreur est déjà en base
    await db.setLastCrmError('acme', 'sales', 'ancienne erreur');
    const preState = await db.getBotRuntimeState('acme', 'sales');
    expect(preState?.last_crm_error).toBe('ancienne erreur');

    const { initCrmBridge } = await import('../crm-bridge.js');
    const { events } = await import('../events.js');

    await initCrmBridge();

    events.publishLead({
      type: 'qualified',
      lead: {
        phone: '+33611111111',
        client_id: 'acme',
        bot_id: 'sales',
        name: null,
        qualified_data: {},
        stage: 'new',
      } as never,
      changed_fields: ['name'],
    });

    // Laisse le fire-and-forget se terminer
    await new Promise((r) => setTimeout(r, 30));

    const state = await db.getBotRuntimeState('acme', 'sales');
    expect(state?.last_crm_error).toBeNull();
  });
});
