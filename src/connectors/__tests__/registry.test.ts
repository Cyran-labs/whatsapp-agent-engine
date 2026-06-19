import { describe, expect, it } from 'vitest';
import { createConnector } from '../registry.js';

/**
 * Smoke test : chaque type instancie un connecteur valide via les credentials minimaux.
 * Pour les connecteurs FieldMapper (hubspot/pipedrive/salesforce/zoho), cela charge et
 * valide aussi connectors-config/default/{connector}.json.
 */
describe('createConnector', () => {
  it('webhook-generic', () => {
    const c = createConnector({ type: 'webhook-generic', credentials: { url: 'https://x', secret: 's' } });
    expect(c.connectorName).toBe('webhook-generic');
  });

  it('attio', () => {
    const c = createConnector({ type: 'attio', credentials: { api_key: 'k' } });
    expect(c.connectorName).toBe('attio');
  });

  it('hubspot (charge connectors-config/default/hubspot.json)', () => {
    const c = createConnector({ type: 'hubspot', credentials: { access_token: 'pat', client_id: 'default' } });
    expect(c.connectorName).toBe('hubspot');
  });

  it('pipedrive (charge connectors-config/default/pipedrive.json)', () => {
    const c = createConnector({ type: 'pipedrive', credentials: { api_token: 't', client_id: 'default' } });
    expect(c.connectorName).toBe('pipedrive');
  });

  it('salesforce (charge connectors-config/default/salesforce.json)', () => {
    const c = createConnector({
      type: 'salesforce',
      credentials: { instance_url: 'https://x.my.salesforce.com', access_token: 't', client_id: 'default' },
    });
    expect(c.connectorName).toBe('salesforce');
  });

  it('zoho (charge connectors-config/default/zoho.json)', () => {
    const c = createConnector({ type: 'zoho', credentials: { access_token: 't', client_id: 'default' } });
    expect(c.connectorName).toBe('zoho');
  });

  it('throw sur type inconnu', () => {
    expect(() => createConnector({ type: 'unknown', credentials: {} })).toThrow(/Unknown connector type/);
  });
});
