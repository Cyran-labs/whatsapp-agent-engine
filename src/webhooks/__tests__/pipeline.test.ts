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

import {
  ACME_FREE_NUMBER, ACME_FREE_PNID, ACME_META_KEY, ACME_NUMBER, ACME_PNID, ACME_SUPPORT_NUMBER, ACME_TOKEN, ACME_WABA, BETA_NUMBER,
  LLM_REPLY, createWorld, sign,
} from './fixtures.js';
import type { World } from './fixtures.js';
import { CONTACT, botRecord, createConnectedBot, metaBody, metaTexts, setBotStatus, unservedCount } from '../../test-support/whatsapp.js';
import type { FetchCall } from '../../test-support/whatsapp.js';
import { getBotConfig, upsertBot } from '../../core/config-store.js';
import type { Route } from '../../core/router.js';
import { encryptAccountSecrets, getTransportForNumber } from '../../transport/index.js';
import { encryptJson } from '../../core/credentials/crypto.js';
import type { IncomingMessage } from '../../transport/types.js';
import { routeAndServe, serveMessage } from '../pipeline.js';

const AUTH_ERROR = 'Jeton refusé par le fournisseur WhatsApp.';
const LLM_ERROR_REPLY = 'Désolé, je rencontre un problème technique. Réessayez dans un instant.';
const AUDIO_REPLY = 'Les messages vocaux ne sont pas encore supportés. Écrivez-moi votre réponse.';
const TEXT_ONLY_REPLY = 'Je ne peux traiter que les messages texte. Écrivez-moi votre question.';
const RESET_REPLY = 'Conversation réinitialisée.';
const META_PATH = `/webhook/meta/${ACME_META_KEY}`;

