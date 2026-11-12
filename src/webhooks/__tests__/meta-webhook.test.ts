import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { serve } from '../../test-support/http.js';

const chatMock = vi.hoisted(() => vi.fn());

vi.mock('../../llm/anthropic.js', () => ({
  chat: chatMock,
  withRetry: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getClientForTenant: vi.fn(async () => ({
    messages: { create: vi.fn(async () => ({ content: [{ type: 'text', text: '{}' }] })) },
  })),
}));

// Espion sur la vérification de signature (comportement réel conservé) : compte les vérifications par requête.
vi.mock('../meta-signature.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../meta-signature.js')>();
  return { ...actual, verifyMetaSignature: vi.fn(actual.verifyMetaSignature) };
});

// Espion sur la lecture des secrets d'un compte (comportement réel conservé).
vi.mock('../../transport/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../transport/index.js')>();
  return { ...actual, decryptAccountSecrets: vi.fn(actual.decryptAccountSecrets) };
});

import {
  ACME_APP_SECRET, ACME_CM_KEY, ACME_FREE_NUMBER, ACME_FREE_PNID, ACME_META_KEY, ACME_NUMBER, ACME_PNID,
  ACME_SUPPORT_NUMBER, ACME_SUPPORT_PNID, ACME_TOKEN, ACME_VERIFY, ACME_WABA, ACME_WABA_2, BETA_APP_SECRET, BETA_META_KEY,
  BETA_NUMBER, BETA_PNID, BETA_TOKEN, BETA_VERIFY, BETA_WABA, LLM_REPLY,
  createWorld, sign,
} from './fixtures.js';
import { CONTACT, createMetaAccount, createConnectedBot, metaBody, metaTexts, setBotStatus, unservedCount } from '../../test-support/whatsapp.js';
import type { MetaMessageSpec } from '../../test-support/whatsapp.js';
import type { World } from './fixtures.js';
import type { WhatsAppAccountRecord } from '../../core/database/whatsapp-types.js';
import { MAX_MESSAGES_PER_WEBHOOK } from '../meta.js';
import { verifyMetaSignature } from '../meta-signature.js';
import { decryptAccountSecrets, encryptAccountSecrets } from '../../transport/index.js';
import { hashWebhookKey } from '../../whatsapp/webhook-key.js';
import { createRefreshScheduler } from '../../whatsapp/refresh-scheduler.js';
import type { RefreshScheduler } from '../../whatsapp/refresh-scheduler.js';
import { isSignatureRejected, SIGNATURE_REJECTION_THRESHOLD } from '../signature-monitor.js';
import { registerPendingVerification, resetPendingVerificationsForTests } from '../pending-verification.js';

const ACME_PATH = `/webhook/meta/${ACME_META_KEY}`;

/** Message d'acme/ventes (WABA et numéro du compte Meta d'acme), surchargé au besoin. */
function acme(spec: Partial<MetaMessageSpec> & { id: string }): MetaMessageSpec {
  return { wabaId: ACME_WABA, displayPhone: ACME_NUMBER, phoneNumberId: ACME_PNID, ...spec };
}

