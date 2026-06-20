import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BotConfig } from '../../core/bot-config.js';

vi.mock('../../core/credentials/resolver.js', () => ({
  resolveTransportCredentials: vi.fn(),
}));
vi.mock('../meta-cloud.js', () => ({
  createMetaCloudTransport: vi.fn((opts: unknown) => ({ kind: 'meta', opts })),
}));
vi.mock('../cm-com.js', () => ({
  createCmComTransport: vi.fn((opts: unknown) => ({ kind: 'cm', opts })),
}));

import { getTransportForBot } from '../index.js';
import { resolveTransportCredentials } from '../../core/credentials/resolver.js';
import { createMetaCloudTransport } from '../meta-cloud.js';

const resolveMock = vi.mocked(resolveTransportCredentials);
const metaFactory = vi.mocked(createMetaCloudTransport);

function bot(overrides: Partial<BotConfig> = {}): BotConfig {
  return { client_id: 'c1', bot_id: 'b1', transport: 'meta-cloud', ...overrides } as BotConfig;
}

describe('getTransportForBot', () => {
  beforeEach(() => {
    vi.stubEnv('META_PHONE_NUMBER_ID', 'env-pid');
    vi.stubEnv('META_ACCESS_TOKEN', 'env-tok');
    vi.stubEnv('META_APP_SECRET', 'env-sec');
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('instancie meta-cloud avec les credentials résolus', async () => {
    resolveMock.mockResolvedValue({ phone_number_id: 'p', access_token: 'a', app_secret: 's' });
    const t = await getTransportForBot(bot({ bot_id: 'resolved' })) as { opts: unknown };
    expect(t.opts).toEqual({ phoneNumberId: 'p', accessToken: 'a', appSecret: 's' });
  });

  it('fallback config quand le resolver renvoie {}', async () => {
    resolveMock.mockResolvedValue({});
    const t = await getTransportForBot(bot({ bot_id: 'fallback' })) as { opts: unknown };
    expect(t.opts).toEqual({ phoneNumberId: 'env-pid', accessToken: 'env-tok', appSecret: 'env-sec' });
  });

  it('cache rekeyé par (client_id, bot_id, transport)', async () => {
    resolveMock.mockResolvedValue({ phone_number_id: 'p', access_token: 'a', app_secret: 's' });
    const a1 = await getTransportForBot(bot({ bot_id: 'same' }));
    const a2 = await getTransportForBot(bot({ bot_id: 'same' }));
    expect(a1).toBe(a2); // cache
    await getTransportForBot(bot({ bot_id: 'other' }));
    expect(metaFactory).toHaveBeenCalledTimes(2); // 'same' (1x) + 'other' (1x)
  });
});
