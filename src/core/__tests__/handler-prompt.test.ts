import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../database/types.js';
import type { BotConfig } from '../bot-config.js';
import { createTestDatabase } from '../../test-support/test-database.js';
import { __setDatabaseForTests } from '../database/index.js';

const chatMock = vi.hoisted(() => vi.fn());
const createMock = vi.hoisted(() => vi.fn());
const sendTextMock = vi.hoisted(() => vi.fn());

vi.mock('../../llm/anthropic.js', () => ({
  chat: chatMock,
  withRetry: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getClientForTenant: vi.fn(async () => ({ messages: { create: createMock } })),
}));

vi.mock('../../llm/usage-recorder.js', () => ({
  recordUsage: vi.fn(),
}));

vi.mock('../credentials/resolver.js', () => ({
  resolveLlmCredentials: vi.fn(async () => ({ mode: 'byo', apiKey: 'cle-factice' })),
}));

import { handleMessage } from '../handler.js';
import type { Transport } from '../../transport/types.js';

const transport = {
  id: 'meta-cloud',
  senderId: '111',
  sendText: sendTextMock,
  sendReadReceipt: vi.fn(async () => undefined),
  sendTypingIndicator: vi.fn(async () => undefined),
} as unknown as Transport;

function botConfig(clientId: string, botId: string): BotConfig {
  return {
    client_id: clientId,
    bot_id: botId,
    name: botId,
    system_prompt: 'Tu es un agent IA.',
    status: 'active',
    lead_fields: 'prenom, email',
    welcome: { enabled: false, message: '' },
  } as BotConfig;
}

describe('handleMessage : contenu du prompt envoyé au LLM', () => {
  let db: Database;

  beforeEach(async () => {
    db = await createTestDatabase();
    __setDatabaseForTests(db);
    chatMock.mockResolvedValue('{"type":"text","text":"Bonjour"}');
    createMock.mockResolvedValue({ content: [{ type: 'text', text: '{}' }] });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await db.close();
  });

  // audit 1.2
  it("le prompt de l'agent IA de B ne contient rien de ce que le contact a échangé avec A", async () => {
    await db.addMessage('33600000001', 'acme', 'ventes', 'user', 'SECRET-ACME');
    await db.addMessage('33600000001', 'acme', 'ventes', 'assistant', 'REPONSE-ACME');

    await handleMessage(
      { bot: botConfig('beta', 'accueil'), accountId: 2, accountSecretEncrypted: 'enc:beta', transport, waNumber: '+33100000002', contactId: '33600000001', messageId: 'wamid.TEST' },
      'bonjour'
    );

    // L'extraction de lead est attendue par handleMessage : tout est terminé au retour.
    expect(createMock).toHaveBeenCalled();
    expect(sendTextMock).toHaveBeenCalled();

    const [systemParts, messages] = chatMock.mock.calls[0] as [unknown, unknown];
    expect(JSON.stringify([systemParts, messages])).not.toMatch(/SECRET-ACME|REPONSE-ACME/);
  });
});