describe('POST /webhook/meta/:key', () => {
  let world: World;

  beforeEach(async () => {
    chatMock.mockReset();
    chatMock.mockResolvedValue(JSON.stringify({ type: 'text', text: LLM_REPLY }));
    vi.mocked(verifyMetaSignature).mockClear();
    vi.mocked(decryptAccountSecrets).mockClear();
    world = await createWorld();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await world.close();
  });

  async function post(raw: string, signature?: string, path: string = ACME_PATH): Promise<request.Response> {
    const req = request(await serve(world.app)).post(path).set('Content-Type', 'application/json');
    if (signature !== undefined) req.set('x-hub-signature-256', signature);
    const res = await req.send(raw);
    await world.tracker.drain(10_000);
    return res;
  }

  /** Ni LLM, ni envoi, ni session, ni conversation, ni compteur, ni réservation pour ce message. */
  async function expectNothingHappened(waNumber: string, messageId: string): Promise<void> {
    expect(chatMock).not.toHaveBeenCalled();
    expect(world.fetchMock).not.toHaveBeenCalled();
    expect(await world.db.getSession(waNumber, CONTACT)).toBeUndefined();
    for (const [clientId, botId] of [['acme', 'ventes'], ['acme', 'support'], ['beta', 'accueil']] as const) {
      expect(await world.db.getConversation(CONTACT, clientId, botId)).toHaveLength(0);
      expect(await unservedCount(world.db, clientId, botId)).toBe(0);
    }
    // Dernière vérification (elle écrit) : le message n'a pas été réservé.
    expect(await world.db.claimMessage(`${waNumber}:${messageId}`, 300)).toBe(true);
  }

  // revue finale 2b-1 m7
  it('sans en-tête de signature et JSON invalide : 401 (et non 400)', async () => {
    const res = await request(await serve(world.app)).post(ACME_PATH)
      .set('Content-Type', 'application/json').send('{"entry":');
    expect(res.status).toBe(401);
    const empty = await request(await serve(world.app)).post(ACME_PATH)
      .set('Content-Type', 'application/json').set('x-hub-signature-256', '').send('{"entry":');
    expect(empty.status).toBe(401);
  });

  // revue finale 2b-3 I-1
  it('corps JSON invalide avec un en-tête de signature : le corps reçu (secret compris) n\'atteint aucun journal', async () => {
    const logs = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'log')];
    for (const spy of logs) spy.mockImplementation(() => undefined);
    const res = await request(await serve(world.app)).post(ACME_PATH)
      .set('Content-Type', 'application/json').set('x-hub-signature-256', sign('x')).send('{"token":"SECRET-WEBHOOK-META", ');
    expect(res.status).toBe(400);
    for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain('SECRET-WEBHOOK-META');
    for (const spy of logs) spy.mockRestore();
  });

  // audit 4.2
  it('sans signature : 401, ni base, ni LLM, ni envoi', async () => {
    const raw = JSON.stringify(metaBody([acme({ id: 'wamid.1' })]));
    const res = await post(raw);
    expect(res.status).toBe(401);
    await expectNothingHappened(ACME_NUMBER, 'wamid.1');
  });

  // audit 4.2
  it('signature présente mais corps non JSON (corps brut absent) : 401, aucune lecture des secrets', async () => {
    const res = await request(await serve(world.app)).post(ACME_PATH)
      .set('Content-Type', 'text/plain').set('x-hub-signature-256', sign('x')).send('x');
    await world.tracker.drain(10_000);
    expect(res.status).toBe(401);
    expect(decryptAccountSecrets).not.toHaveBeenCalled();
    expect(chatMock).not.toHaveBeenCalled();
    expect(world.fetchMock).not.toHaveBeenCalled();
  });

  // audit 4.1
  it('clé inconnue, clé d\'un compte CM.com, ancienne route sans clé : 404, aucune lecture des secrets', async () => {
    const raw = JSON.stringify(metaBody([acme({ id: 'wamid.k' })]));
    expect((await post(raw, sign(raw), '/webhook/meta/cle-inconnue')).status).toBe(404);
    expect((await post(raw, sign(raw), `/webhook/meta/${ACME_CM_KEY}`)).status).toBe(404);
    expect((await post(raw, sign(raw), '/webhook/meta')).status).toBe(404);
    expect((await post(raw, sign(raw), '/webhook')).status).toBe(404);
    expect(decryptAccountSecrets).not.toHaveBeenCalled();
    expect(verifyMetaSignature).not.toHaveBeenCalled();
    await expectNothingHappened(ACME_NUMBER, 'wamid.k');
  });

  // audit 4.1
  it('clé inconnue avec un JSON invalide : 404 avant lecture du corps', async () => {
    const res = await request(await serve(world.app)).post('/webhook/meta/cle-inconnue')
      .set('Content-Type', 'application/json').set('x-hub-signature-256', 'sha256=00').send('{"entry":');
    expect(res.status).toBe(404);
  });

  // audit 4.1
  it('compte déconnecté : sa clé répond 404', async () => {
    // Déconnexion refusée tant qu'un numéro sert un agent IA actif : l'agent IA repasse d'abord en brouillon.
    expect((await world.db.transitionBotStatus('acme', 'ventes', 'draft')).ok).toBe(true);
    expect(await world.db.disconnectWhatsAppAccount('acme', world.accounts.acmeMeta.account.id)).toEqual({ ok: true });
    const raw = JSON.stringify(metaBody([acme({ id: 'wamid.dec' })]));
    expect((await post(raw, sign(raw))).status).toBe(404);
    expect(decryptAccountSecrets).not.toHaveBeenCalled();
  });

  // audit 4.2
  it('signature fausse : 200, aucun appel LLM, aucune session, aucune écriture', async () => {
    const raw = JSON.stringify(metaBody([acme({ id: 'wamid.2' })]));
    const res = await post(raw, sign(raw, 'autre-secret'));
    expect(res.status).toBe(200);
    await expectNothingHappened(ACME_NUMBER, 'wamid.2');
    const account = await world.db.getWhatsAppAccount('acme', world.accounts.acmeMeta.account.id);
    expect(account?.last_signature_ok_at).toBeNull();
    expect(account?.state).toBe('connected');
  });

  // audit 4.2 : la signature d'un autre compte (autre organisation) ne vaut pas sur l'URL d'acme.
  it("signature calculée avec le secret d'app d'un autre compte : rien", async () => {
    const raw = JSON.stringify(metaBody([acme({ id: 'wamid.autre' })]));
    expect((await post(raw, sign(raw, BETA_APP_SECRET))).status).toBe(200);
    await expectNothingHappened(ACME_NUMBER, 'wamid.autre');
  });

  // revue 2b-1 M-3
  it('POST de 50 messages vers 50 numéros du compte, signature fausse : un seul calcul de HMAC, aucune lecture de numéro', async () => {
    const numbers = Array.from({ length: 50 }, (_, i) => ({ phone: `+3320000${String(1000 + i)}`, providerNumberId: `PNID_LOT_${i}` }));
    const lot = await createMetaAccount(world.db, {
      clientId: 'beta', wabaId: 'WABA_LOT', metaAppId: 'app-lot', accessToken: 'JETON_LOT', appSecret: 'secret-lot',
      verifyToken: 'verif-lot', webhookKey: 'cle-lot', numbers,
    });
    for (const [i, n] of numbers.entries()) {
      await createConnectedBot(world.db, { clientId: 'beta', botId: `lot${i}`, numberId: lot.numbers[n.phone]!.id });
    }
    const raw = JSON.stringify(metaBody(numbers.map((n, i) => ({
      wabaId: 'WABA_LOT', displayPhone: n.phone, phoneNumberId: n.providerNumberId, id: `wamid.lot${i}`,
    }))));
    const findSpy = vi.spyOn(world.db, 'findPresentNumber');
    vi.mocked(verifyMetaSignature).mockClear();
    expect((await post(raw, sign(raw, 'faux'), '/webhook/meta/cle-lot')).status).toBe(200);
    expect(verifyMetaSignature).toHaveBeenCalledTimes(1);
    expect(findSpy).not.toHaveBeenCalled();
    expect(chatMock).not.toHaveBeenCalled();
    expect(world.fetchMock).not.toHaveBeenCalled();

    // Même lot bien signé : toujours un seul calcul de HMAC, cinquante messages servis.
    vi.mocked(verifyMetaSignature).mockClear();
    expect((await post(raw, sign(raw, 'secret-lot'), '/webhook/meta/cle-lot')).status).toBe(200);
    expect(verifyMetaSignature).toHaveBeenCalledTimes(1);
    expect(chatMock).toHaveBeenCalledTimes(50);
  });

  // audit 4.2
  it('signature sur les octets reçus : un corps re-sérialisé différemment est refusé', async () => {
    const spaced = JSON.stringify(metaBody([acme({ id: 'wamid.3', text: 'Café crème' })]), null, 2);
    const signature = sign(spaced);

    // Même objet, autre sérialisation : la signature des octets d'origine ne vaut plus.
    const compact = JSON.stringify(JSON.parse(spaced) as unknown);
    expect(compact).not.toBe(spaced);
    expect((await post(compact, signature)).status).toBe(200);
    expect(chatMock).not.toHaveBeenCalled();
    expect(world.fetchMock).not.toHaveBeenCalled();

    // Corps tel que signé : accepté.
    expect((await post(spaced, signature)).status).toBe(200);
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(metaTexts(world.calls)).toEqual([{ phoneNumberId: ACME_PNID, authorization: `Bearer ${ACME_TOKEN}`, to: CONTACT, text: LLM_REPLY }]);
  });

  // audit 1.1
  it("bonne signature : l'agent IA du numéro répond avec le jeton du compte, la session est celle de cet agent IA", async () => {
    const raw = JSON.stringify(metaBody([acme({ id: 'wamid.ok' })]));
    expect((await post(raw, sign(raw))).status).toBe(200);
    expect(metaTexts(world.calls)).toEqual([{ phoneNumberId: ACME_PNID, authorization: `Bearer ${ACME_TOKEN}`, to: CONTACT, text: LLM_REPLY }]);
    for (const call of world.calls) expect(call.headers['Authorization']).toBe(`Bearer ${ACME_TOKEN}`);
    expect(await world.db.getSession(ACME_NUMBER, CONTACT)).toMatchObject({ client_id: 'acme', bot_id: 'ventes' });
  });

  // audit 1.1 : chaque organisation sur son URL, avec son secret, répond avec son jeton.
  it('beta sur son URL avec son secret : beta répond avec son jeton', async () => {
    const raw = JSON.stringify(metaBody([{ wabaId: BETA_WABA, displayPhone: BETA_NUMBER, phoneNumberId: BETA_PNID, id: 'wamid.b' }]));
    expect((await post(raw, sign(raw, BETA_APP_SECRET), `/webhook/meta/${BETA_META_KEY}`)).status).toBe(200);
    expect(metaTexts(world.calls)).toEqual([{ phoneNumberId: BETA_PNID, authorization: `Bearer ${BETA_TOKEN}`, to: CONTACT, text: LLM_REPLY }]);
    expect(await world.db.getSession(BETA_NUMBER, CONTACT)).toMatchObject({ client_id: 'beta', bot_id: 'accueil' });
  });

  // Point d'attention 1 de la revue du plan 2b-2
  it.each([
    { cas: "entrée d'une autre WABA (celle de beta), numéro d'acme", spec: { wabaId: BETA_WABA }, waNumber: ACME_NUMBER },
    { cas: "entrée d'une WABA inconnue", spec: { wabaId: 'WABA_INCONNUE' }, waNumber: ACME_NUMBER },
    { cas: 'phone_number_id du numéro de beta (autre organisation)', spec: { displayPhone: BETA_NUMBER, phoneNumberId: BETA_PNID }, waNumber: BETA_NUMBER },
    { cas: "phone_number_id d'un numéro d'un autre compte d'acme (même organisation)", spec: { displayPhone: ACME_SUPPORT_NUMBER, phoneNumberId: ACME_SUPPORT_PNID }, waNumber: ACME_SUPPORT_NUMBER },
    { cas: 'phone_number_id du numéro de beta dans une entrée de la WABA de beta', spec: { wabaId: BETA_WABA, displayPhone: BETA_NUMBER, phoneNumberId: BETA_PNID }, waNumber: BETA_NUMBER },
    { cas: "WABA de l'autre compte d'acme avec son numéro", spec: { wabaId: ACME_WABA_2, displayPhone: ACME_SUPPORT_NUMBER, phoneNumberId: ACME_SUPPORT_PNID }, waNumber: ACME_SUPPORT_NUMBER },
  ])('signé avec le secret du compte A sur l\'URL de A, $cas : ignoré, aucun effet', async ({ spec, waNumber }) => {
    const raw = JSON.stringify(metaBody([acme({ id: 'wamid.pa1', ...spec })]));
    expect((await post(raw, sign(raw, ACME_APP_SECRET))).status).toBe(200);
    await expectNothingHappened(waNumber, 'wamid.pa1');
  });

  // Point d'attention 1 : un lot mêlé n'empêche pas les messages légitimes du lot.
  it("lot mêlé signé par A : seul le message du numéro de A dans la WABA de A est servi", async () => {
    const raw = JSON.stringify(metaBody([
      acme({ id: 'wamid.mix1', wabaId: BETA_WABA }),
      acme({ id: 'wamid.mix2', displayPhone: BETA_NUMBER, phoneNumberId: BETA_PNID }),
      acme({ id: 'wamid.mix3' }),
    ]));
    expect((await post(raw, sign(raw))).status).toBe(200);
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(metaTexts(world.calls).map((t) => t.phoneNumberId)).toEqual([ACME_PNID]);
    expect(await world.db.getSession(BETA_NUMBER, CONTACT)).toBeUndefined();
    expect(await world.db.claimMessage(`${ACME_NUMBER}:wamid.mix1`, 300)).toBe(true);
    expect(await world.db.claimMessage(`${BETA_NUMBER}:wamid.mix2`, 300)).toBe(true);
  });

  it('numéro libre du compte (sans agent IA) ou phone_number_id inconnu : rien', async () => {
    const raw = JSON.stringify(metaBody([
      acme({ id: 'wamid.libre', displayPhone: ACME_FREE_NUMBER, phoneNumberId: ACME_FREE_PNID }),
      acme({ id: 'wamid.inconnu', displayPhone: '+33199999999', phoneNumberId: 'PNID_INCONNU' }),
    ]));
    expect((await post(raw, sign(raw))).status).toBe(200);
    await expectNothingHappened(ACME_FREE_NUMBER, 'wamid.libre');
  });

  // Le routage est fait par phone_number_id, jamais par le numéro affiché.
  it("numéro affiché d'un autre agent IA avec le phone_number_id d'acme/ventes : servi par acme/ventes", async () => {
    const raw = JSON.stringify(metaBody([acme({ id: 'wamid.aff', displayPhone: BETA_NUMBER })]));
    expect((await post(raw, sign(raw))).status).toBe(200);
    expect(metaTexts(world.calls).map((t) => t.phoneNumberId)).toEqual([ACME_PNID]);
    expect(await world.db.getSession(ACME_NUMBER, CONTACT)).toMatchObject({ client_id: 'acme', bot_id: 'ventes' });
    expect(await world.db.getSession(BETA_NUMBER, CONTACT)).toBeUndefined();
  });

  // choix 4
  it(`signatures rejetées en série : au-delà de ${SIGNATURE_REJECTION_THRESHOLD}, le compte compte comme rejeté ; une signature valide lève l'état`, async () => {
    const raw = JSON.stringify(metaBody([acme({ id: 'wamid.serie', type: 'reaction' })]));
    const accountId = world.accounts.acmeMeta.account.id;
    for (let i = 0; i <= SIGNATURE_REJECTION_THRESHOLD; i++) await post(raw, sign(raw, 'faux'));
    expect(isSignatureRejected(accountId)).toBe(true);
    expect((await world.db.getWhatsAppAccount('acme', accountId))?.state).toBe('connected');
    await post(raw, sign(raw));
    expect(isSignatureRejected(accountId)).toBe(false);
  });

  it('signature valide : last_signature_ok_at écrit, puis pas plus d\'une fois par 10 minutes', async () => {
    const accountId = world.accounts.acmeMeta.account.id;
    const touch = vi.spyOn(world.db, 'touchSignatureOk');
    const raw = JSON.stringify(metaBody([acme({ id: 'wamid.t1', type: 'reaction' })]));
    await post(raw, sign(raw));
    expect(touch).toHaveBeenCalledTimes(1);
    expect((await world.db.getWhatsAppAccount('acme', accountId))?.last_signature_ok_at).not.toBeNull();
    await post(raw, sign(raw));
    expect(touch).toHaveBeenCalledTimes(1);

    // Dernière signature valide il y a 11 minutes : de nouveau écrite.
    await world.db.touchSignatureOk(accountId, new Date(Date.now() - 11 * 60_000).toISOString());
    touch.mockClear();
    await post(raw, sign(raw));
    expect(touch).toHaveBeenCalledTimes(1);
  });

  // audit 4.2
  it(`au plus ${MAX_MESSAGES_PER_WEBHOOK} messages traités par POST`, async () => {
    const specs = Array.from({ length: MAX_MESSAGES_PER_WEBHOOK + 10 }, (_, i) => acme({
      id: `wamid.cap${i}`, from: `3360000${String(1000 + i)}`, type: 'audio',
    }));
    const raw = JSON.stringify(metaBody(specs));
    const warn = vi.spyOn(console, 'warn');
    expect((await post(raw, sign(raw))).status).toBe(200);
    expect(metaTexts(world.calls)).toHaveLength(MAX_MESSAGES_PER_WEBHOOK);
    expect(warn.mock.calls.some((args) => String(args[0]).includes('10 message(s) ignoré(s)'))).toBe(true);
  });

  it("statuts et événements de compte : journal du nombre et du champ seulement, après authentification, aucun effet", async () => {
    const raw = JSON.stringify({
      entry: [{
        id: ACME_WABA,
        changes: [
          { field: 'messages', value: { metadata: { display_phone_number: '33100000001', phone_number_id: ACME_PNID }, statuses: [{ id: 'wamid.s', status: 'delivered', recipient_id: CONTACT }] } },
          { field: 'account_update', value: { event: 'X' } },
        ],
      }],
    });
    const log = vi.spyOn(console, 'log');
    expect((await post(raw, sign(raw))).status).toBe(200);
    const lines = log.mock.calls.map((args) => args.map(String).join(' '));
    expect(lines.some((l) => l.includes('1 statut(s)') && l.includes('account_update'))).toBe(true);
    expect(lines.some((l) => l.includes(CONTACT))).toBe(false);
    expect(world.fetchMock).not.toHaveBeenCalled();

    // Même corps mal signé : aucun journal des statuts.
    log.mockClear();
    expect((await post(raw, sign(raw, 'faux'))).status).toBe(200);
    expect(log.mock.calls.map((args) => args.map(String).join(' ')).some((l) => l.includes('statut(s)'))).toBe(false);
  });

  // audit 4.2 : noms de champ d'événement filtrés par safeFieldName dans le journal d'un lot authentifié.
  it("lot bien signé avec des noms de champ piégés : le journal ne porte que « autre »", async () => {
    const trap = '\n[Server] faux';
    const raw = JSON.stringify({
      entry: [{ id: ACME_WABA, changes: [{ field: `x${trap}`, value: {} }, { field: 'x'.repeat(5000), value: {} }] }],
    });
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
    expect((await post(raw, sign(raw))).status).toBe(200);
    const args = spies.flatMap((s) => s.mock.calls.flat().map((a) => (a instanceof Error ? `${a.message}${a.stack ?? ''}` : String(a))));
    const eventLines = args.filter((a) => a.includes('événement(s) de compte'));
    expect(eventLines).toHaveLength(1);
    expect(eventLines[0]).toContain('2 événement(s) de compte (autre)');
    for (const arg of args) {
      expect(arg).not.toContain('[Server] faux');
      expect(arg).not.toContain('\n');
      expect(arg).not.toContain('xxxxxxxxxx');
    }
  });

  // audit 4.2
  it('corps mal signé : aucune donnée de la requête dans les journaux (champ et identifiant piégés)', async () => {
    const trap = '\n[Server] faux';
    const body = metaBody([
      acme({ id: `wamid.a${trap}` }),
      acme({ id: `wamid.b${trap}`, displayPhone: '+33199999999', phoneNumberId: `PNID${trap}` }),
      acme({ id: `wamid.c${trap}`, wabaId: `WABA${trap}` }),
    ]) as { entry: Array<{ changes: unknown[] }> };
    body.entry[0]!.changes.push({ field: `x${trap}`, value: {} });
    body.entry[0]!.changes.push({ field: 'x'.repeat(5000), value: {} });
    const raw = JSON.stringify(body);
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
    expect((await post(raw, sign(raw, 'mauvais'))).status).toBe(200);
    const args = spies.flatMap((s) => s.mock.calls.flat().map((a) => (a instanceof Error ? `${a.message}${a.stack ?? ''}` : String(a))));
    expect(args.length).toBeGreaterThan(0);
    for (const arg of args) {
      expect(arg).not.toContain('[Server] faux');
      expect(arg).not.toContain('\n');
      expect(arg).not.toContain('xxxxxxxxxx');
      expect(arg).not.toContain(CONTACT);
      expect(arg).not.toContain(ACME_META_KEY);
    }
    expect(chatMock).not.toHaveBeenCalled();
    expect(world.fetchMock).not.toHaveBeenCalled();
  });

  it("identifiant de message filtré dans les journaux après authentification", async () => {
    const raw = JSON.stringify(metaBody([acme({ id: 'wamid.z\n[Server] faux', phoneNumberId: 'PNID_INCONNU' })]));
    const warn = vi.spyOn(console, 'warn');
    expect((await post(raw, sign(raw))).status).toBe(200);
    const lines = warn.mock.calls.map((c) => c.map(String).join(' '));
    expect(lines.some((l) => l.includes('wamid.zServerfau'))).toBe(true);
    expect(lines.every((l) => !l.includes('\n') && !l.includes('[Server] faux'))).toBe(true);
  });

  it("aucun journal du webhook ne contient l'identifiant du contact, le texte du message ni la clé d'URL", async () => {
    const spies = (['log', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m));
    const raw = JSON.stringify(metaBody([acme({ id: 'wamid.7', text: 'Texte confidentiel' })]));
    expect((await post(raw, sign(raw))).status).toBe(200);
    expect(metaTexts(world.calls)).toHaveLength(1);
    const lines = spies.flatMap((s) => s.mock.calls.map((args) => args.map(String).join(' ')))
      .filter((l) => l.startsWith('[Webhook') || l.startsWith('[Pipeline'));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(CONTACT);
      expect(line).not.toContain('Texte confidentiel');
      expect(line).not.toContain(ACME_META_KEY);
      expect(line).not.toContain(ACME_APP_SECRET);
    }
  });

  // f4 (tâche 0) : un contact au numéro masqué arrive par `from_user_id`.
  it('contact BSUID (from_user_id seul) : servi, réponse envoyée à son BSUID', async () => {
    const raw = JSON.stringify(metaBody([acme({ id: 'wamid.bsuid', fromUserId: 'FR.abc123' })]));
    expect((await post(raw, sign(raw))).status).toBe(200);
    expect(metaTexts(world.calls)).toEqual([{ phoneNumberId: ACME_PNID, authorization: `Bearer ${ACME_TOKEN}`, to: 'FR.abc123', text: LLM_REPLY }]);
    expect(await world.db.getSession(ACME_NUMBER, 'FR.abc123')).toMatchObject({ client_id: 'acme', bot_id: 'ventes' });
  });
});

