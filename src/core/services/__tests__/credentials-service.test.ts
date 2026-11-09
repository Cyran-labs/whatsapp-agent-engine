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
    await svc.setCredentials('acme', 'sales', 'crm', 'pipedrive', { api_token: 'pd-token-9876', company_domain: 'acme' });
    const masked = await svc.getMasked('acme', 'sales', 'crm', 'pipedrive');
    expect(masked.configured).toBe(true);
    expect(masked.fields!.company_domain).toBe('acme');
    expect(masked.fields!.api_token).toBe('••••9876');
  });

  it('getMasked non configuré → configured:false', async () => {
    expect(await svc.getMasked('acme', 'sales', 'crm', 'hubspot')).toEqual({ configured: false });
  });

  it('provider inconnu → VALIDATION_ERROR', async () => {
    await expect(svc.setCredentials('acme', null, 'crm', 'nope', { x: '1' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it("identifiants de transport par agent IA : service inconnu (les identifiants WhatsApp sont ceux du compte d'organisation)", async () => {
    await expect(svc.setCredentials('acme', 'sales', 'transport', 'meta-cloud', { phone_number_id: '1', access_token: 't', app_secret: 's' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: [{ path: 'provider', message: 'Provider inconnu.' }] });
    expect(await db.listCredentials('acme')).toEqual([]);
  });

  it('clé hors schéma → VALIDATION_ERROR', async () => {
    await expect(svc.setCredentials('acme', 'sales', 'crm', 'hubspot', { access_token: 'x', bogus: 'y' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('CRM : champ public absent accepté', async () => {
    await expect(svc.setCredentials('acme', 'sales', 'crm', 'pipedrive', { api_token: 'x' })).resolves.toBeUndefined();
  });
});
