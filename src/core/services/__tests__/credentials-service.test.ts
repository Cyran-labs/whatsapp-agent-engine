import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import { __setDatabaseForTests } from '../../database/index.js';
import { CredentialsService } from '../credentials-service.js';
import type { Database } from '../../database/types.js';
import * as transports from '../../../transport/index.js';
import { getCredentialRecord } from '../../credentials/store.js';
import { decryptJson } from '../../credentials/crypto.js';

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

  const META = { phone_number_id: '123', access_token: 'tok', app_secret: 'sek' };

  // audit 2.1
  it('transport sans app_secret refusé : « Champ requis. »', async () => {
    await expect(svc.setCredentials('acme', 'sales', 'transport', 'meta-cloud', { phone_number_id: '123', access_token: 'tok' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: [{ path: 'values.app_secret', message: 'Champ requis.' }] });
  });

  // audit 2.1
  it('transport avec un champ vide refusé', async () => {
    await expect(svc.setCredentials('acme', 'sales', 'transport', 'meta-cloud', { ...META, app_secret: '   ' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  // audit 2.2
  it('transport CM.com : service_url refusé (champ non reconnu)', async () => {
    await expect(svc.setCredentials('acme', 'sales', 'transport', 'cm-com', { product_token: 't', from_number: '0033600000000', service_url: 'https://x.example' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: [{ path: 'values.service_url', message: 'Champ non reconnu pour ce provider.' }] });
  });

  it('les champs requis ne s\'appliquent qu\'au transport (CRM inchangé)', async () => {
    await expect(svc.setCredentials('acme', 'sales', 'crm', 'pipedrive', { api_token: 'x' })).resolves.toBeUndefined();
  });

  it('internal : stocké avec les valeurs, jamais renvoyé par getMasked, refusé s\'il porte un champ saisissable', async () => {
    await svc.setCredentials('acme', 'sales', 'transport', 'cm-com', { product_token: 'tok-1234', from_number: '0033600000000' }, undefined, { webhook_secret: 'sec' });
    const rec = await getCredentialRecord('acme', 'sales', 'transport', 'cm-com');
    expect(decryptJson(rec!.secret_encrypted, rec!.key_version)).toEqual({ product_token: 'tok-1234', from_number: '0033600000000', webhook_secret: 'sec' });
    const masked = await svc.getMasked('acme', 'sales', 'transport', 'cm-com');
    expect(Object.keys(masked.fields!).sort()).toEqual(['from_number', 'product_token']);
    await expect(svc.setCredentials('acme', 'sales', 'transport', 'cm-com', { product_token: 't', from_number: 'n' }, undefined, { product_token: 'x' })).rejects.toThrow();
  });

  // audit 5.8
  it('transport enregistré : cache invalidé pour l\'agent IA, ou pour l\'organisation si botId est null', async () => {
    const spy = vi.spyOn(transports, 'invalidateTransports');
    await svc.setCredentials('acme', 'sales', 'transport', 'meta-cloud', META);
    expect(spy).toHaveBeenLastCalledWith('acme', 'sales');
    await svc.setCredentials('acme', null, 'transport', 'meta-cloud', META);
    expect(spy).toHaveBeenLastCalledWith('acme', undefined);
    spy.mockClear();
    await svc.setCredentials('acme', 'sales', 'llm', 'anthropic', { api_key: 'k' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