function incoming(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    contactId: CONTACT,
    toNumber: ACME_NUMBER.slice(1),
    recipientId: ACME_PNID,
    providerAccountId: ACME_WABA,
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

  /** Route lue en base (compte, numéro, agent IA branché) comme le fait le webhook. */
  async function routeOf(phone: string = ACME_NUMBER): Promise<Route> {
    const numberRec = await world.db.getWhatsAppNumber(world.number(phone).client_id, world.number(phone).id);
    const account = await world.db.getWhatsAppAccount(numberRec!.client_id, numberRec!.account_id);
    return { account: account!, number: numberRec!, bot: getBotConfig(numberRec!.client_id, numberRec!.bot_id!) };
  }

  // Délai de reprise nul : une clé encore « en cours » serait reprise (true) ; seule une clé marquée traitée renvoie false.
  async function serve(message: IncomingMessage, route?: Route): Promise<void> {
    const r = route ?? await routeOf();
    const transport = getTransportForNumber(r.account, r.number)!;
    await serveMessage({ route: r, transport, message }, world.tracker);
  }

  async function accountState(): Promise<{ state: string; error_reason: string | null; error_detail: string | null }> {
    const a = (await world.db.getWhatsAppAccount('acme', world.accounts.acmeMeta.account.id))!;
    return { state: a.state, error_reason: a.error_reason, error_detail: a.error_detail };
  }

  const TOKEN_ERROR = { state: 'error', error_reason: 'token_invalid', error_detail: AUTH_ERROR };

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
    const raw = JSON.stringify(metaBody([{ wabaId: ACME_WABA, displayPhone: ACME_NUMBER, phoneNumberId: ACME_PNID, id: 'wamid.R1' }]));
    const server = await serveApp(world.app);
    const send = () => request(server).post(META_PATH)
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
    await upsertBot(botRecord('acme', 'ventes', { welcome: { enabled: true, message: { fr: 'Bienvenue !' } } }));
    const server = await serveApp(world.app);
    const post = (id: string) => {
      const raw = JSON.stringify(metaBody([{ wabaId: ACME_WABA, displayPhone: ACME_NUMBER, phoneNumberId: ACME_PNID, id, text: `Question ${id}` }]));
      return request(server).post(META_PATH)
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
    await setBotStatus(world.db, 'acme', 'ventes', 'paused');
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
    await setBotStatus(world.db, 'acme', 'ventes', 'draft');
    await serve(incoming({ messageId: 'wamid.D1' }));
    await world.tracker.drain(10_000);
    expect(await unservedCount(world.db, 'acme', 'ventes')).toBe(1);
    expect(await world.db.getSession(ACME_NUMBER, CONTACT)).toBeUndefined();
    expect(chatMock).not.toHaveBeenCalled();
    expect(world.fetchMock).not.toHaveBeenCalled();
  });

  // audit 3.1, revue d'isolation I-1
  it("statut changé en base sans rafraîchir le cache (le cache dit actif, la base dit en pause) : aucun LLM ni envoi, compteur incrémenté", async () => {
    // transitionBotStatus écrit la base sans toucher au cache de configuration.
    expect((await world.db.transitionBotStatus('acme', 'ventes', 'paused')).ok).toBe(true);
    expect(getBotConfig('acme', 'ventes').status).toBe('active');
    await serve(incoming({ messageId: 'wamid.R1' }));
    await world.tracker.drain(10_000);
    expect(chatMock).not.toHaveBeenCalled();
    expect(world.fetchMock).not.toHaveBeenCalled();
    expect(await unservedCount(world.db, 'acme', 'ventes')).toBe(1);
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

  // spec 2b §5.7 (revue finale m4)
  it('premier message vocal d\'un nouveau contact, accueil actif : accueil puis réponse fixe, dans cet ordre ; pas de second accueil ensuite', async () => {
    await upsertBot(botRecord('acme', 'ventes', { welcome: { enabled: true, message: { fr: 'Bienvenue !' } } }));
    await serve(incoming({ messageId: 'wamid.WA1', kind: 'audio', providerType: 'audio', text: '' }));
    await world.tracker.drain(10_000);
    expect(metaTexts(world.calls).map((t) => t.text)).toEqual(['Bienvenue !', AUDIO_REPLY]);
    expect(chatMock).not.toHaveBeenCalled();
    expect(await world.db.claimMessage(`${ACME_NUMBER}:wamid.WA1`, 0)).toBe(false);

    await serve(incoming({ messageId: 'wamid.WA2', text: 'Bonjour' }));
    await world.tracker.drain(10_000);
    expect(metaTexts(world.calls).map((t) => t.text)).toEqual(['Bienvenue !', AUDIO_REPLY, LLM_REPLY]);
    expect(chatMock).toHaveBeenCalledTimes(1);
  });

  // spec 2b §5.7 (revue finale m4)
  it('premier message non pris en charge, accueil actif : accueil puis réponse texte seulement', async () => {
    await upsertBot(botRecord('acme', 'ventes', { welcome: { enabled: true, message: { fr: 'Bienvenue !' } } }));
    await serve(incoming({ messageId: 'wamid.WU1', kind: 'unsupported', providerType: 'sticker', text: '' }));
    await world.tracker.drain(10_000);
    expect(metaTexts(world.calls).map((t) => t.text)).toEqual(['Bienvenue !', TEXT_ONLY_REPLY]);
  });

  // spec 2b §5.7 (revue finale m4)
  it('contact déjà connu qui envoie un vocal, accueil actif : réponse fixe seule, sans accueil', async () => {
    await upsertBot(botRecord('acme', 'ventes', { welcome: { enabled: true, message: { fr: 'Bienvenue !' } } }));
    await serve(incoming({ messageId: 'wamid.WK1', text: 'Bonjour' }));
    await world.tracker.drain(10_000);
    expect(metaTexts(world.calls).map((t) => t.text)).toEqual(['Bienvenue !', LLM_REPLY]);
    await serve(incoming({ messageId: 'wamid.WK2', kind: 'audio', providerType: 'audio', text: '' }));
    await world.tracker.drain(10_000);
    expect(metaTexts(world.calls).map((t) => t.text)).toEqual(['Bienvenue !', LLM_REPLY, AUDIO_REPLY]);
  });

  // spec 2b §5.7, audit 5.9 (revue finale m4)
  it("premier message vocal, accueil refusé pour jeton invalide : la réponse fixe n'est pas envoyée, la clé est marquée traitée", async () => {
    await upsertBot(botRecord('acme', 'ventes', { welcome: { enabled: true, message: { fr: 'Bienvenue !' } } }));
    rejectTextSends();
    await serve(incoming({ messageId: 'wamid.WA3', kind: 'audio', providerType: 'audio', text: '' }));
    await world.tracker.drain(10_000);
    expect(metaTexts(world.calls).map((t) => t.text)).toEqual(['Bienvenue !']);
    expect(await accountState()).toEqual(TOKEN_ERROR);
    expect(await world.db.claimMessage(`${ACME_NUMBER}:wamid.WA3`, 0)).toBe(false);
  });

  // audit 5.9
  it("réponse fixe refusée pour jeton invalide : l'erreur est enregistrée sur l'agent IA", async () => {
    rejectTextSends();
    await serve(incoming({ messageId: 'wamid.A2', kind: 'audio', providerType: 'audio', text: '' }));
    await world.tracker.drain(10_000);
    expect(await accountState()).toEqual(TOKEN_ERROR);
    expect(await world.db.claimMessage(`${ACME_NUMBER}:wamid.A2`, 0)).toBe(false);
  });

  // audit 5.9
  it("accueil refusé pour jeton invalide : le message n'est pas traité, la clé est marquée traitée", async () => {
    await upsertBot(botRecord('acme', 'ventes', { welcome: { enabled: true, message: { fr: 'Bienvenue !' } } }));
    rejectTextSends();
    await serve(incoming({ messageId: 'wamid.W3' }));
    await world.tracker.drain(10_000);
    expect(chatMock).not.toHaveBeenCalled();
    expect(await accountState()).toEqual(TOKEN_ERROR);
    expect(await world.db.claimMessage(`${ACME_NUMBER}:wamid.W3`, 0)).toBe(false);
  });

  // audit 5.3
  it('clé de dédoublonnage préfixée par le numéro destinataire : un même identifiant ne bloque pas un autre numéro', async () => {
    expect(await world.db.claimMessage('+33100000002:wamid.X1', 300)).toBe(true);
    await serve(incoming({ messageId: 'wamid.X1' }));
    await world.tracker.drain(10_000);
    expect(chatMock).toHaveBeenCalledTimes(1);
  });
  // spec §8.4
  describe('accès limité', () => {
    const LISTED = '33612345678';

    async function limitedBot(allowlist: string[]): Promise<Route> {
      await createConnectedBot(world.db, {
        clientId: 'acme', botId: 'pilote', numberId: world.number(ACME_FREE_NUMBER).id, status: 'limited', allowlist,
      });
      return routeOf(ACME_FREE_NUMBER);
    }

    // spec §8.4
    it('contact de la liste servi ; contact hors liste : aucun appel LLM, aucune session, compteur à 1', async () => {
      const route = await limitedBot(['+33612345678']);
      await serve(incoming({ messageId: 'wamid.LIM1', contactId: LISTED }), route);
      await world.tracker.drain(10_000);
      expect(chatMock).toHaveBeenCalledTimes(1);
      expect(metaTexts(world.calls)).toEqual([{ phoneNumberId: ACME_FREE_PNID, authorization: `Bearer ${ACME_TOKEN}`, to: LISTED, text: LLM_REPLY }]);

      world.calls.length = 0;
      await serve(incoming({ messageId: 'wamid.LIM2', contactId: CONTACT }), route);
      await world.tracker.drain(10_000);
      expect(chatMock).toHaveBeenCalledTimes(1);
      expect(world.calls).toEqual([]);
      expect(await world.db.getSession(ACME_FREE_NUMBER, CONTACT)).toBeUndefined();
      expect(await world.db.getConversation(CONTACT, 'acme', 'pilote')).toEqual([]);
      expect(await unservedCount(world.db, 'acme', 'pilote')).toBe(1);
      expect(await world.db.claimMessage(`${ACME_FREE_NUMBER}:wamid.LIM2`, 0)).toBe(false);
    });

    // Point d'attention 4 de la revue du plan 2b-2
    it.each([
      { cas: 'liste E.164, contact BSUID', allowlist: ['+33612345678'], contact: 'FR.abc123', served: false },
      { cas: 'liste BSUID, contact au numéro', allowlist: ['FR.abc123'], contact: '33612345678', served: false },
      { cas: 'liste BSUID, même BSUID', allowlist: ['FR.abc123'], contact: 'FR.abc123', served: true },
    ])('$cas : servi = $served', async ({ allowlist, contact, served }) => {
      const route = await limitedBot(allowlist);
      await serve(incoming({ messageId: 'wamid.PA4', contactId: contact }), route);
      await world.tracker.drain(10_000);
      if (served) {
        expect(chatMock).toHaveBeenCalledTimes(1);
        expect(metaTexts(world.calls).map((t) => t.to)).toEqual([contact]);
        expect(await unservedCount(world.db, 'acme', 'pilote')).toBe(0);
      } else {
        expect(chatMock).not.toHaveBeenCalled();
        expect(world.fetchMock).not.toHaveBeenCalled();
        expect(await world.db.getSession(ACME_FREE_NUMBER, contact)).toBeUndefined();
        expect(await unservedCount(world.db, 'acme', 'pilote')).toBe(1);
      }
    });

    // choix 9, spec §5.6
    it.each(['reset', ' Reset ', 'RESET'])('« %s » par un contact de la liste : session et historique effacés, lead conservé, réponse fixe, aucun appel LLM', async (word) => {
      const route = await limitedBot(['+33612345678']);
      await serve(incoming({ messageId: 'wamid.RS0', contactId: LISTED, text: 'Bonjour' }), route);
      await world.tracker.drain(10_000);
      expect(await world.db.getConversation(LISTED, 'acme', 'pilote')).toHaveLength(2);
      expect(await world.db.getSession(ACME_FREE_NUMBER, LISTED)).toBeDefined();
      const lead = await world.db.getLeadData(LISTED, 'acme', 'pilote');
      expect(lead).not.toBeNull();
      chatMock.mockClear();
      world.calls.length = 0;

      await serve(incoming({ messageId: 'wamid.RS1', contactId: LISTED, text: word }), route);
      await world.tracker.drain(10_000);
      expect(chatMock).not.toHaveBeenCalled();
      expect(metaTexts(world.calls).map((t) => t.text)).toEqual([RESET_REPLY]);
      expect(await world.db.getConversation(LISTED, 'acme', 'pilote')).toEqual([]);
      expect(await world.db.getSession(ACME_FREE_NUMBER, LISTED)).toBeUndefined();
      expect(await world.db.getLeadData(LISTED, 'acme', 'pilote')).toEqual(lead);
      expect(await world.db.claimMessage(`${ACME_FREE_NUMBER}:wamid.RS1`, 0)).toBe(false);

      // Message suivant : nouvelle conversation, le LLM ne voit que ce message.
      await serve(incoming({ messageId: 'wamid.RS2', contactId: LISTED, text: 'Nouveau départ' }), route);
      await world.tracker.drain(10_000);
      const [args] = chatMock.mock.calls;
      expect((args?.[1] as Array<{ content: string }>).map((m) => m.content)).toEqual(['Nouveau départ']);
    });

    // choix 9 : seuls les espaces de début et de fin sont ignorés, jamais ceux de l'intérieur du mot.
    it.each(['re set', 'r e s e t'])('« %s » par un contact de la liste : transmis au LLM, session et historique intacts', async (word) => {
      const route = await limitedBot(['+33612345678']);
      await serve(incoming({ messageId: 'wamid.RI0', contactId: LISTED, text: 'Bonjour' }), route);
      await world.tracker.drain(10_000);
      const before = await world.db.getConversation(LISTED, 'acme', 'pilote', 100);
      expect(before).toHaveLength(2);
      chatMock.mockClear();
      world.calls.length = 0;

      await serve(incoming({ messageId: 'wamid.RI1', contactId: LISTED, text: word }), route);
      await world.tracker.drain(10_000);
      expect(chatMock).toHaveBeenCalledTimes(1);
      const [args] = chatMock.mock.calls;
      expect((args?.[1] as Array<{ content: string }>).map((m) => m.content).at(-1)).toBe(word);
      expect(metaTexts(world.calls).map((t) => t.text)).toEqual([LLM_REPLY]);
      expect(await world.db.getSession(ACME_FREE_NUMBER, LISTED)).toBeDefined();
      const after = await world.db.getConversation(LISTED, 'acme', 'pilote', 100);
      expect(after).toHaveLength(4);
      expect(after).toEqual(expect.arrayContaining(before));
    });

    // choix 9 : la liste est conservée après l'ouverture à tous et sert encore au mot-clé.
    it('« reset » par un contact de la liste d\'un agent IA actif : conversation réinitialisée', async () => {
      await world.db.replaceAllowlist('acme', 'ventes', ['+33600000001']);
      await serve(incoming({ messageId: 'wamid.RA0', text: 'Bonjour' }));
      await world.tracker.drain(10_000);
      chatMock.mockClear();
      world.calls.length = 0;
      await serve(incoming({ messageId: 'wamid.RA1', text: 'reset' }));
      await world.tracker.drain(10_000);
      expect(chatMock).not.toHaveBeenCalled();
      expect(metaTexts(world.calls).map((t) => t.text)).toEqual([RESET_REPLY]);
      expect(await world.db.getConversation(CONTACT, 'acme', 'ventes')).toEqual([]);
    });

    // choix 9
    it('« reset » par un contact hors liste d\'un agent IA actif : transmis au LLM comme texte', async () => {
      await world.db.replaceAllowlist('acme', 'ventes', ['+33612345678']);
      await serve(incoming({ messageId: 'wamid.RH1', text: 'reset' }));
      await world.tracker.drain(10_000);
      expect(chatMock).toHaveBeenCalledTimes(1);
      const [args] = chatMock.mock.calls;
      expect((args?.[1] as Array<{ content: string }>).map((m) => m.content)).toEqual(['reset']);
      expect(metaTexts(world.calls).map((t) => t.text)).toEqual([LLM_REPLY]);
    });

    // choix 9 : un « reset » d'un contact de la liste n'efface que cet agent IA.
    it("« reset » : l'historique du même contact chez un autre agent IA reste intact", async () => {
      const route = await limitedBot(['+33600000001']);
      await serve(incoming({ messageId: 'wamid.RO1', text: 'Bonjour ventes' }));
      await serve(incoming({ messageId: 'wamid.RO2', text: 'Bonjour pilote' }), route);
      await world.tracker.drain(10_000);
      await serve(incoming({ messageId: 'wamid.RO3', text: 'reset' }), route);
      await world.tracker.drain(10_000);
      expect(await world.db.getConversation(CONTACT, 'acme', 'pilote')).toEqual([]);
      expect(await world.db.getConversation(CONTACT, 'acme', 'ventes')).toHaveLength(2);
      expect(await world.db.getSession(ACME_NUMBER, CONTACT)).toBeDefined();
    });
  });

  // revue 2b-1 M-5
  it('relivraison trois fois d\'un message pour un agent IA en pause : compteur à 1', async () => {
    await setBotStatus(world.db, 'acme', 'ventes', 'paused');
    for (let i = 0; i < 3; i++) {
      await serve(incoming({ messageId: 'wamid.M5' }));
      await world.tracker.drain(10_000);
    }
    expect(await unservedCount(world.db, 'acme', 'ventes')).toBe(1);
    expect(chatMock).not.toHaveBeenCalled();
  });

  // revue finale 2b-1 m8
  it('compte en erreur (jeton) : aucun appel LLM pour les messages suivants, compteur incrémenté', async () => {
    await world.db.setWhatsAppAccountError(world.accounts.acmeMeta.account.id, 'token_invalid', AUTH_ERROR);
    await serve(incoming({ messageId: 'wamid.ER1' }));
    await world.tracker.drain(10_000);
    expect(chatMock).not.toHaveBeenCalled();
    expect(world.fetchMock).not.toHaveBeenCalled();
    expect(await world.db.getSession(ACME_NUMBER, CONTACT)).toBeUndefined();
    expect(await unservedCount(world.db, 'acme', 'ventes')).toBe(1);
  });

  // revue finale 2b-1 m8, spec §7.7
  it('envoi refusé (401 Meta) : le compte passe en erreur (jeton) et le message suivant n\'est pas servi', async () => {
    rejectTextSends();
    await serve(incoming({ messageId: 'wamid.T1' }));
    await world.tracker.drain(10_000);
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(await accountState()).toEqual(TOKEN_ERROR);
    // L'état d'exécution de l'agent IA ne porte plus d'erreur de transport : le jeton est porté par le compte.
    expect((await world.db.getBotRuntimeState('acme', 'ventes')) ?? {}).not.toHaveProperty('transport_error');

    await serve(incoming({ messageId: 'wamid.T2' }));
    await world.tracker.drain(10_000);
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(await unservedCount(world.db, 'acme', 'ventes')).toBe(1);
  });

  // spec §7.5, revue 2b-1 M-5
  it("branchement du numéro sur un autre agent IA pendant l'attente derrière le verrou : le message en file n'est servi ni par l'ancien ni par le nouveau", async () => {
    let release!: (value: string) => void;
    const started = new Promise<void>((resolve) => {
      chatMock.mockImplementationOnce(() => {
        resolve();
        return new Promise<string>((res) => { release = res; });
      });
    });
    await serve(incoming({ messageId: 'wamid.B1' }));
    await started;
    await serve(incoming({ messageId: 'wamid.B2', text: 'Deuxième' }));
    await createConnectedBot(world.db, { clientId: 'acme', botId: 'nouveau', numberId: world.number(ACME_NUMBER).id });
    release(JSON.stringify({ type: 'text', text: LLM_REPLY }));
    await world.tracker.drain(10_000);
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(chatMock.mock.calls.map((c) => (c[2] as { botId: string }).botId)).toEqual(['ventes']);
    expect(metaTexts(world.calls).map((t) => t.text)).toEqual([LLM_REPLY]);
    // Un changement de route n'est pas un message non servi de l'un ou l'autre agent IA.
    expect(await unservedCount(world.db, 'acme', 'ventes')).toBe(0);
    expect(await unservedCount(world.db, 'acme', 'nouveau')).toBe(0);
    expect(await world.db.getConversation(CONTACT, 'acme', 'nouveau')).toEqual([]);
    expect(await world.db.claimMessage(`${ACME_NUMBER}:wamid.B2`, 0)).toBe(false);
  });

  // spec §7.4
  it('numéro retiré chez le fournisseur après le routage : non servi, compteur incrémenté', async () => {
    const route = await routeOf();
    await world.db.applyInventory('acme', world.accounts.acmeMeta.account.id, [{
      provider_number_id: ACME_FREE_PNID, phone_e164: ACME_FREE_NUMBER, display_name: 'Libre', meta_status: 'CONNECTED',
      quality: 'GREEN', is_test: false, cm_channel_id: null,
    }]);
    await serve(incoming({ messageId: 'wamid.NR1' }), route);
    await world.tracker.drain(10_000);
    expect(chatMock).not.toHaveBeenCalled();
    expect(world.fetchMock).not.toHaveBeenCalled();
    expect(await unservedCount(world.db, 'acme', 'ventes')).toBe(1);
  });
  // audit 1.5, point d'attention 1 : contrôle de routeAndServe, indépendant de la recherche du numéro par compte.
  it.each([
    { cas: "numéro d'une autre organisation", phone: BETA_NUMBER },
    { cas: "numéro d'un autre compte de la même organisation", phone: ACME_SUPPORT_NUMBER },
  ])('routeAndServe avec un $cas : anomalie journalisée, aucun effet', async ({ phone }) => {
    const n = world.number(phone);
    const foreign = (await world.db.getWhatsAppNumber(n.client_id, n.id))!;
    const errors = vi.spyOn(console, 'error');
    await routeAndServe('Test', world.accounts.acmeMeta.account, foreign, incoming({ messageId: 'wamid.ANO' }), world.tracker);
    await world.tracker.drain(10_000);
    expect(errors.mock.calls.some((c) => String(c[0]).includes('Anomalie'))).toBe(true);
    expect(chatMock).not.toHaveBeenCalled();
    expect(world.fetchMock).not.toHaveBeenCalled();
    expect(await world.db.claimMessage(`${phone}:wamid.ANO`, 300)).toBe(true);
    errors.mockRestore();
  });
  // revue de la tâche 6 (correction 1) : le transport est reconstruit sous le verrou avec le compte relu.
  it("secrets du compte remplacés pendant l'attente derrière le verrou : le message en file part avec le nouveau jeton", async () => {
    let release!: (value: string) => void;
    const started = new Promise<void>((resolve) => {
      chatMock.mockImplementationOnce(() => {
        resolve();
        return new Promise<string>((res) => { release = res; });
      });
    });
    await serve(incoming({ messageId: 'wamid.S1' }));
    await started;
    await serve(incoming({ messageId: 'wamid.S2', text: 'Deuxième' }));
    const enc = encryptAccountSecrets({
      mode: 'meta_manual', access_token: 'JETON_NOUVEAU', app_secret: 'secret-nouveau', verify_token: 'verif', webhook_key: ACME_META_KEY,
    });
    expect(await world.db.replaceWhatsAppAccountSecrets('acme', world.accounts.acmeMeta.account.id, {
      ...enc, waba_id: ACME_WABA, meta_app_id: 'app-acme', token_expiry: null, verified_at: new Date().toISOString(),
    })).toEqual({ ok: true });
    release(JSON.stringify({ type: 'text', text: LLM_REPLY }));
    await world.tracker.drain(10_000);
    expect(metaTexts(world.calls).map((t) => t.authorization)).toEqual([`Bearer ${ACME_TOKEN}`, 'Bearer JETON_NOUVEAU']);
  });

  // revue de la tâche 6 (correction 1) : sans transport pour la route relue, le message en file est écarté.
  it("secrets du compte devenus illisibles pendant l'attente : message en file écarté sans compteur", async () => {
    let release!: (value: string) => void;
    const started = new Promise<void>((resolve) => {
      chatMock.mockImplementationOnce(() => {
        resolve();
        return new Promise<string>((res) => { release = res; });
      });
    });
    await serve(incoming({ messageId: 'wamid.U1' }));
    await started;
    await serve(incoming({ messageId: 'wamid.U2', text: 'Deuxième' }));
    const enc = encryptJson({ mode: 'meta_manual', webhook_key: ACME_META_KEY });
    expect(await world.db.replaceWhatsAppAccountSecrets('acme', world.accounts.acmeMeta.account.id, {
      secret_encrypted: enc.secret, key_version: enc.keyVersion, waba_id: ACME_WABA, meta_app_id: 'app-acme', token_expiry: null,
      verified_at: new Date().toISOString(),
    })).toEqual({ ok: true });
    release(JSON.stringify({ type: 'text', text: LLM_REPLY }));
    await world.tracker.drain(10_000);
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(metaTexts(world.calls)).toHaveLength(1);
    expect(await unservedCount(world.db, 'acme', 'ventes')).toBe(0);
    expect(await world.db.claimMessage(`${ACME_NUMBER}:wamid.U2`, 0)).toBe(false);
  });
});
