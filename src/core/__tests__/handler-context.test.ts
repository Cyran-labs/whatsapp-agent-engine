import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../database/types.js';
import type { BotConfig } from '../bot-config.js';
import type { Transport } from '../../transport/types.js';
import { TransportSendError } from '../../transport/types.js';
import { createTestDatabase } from '../../test-support/test-database.js';
import { __setDatabaseForTests } from '../database/index.js';

const chatMock = vi.hoisted(() => vi.fn());
const createMock = vi.hoisted(() => vi.fn());

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

import { buildLlmMessages, handleMessage, handleWelcome } from '../handler.js';
import type { ConversationContext } from '../handler.js';

const AUTH_MESSAGE = 'Jeton refusé par le fournisseur WhatsApp.';
const LLM_ERROR_REPLY = 'Désolé, je rencontre un problème technique. Réessayez dans un instant.';

function botConfig(): BotConfig {
  return {
    client_id: 'acme',
    bot_id: 'ventes',
    name: 'ventes',
    status: 'active',
    transport: 'meta-cloud',
    system_prompt: 'Tu es un agent IA.',
    lead_fields: 'prenom, email',
    whatsapp_numbers: ['+33100000001'],
    welcome: { enabled: true, message: 'Bienvenue {profileName} !' },
  };
}

interface FakeTransport extends Transport {
  sent: string[];
}

function fakeTransport(sendText?: (to: string, text: string) => Promise<void>): FakeTransport {
  const sent: string[] = [];
  const transport = {
    id: 'meta-cloud',
    senderId: '111',
    sent,
    sendText: vi.fn(async (to: string, text: string) => {
      if (sendText) await sendText(to, text);
      sent.push(text);
    }),
    sendReadReceipt: vi.fn(async () => undefined),
    sendTypingIndicator: vi.fn(async () => undefined),
  };
  return transport as unknown as FakeTransport;
}

function context(transport: Transport, overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    bot: botConfig(),
    transport,
    waNumber: '+33100000001',
    contactId: '33600000001',
    messageId: 'wamid.TEST',
    ...overrides,
  };
}

describe('buildLlmMessages', () => {
  // audit 5.6
  it('retire les messages assistant en tête et les rend à part', () => {
    const result = buildLlmMessages([
      { role: 'assistant', content: 'A' },
      { role: 'user', content: 'B' },
      { role: 'assistant', content: 'C' },
    ]);
    expect(result.messages).toEqual([
      { role: 'user', content: 'B' },
      { role: 'assistant', content: 'C' },
    ]);
    expect(result.leadingAssistant).toEqual(['A']);
  });

  it('historique sans assistant en tête : inchangé', () => {
    const result = buildLlmMessages([{ role: 'user', content: 'B' }, { role: 'assistant', content: 'C' }]);
    expect(result.messages).toHaveLength(2);
    expect(result.leadingAssistant).toEqual([]);
  });

  it('plusieurs assistant en tête : tous retirés, ordre conservé', () => {
    const result = buildLlmMessages([
      { role: 'assistant', content: 'A1' },
      { role: 'assistant', content: 'A2' },
      { role: 'user', content: 'B' },
    ]);
    expect(result.leadingAssistant).toEqual(['A1', 'A2']);
    expect(result.messages).toEqual([{ role: 'user', content: 'B' }]);
  });

  it('historique vide ou uniquement assistant : aucun message', () => {
    expect(buildLlmMessages([])).toEqual({ messages: [], leadingAssistant: [] });
    expect(buildLlmMessages([{ role: 'assistant', content: 'A' }])).toEqual({ messages: [], leadingAssistant: ['A'] });
  });
});

