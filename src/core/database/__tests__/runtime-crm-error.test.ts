import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../../test-support/test-database.js';
import type { Database } from '../types.js';

describe('bot_runtime_state : dernière erreur CRM', () => {
  let db: Database;
  beforeEach(async () => { db = await createTestDatabase(); });
  afterEach(async () => { await db.close(); });

  it('stocke puis efface la dernière erreur CRM', async () => {
    await db.setLastCrmError('acme', 'sales', 'HubSpot 401 Unauthorized');
    const after = await db.getBotRuntimeState('acme', 'sales');
    expect(after?.last_crm_error).toBe('HubSpot 401 Unauthorized');
    expect(after?.last_crm_error_at).not.toBeNull();

    await db.setLastCrmError('acme', 'sales', null);
    const cleared = await db.getBotRuntimeState('acme', 'sales');
    expect(cleared?.last_crm_error).toBeNull();
    expect(cleared?.last_crm_error_at).toBeNull();
  });

  it('cohabite avec le compteur de messages non servis sans l\'écraser', async () => {
    await db.incrementUnserved('acme', 'sales');
    await db.setLastCrmError('acme', 'sales', 'boom');
    const rt = await db.getBotRuntimeState('acme', 'sales');
    expect(rt?.unserved_count).toBe(1);
    expect(rt?.last_crm_error).toBe('boom');
  });
});
