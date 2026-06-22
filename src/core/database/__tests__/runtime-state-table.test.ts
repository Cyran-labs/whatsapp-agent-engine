import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../sqlite.js';
import type { Database } from '../types.js';

describe('bot_runtime_state (sqlite)', () => {
  let db: Database;
  beforeEach(() => { db = createSqliteDriver(':memory:'); });
  afterEach(async () => { await db.close(); });

  it('absent → undefined', async () => {
    expect(await db.getBotRuntimeState('acme', 'immo')).toBeUndefined();
  });

  it('setTransportValidation succès puis échec (upsert)', async () => {
    await db.setTransportValidation('acme', 'immo', '2026-06-22T10:00:00.000Z', null);
    let st = await db.getBotRuntimeState('acme', 'immo');
    expect(st!.transport_validated_at).toBe('2026-06-22T10:00:00.000Z');
    expect(st!.transport_error).toBeNull();
    await db.setTransportValidation('acme', 'immo', null, 'token expiré');
    st = await db.getBotRuntimeState('acme', 'immo');
    expect(st!.transport_validated_at).toBeNull();
    expect(st!.transport_error).toBe('token expiré');
  });
});
