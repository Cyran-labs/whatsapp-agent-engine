import { describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import type { CredentialRecord } from '../../database/types.js';

function rec(overrides: Partial<CredentialRecord> = {}): CredentialRecord {
  return {
    client_id: 'default',
    bot_id: null,
    service: 'llm',
    provider: 'anthropic',
    mode: 'byo',
    secret_encrypted: 'ZW5j',
    key_version: 1,
    ...overrides,
  };
}

describe('Database credentials (sqlite in-memory)', () => {
  it('insert puis get (portée client, bot_id null)', async () => {
    const db = createSqliteDriver(':memory:');
    await db.upsertCredential(rec());
    const got = await db.getCredential('default', null, 'llm', 'anthropic');
    expect(got?.secret_encrypted).toBe('ZW5j');
    expect(got?.mode).toBe('byo');
    await db.close();
  });

  it('upsert met à jour au lieu de dupliquer', async () => {
    const db = createSqliteDriver(':memory:');
    await db.upsertCredential(rec({ secret_encrypted: 'v1' }));
    await db.upsertCredential(rec({ secret_encrypted: 'v2' }));
    const got = await db.getCredential('default', null, 'llm', 'anthropic');
    expect(got?.secret_encrypted).toBe('v2');
    const all = await db.listCredentials('default');
    expect(all).toHaveLength(1);
    await db.close();
  });

  it('distingue portée bot et portée client', async () => {
    const db = createSqliteDriver(':memory:');
    await db.upsertCredential(rec({ bot_id: null, secret_encrypted: 'client' }));
    await db.upsertCredential(rec({ bot_id: 'botA', secret_encrypted: 'bot' }));
    expect((await db.getCredential('default', null, 'llm', 'anthropic'))?.secret_encrypted).toBe('client');
    expect((await db.getCredential('default', 'botA', 'llm', 'anthropic'))?.secret_encrypted).toBe('bot');
    await db.close();
  });

  it('get inexistant -> undefined', async () => {
    const db = createSqliteDriver(':memory:');
    expect(await db.getCredential('x', null, 'llm', 'anthropic')).toBeUndefined();
    await db.close();
  });
});
