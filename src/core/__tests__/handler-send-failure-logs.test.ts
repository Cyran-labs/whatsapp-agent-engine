import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../database/types.js';
import type { BotConfig } from '../bot-config.js';
import { createMetaCloudTransport } from '../../transport/meta-cloud.js';
import { createCmComTransport } from '../../transport/cm-com.js';
import type { Transport } from '../../transport/types.js';
import { CrmHttpError } from '../../connectors/http.js';
import { createTestDatabase } from '../../test-support/test-database.js';
import { __setDatabaseForTests } from '../database/index.js';
import { createMetaAccount } from '../../test-support/whatsapp.js';

const chatMock = vi.hoisted(() => vi.fn());

vi.mock('../../llm/anthropic.js', () => ({
  chat: chatMock,
  withRetry: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getClientForTenant: vi.fn(async () => ({ messages: { create: vi.fn(async () => ({ content: [{ type: 'text', text: '{}' }] })) } })),
}));
vi.mock('../../llm/usage-recorder.js', () => ({ recordUsage: vi.fn() }));
vi.mock('../credentials/resolver.js', () => ({
  resolveLlmCredentials: vi.fn(async () => ({ mode: 'byo', apiKey: 'cle-factice' })),
}));

import { handleMessage } from '../handler.js';
import type { ConversationContext } from '../handler.js';

const PHONE = '+33 6 12 34 56 78';
const DIGITS = '33612345678';
const EMAIL = 'claire.bernard@example.com';
const PROVIDER_BODY = `{"error":{"code":131026,"message":"Message undeliverable to ${PHONE} (${DIGITS}), contact ${EMAIL}"}}`;

function botConfig(): BotConfig {
  return {
    client_id: 'acme',
    bot_id: 'ventes',
    name: 'ventes',
    status: 'active',
    system_prompt: 'Tu es un agent IA.',
    lead_fields: 'prenom, email',
    welcome: { enabled: false, message: '' },
  };
}

function response(status: number, body: string): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => body } as unknown as Response;
}

let written: string[] = [];
let accountId = 0;
let accountSecretEncrypted = '';
let db: Database;

beforeEach(async () => {
  vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '0'.repeat(64));
  written = [];
  for (const method of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      written.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}\n${a.stack ?? ''}` : typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
    });
  }
  db = await createTestDatabase();
  __setDatabaseForTests(db);
  await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
  const fixture = await createMetaAccount(db, {
    clientId: 'acme', wabaId: 'WABA_A', metaAppId: 'app-a', accessToken: 'T', appSecret: 'S', verifyToken: 'V', webhookKey: 'K',
    numbers: [{ phone: '+33100000001', providerNumberId: '111' }],
  });
  accountId = fixture.account.id;
  accountSecretEncrypted = fixture.account.secret_encrypted;
  chatMock.mockResolvedValue('{"type":"text","text":"Bonjour, comment puis-je vous aider ?"}');
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  await db.close();
});

function context(transport: Transport): ConversationContext {
  return {
    bot: botConfig(),
    accountId,
    accountSecretEncrypted,
    stillServed: async () => true,
    transport,
    waNumber: '+33100000001',
    contactId: DIGITS,
    messageId: '',
  };
}

function expectNoProviderData(): void {
  const all = written.join('\n');
  expect(all).not.toContain(PHONE);
  expect(all).not.toContain(DIGITS);
  expect(all).not.toContain('612345678');
  expect(all).not.toContain(EMAIL);
  expect(all).not.toContain('claire.bernard');
  expect(all).not.toContain('undeliverable');
}

// recette Q-9
describe('un envoi refusé par le fournisseur ne laisse aucune donnée du fournisseur dans les journaux', () => {
  it('Meta : handleMessage, vrai transport, corps de réponse avec un numéro et une adresse e-mail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(400, PROVIDER_BODY)));
    const transport = createMetaCloudTransport({ phoneNumberId: '111', accessToken: 'T' });
    await expect(handleMessage(context(transport), 'Bonjour')).resolves.toBeUndefined();
    // Le chemin d'envoi a bien été exercé et a bien échoué : le motif lisible (statut, code) est journalisé.
    expect(written.join('\n')).toContain('[Bot] Dispatch failed for type=text: [MetaCloud] 400 (code 131026)');
    expectNoProviderData();
  });

  it('CM.com : handleMessage, vrai transport, corps de réponse avec un numéro et une adresse e-mail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(400, `{"details":"${PHONE} ${EMAIL}","errorCode":7}`)));
    const transport = createCmComTransport({ productToken: 'cm-secret', fromNumber: '33600000000' });
    await expect(handleMessage(context(transport), 'Bonjour')).resolves.toBeUndefined();
    expect(written.join('\n')).toContain('[Bot] Dispatch failed for type=text: [CmCom] 400 (code 7)');
    expectNoProviderData();
    expect(written.join('\n')).not.toContain('cm-secret');
  });

  it("l'extrait reste lisible sur l'erreur pour qui le demande, jamais dans son message", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(400, PROVIDER_BODY)));
    const transport = createMetaCloudTransport({ phoneNumberId: '111', accessToken: 'T' });
    const err = await transport.sendText(DIGITS, 'salut').catch((e: unknown) => e);
    expect((err as { message: string }).message).toBe('[MetaCloud] 400 (code 131026)');
    expect((err as { providerDetail?: string }).providerDetail).toContain('131026');
  });

  it('connecteur CRM : le message de CrmHttpError ne reprend pas le corps de la réponse', () => {
    const err = new CrmHttpError(422, `{"message":"Invalid email ${EMAIL} for ${PHONE}"}`, 'Pipedrive');
    expect(err.message).toBe('Pipedrive 422');
    expect(err.status).toBe(422);
    expect(err.providerDetail).toContain(EMAIL);
  });
});
