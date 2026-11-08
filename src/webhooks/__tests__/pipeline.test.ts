import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { serve as serveApp } from '../../test-support/http.js';

const chatMock = vi.hoisted(() => vi.fn());

vi.mock('../../llm/anthropic.js', () => ({
  chat: chatMock,
  withRetry: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getClientForTenant: vi.fn(async () => ({
    messages: { create: vi.fn(async () => ({ content: [{ type: 'text', text: '{}' }] })) },
  })),
}));

import { ACME_NUMBER, ACME_PNID, LLM_REPLY, createWorld, sign } from './fixtures.js';
import type { World } from './fixtures.js';
import { CONTACT, botRecord, metaBody, metaTexts, unservedCount } from '../../test-support/whatsapp.js';
import type { FetchCall } from '../../test-support/whatsapp.js';
import { upsertBot } from '../../core/config-store.js';
import { findRoute } from '../../core/router.js';
import { getTransportForBot } from '../../transport/index.js';
import type { IncomingMessage } from '../../transport/types.js';
import { serveMessage } from '../pipeline.js';

const AUTH_ERROR = 'Jeton refusé par le fournisseur WhatsApp.';
const LLM_ERROR_REPLY = 'Désolé, je rencontre un problème technique. Réessayez dans un instant.';
const AUDIO_REPLY = 'Les messages vocaux ne sont pas encore supportés. Écrivez-moi votre réponse.';
const TEXT_ONLY_REPLY = 'Je ne peux traiter que les messages texte. Écrivez-moi votre question.';

