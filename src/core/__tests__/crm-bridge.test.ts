import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BotConfig } from '../bot-config.js';

vi.mock('../credentials/resolver.js', () => ({
  resolveCrmCredentials: vi.fn(),
}));

import { instantiateConnector } from '../crm-bridge.js';
import { resolveCrmCredentials } from '../credentials/resolver.js';

const resolveMock = vi.mocked(resolveCrmCredentials);

// client_id 'default' : loadMappingConfig (appelé par les constructeurs hubspot/pipedrive)
// ne retombe PAS sur 'default' automatiquement ; il exige connectors-config/{clientId}/{type}.json.
// Seul 'default' possède des mappings dans le repo, donc on l'utilise ici.
function bot(connector: string): BotConfig {
  return { client_id: 'default', bot_id: 'b1', crm: { connector } } as unknown as BotConfig;
}

describe('instantiateConnector', () => {
  beforeEach(() => vi.stubEnv('HUBSPOT_TOKEN', 'pat-env'));
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('hubspot via credentials résolus', async () => {
    resolveMock.mockResolvedValue({ access_token: 'pat-resolved' });
    const c = await instantiateConnector(bot('hubspot'));
    expect(c.connectorName).toBe('hubspot');
  });

  it('hubspot fallback config quand resolver vide', async () => {
    resolveMock.mockResolvedValue({});
    const c = await instantiateConnector(bot('hubspot'));
    expect(c.connectorName).toBe('hubspot');
  });

  it('pipedrive via credentials résolus', async () => {
    resolveMock.mockResolvedValue({ api_token: 'pd-token' });
    const c = await instantiateConnector(bot('pipedrive'));
    expect(c.connectorName).toBe('pipedrive');
  });

  it('mad-crm throw sans dépendre du resolver', async () => {
    resolveMock.mockResolvedValue({});
    await expect(instantiateConnector(bot('mad-crm'))).rejects.toThrow(/mad-crm/);
  });

  it('webhook-generic sans url -> throw (fail-closed)', async () => {
    resolveMock.mockResolvedValue({});
    await expect(instantiateConnector(bot('webhook-generic'))).rejects.toThrow(/url/);
  });

  it('webhook-generic avec url -> instancié', async () => {
    resolveMock.mockResolvedValue({ url: 'https://example.test/hook' });
    const c = await instantiateConnector(bot('webhook-generic'));
    expect(c.connectorName).toBe('webhook-generic');
  });
});
