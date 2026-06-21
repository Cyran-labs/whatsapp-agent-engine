import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../sqlite.js';
import type { Database } from '../types.js';

describe('platform_llm_keys (sqlite)', () => {
  let db: Database;
  beforeEach(() => { db = createSqliteDriver(':memory:'); });
  afterEach(async () => { await db.close(); });

  it('upsert puis list ne renvoie que les clés actives', async () => {
    await db.upsertPlatformKey({ label: 'pool-1', secret_encrypted: 'enc1', key_version: 1, active: true });
    await db.upsertPlatformKey({ label: 'pool-2', secret_encrypted: 'enc2', key_version: 1, active: false });
    const active = await db.listActivePlatformKeys();
    expect(active.map((k) => k.label)).toEqual(['pool-1']);
    expect(active[0]!.active).toBe(true);
    expect(active[0]!.secret_encrypted).toBe('enc1');
  });

  it('upsert est idempotent par label (update, pas de doublon)', async () => {
    await db.upsertPlatformKey({ label: 'pool-1', secret_encrypted: 'old', key_version: 1, active: true });
    await db.upsertPlatformKey({ label: 'pool-1', secret_encrypted: 'new', key_version: 2, active: true });
    const active = await db.listActivePlatformKeys();
    expect(active).toHaveLength(1);
    expect(active[0]!.secret_encrypted).toBe('new');
    expect(active[0]!.key_version).toBe(2);
  });

  it('réactiver une clé désactivée via upsert', async () => {
    await db.upsertPlatformKey({ label: 'pool-1', secret_encrypted: 'e', key_version: 1, active: false });
    expect(await db.listActivePlatformKeys()).toHaveLength(0);
    await db.upsertPlatformKey({ label: 'pool-1', secret_encrypted: 'e', key_version: 1, active: true });
    expect(await db.listActivePlatformKeys()).toHaveLength(1);
  });
});
