import { describe, expect, it } from 'vitest';
import { getProviderDef, maskSecret, maskCredentials, connectorsCatalogue } from '../providers.js';

describe('providers', () => {
  it('PROVIDERS couvre crm/llm ; plus aucun transport par agent IA', () => {
    expect(getProviderDef('crm', 'hubspot')).toBeDefined();
    expect(getProviderDef('llm', 'anthropic')).toBeDefined();
    expect(getProviderDef('crm', 'inconnu')).toBeUndefined();
    expect(getProviderDef('transport', 'meta-cloud')).toBeUndefined();
    expect(getProviderDef('transport', 'cm-com')).toBeUndefined();
  });

  it('maskSecret garde les 4 derniers', () => {
    expect(maskSecret('pat-eu1-secret-1234')).toBe('••••1234');
    expect(maskSecret('abc')).toBe('••••');
    expect(maskSecret('')).toBe('••••');
  });

  it('maskCredentials masque les secrets, garde les publics', () => {
    const def = getProviderDef('crm', 'pipedrive')!;
    const masked = maskCredentials(def, { api_token: 'pd-token-9876', company_domain: 'acme' });
    expect(masked.company_domain).toBe('acme'); // public
    expect(masked.api_token).toBe('••••9876'); // secret
  });

  it('connectorsCatalogue aplatit tous les providers, sans service transport', () => {
    const cat = connectorsCatalogue();
    expect(cat.some((c) => c.service === 'crm' && c.provider === 'hubspot')).toBe(true);
    expect(cat.every((c) => Array.isArray(c.fields))).toBe(true);
    expect(cat.some((c) => (c.service as string) === 'transport')).toBe(false);
  });
});
