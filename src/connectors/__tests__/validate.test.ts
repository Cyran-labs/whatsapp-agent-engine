import { afterEach, describe, expect, it, vi } from 'vitest';
import { HubSpotConnector } from '../hubspot.js';

afterEach(() => { vi.unstubAllGlobals(); });

const mapping = {
  version: 1,
  connector: 'hubspot',
  target_object: 'contacts',
  client_id: 'acme',
  field_mapping: [{ source: 'email', target: 'email' }],
};

describe('hubspot validate', () => {
  it('2xx → ok:true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' }));
    const c = new HubSpotConnector({ accessToken: 'pat-x', mapping });
    expect(await c.validate!()).toEqual({ ok: true });
  });

  it('403 → ok:false avec erreur contenant 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => 'forbidden' }));
    const c = new HubSpotConnector({ accessToken: 'pat-x', mapping });
    const r = await c.validate!();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('403');
  });

  it('401 → ok:false avec erreur contenant 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' }));
    const c = new HubSpotConnector({ accessToken: 'pat-x', mapping });
    const r = await c.validate!();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('401');
  });

  it('exception réseau → ok:false sans throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const c = new HubSpotConnector({ accessToken: 'pat-x', mapping });
    const r = await c.validate!();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ECONNREFUSED');
  });
});
