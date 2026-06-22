import { describe, expect, it } from 'vitest';
import { PROVIDERS, getProviderDef, maskSecret, maskCredentials, connectorsCatalogue } from '../providers.js';

describe('providers', () => {
  it('PROVIDERS couvre transport/crm/llm', () => {
    expect(getProviderDef('transport', 'meta-cloud')).toBeDefined();
    expect(getProviderDef('crm', 'hubspot')).toBeDefined();
    expect(getProviderDef('llm', 'anthropic')).toBeDefined();
    expect(getProviderDef('crm', 'inconnu')).toBeUndefined();
  });

  it('maskSecret garde les 4 derniers', () => {
    expect(maskSecret('pat-eu1-secret-1234')).toBe('••••1234');
    expect(maskSecret('abc')).toBe('••••');
    expect(maskSecret('')).toBe('••••');
  });

  it('maskCredentials masque les secrets, garde les publics', () => {
    const def = getProviderDef('transport', 'meta-cloud')!;
    const masked = maskCredentials(def, { phone_number_id: '123456789', access_token: 'EAALongToken9876', app_secret: 'sek_abcd5555' });
    expect(masked.phone_number_id).toBe('123456789'); // public
    expect(masked.access_token).toBe('••••9876'); // secret
    expect(masked.app_secret).toBe('••••5555');
  });

  it('connectorsCatalogue aplatit tous les providers', () => {
    const cat = connectorsCatalogue();
    expect(cat.some((c) => c.service === 'crm' && c.provider === 'hubspot')).toBe(true);
    expect(cat.every((c) => Array.isArray(c.fields))).toBe(true);
  });
});