describe('contexte de conversation', () => {
  let db: Database;

  beforeEach(async () => {
    db = await createTestDatabase();
    __setDatabaseForTests(db);
    chatMock.mockResolvedValue('{"type":"text","text":"Bonjour, comment puis-je vous aider ?"}');
    createMock.mockResolvedValue({ content: [{ type: 'text', text: '{}' }] });
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.clearAllMocks();
    await db.close();
  });

  // audit 5.6
  it("accueil puis message : deux envois, texte réel de l'accueil en historique, premier message LLM de rôle user", async () => {
    const transport = fakeTransport();
    const ctx = context(transport, { profileName: 'Camille' });

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const welcome = handleWelcome(ctx);
    await vi.advanceTimersByTimeAsync(1500);
    await welcome;
    vi.useRealTimers();

    await handleMessage(ctx, 'Bonjour');

    expect(transport.sent).toEqual(['Bienvenue Camille !', 'Bonjour, comment puis-je vous aider ?']);

    const history = (await db.getConversation('33600000001', 'acme', 'ventes', 20)).reverse();
    expect(history[0]).toEqual({ role: 'assistant', content: 'Bienvenue Camille !' });
    expect(history.map((m) => m.content)).not.toContain('[Welcome]');

    const [systemParts, messages] = chatMock.mock.calls[0] as [Array<{ text: string }>, Array<{ role: string; content: string }>];
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.content).toBe('Bonjour');
    const prompt = systemParts.map((p) => p.text).join('\n');
    expect(prompt).toContain('## Messages déjà envoyés au contact');
    expect(prompt).toContain('Bienvenue Camille !');
  });

  it("sans message d'accueil préalable, aucune partie « Messages déjà envoyés »", async () => {
    const transport = fakeTransport();
    await handleMessage(context(transport), 'Bonjour');
    const [systemParts] = chatMock.mock.calls[0] as [Array<{ text: string }>];
    expect(systemParts.map((p) => p.text).join('\n')).not.toContain('Messages déjà envoyés');
  });

  it("accueil sans {profileName} : texte envoyé et enregistré identiques", async () => {
    const transport = fakeTransport();
    const bot = { ...botConfig(), welcome: { enabled: true, message: 'Bonjour {profileName}, bienvenue' } };
    await handleWelcome(context(transport, { bot, messageId: '' }));
    expect(transport.sent).toEqual(['Bonjour , bienvenue']);
    const history = await db.getConversation('33600000001', 'acme', 'ventes', 20);
    expect(history).toEqual([{ role: 'assistant', content: 'Bonjour , bienvenue' }]);
  });

  it("accueil désactivé : rien n'est envoyé", async () => {
    const transport = fakeTransport();
    const bot = { ...botConfig(), welcome: { enabled: false, message: 'x' } };
    await handleWelcome(context(transport, { bot, messageId: '' }));
    expect(transport.sent).toEqual([]);
  });

  // audit 5.9
  it("un envoi refusé pour jeton invalide enregistre l'erreur de transport", async () => {
    const transport = fakeTransport(async () => {
      throw new TransportSendError('Unauthorized', 'auth', { status: 401 });
    });
    await expect(handleMessage(context(transport), 'Bonjour')).resolves.toBeUndefined();
    const state = await db.getBotRuntimeState('acme', 'ventes');
    expect(state?.transport_error).toBe(AUTH_MESSAGE);
    expect(state?.transport_validated_at).toBeNull();
  });

  // audit 5.9
  it("un refus de jeton à l'envoi de l'accueil enregistre aussi l'erreur de transport", async () => {
    const transport = fakeTransport(async () => {
      throw new TransportSendError('Unauthorized', 'auth', { status: 401 });
    });
    await expect(handleWelcome(context(transport, { messageId: '' }))).rejects.toBeInstanceOf(TransportSendError);
    expect((await db.getBotRuntimeState('acme', 'ventes'))?.transport_error).toBe(AUTH_MESSAGE);
    expect(await db.getConversation('33600000001', 'acme', 'ventes', 20)).toEqual([]);
  });

  it("une erreur d'envoi transitoire n'enregistre pas d'erreur de transport", async () => {
    const transport = fakeTransport(async () => {
      throw new TransportSendError('Timeout', 'transient');
    });
    await handleMessage(context(transport), 'Bonjour');
    expect(await db.getBotRuntimeState('acme', 'ventes')).toBeUndefined();
  });

  it('le LLM qui lève : le contact reçoit le message de repli et handleMessage se résout', async () => {
    chatMock.mockRejectedValue(new Error('LLM indisponible'));
    const transport = fakeTransport();
    await expect(handleMessage(context(transport), 'Bonjour')).resolves.toBeUndefined();
    expect(transport.sent).toEqual([LLM_ERROR_REPLY]);
  });

  it("l'extraction de lead est terminée quand handleMessage se résout", async () => {
    createMock.mockResolvedValue({ content: [{ type: 'text', text: '{"prenom":"Camille"}' }] });
    const transport = fakeTransport();
    await handleMessage(context(transport), 'Je suis Camille');
    expect(createMock).toHaveBeenCalledTimes(1);
    const lead = await db.getLeadData('33600000001', 'acme', 'ventes');
    expect(lead?.['prenom']).toBe('Camille');
  });

  it("une extraction de lead qui échoue ne fait pas échouer handleMessage", async () => {
    createMock.mockRejectedValue(new Error('extraction KO'));
    const transport = fakeTransport();
    await expect(handleMessage(context(transport), 'Bonjour')).resolves.toBeUndefined();
    expect(transport.sent).toEqual(['Bonjour, comment puis-je vous aider ?']);
  });
});
