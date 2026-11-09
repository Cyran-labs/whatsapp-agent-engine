import { describe, expect, it } from 'vitest';
import {
  CreateWhatsAppAccountInput, ReplaceWhatsAppCredentialsInput, RenameWhatsAppAccountInput, SetWhatsAppNumberTestFlagInput,
} from '../index.js';

const meta = { mode: 'meta_manual', name: '  Boutique  ', waba_id: '123456789', access_token: 'EAA'.padEnd(40, 'x'), app_secret: 'a'.repeat(32) };
const cm = { mode: 'cm_com', name: 'CM', account_id: '0b9c8a52-4f1e-4d4c-9a39-2a3d5f7e9b10', product_token: 'p'.repeat(36) };

describe('contracts: comptes WhatsApp', () => {
  it('création Meta : nom rogné, champs exigés', () => {
    const r = CreateWhatsAppAccountInput.parse(meta);
    expect(r).toMatchObject({ mode: 'meta_manual', name: 'Boutique', waba_id: '123456789' });
    expect(() => CreateWhatsAppAccountInput.parse({ ...meta, waba_id: 'abc' })).toThrow();
    expect(() => CreateWhatsAppAccountInput.parse({ ...meta, waba_id: '1234' })).toThrow();
    expect(() => CreateWhatsAppAccountInput.parse({ ...meta, access_token: 'court' })).toThrow();
    expect(() => CreateWhatsAppAccountInput.parse({ ...meta, app_secret: 'court' })).toThrow();
    expect(() => CreateWhatsAppAccountInput.parse({ ...meta, name: '   ' })).toThrow();
    expect(() => CreateWhatsAppAccountInput.parse({ ...meta, name: 'x'.repeat(81) })).toThrow();
  });

  it('création CM.com : accountId UUID et productToken', () => {
    expect(CreateWhatsAppAccountInput.parse(cm)).toMatchObject({ mode: 'cm_com', account_id: cm.account_id });
    expect(() => CreateWhatsAppAccountInput.parse({ ...cm, account_id: 'pas-un-uuid' })).toThrow();
    expect(() => CreateWhatsAppAccountInput.parse({ ...cm, product_token: 'court' })).toThrow();
  });

  it('mode inconnu ou champs croisés refusés', () => {
    expect(() => CreateWhatsAppAccountInput.parse({ ...meta, mode: 'meta_embedded' })).toThrow();
    expect(() => CreateWhatsAppAccountInput.parse({ mode: 'cm_com', name: 'x', waba_id: '123456789' })).toThrow();
  });

  it('remplacement : même union sans nom ; renommage ; marquage de test', () => {
    const metaCreds = { mode: meta.mode, waba_id: meta.waba_id, access_token: meta.access_token, app_secret: meta.app_secret };
    expect(ReplaceWhatsAppCredentialsInput.parse(metaCreds)).not.toHaveProperty('name');
    expect(() => ReplaceWhatsAppCredentialsInput.parse({ mode: 'meta_manual', waba_id: '123456789' })).toThrow();
    expect(RenameWhatsAppAccountInput.parse({ name: ' Nouveau ' }).name).toBe('Nouveau');
    expect(SetWhatsAppNumberTestFlagInput.parse({ is_test: true }).is_test).toBe(true);
    expect(() => SetWhatsAppNumberTestFlagInput.parse({ is_test: 'oui' })).toThrow();
  });
});
