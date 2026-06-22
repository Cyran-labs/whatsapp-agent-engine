import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../sqlite.js';
import type { Database } from '../types.js';

const MAPPING = { version: 1, connector: 'hubspot', target_object: 'contacts', client_id: 'acme', field_mapping: [{ source: 'email', target: 'email' }] };

describe('connector_mappings + audit_log (sqlite)', () => {
  let db: Database;
  beforeEach(() => { db = createSqliteDriver(':memory:'); });
  afterEach(async () => { await db.close(); });

  it('upsertConnectorMapping (client-level) + getConnectorMapping exact', async () => {
    await db.upsertConnectorMapping({ client_id: 'acme', bot_id: null, connector: 'hubspot', mapping: MAPPING });
    const got = await db.getConnectorMapping('acme', null, 'hubspot');
    expect(got!.mapping).toEqual(MAPPING);
    expect(got!.bot_id).toBeNull();
    expect(await db.getConnectorMapping('acme', 'sales', 'hubspot')).toBeUndefined(); // pas de bot-scope
  });

  it('upsert met à jour sans dupliquer', async () => {
    await db.upsertConnectorMapping({ client_id: 'acme', bot_id: null, connector: 'hubspot', mapping: MAPPING });
    await db.upsertConnectorMapping({ client_id: 'acme', bot_id: null, connector: 'hubspot', mapping: { ...MAPPING, target_object: 'leads' } });
    expect((await db.getConnectorMapping('acme', null, 'hubspot'))!.mapping).toMatchObject({ target_object: 'leads' });
    expect(await db.listConnectorMappings('acme')).toHaveLength(1);
  });

  it('bot-scope et client-level coexistent (clés distinctes)', async () => {
    await db.upsertConnectorMapping({ client_id: 'acme', bot_id: null, connector: 'hubspot', mapping: MAPPING });
    await db.upsertConnectorMapping({ client_id: 'acme', bot_id: 'sales', connector: 'hubspot', mapping: { ...MAPPING, target_object: 'bot' } });
    expect((await db.getConnectorMapping('acme', 'sales', 'hubspot'))!.mapping).toMatchObject({ target_object: 'bot' });
    expect((await db.getConnectorMapping('acme', null, 'hubspot'))!.mapping).toMatchObject({ target_object: 'contacts' });
    expect(await db.listConnectorMappings('acme')).toHaveLength(2);
  });

  it('insertAuditLog append + listAuditLog par client (récents d\'abord)', async () => {
    await db.insertAuditLog({ actor_user_id: 1, action: 'bot.create', target: 'bot:acme/sales', client_id: 'acme', metadata: { name: 'Ventes' } });
    await db.insertAuditLog({ actor_user_id: 1, action: 'bot.status', target: 'bot:acme/sales', client_id: 'acme', metadata: null });
    await db.insertAuditLog({ actor_user_id: 2, action: 'bot.create', target: 'bot:other/x', client_id: 'other', metadata: null });
    const rows = await db.listAuditLog('acme');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.action).toBe('bot.status'); // plus récent d'abord
    expect(rows[0]!.id).toBeGreaterThan(0);
    expect(rows[1]!.metadata).toEqual({ name: 'Ventes' });
  });
});
