/**
 * Revue d'isolation I-2 : un agent IA dont le CRM est `hubspot` sans identifiants enregistrés n'a pas de
 * connecteur câblé, même quand HUBSPOT_TOKEN est défini dans l'environnement de la plateforme.
 *
 * Passe par initCrmBridge avec le vrai résolveur et la vraie base. vi.resetModules() réinitialise l'état
 * du module (drapeau d'initialisation, liste de connecteurs) : les modules sont réimportés à chaque test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from '../../test-support/test-database.js';
import type { BotRecord, Database } from '../database/types.js';

const PLATFORM_TOKEN = 'pat-plateforme-secret';

const hubspotBot: BotRecord = {
  client_id: 'beta', bot_id: 'accueil', name: 'Accueil', transport: 'meta-cloud', status: 'active',
  default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'p' }, lead_fields: '',
  welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null,
  crm: { connector: 'hubspot' }, personality: null, entity_id: null,
};

describe('initCrmBridge : aucun repli sur les identifiants CRM de la plateforme', () => {
  let db: Database;

  beforeEach(async () => {
    vi.resetModules();
    process.env['CREDENTIALS_ENCRYPTION_KEY'] = '0'.repeat(64);
    vi.stubEnv('HUBSPOT_TOKEN', PLATFORM_TOKEN);
    db = await createTestDatabase();
    const dbIndex = await import('../database/index.js');
    dbIndex.__setDatabaseForTests(db);
    const store = await import('../config-store.js');
    store.resetConfigStore();
    await db.upsertClient({ client_id: 'beta', name: 'Beta', status: 'active' });
    await store.upsertBot(hubspotBot, ['+33100000002']);
    await store.upsertMapping('beta', null, 'hubspot', {
      version: 1, connector: 'hubspot', target_object: 'contacts', client_id: 'beta',
      field_mapping: [{ source: 'email', target: 'email' }],
    });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await db.close();
  });

  it('agent IA hubspot sans identifiants : aucun connecteur câblé, aucun appel réseau, journal sans secret', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { initCrmBridge } = await import('../crm-bridge.js');
    const { events } = await import('../events.js');
    await initCrmBridge();

    const lines = [...logs.mock.calls, ...errors.mock.calls].map((c) => c.map(String).join(' '));
    expect(lines.some((l) => l.startsWith('[CrmBridge] Failed to bind beta/accueil -> hubspot'))).toBe(true);
    expect(lines.some((l) => l.includes('Bound'))).toBe(false);
    expect(lines.some((l) => l.includes('No CRM connector configured'))).toBe(true);
    expect(lines.some((l) => l.includes(PLATFORM_TOKEN))).toBe(false);

    // Aucun connecteur câblé : personne n'écoute les leads, donc aucun envoi vers le CRM de la plateforme.
    expect(events.listenerCount('lead')).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
