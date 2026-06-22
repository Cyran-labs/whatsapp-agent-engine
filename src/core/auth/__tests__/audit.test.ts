import { describe, expect, it, vi } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import { recordAudit } from '../../audit.js';

describe('recordAudit', () => {
  it('écrit une ligne d\'audit', async () => {
    const db = createSqliteDriver(':memory:');
    await recordAudit(db, { actor_user_id: 1, action: 'bot.create', target: 'bot:acme/sales', client_id: 'acme', metadata: null });
    expect(await db.listAuditLog('acme')).toHaveLength(1);
    await db.close();
  });

  it('ne throw jamais si l\'insert échoue', async () => {
    const broken = { insertAuditLog: vi.fn().mockRejectedValue(new Error('db down')) } as unknown as Parameters<typeof recordAudit>[0];
    await expect(recordAudit(broken, { actor_user_id: null, action: 'x', target: 'y', client_id: null, metadata: null })).resolves.toBeUndefined();
  });
});