describe('GET /webhook/meta/:key', () => {
  let world: World;

  beforeEach(async () => { world = await createWorld(); });
  afterEach(async () => { await world.close(); });

  const query = { 'hub.mode': 'subscribe', 'hub.verify_token': ACME_VERIFY, 'hub.challenge': '12345' };

  // audit 4.3
  it('bon jeton du compte : 200 text/plain avec le challenge', async () => {
    const res = await request(await serve(world.app)).get(ACME_PATH).query(query);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.text).toBe('12345');
  });

  // audit 4.3
  it("jeton d'un autre compte, jeton faux, vide, autre mode : 403", async () => {
    const server = await serve(world.app);
    expect((await request(server).get(ACME_PATH).query({ ...query, 'hub.verify_token': BETA_VERIFY })).status).toBe(403);
    expect((await request(server).get(ACME_PATH).query({ ...query, 'hub.verify_token': `${ACME_VERIFY}x` })).status).toBe(403);
    expect((await request(server).get(ACME_PATH).query({ ...query, 'hub.verify_token': '' })).status).toBe(403);
    expect((await request(server).get(ACME_PATH).query({ ...query, 'hub.mode': 'unsubscribe' })).status).toBe(403);
    expect((await request(server).get(`/webhook/meta/${BETA_META_KEY}`).query(query)).status).toBe(403);
  });

  // audit 4.3
  it("clé inconnue ou d'un compte CM.com : 403 ; ancienne route sans clé : 404", async () => {
    const server = await serve(world.app);
    expect((await request(server).get('/webhook/meta/cle-inconnue').query(query)).status).toBe(403);
    expect((await request(server).get(`/webhook/meta/${ACME_CM_KEY}`).query(query)).status).toBe(403);
    expect((await request(server).get('/webhook/meta').query(query)).status).toBe(404);
  });

  // Aucun repli sur la plateforme : META_VERIFY_TOKEN de l'environnement n'ouvre aucune URL.
  it("META_VERIFY_TOKEN de l'environnement : sans effet", async () => {
    vi.stubEnv('META_VERIFY_TOKEN', 'jeton-plateforme');
    try {
      const server = await serve(world.app);
      expect((await request(server).get(ACME_PATH).query({ ...query, 'hub.verify_token': 'jeton-plateforme' })).status).toBe(403);
      expect((await request(server).get('/webhook/meta').query({ ...query, 'hub.verify_token': 'jeton-plateforme' })).status).toBe(404);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('GET /webhook/meta/:key pendant un raccordement (registre des vérifications attendues)', () => {
  let world: World;
  const PENDING_KEY = 'cle-en-cours-de-raccordement';
  const PENDING_PATH = `/webhook/meta/${PENDING_KEY}`;
  const PENDING_VERIFY = 'jeton-en-cours';
  const query = { 'hub.mode': 'subscribe', 'hub.verify_token': PENDING_VERIFY, 'hub.challenge': '67890' };

  beforeEach(async () => { chatMock.mockClear(); resetPendingVerificationsForTests(); world = await createWorld(); });
  afterEach(async () => { vi.useRealTimers(); resetPendingVerificationsForTests(); vi.restoreAllMocks(); await world.close(); });

  it('webhook GET servi par le registre avant la création du compte', async () => {
    registerPendingVerification(PENDING_KEY, PENDING_VERIFY);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const res = await request(await serve(world.app)).get(PENDING_PATH).query(query);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.text).toBe('67890');
    expect(log).toHaveBeenCalledWith('[Webhook/Meta] Vérification acceptée (raccordement en cours)');
    expect(JSON.stringify(log.mock.calls)).not.toContain(PENDING_KEY);
  });

  // spec R1 §8
  it("GET avec le jeton d'un autre raccordement en attente : 403", async () => {
    registerPendingVerification(PENDING_KEY, PENDING_VERIFY);
    registerPendingVerification('cle-autre-raccordement', 'jeton-autre');
    const server = await serve(world.app);
    expect((await request(server).get(PENDING_PATH).query({ ...query, 'hub.verify_token': 'jeton-autre' })).status).toBe(403);
    expect((await request(server).get(PENDING_PATH).query({ ...query, 'hub.verify_token': '' })).status).toBe(403);
    expect((await request(server).get(PENDING_PATH).query({ ...query, 'hub.mode': 'unsubscribe' })).status).toBe(403);
    expect((await request(server).get('/webhook/meta/cle-autre-raccordement').query(query)).status).toBe(403);
  });

  it('le jeton en attente n\'ouvre pas la clé d\'un compte existant, ni une clé inconnue', async () => {
    registerPendingVerification(PENDING_KEY, PENDING_VERIFY);
    const server = await serve(world.app);
    expect((await request(server).get(ACME_PATH).query(query)).status).toBe(403);
    expect((await request(server).get('/webhook/meta/cle-inconnue').query(query)).status).toBe(403);
  });

  it('après libération ou expiration : 403', async () => {
    const release = registerPendingVerification(PENDING_KEY, PENDING_VERIFY);
    const server = await serve(world.app);
    expect((await request(server).get(PENDING_PATH).query(query)).status).toBe(200);
    release();
    expect((await request(server).get(PENDING_PATH).query(query)).status).toBe(403);

    registerPendingVerification(PENDING_KEY, PENDING_VERIFY, 50);
    expect((await request(server).get(PENDING_PATH).query(query)).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect((await request(server).get(PENDING_PATH).query(query)).status).toBe(403);
  });

  // spec R1 §8
  it('POST signé sur une clé en attente : 404, aucun effet de bord', async () => {
    registerPendingVerification(PENDING_KEY, PENDING_VERIFY);
    const raw = JSON.stringify(metaBody([{ id: 'wamid.pend', wabaId: ACME_WABA, displayPhone: ACME_NUMBER, phoneNumberId: ACME_PNID }]));
    vi.mocked(decryptAccountSecrets).mockClear();
    vi.mocked(verifyMetaSignature).mockClear();
    const res = await request(await serve(world.app)).post(PENDING_PATH)
      .set('Content-Type', 'application/json').set('x-hub-signature-256', sign(raw)).send(raw);
    await world.tracker.drain(10_000);
    expect(res.status).toBe(404);
    expect(decryptAccountSecrets).not.toHaveBeenCalled();
    expect(verifyMetaSignature).not.toHaveBeenCalled();
    expect(chatMock).not.toHaveBeenCalled();
    expect(world.fetchMock).not.toHaveBeenCalled();
    expect(await world.db.getSession(ACME_NUMBER, CONTACT)).toBeUndefined();
  });
});

describe('POST /webhook/meta/:key : statuts, événements de compte et rafraîchissement', () => {
  let world: World;
  let scheduler: RefreshScheduler;
  let refresh: ReturnType<typeof vi.fn<(clientId: string, accountId: number) => Promise<void>>>;

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    refresh = vi.fn<(clientId: string, accountId: number) => Promise<void>>(async () => undefined);
    scheduler = createRefreshScheduler(refresh);
    world = await createWorld({ refreshScheduler: scheduler });
  });
  afterEach(async () => {
    scheduler.stop();
    vi.restoreAllMocks();
    await world.close();
  });

  async function post(body: unknown, secret: string = ACME_APP_SECRET): Promise<request.Response> {
    const raw = JSON.stringify(body);
    const res = await request(await serve(world.app)).post(ACME_PATH)
      .set('Content-Type', 'application/json').set('x-hub-signature-256', sign(raw, secret)).send(raw);
    await world.tracker.drain(10_000);
    return res;
  }

  const failedStatus = (waba: string, pnid: string, code: number) => ({
    id: waba,
    changes: [{
      field: 'messages',
      value: {
        metadata: { display_phone_number: '33100000001', phone_number_id: pnid },
        statuses: [{ id: 'wamid.s', status: 'failed', recipient_id: CONTACT, errors: [{ code }] }],
      },
    }],
  });
  const accountId = (): number => world.accounts.acmeMeta.account.id;
  const alerts = async () => (await world.db.getWhatsAppAccount('acme', accountId()))?.alerts ?? [];
  const failures = async () => (await world.db.getWhatsAppNumber('acme', world.number(ACME_NUMBER).id))?.delivery_failures;

  it('statut failed 131042 + account_update : échec compté, alertes écrites, rafraîchissement demandé pour ce compte', async () => {
    const res = await post({ entry: [
      failedStatus(ACME_WABA, ACME_PNID, 131042),
      { id: ACME_WABA, changes: [{ field: 'account_update', value: { event: 'ACCOUNT_RESTRICTION', phone_number: '33100000001' } }] },
    ] });
    expect(res.status).toBe(200);
    expect(await failures()).toBe(1);
    expect((await alerts()).map((a) => a.kind).sort()).toEqual(['account_update', 'payment']);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('acme', accountId());
    expect(world.fetchMock).not.toHaveBeenCalled();
  });

  // audit 4.2
  it('lot mal signé : rien n\'est écrit, aucun rafraîchissement', async () => {
    const res = await post({ entry: [
      failedStatus(ACME_WABA, ACME_PNID, 131042),
      { id: ACME_WABA, changes: [{ field: 'account_update', value: { event: 'ACCOUNT_RESTRICTION' } }] },
    ] }, 'faux');
    expect(res.status).toBe(200);
    expect(await failures()).toBe(0);
    expect(await alerts()).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  // audit 1.1 : une entrée d'une autre WABA, même avec un phone_number_id de ce compte, n'écrit rien
  it('entrées d\'une autre WABA postées sur l\'URL du compte : ignorées', async () => {
    await post({ entry: [
      failedStatus(BETA_WABA, ACME_PNID, 131042),
      { id: BETA_WABA, changes: [{ field: 'phone_number_quality_update', value: { display_phone_number: '33100000001' } }] },
    ] });
    expect(await failures()).toBe(0);
    expect(await alerts()).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  // point d'attention 3 (plan 2b-2)
  it('rafale de 50 événements phone_number_quality_update : un seul rafraîchissement dans la minute', async () => {
    const change = { field: 'phone_number_quality_update', value: { event: 'ONBOARDING', display_phone_number: '33100000001' } };
    await post({ entry: [{ id: ACME_WABA, changes: Array.from({ length: 50 }, () => change) }] });
    await post({ entry: [{ id: ACME_WABA, changes: [change, change] }] });
    await post({ entry: [{ id: ACME_WABA, changes: [change] }] });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await alerts()).toEqual([]);
  });

  describe("comptes de la même organisation et de la même app (spec R1 §5.4)", () => {
    const SIBLING_WABA = 'WABA_ACME_B';
    const SIBLING_NUMBER = '+33100000009';
    const SIBLING_PNID = 'PNID_ACME_B';
    let sibling: WhatsAppAccountRecord;

    beforeEach(async () => {
      // Compte B d'acme sur la même app Meta que le compte de l'URL (app-acme), donc le même secret d'app.
      sibling = (await createMetaAccount(world.db, {
        clientId: 'acme', wabaId: SIBLING_WABA, metaAppId: 'app-acme', accessToken: 'JETON_ACME_B', appSecret: ACME_APP_SECRET,
        verifyToken: 'verif-acme-b', webhookKey: 'cle-meta-acme-b', numbers: [{ phone: SIBLING_NUMBER, providerNumberId: SIBLING_PNID }],
      })).account;
      await createConnectedBot(world.db, { clientId: 'acme', botId: 'soeur', numberId: (await world.db.findPresentNumber(sibling.id, { providerNumberId: SIBLING_PNID }))!.id });
    });

    const accountUpdate = (waba: string) => ({ id: waba, changes: [{ field: 'account_update', value: { event: 'ACCOUNT_RESTRICTION' } }] });
    const qualityUpdate = (waba: string) => ({ id: waba, changes: [{ field: 'phone_number_quality_update', value: { event: 'FLAGGED' } }] });
    const alertsOf = async (clientId: string, id: number) => (await world.db.getWhatsAppAccount(clientId, id))?.alerts ?? [];

    it('événement de compte pour B (même organisation, même app) reçu sur A : traité pour B', async () => {
      const res = await post({ entry: [accountUpdate(SIBLING_WABA), qualityUpdate(SIBLING_WABA)] });
      expect(res.status).toBe(200);
      expect((await alertsOf('acme', sibling.id)).map((a) => [a.kind, a.event])).toEqual([['account_update', 'ACCOUNT_RESTRICTION']]);
      expect(await alertsOf('acme', accountId())).toEqual([]);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(refresh).toHaveBeenCalledWith('acme', sibling.id);
    });

    // spec R1 §8
    it("événement de compte pour une WABA d'une autre organisation reçu sur A : ignoré", async () => {
      const beta = world.accounts.betaMeta.account;
      const acmeOtherApp = world.accounts.acmeMeta2.account;
      await post({ entry: [
        accountUpdate(BETA_WABA), qualityUpdate(BETA_WABA), failedStatus(BETA_WABA, BETA_PNID, 131042),
        // Même organisation, autre app : ignoré aussi (la signature n'est pas celle de son app).
        accountUpdate(ACME_WABA_2), qualityUpdate(ACME_WABA_2),
      ] });
      expect(await alertsOf('beta', beta.id)).toEqual([]);
      expect(await alertsOf('acme', acmeOtherApp.id)).toEqual([]);
      expect(await alertsOf('acme', accountId())).toEqual([]);
      expect((await world.db.getWhatsAppNumber('beta', world.number(BETA_NUMBER).id))?.delivery_failures).toBe(0);
      expect(refresh).not.toHaveBeenCalled();
      expect((await world.db.getWhatsAppAccount('beta', beta.id))!.webhook_state).toBeNull();
    });

    // spec R1 §8
    it('message de B reçu sur A : jamais routé, B marqué waba missing', async () => {
      await world.db.setWhatsAppAccountWebhookState(sibling.client_id, sibling.id, { waba: 'ok', app: 'elsewhere', app_host: 'autre.example.com', checked_at: '2026-11-12T10:00:00.000Z' });
      const log = vi.mocked(console.log);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const fromB = (id: string) => ({ wabaId: SIBLING_WABA, displayPhone: SIBLING_NUMBER, phoneNumberId: SIBLING_PNID, id });
      const write = vi.spyOn(world.db, 'markWhatsAppAccountWabaWebhookMissing');
      // Revue de la tâche 7, mineur 3 : un statut en échec de B dans le même lot n'est pas compté pour B.
      await post({ entry: [
        ...(metaBody([fromB('wamid.b1'), fromB('wamid.b2'), fromB('wamid.b3')]).entry as unknown[]),
        failedStatus(SIBLING_WABA, SIBLING_PNID, 131042),
      ] });
      const siblingNumber = (await world.db.findPresentNumber(sibling.id, { providerNumberId: SIBLING_PNID }))!;
      expect(siblingNumber.delivery_failures).toBe(0);
      expect(await alertsOf('acme', sibling.id)).toEqual([]);
      // Jamais routé : ni réponse, ni session, ni appel LLM, ni par B ni par A.
      expect(metaTexts(world.calls)).toEqual([]);
      expect(chatMock).not.toHaveBeenCalled();
      expect(await world.db.getSession(SIBLING_NUMBER, CONTACT)).toBeUndefined();
      expect(await world.db.getSession(ACME_NUMBER, CONTACT)).toBeUndefined();
      expect(write).toHaveBeenCalledTimes(1);
      expect((await world.db.getWhatsAppAccount('acme', sibling.id))!.webhook_state)
        .toEqual({ waba: 'missing', app: 'elsewhere', app_host: 'autre.example.com', checked_at: '2026-11-12T10:00:00.000Z' });
      expect((await world.db.getWhatsAppAccount('acme', accountId()))!.webhook_state).toBeNull();
      const lines = [...log.mock.calls, ...warn.mock.calls].map((args) => args.join(' ')).join('\n');
      for (const secret of [CONTACT, 'wamid.b1', 'cle-meta-acme-b', ACME_META_KEY, SIBLING_PNID, SIBLING_WABA]) {
        expect(lines).not.toContain(secret);
      }
      // Lot suivant : déjà marqué, l'écriture conditionnelle ne change rien.
      await post(metaBody([fromB('wamid.b4')]));
      expect(write).toHaveBeenCalledTimes(2);
      expect((await world.db.getWhatsAppAccount('acme', sibling.id))!.webhook_state)
        .toEqual({ waba: 'missing', app: 'elsewhere', app_host: 'autre.example.com', checked_at: '2026-11-12T10:00:00.000Z' });
      expect(metaTexts(world.calls)).toEqual([]);
    });

    it("message de B sans état de webhook : marqué waba missing, autres champs inconnus", async () => {
      await post(metaBody([{ wabaId: SIBLING_WABA, displayPhone: SIBLING_NUMBER, phoneNumberId: SIBLING_PNID, id: 'wamid.b1' }]));
      expect((await world.db.getWhatsAppAccount('acme', sibling.id))!.webhook_state)
        .toEqual({ waba: 'missing', app: 'unknown', app_host: null, checked_at: null });
    });

    // spec R1 §8
    it("message d'une WABA d'une autre organisation reçu sur A : jamais routé, rien n'est marqué", async () => {
      const beta = world.accounts.betaMeta.account;
      await post(metaBody([{ wabaId: BETA_WABA, displayPhone: BETA_NUMBER, phoneNumberId: BETA_PNID, id: 'wamid.x' }]));
      expect(metaTexts(world.calls)).toEqual([]);
      expect((await world.db.getWhatsAppAccount('beta', beta.id))!.webhook_state).toBeNull();
      expect((await world.db.getWhatsAppAccount('acme', sibling.id))!.webhook_state).toBeNull();
    });

    // revue R1 ISO-M4 : seul le filtre par organisation écarte ce compte (même app, WABA du lot, connecté), cas rendu
    // impossible en régime normal par le choix 3 et inséré directement ici.
    it("compte connecté d'une autre organisation sur la même app : événement ignoré, message jamais routé, rien marqué", async () => {
      const BETA_SAME_APP_WABA = 'WABA-BETA-MEME-APP';
      const BETA_SAME_APP_PNID = 'PNID-BETA-MEME-APP';
      const BETA_SAME_APP_NUMBER = '+33299999999';
      // Insertion directe : le pilote de création refuserait l'app (choix 3).
      const betaSameApp = await world.db.insertWhatsAppAccount({
        client_id: 'beta', name: 'Beta même app', mode: 'meta_manual', provider_account_id: BETA_SAME_APP_WABA, waba_id: BETA_SAME_APP_WABA,
        meta_app_id: 'app-acme',
        ...encryptAccountSecrets({
          mode: 'meta_manual', access_token: 'JETON_BETA_MEME_APP', app_secret: ACME_APP_SECRET, verify_token: 'verif-beta-meme-app', webhook_key: 'cle-meta-beta-meme-app',
        }),
        webhook_key_hash: hashWebhookKey('cle-meta-beta-meme-app'), token_expiry: null, last_verified_at: null,
      });
      await world.db.applyInventory('beta', betaSameApp.id, [{
        provider_number_id: BETA_SAME_APP_PNID, phone_e164: BETA_SAME_APP_NUMBER, display_name: 'Beta', meta_status: 'CONNECTED',
        quality: 'GREEN', is_test: false, cm_channel_id: null,
      }], { allowTakeover: false });
      expect(betaSameApp.state).toBe('connected');
      const before = await world.db.getWhatsAppAccount('beta', betaSameApp.id);
      const write = vi.spyOn(world.db, 'markWhatsAppAccountWabaWebhookMissing');
      const res = await post({ entry: [
        accountUpdate(BETA_SAME_APP_WABA), qualityUpdate(BETA_SAME_APP_WABA), failedStatus(BETA_SAME_APP_WABA, BETA_SAME_APP_PNID, 131042),
        ...(metaBody([{ wabaId: BETA_SAME_APP_WABA, displayPhone: BETA_SAME_APP_NUMBER, phoneNumberId: BETA_SAME_APP_PNID, id: 'wamid.beta-meme-app' }]).entry as unknown[]),
      ] });
      expect(res.status).toBe(200);
      expect(await world.db.getWhatsAppAccount('beta', betaSameApp.id)).toEqual(before);
      expect(write).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
      expect(metaTexts(world.calls)).toEqual([]);
      expect(chatMock).not.toHaveBeenCalled();
      expect(await world.db.getSession(BETA_SAME_APP_NUMBER, CONTACT)).toBeUndefined();
      // Contrôle positif : le même lot pour le compte frère d'acme (même organisation, même app) est traité.
      await post({ entry: [accountUpdate(SIBLING_WABA)] });
      expect(refresh).toHaveBeenCalledWith('acme', sibling.id);
    });

    it("B déconnecté : ses événements reçus sur A sont ignorés, ses messages ne marquent rien", async () => {
      await setBotStatus(world.db, 'acme', 'soeur', 'paused');
      expect((await world.db.disconnectWhatsAppAccount('acme', sibling.id)).ok).toBe(true);
      await post({ entry: [accountUpdate(SIBLING_WABA), ...(metaBody([{ wabaId: SIBLING_WABA, displayPhone: SIBLING_NUMBER, phoneNumberId: SIBLING_PNID, id: 'wamid.b1' }]).entry as unknown[])] });
      expect(await alertsOf('acme', sibling.id)).toEqual([]);
      expect((await world.db.getWhatsAppAccount('acme', sibling.id))!.webhook_state).toBeNull();
      expect(metaTexts(world.calls)).toEqual([]);
    });
  });

  it('un statut failed et un message dans le même lot : le message est servi', async () => {
    const message = metaBody([acme({ id: 'wamid.m' })]).entry as unknown[];
    await post({ entry: [failedStatus(ACME_WABA, ACME_PNID, 131026), ...message] });
    expect(await failures()).toBe(1);
    expect(metaTexts(world.calls)).toHaveLength(1);
  });
});
