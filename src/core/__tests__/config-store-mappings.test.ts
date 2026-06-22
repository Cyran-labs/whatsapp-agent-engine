import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../database/sqlite.js';
import { __setDatabaseForTests } from '../database/index.js';
import { getMapping, upsertMapping } from '../config-store.js';
import type { Database } from '../database/types.js';
import type { FieldMapping } from '../../connectors/field-mapper.js';

const M = (target: string): FieldMapping => ({
  version: 1, connector: 'hubspot', target_object: target, client_id: 'acme',
  field_mapping: [{ source: 'email', target: 'email' }],
});

describe('ConfigStore mappings', () => {
  let db: Database;
  beforeEach(() => { db = createSqliteDriver(':memory:'); __setDatabaseForTests(db); });
  afterEach(async () => { await db.close(); });

  it('getMapping retourne null si aucun mapping', async () => {
    expect(await getMapping('acme', 'sales', 'hubspot')).toBeNull();
  });

  it('upsertMapping (client-level) puis getMapping en fallback', async () => {
    await upsertMapping('acme', null, 'hubspot', M('contacts'));
    const got = await getMapping('acme', 'sales', 'hubspot'); // pas de bot-scope -> fallback client
    expect(got!.target_object).toBe('contacts');
  });

  it('le bot-scope prime sur le client-level', async () => {
    await upsertMapping('acme', null, 'hubspot', M('client'));
    await upsertMapping('acme', 'sales', 'hubspot', M('bot'));
    expect((await getMapping('acme', 'sales', 'hubspot'))!.target_object).toBe('bot');
    expect((await getMapping('acme', 'autre', 'hubspot'))!.target_object).toBe('client');
  });
});
