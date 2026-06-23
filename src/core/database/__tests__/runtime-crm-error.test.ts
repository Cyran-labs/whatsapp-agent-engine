import { beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../sqlite.js';
import type { Database } from '../types.js';

describe('bot_runtime_state — dernière erreur CRM', () => {
  let db: Database;
  beforeEach(() => { db = createSqliteDriver(':memory:'); });

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

  it('cohabite avec la validation transport sans l\'écraser', async () => {
    await db.setTransportValidation('acme', 'sales', '2026-06-22T10:00:00.000Z', null);
    await db.setLastCrmError('acme', 'sales', 'boom');
    const rt = await db.getBotRuntimeState('acme', 'sales');
    expect(rt?.transport_validated_at).toBe('2026-06-22T10:00:00.000Z');
    expect(rt?.last_crm_error).toBe('boom');
  });
});
