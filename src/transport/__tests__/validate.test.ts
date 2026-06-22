import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMetaCloudTransport } from '../meta-cloud.js';
import { createCmComTransport } from '../cm-com.js';

afterEach(() => { vi.unstubAllGlobals(); });

const metaOpts = { phoneNumberId: '123', accessToken: 'tok', appSecret: 'sek' };

describe('meta-cloud validateCredentials', () => {
  it('2xx → ok:true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{"id":"123"}' }));
    const t = createMetaCloudTransport(metaOpts);
    expect(await t.validateCredentials!()).toEqual({ ok: true });
  });

  it('401 → ok:false avec erreur contenant 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'invalid token' }));
    const t = createMetaCloudTransport(metaOpts);
    const r = await t.validateCredentials!();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('401');
  });

  it('exception réseau → ok:false sans throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const t = createMetaCloudTransport(metaOpts);
    const r = await t.validateCredentials!();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('network down');
  });
});

describe('cm-com validateCredentials', () => {
  it('productToken + fromNumber présents → ok:true', async () => {
    const t = createCmComTransport({ productToken: 'tok-x', fromNumber: '33600000000', serviceUrl: 'https://example.com' });
    expect(await t.validateCredentials!()).toEqual({ ok: true });
  });

  it('productToken manquant → ok:false avec erreur', async () => {
    const t = createCmComTransport({ productToken: '', fromNumber: '33600000000', serviceUrl: 'https://example.com' });
    const r = await t.validateCredentials!();
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('fromNumber manquant → ok:false avec erreur', async () => {
    const t = createCmComTransport({ productToken: 'tok-x', fromNumber: '', serviceUrl: 'https://example.com' });
    const r = await t.validateCredentials!();
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
});
