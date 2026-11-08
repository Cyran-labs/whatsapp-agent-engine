import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTransport, getCmWebhookSecret } from '../index.js';
import { CM_SEND_URL } from '../cm-com.js';
import { createTestDatabase } from '../../test-support/test-database.js';
import { __setDatabaseForTests } from '../../core/database/index.js';
import type { Database } from '../../core/database/types.js';
import { encryptJson } from '../../core/credentials/crypto.js';
import { upsertCredentialRecord } from '../../core/credentials/store.js';

// Fabrique par agent IA (getTransportForBot) supprimée en tâche 6 du lot 2b-2 : le chemin des messages n'utilise
// que les transports par compte (account-transport.test.ts). Restent buildTransport et getCmWebhookSecret,
// utilisés par ConnectionsService jusqu'à la tâche 8.

const META = { phone_number_id: 'p', access_token: 'a', app_secret: 's' };
const CM = { product_token: 'tok', from_number: '0033600000000' };

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

  it("meta-cloud : le transport ne porte plus la vérification de signature (voir verifyMetaSignature)", () => {
    const t = buildTransport('meta-cloud', META)!;
    expect('verifyWebhookSignature' in t).toBe(false);
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
