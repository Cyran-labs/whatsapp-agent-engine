import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSeedRecords, buildPlatformKeyRecords } from '../../../../scripts/seed-credentials.js';
import { decryptJson } from '../crypto.js';

const KEY_HEX = '0'.repeat(64);

describe('buildSeedRecords', () => {
  beforeEach(() => vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', KEY_HEX));
  afterEach(() => vi.unstubAllEnvs());

  it('seed meta + anthropic + hubspot pour le client default', () => {
    const recs = buildSeedRecords({
      META_PHONE_NUMBER_ID: 'pid', META_ACCESS_TOKEN: 'mtok', META_APP_SECRET: 'msec', META_VERIFY_TOKEN: 'vtok',
      ANTHROPIC_API_KEY: 'sk-anthropic',
      HUBSPOT_TOKEN: 'pat-hub',
    });

    const llm = recs.find((r) => r.service === 'llm');
    expect(llm?.client_id).toBe('default');
    expect(llm?.mode).toBe('byo');
    expect(decryptJson(llm!.secret_encrypted, llm!.key_version)).toEqual({ api_key: 'sk-anthropic' });

    const meta = recs.find((r) => r.provider === 'meta-cloud');
    expect(decryptJson(meta!.secret_encrypted, meta!.key_version)).toEqual({
      phone_number_id: 'pid', access_token: 'mtok', app_secret: 'msec', verify_token: 'vtok',
    });

    const hub = recs.find((r) => r.provider === 'hubspot');
    expect(decryptJson(hub!.secret_encrypted, hub!.key_version)).toEqual({ access_token: 'pat-hub' });
  });

  it('ignore les services dont les secrets sont absents', () => {
    const recs = buildSeedRecords({ ANTHROPIC_API_KEY: 'sk-only' });
    expect(recs.map((r) => r.service)).toEqual(['llm']);
  });
});

describe('buildPlatformKeyRecords', () => {
  beforeEach(() => vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', KEY_HEX));
  afterEach(() => vi.unstubAllEnvs());

  it('ANTHROPIC_API_KEYS (csv) -> une clé pool par entrée, labels pool-N', () => {
    const recs = buildPlatformKeyRecords({ ANTHROPIC_API_KEYS: 'sk-a, sk-b' });
    expect(recs.map((r) => r.label)).toEqual(['pool-1', 'pool-2']);
    expect(recs.every((r) => r.active)).toBe(true);
    expect(decryptJson(recs[0]!.secret_encrypted, recs[0]!.key_version)).toEqual({ api_key: 'sk-a' });
  });

  it('retombe sur ANTHROPIC_API_KEY si ANTHROPIC_API_KEYS absent', () => {
    const recs = buildPlatformKeyRecords({ ANTHROPIC_API_KEY: 'sk-solo' });
    expect(recs).toHaveLength(1);
    expect(recs[0]!.label).toBe('pool-1');
    expect(decryptJson(recs[0]!.secret_encrypted, recs[0]!.key_version)).toEqual({ api_key: 'sk-solo' });
  });

  it('liste vide si aucune source', () => {
    expect(buildPlatformKeyRecords({})).toEqual([]);
  });
});
