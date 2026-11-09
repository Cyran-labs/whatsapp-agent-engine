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

  it("plus de colonnes de validation du transport par agent IA : l'état ne porte que le CRM et les messages non servis", async () => {
    await db.setLastCrmError('acme', 'sales', 'x');
    const st = await db.getBotRuntimeState('acme', 'sales');
    expect(Object.keys(st!).sort()).toEqual(
      ['bot_id', 'client_id', 'last_crm_error', 'last_crm_error_at', 'unserved_count', 'unserved_last_at', 'updated_at'],
    );
  });
});
