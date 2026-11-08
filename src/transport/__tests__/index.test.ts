import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'crypto';
import type { BotConfig } from '../../core/bot-config.js';

vi.mock('../../core/credentials/resolver.js', () => ({
  resolveTransportCredentials: vi.fn(),
}));

import { buildTransport, getTransportForBot, invalidateTransports, getCmWebhookSecret } from '../index.js';
import { CM_SEND_URL } from '../cm-com.js';
import { resolveTransportCredentials } from '../../core/credentials/resolver.js';
import { createTestDatabase } from '../../test-support/test-database.js';
import { __setDatabaseForTests } from '../../core/database/index.js';
import type { Database } from '../../core/database/types.js';
import { encryptJson } from '../../core/credentials/crypto.js';
import { upsertCredentialRecord } from '../../core/credentials/store.js';

const resolveMock = vi.mocked(resolveTransportCredentials);

const META = { phone_number_id: 'p', access_token: 'a', app_secret: 's' };
const CM = { product_token: 'tok', from_number: '0033600000000' };

function bot(overrides: Partial<BotConfig> = {}): BotConfig {
  return { client_id: 'c1', bot_id: 'b1', transport: 'meta-cloud', ...overrides } as BotConfig;
}

describe('getTransportForBot', () => {
  afterEach(() => {
    invalidateTransports('c1');
    invalidateTransports('c2');
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // audit 2.1
  it("un agent IA sans identifiants n'a pas de transport, même avec META_* et CM_* dans l'environnement", async () => {
    vi.stubEnv('META_PHONE_NUMBER_ID', 'env-pid'); vi.stubEnv('META_ACCESS_TOKEN', 'env-tok'); vi.stubEnv('META_APP_SECRET', 'env-sec');
    vi.stubEnv('CM_PRODUCT_TOKEN', 'env-cm'); vi.stubEnv('CM_FROM_NUMBER', '0033100000000');
    resolveMock.mockResolvedValue({});
    expect(await getTransportForBot(bot({ transport: 'meta-cloud' }))).toBeNull();
    expect(await getTransportForBot(bot({ transport: 'cm-com', bot_id: 'cm' }))).toBeNull();
  });

  // audit 2.2
  it("identifiants CM.com incomplets : pas de transport, pas de complétion depuis l'environnement", async () => {
    vi.stubEnv('CM_FROM_NUMBER', '0033100000000');
    resolveMock.mockResolvedValue({ product_token: 'tok' });
    expect(await getTransportForBot(bot({ transport: 'cm-com' }))).toBeNull();
  });

  // audit 2.1
  it('identifiants Meta sans app_secret : pas de transport, sans exception', async () => {
    vi.stubEnv('META_APP_SECRET', 'env-sec');
    resolveMock.mockResolvedValue({ phone_number_id: 'p', access_token: 'a' });
    expect(await getTransportForBot(bot())).toBeNull();
  });

  it('instancie meta-cloud avec les identifiants résolus', async () => {
    resolveMock.mockResolvedValue(META);
    const t = await getTransportForBot(bot());
    expect(t?.id).toBe('meta-cloud');
    expect(t?.senderId).toBe('p');
  });

  it('instancie cm-com avec les identifiants résolus', async () => {
    resolveMock.mockResolvedValue(CM);
    const t = await getTransportForBot(bot({ transport: 'cm-com' }));
    expect(t?.id).toBe('cm-com');
    expect(t?.senderId).toBe('0033600000000');
  });

  it('cache par (organisation, agent IA)', async () => {
    resolveMock.mockResolvedValue(META);
    const a1 = await getTransportForBot(bot({ bot_id: 'same' }));
    const a2 = await getTransportForBot(bot({ bot_id: 'same' }));
    expect(a1).toBe(a2);
    expect(resolveMock).toHaveBeenCalledTimes(1);
    await getTransportForBot(bot({ bot_id: 'other' }));
    await getTransportForBot(bot({ client_id: 'c2', bot_id: 'same' }));
    expect(resolveMock).toHaveBeenCalledTimes(3);
  });

  it("null n'est pas mis en cache : des identifiants ajoutés ensuite sont vus", async () => {
    resolveMock.mockResolvedValueOnce({});
    expect(await getTransportForBot(bot())).toBeNull();
    resolveMock.mockResolvedValueOnce(META);
    expect(await getTransportForBot(bot())).not.toBeNull();
  });

  // audit 5.8
  it('le cache est invalidé quand les identifiants changent', async () => {
    resolveMock.mockResolvedValueOnce(META);
    const before = await getTransportForBot(bot());
    resolveMock.mockResolvedValueOnce({ ...META, phone_number_id: 'p2' });
    expect(await getTransportForBot(bot())).toBe(before); // sans invalidation : cache
    invalidateTransports('c1', 'b1');
    const after = await getTransportForBot(bot());
    expect(after).not.toBe(before);
    expect(after?.senderId).toBe('p2');
  });

  // audit 5.8
  it("invalidateTransports sans agent IA vide toute l'organisation, sans toucher les autres", async () => {
    resolveMock.mockResolvedValue(META);
    const b1 = await getTransportForBot(bot({ bot_id: 'b1' }));
    const b2 = await getTransportForBot(bot({ bot_id: 'b2' }));
    const other = await getTransportForBot(bot({ client_id: 'c2', bot_id: 'b1' }));
    invalidateTransports('c1');
    expect(await getTransportForBot(bot({ bot_id: 'b1' }))).not.toBe(b1);
    expect(await getTransportForBot(bot({ bot_id: 'b2' }))).not.toBe(b2);
    expect(await getTransportForBot(bot({ client_id: 'c2', bot_id: 'b1' }))).toBe(other);
  });

  // audit 5.8
  it("une résolution commencée avant une invalidation ne remplit pas le cache avec d'anciens identifiants", async () => {
    let release: (v: Record<string, string>) => void = () => {};
    resolveMock.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const pending = getTransportForBot(bot());
    invalidateTransports('c1', 'b1');
    release(META);
    await pending;
    resolveMock.mockResolvedValueOnce({ ...META, phone_number_id: 'p3' });
    expect((await getTransportForBot(bot()))?.senderId).toBe('p3');
  });

  it("changement de type de transport de l'agent IA : transport reconstruit", async () => {
    resolveMock.mockResolvedValueOnce(META);
    expect((await getTransportForBot(bot()))?.id).toBe('meta-cloud');
    resolveMock.mockResolvedValueOnce(CM);
    expect((await getTransportForBot(bot({ transport: 'cm-com' })))?.id).toBe('cm-com');
  });
});

describe('buildTransport', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it.each([
    ['meta-cloud', { phone_number_id: '', access_token: 'a', app_secret: 's' }],
    ['meta-cloud', { phone_number_id: 'p', access_token: 'a' }],
    ['meta-cloud', { phone_number_id: 'p', access_token: 'a', app_secret: '  ' }],
    ['cm-com', { product_token: 'tok' }],
    ['cm-com', { product_token: '', from_number: '0033600000000' }],
  ] as const)('%s : champ requis manquant ou vide, null sans exception', (provider, creds) => {
    expect(buildTransport(provider, { ...creds })).toBeNull();
  });

  it("meta-cloud : l'app_secret sert à vérifier la signature (ni l'access_token ni le phone_number_id)", () => {
    const t = buildTransport('meta-cloud', META)!;
    const body = '{"entry":[]}';
    const sign = (key: string): Record<string, string> => ({ 'x-hub-signature-256': 'sha256=' + createHmac('sha256', key).update(body, 'utf8').digest('hex') });
    expect(t.verifyWebhookSignature!(body, sign('s'))).toBe(true);
    expect(t.verifyWebhookSignature!(body, sign('a'))).toBe(false);
    expect(t.verifyWebhookSignature!(body, sign('p'))).toBe(false);
    expect(t.verifyWebhookSignature!(body, {})).toBe(false);
  });

  it('cm-com : un service_url hérité dans les identifiants est ignoré', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
    vi.stubGlobal('fetch', fetchMock);
    const t = buildTransport('cm-com', { ...CM, service_url: 'https://evil.example/collect' });
    await t!.sendText('33611111111', 'bonjour');
    expect(fetchMock.mock.calls[0]![0]).toBe(CM_SEND_URL);
  });
});

