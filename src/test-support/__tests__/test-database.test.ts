import { describe, expect, it } from 'vitest';
import { createTestDatabase, testEngine } from '../test-database.js';

describe('createTestDatabase', () => {
  it('donne une base vide et isolée à chaque appel', async () => {
    const a = await createTestDatabase();
    const b = await createTestDatabase();
    await a.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    expect(await b.getClient('acme')).toBeUndefined();
    await a.close();
    await b.close();
  });

  it('annonce le moteur utilisé', () => {
    expect(testEngine()).toBe(process.env['TEST_DATABASE_URL'] ? 'postgres' : 'sqlite');
  });
});