function incoming(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    contactId: CONTACT,
    toNumber: ACME_NUMBER.slice(1),
    recipientId: ACME_PNID,
    kind: 'text',
    providerType: 'text',
    text: 'Bonjour',
    messageId: 'wamid.P1',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('serveMessage', () => {
  let world: World;

  beforeEach(async () => {
    chatMock.mockReset();
    chatMock.mockResolvedValue(JSON.stringify({ type: 'text', text: LLM_REPLY }));
    world = await createWorld();
  });

  afterEach(async () => {
    await world.close();
  });

  // Délai de reprise nul : une clé encore « en cours » serait reprise (true) ; seule une clé marquée traitée renvoie false.
  async function serve(message: IncomingMessage): Promise<void> {
    const bot = findRoute(ACME_NUMBER)!;
    const transport = (await getTransportForBot(bot))!;
    await serveMessage({ bot, transport, waNumber: ACME_NUMBER, message }, world.tracker);
  }

  /** Les envois de texte Meta répondent 401 (jeton refusé) ; le reste répond 200. */
  function rejectTextSends(): void {
    world.fetchMock.mockImplementation(async (input: unknown, init?: { headers?: Record<string, string>; body?: unknown }) => {
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      const call: FetchCall = { url: String(input), headers: { ...(init?.headers ?? {}) }, body };
      world.calls.push(call);
      if (body['type'] === 'text') return { ok: false, status: 401, text: async () => '{"error":{"code":190}}' };
      return { ok: true, status: 200, text: async () => '{}' };
    });
  }

  // audit 5.3
  it('relivraison concurrente : le même POST envoyé deux fois en parallèle donne un seul appel LLM et une seule réponse', async () => {
    const raw = JSON.stringify(metaBody([{ displayPhone: ACME_NUMBER, phoneNumberId: ACME_PNID, id: 'wamid.R1' }]));
    const server = await serveApp(world.app);
    const send = () => request(server).post('/webhook/meta')
      .set('Content-Type', 'application/json').set('x-hub-signature-256', sign(raw)).send(raw);
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    await world.tracker.drain(10_000);
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(metaTexts(world.calls).map((t) => t.text)).toEqual([LLM_REPLY]);
    expect(await world.db.claimMessage(`${ACME_NUMBER}:wamid.R1`, 0)).toBe(false);
  });

  // audit 5.6, 5.7
  it("deux premiers messages simultanés d'un nouveau contact, accueil actif : un seul accueil, deux réponses, l'accueil d'abord", async () => {
    await upsertBot(botRecord('acme', 'ventes', 'meta-cloud', { welcome: { enabled: true, message: { fr: 'Bienvenue !' } } }));
    const server = await serveApp(world.app);
    const post = (id: string) => {
      const raw = JSON.stringify(metaBody([{ displayPhone: ACME_NUMBER, phoneNumberId: ACME_PNID, id, text: `Question ${id}` }]));
      return request(server).post('/webhook/meta')
        .set('Content-Type', 'application/json').set('x-hub-signature-256', sign(raw)).send(raw);
    };
    await Promise.all([post('wamid.W1'), post('wamid.W2')]);
    await world.tracker.drain(10_000);
    expect(metaTexts(world.calls).map((t) => t.text)).toEqual(['Bienvenue !', LLM_REPLY, LLM_REPLY]);
    expect(chatMock).toHaveBeenCalledTimes(2);
    const history = (await world.db.getConversation(CONTACT, 'acme', 'ventes', 20)).reverse();
    expect(history[0]).toMatchObject({ role: 'assistant', content: 'Bienvenue !' });
    expect(history.filter((m) => m.role === 'user')).toHaveLength(2);
  });

  // audit 5.13
  it('message plus vieux que 24 h : rien, sauf journal', async () => {
    const log = vi.spyOn(console, 'log');
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await serve(incoming({ messageId: 'wamid.OLD', timestamp: old }));
    await world.tracker.drain(10_000);
    expect(chatMock).not.toHaveBeenCalled();
    expect(world.fetchMock).not.toHaveBeenCalled();
    expect(await world.db.getSession(ACME_NUMBER, CONTACT)).toBeUndefined();
    expect(log.mock.calls.some((args) => String(args[0]).includes('trop ancien'))).toBe(true);
    expect(await world.db.claimMessage(`${ACME_NUMBER}:wamid.OLD`, 300)).toBe(true);
    log.mockRestore();
  });

  // audit 5.13
  it("seuil d'ancienneté réglable par MESSAGE_MAX_AGE_HOURS ; horodatage illisible traité comme maintenant", async () => {
    process.env['MESSAGE_MAX_AGE_HOURS'] = '1';
    try {
      await serve(incoming({ messageId: 'wamid.2H', timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() }));
      await serve(incoming({ messageId: 'wamid.BAD', timestamp: 'pas-une-date' }));
      await world.tracker.drain(10_000);
      expect(chatMock).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env['MESSAGE_MAX_AGE_HOURS'];
    }
  });

  // audit 3.1
  it('agent IA passé en pause pendant que le message attend derrière le verrou : pas de LLM, compteur incrémenté', async () => {
    let release!: (value: string) => void;
    const started = new Promise<void>((resolve) => {
      chatMock.mockImplementationOnce(() => {
        resolve();
        return new Promise<string>((res) => { release = res; });
      });
    });
    await serve(incoming({ messageId: 'wamid.L1' }));
    await started;
    await serve(incoming({ messageId: 'wamid.L2', text: 'Deuxième' }));
    await upsertBot(botRecord('acme', 'ventes', 'meta-cloud', { status: 'paused' }));
    release(JSON.stringify({ type: 'text', text: LLM_REPLY }));
    await world.tracker.drain(10_000);
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(metaTexts(world.calls).map((t) => t.text)).toEqual([LLM_REPLY]);
    expect(await unservedCount(world.db, 'acme', 'ventes')).toBe(1);
    // Le message écarté est marqué traité : une relivraison ne le rejoue pas.
    expect(await world.db.claimMessage(`${ACME_NUMBER}:wamid.L2`, 0)).toBe(false);
  });

  // audit 5.5
  it("LLM qui lève sur le premier message : message d'erreur envoyé, clé marquée traitée, message suivant du contact traité", async () => {
    chatMock.mockRejectedValueOnce(new Error('LLM indisponible'));
    await serve(incoming({ messageId: 'wamid.E1' }));
    await world.tracker.drain(10_000);
    expect(metaTexts(world.calls).map((t) => t.text)).toEqual([LLM_ERROR_REPLY]);
    expect(await world.db.claimMessage(`${ACME_NUMBER}:wamid.E1`, 0)).toBe(false);

    await serve(incoming({ messageId: 'wamid.E2', text: 'Encore là ?' }));
    await world.tracker.drain(10_000);
    expect(metaTexts(world.calls).map((t) => t.text)).toEqual([LLM_ERROR_REPLY, LLM_REPLY]);
    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  // audit 5.5
  it("erreur de base sous le verrou : journalisée sans contact ni contenu, clé marquée traitée, message suivant traité", async () => {
    const spy = vi.spyOn(world.db, 'createSessionIfAbsent').mockRejectedValueOnce(new Error('base indisponible'));
    const errors = vi.spyOn(console, 'error');
    await serve(incoming({ messageId: 'wamid.DB1', text: 'Texte confidentiel' }));
    await world.tracker.drain(10_000);
    const lines = errors.mock.calls.map((c) => c.map(String).join(' '));
    expect(lines.some((l) => l.startsWith('[Pipeline] Échec du traitement') && l.includes('base indisponible'))).toBe(true);
    expect(lines.every((l) => !l.includes(CONTACT) && !l.includes('Texte confidentiel'))).toBe(true);
    expect(chatMock).not.toHaveBeenCalled();
    expect(await world.db.claimMessage(`${ACME_NUMBER}:wamid.DB1`, 0)).toBe(false);

    await serve(incoming({ messageId: 'wamid.DB2' }));
    await world.tracker.drain(10_000);
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(metaTexts(world.calls).map((t) => t.text)).toEqual([LLM_REPLY]);
    spy.mockRestore();
    errors.mockRestore();
  });

  // audit 3.1
  it('agent IA en brouillon : unserved_count à 1, aucune session, aucun appel LLM, aucun envoi', async () => {
    await upsertBot(botRecord('acme', 'ventes', 'meta-cloud', { status: 'draft' }));
    await serve(incoming({ messageId: 'wamid.D1' }));
    await world.tracker.drain(10_000);
    expect(await unservedCount(world.db, 'acme', 'ventes')).toBe(1);
    expect(await world.db.getSession(ACME_NUMBER, CONTACT)).toBeUndefined();
    expect(chatMock).not.toHaveBeenCalled();
    expect(world.fetchMock).not.toHaveBeenCalled();
  });

  // audit 3.1
  it("organisation suspendue : compteur incrémenté, rien d'autre", async () => {
    await world.db.upsertClient({ client_id: 'acme', name: 'acme', status: 'suspended' });
    await serve(incoming({ messageId: 'wamid.S1' }));
    await world.tracker.drain(10_000);
    expect(await unservedCount(world.db, 'acme', 'ventes')).toBe(1);
    expect(await world.db.getSession(ACME_NUMBER, CONTACT)).toBeUndefined();
    expect(world.fetchMock).not.toHaveBeenCalled();
  });

  it('message ignoré (réaction) : ni réservation, ni session, ni envoi', async () => {
    await serve(incoming({ messageId: 'wamid.I1', kind: 'ignored', providerType: 'reaction', text: '' }));
    await world.tracker.drain(10_000);
    expect(world.fetchMock).not.toHaveBeenCalled();
    expect(await world.db.getSession(ACME_NUMBER, CONTACT)).toBeUndefined();
    expect(await world.db.claimMessage(`${ACME_NUMBER}:wamid.I1`, 300)).toBe(true);
  });

  // audit 5.2
  it('audio, média et non pris en charge : réponse fixe, session créée, pas de LLM, clé marquée traitée', async () => {
    await serve(incoming({ messageId: 'wamid.A1', kind: 'audio', providerType: 'audio', text: '' }));
    await serve(incoming({ messageId: 'wamid.M1', kind: 'media', providerType: 'image', text: '' }));
    await serve(incoming({ messageId: 'wamid.U1', kind: 'unsupported', providerType: 'sticker', text: '' }));
    await world.tracker.drain(10_000);
    expect(metaTexts(world.calls).map((t) => t.text)).toEqual([AUDIO_REPLY, TEXT_ONLY_REPLY, TEXT_ONLY_REPLY]);
    expect(chatMock).not.toHaveBeenCalled();
    expect(await world.db.getSession(ACME_NUMBER, CONTACT)).toMatchObject({ client_id: 'acme', bot_id: 'ventes' });
    for (const id of ['wamid.A1', 'wamid.M1', 'wamid.U1']) {
      expect(await world.db.claimMessage(`${ACME_NUMBER}:${id}`, 0)).toBe(false);
    }
  });

  // audit 5.9
  it("réponse fixe refusée pour jeton invalide : l'erreur est enregistrée sur l'agent IA", async () => {
    rejectTextSends();
    await serve(incoming({ messageId: 'wamid.A2', kind: 'audio', providerType: 'audio', text: '' }));
    await world.tracker.drain(10_000);
    expect((await world.db.getBotRuntimeState('acme', 'ventes'))?.transport_error).toBe(AUTH_ERROR);
    expect(await world.db.claimMessage(`${ACME_NUMBER}:wamid.A2`, 0)).toBe(false);
  });

  // audit 5.9
  it("accueil refusé pour jeton invalide : le message n'est pas traité, la clé est marquée traitée", async () => {
    await upsertBot(botRecord('acme', 'ventes', 'meta-cloud', { welcome: { enabled: true, message: { fr: 'Bienvenue !' } } }));
    rejectTextSends();
    await serve(incoming({ messageId: 'wamid.W3' }));
    await world.tracker.drain(10_000);
    expect(chatMock).not.toHaveBeenCalled();
    expect((await world.db.getBotRuntimeState('acme', 'ventes'))?.transport_error).toBe(AUTH_ERROR);
    expect(await world.db.claimMessage(`${ACME_NUMBER}:wamid.W3`, 0)).toBe(false);
  });

  // audit 5.3
  it('clé de dédoublonnage préfixée par le numéro destinataire : un même identifiant ne bloque pas un autre numéro', async () => {
    expect(await world.db.claimMessage('+33100000002:wamid.X1', 300)).toBe(true);
    await serve(incoming({ messageId: 'wamid.X1' }));
    await world.tracker.drain(10_000);
    expect(chatMock).toHaveBeenCalledTimes(1);
  });
});
