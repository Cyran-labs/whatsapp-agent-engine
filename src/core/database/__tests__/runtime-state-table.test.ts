import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../../test-support/test-database.js';
import type { Database } from '../types.js';

describe('bot_runtime_state', () => {
  let db: Database;
  beforeEach(async () => { db = await createTestDatabase(); });
  afterEach(async () => { await db.close(); });

  it('absent → undefined', async () => {
    expect(await db.getBotRuntimeState('acme', 'sales')).toBeUndefined();
  });

  it('setTransportValidation succès puis échec (upsert)', async () => {
    await db.setTransportValidation('acme', 'sales', '2026-06-22T10:00:00.000Z', null);
    let st = await db.getBotRuntimeState('acme', 'sales');
    expect(st!.transport_validated_at).toBe('2026-06-22T10:00:00.000Z');
    expect(st!.transport_error).toBeNull();
    await db.setTransportValidation('acme', 'sales', null, 'token expiré');
    st = await db.getBotRuntimeState('acme', 'sales');
    expect(st!.transport_validated_at).toBeNull();
    expect(st!.transport_error).toBe('token expiré');
  });
});
