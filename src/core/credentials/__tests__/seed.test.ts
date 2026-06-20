import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSeedRecords } from '../../../../scripts/seed-credentials.js';
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
