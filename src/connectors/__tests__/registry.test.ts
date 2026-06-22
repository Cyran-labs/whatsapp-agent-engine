import { describe, expect, it } from 'vitest';
import { createConnector } from '../registry.js';
import type { FieldMapping } from '../field-mapper.js';

/**
 * Smoke test : chaque type instancie un connecteur valide via les credentials minimaux.
 * Pour les connecteurs FieldMapper (hubspot/pipedrive/salesforce/zoho), le mapping
 * est injecté directement (résolu en DB par le CrmBridge en runtime).
 */

function minimalMapping(connector: string): FieldMapping {
  return {
    version: 1,
    connector,
    target_object: 'contacts',
    client_id: 'default',
    field_mapping: [{ source: 'email', target: 'email' }],
  };
}

describe('createConnector', () => {
  it('webhook-generic', () => {
    const c = createConnector({ type: 'webhook-generic', credentials: { url: 'https://x', secret: 's' } });
    expect(c.connectorName).toBe('webhook-generic');
  });

  it('attio', () => {
    const c = createConnector({ type: 'attio', credentials: { api_key: 'k' } });
    expect(c.connectorName).toBe('attio');
  });

  it('hubspot', () => {
    const c = createConnector({
      type: 'hubspot',
      credentials: { access_token: 'pat', client_id: 'default' },
      mapping: minimalMapping('hubspot'),
    });
    expect(c.connectorName).toBe('hubspot');
  });

  it('pipedrive', () => {
    const c = createConnector({
      type: 'pipedrive',
      credentials: { api_token: 't', client_id: 'default' },
      mapping: minimalMapping('pipedrive'),
    });
    expect(c.connectorName).toBe('pipedrive');
  });

  it('salesforce', () => {
    const c = createConnector({
      type: 'salesforce',
      credentials: { instance_url: 'https://x.my.salesforce.com', access_token: 't', client_id: 'default' },
      mapping: minimalMapping('salesforce'),
    });
    expect(c.connectorName).toBe('salesforce');
  });

  it('zoho', () => {
    const c = createConnector({
      type: 'zoho',
      credentials: { access_token: 't', client_id: 'default' },
      mapping: minimalMapping('zoho'),
    });
    expect(c.connectorName).toBe('zoho');
  });

  it('throw sur type inconnu', () => {
    expect(() => createConnector({ type: 'unknown', credentials: {} })).toThrow(/Unknown connector type/);
  });
});
