import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeResolver } from '../resolver.js';
import { encryptJson } from '../crypto.js';
import type { CredentialRecord } from '../../database/types.js';

const KEY_HEX = '0'.repeat(64);

function record(partial: Partial<CredentialRecord> & { value: unknown }): CredentialRecord {
  const { value, ...rest } = partial;
  const { secret, keyVersion } = encryptJson(value);
  return {
    client_id: 'default',
    bot_id: null,
    service: 'llm',
    provider: 'anthropic',
    mode: 'byo',
    ...rest,
    secret_encrypted: secret,
    key_version: keyVersion,
  };
}

/** Store factice : map clé -> record. */
function fakeStore(records: CredentialRecord[]) {
  const key = (c: string, b: string | null, s: string, p: string) => `${c}|${b ?? ''}|${s}|${p}`;
  const map = new Map(records.map((r) => [key(r.client_id, r.bot_id, r.service, r.provider), r]));
  return {
    getCredentialRecord: async (c: string, b: string | null, s: string, p: string) => map.get(key(c, b, s, p)),
  };
}

describe('resolver', () => {
  beforeEach(() => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', KEY_HEX);
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-platform');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('llm byo renvoie la clé client', async () => {
    const store = fakeStore([record({ mode: 'byo', value: { api_key: 'sk-client' } })]);
    const r = makeResolver({ store });
    expect((await r.resolveLlmCredentials('default', null)).apiKey).toBe('sk-client');
  });

  it('llm platform renvoie la clé plateforme (env)', async () => {
    const store = fakeStore([record({ mode: 'platform', value: {} })]);
    const r = makeResolver({ store });
    expect((await r.resolveLlmCredentials('default', null)).apiKey).toBe('sk-platform');
  });

  it('llm fallback .env quand aucun enregistrement', async () => {
    const store = fakeStore([]);
    const r = makeResolver({ store });
    expect((await r.resolveLlmCredentials('default', null)).apiKey).toBe('sk-platform');
  });

  it('llm byo sans api_key -> fallback env + warning (pas de bascule silencieuse)', async () => {
    const store = fakeStore([record({ mode: 'byo', value: { foo: 'bar' } })]);
    const r = makeResolver({ store });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await r.resolveLlmCredentials('default', null)).apiKey).toBe('sk-platform');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('byo record without api_key'));
    warn.mockRestore();
  });

  it('byo expose mode=byo', async () => {
    const store = fakeStore([record({ mode: 'byo', value: { api_key: 'sk-client' } })]);
    const r = makeResolver({ store });
    expect(await r.resolveLlmCredentials('default', null)).toEqual({ apiKey: 'sk-client', mode: 'byo' });
  });

  it('platform expose mode=platform', async () => {
    const store = fakeStore([record({ mode: 'platform', value: {} })]);
    const r = makeResolver({ store });
    expect(await r.resolveLlmCredentials('default', null)).toEqual({ apiKey: 'sk-platform', mode: 'platform' });
  });

  it('byo mal formé -> mode=platform', async () => {
    const store = fakeStore([record({ mode: 'byo', value: { foo: 'bar' } })]);
    const r = makeResolver({ store });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await r.resolveLlmCredentials('default', null)).mode).toBe('platform');
    warn.mockRestore();
  });

  it('bot-scope prioritaire sur client-scope', async () => {
    const store = fakeStore([
      record({ bot_id: null, mode: 'byo', value: { api_key: 'client-key' } }),
      record({ bot_id: 'botA', mode: 'byo', value: { api_key: 'bot-key' } }),
    ]);
    const r = makeResolver({ store });
    expect((await r.resolveLlmCredentials('default', 'botA')).apiKey).toBe('bot-key');
  });

  it('transport renvoie la config déchiffrée', async () => {
    const store = fakeStore([
      record({ service: 'transport', provider: 'meta-cloud', mode: 'byo', value: { phone_number_id: '123', access_token: 'tok', app_secret: 'sec' } }),
    ]);
    const r = makeResolver({ store });
    expect(await r.resolveTransportCredentials('default', null, 'meta-cloud')).toEqual({ phone_number_id: '123', access_token: 'tok', app_secret: 'sec' });
  });

  it('crm renvoie la config déchiffrée (client-scope)', async () => {
    const store = fakeStore([
      record({ service: 'crm', provider: 'hubspot', mode: 'byo', value: { access_token: 'pat-x' } }),
    ]);
    const r = makeResolver({ store });
    expect(await r.resolveCrmCredentials('default', null, 'hubspot')).toEqual({ access_token: 'pat-x' });
  });

  it('crm bot-scope prime sur client-scope', async () => {
    const store = fakeStore([
      record({ bot_id: null, service: 'crm', provider: 'hubspot', mode: 'byo', value: { access_token: 'client-token' } }),
      record({ bot_id: 'botA', service: 'crm', provider: 'hubspot', mode: 'byo', value: { access_token: 'bot-token' } }),
    ]);
    const r = makeResolver({ store });
    expect(await r.resolveCrmCredentials('default', 'botA', 'hubspot')).toEqual({ access_token: 'bot-token' });
  });
});
