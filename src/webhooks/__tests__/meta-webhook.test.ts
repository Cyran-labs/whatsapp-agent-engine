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
import { CONTACT, createMetaAccount, createConnectedBot, metaBody, metaTexts, unservedCount } from '../../test-support/whatsapp.js';
import type { MetaMessageSpec } from '../../test-support/whatsapp.js';
import type { World } from './fixtures.js';
import { MAX_MESSAGES_PER_WEBHOOK } from '../meta.js';
import { verifyMetaSignature } from '../meta-signature.js';
import { decryptAccountSecrets } from '../../transport/index.js';
import { isSignatureRejected, SIGNATURE_REJECTION_THRESHOLD } from '../signature-monitor.js';

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