describe('getCmWebhookSecret', () => {
  let db: Database;
  beforeEach(async () => {
    process.env['CREDENTIALS_ENCRYPTION_KEY'] = '0'.repeat(64);
    db = await createTestDatabase();
    __setDatabaseForTests(db);
  });
  afterEach(async () => { await db.close(); });

  async function store(botId: string | null, values: Record<string, string>): Promise<void> {
    const { secret, keyVersion } = encryptJson(values);
    await upsertCredentialRecord({ client_id: 'c1', bot_id: botId, service: 'transport', provider: 'cm-com', mode: 'byo', secret_encrypted: secret, key_version: keyVersion });
  }

  it("renvoie le secret de l'agent IA, null sinon", async () => {
    expect(await getCmWebhookSecret('c1', 'b1')).toBeNull();
    await store('b1', CM);
    expect(await getCmWebhookSecret('c1', 'b1')).toBeNull();
    await store('b1', { ...CM, webhook_secret: 'sec-bot' });
    expect(await getCmWebhookSecret('c1', 'b1')).toBe('sec-bot');
  });

  // audit 2.2
  it("un secret d'un enregistrement d'organisation n'est jamais renvoyé pour un agent IA", async () => {
    await store(null, { ...CM, webhook_secret: 'sec-org' });
    expect(await getCmWebhookSecret('c1', 'b1')).toBeNull();
    await store('b1', { ...CM, webhook_secret: 'sec-bot' });
    expect(await getCmWebhookSecret('c1', 'b1')).toBe('sec-bot');
    expect(await getCmWebhookSecret('c1', 'b2')).toBeNull();
    expect(await getCmWebhookSecret('c2', 'b1')).toBeNull();
  });
});
