import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import { __setDatabaseForTests } from '../../database/index.js';
import { CredentialsService } from '../credentials-service.js';
import type { Database } from '../../database/types.js';

const KEY = '0'.repeat(64); // 32 octets hex

describe('CredentialsService', () => {
  let db: Database;
  let svc: CredentialsService;
  beforeEach(() => {
    process.env['CREDENTIALS_ENCRYPTION_KEY'] = KEY;
    db = createSqliteDriver(':memory:'); __setDatabaseForTests(db);
    svc = new CredentialsService({ db });
  });
  afterEach(async () => { await db.close(); });

  it('set + getMasked : secrets masqués, publics clairs', async () => {
    await svc.setCredentials('acme', 'sales', 'transport', 'meta-cloud', { phone_number_id: '123456789', access_token: 'EAAToken9876', app_secret: 'sek_5555' });
    const masked = await svc.getMasked('acme', 'sales', 'transport', 'meta-cloud');
    expect(masked.configured).toBe(true);
    expect(masked.fields!.phone_number_id).toBe('123456789');
    expect(masked.fields!.access_token).toBe('••••9876');
  });

  it('getMasked non configuré → configured:false', async () => {
    expect(await svc.getMasked('acme', 'sales', 'crm', 'hubspot')).toEqual({ configured: false });
  });

  it('provider inconnu → VALIDATION_ERROR', async () => {
    await expect(svc.setCredentials('acme', null, 'crm', 'nope', { x: '1' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('clé hors schéma → VALIDATION_ERROR', async () => {
    await expect(svc.setCredentials('acme', 'sales', 'crm', 'hubspot', { access_token: 'x', bogus: 'y' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
