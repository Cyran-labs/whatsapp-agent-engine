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

import {
  ACME_APP_SECRET, ACME_NUMBER, ACME_PNID, ACME_TOKEN, ACME_CM_NUMBER, BETA_APP_SECRET, BETA_NUMBER, BETA_PNID, BETA_TOKEN, LLM_REPLY, SHARED_APP_SECRET,
  createWorld, sign,
} from './fixtures.js';
import { CONTACT, metaBody, metaTexts } from '../../test-support/whatsapp.js';
import type { World } from './fixtures.js';
import { MAX_MESSAGES_PER_WEBHOOK } from '../meta.js';
import { verifyMetaSignature } from '../meta-signature.js';

describe('POST /webhook/meta', () => {
  let world: World;

  beforeEach(async () => {
    chatMock.mockReset();
    chatMock.mockResolvedValue(JSON.stringify({ type: 'text', text: LLM_REPLY }));
    world = await createWorld();
  });

  afterEach(async () => {
    await world.close();
  });

  async function post(raw: string, signature?: string): Promise<request.Response> {
    const req = request(await serve(world.app)).post('/webhook/meta').set('Content-Type', 'application/json');
    if (signature !== undefined) req.set('x-hub-signature-256', signature);
    const res = await req.send(raw);
    await world.tracker.drain(10_000);
    return res;
  }

  async function expectNothingHappened(waNumber: string, messageId: string): Promise<void> {
    expect(chatMock).not.toHaveBeenCalled();
    expect(world.fetchMock).not.toHaveBeenCalled();
    expect(await world.db.getSession(waNumber, CONTACT)).toBeUndefined();
    expect(await world.db.getConversation(CONTACT, 'acme', 'ventes')).toHaveLength(0);
    // Dernière vérification (elle écrit) : le message n'a pas été réservé.
    expect(await world.db.claimMessage(`${waNumber}:${messageId}`, 300)).toBe(true);
  }

  // audit 4.2
  it('POST /webhook/meta sans signature : 401, ni base, ni LLM, ni envoi', async () => {
    const raw = JSON.stringify(metaBody([{ displayPhone: ACME_NUMBER, phoneNumberId: ACME_PNID, id: 'wamid.1' }]));
    const res = await post(raw);
    expect(res.status).toBe(401);
    await expectNothingHappened(ACME_NUMBER, 'wamid.1');
  });

  // audit 4.2
  it('sans corps brut (corps non JSON) : 401', async () => {
    const res = await request(await serve(world.app)).post('/webhook/meta')
      .set('Content-Type', 'text/plain').set('x-hub-signature-256', sign('x')).send('x');
    await world.tracker.drain(10_000);
    expect(res.status).toBe(401);
    expect(chatMock).not.toHaveBeenCalled();
    expect(world.fetchMock).not.toHaveBeenCalled();
  });

  // audit 4.2
  it('signature calculée avec un autre secret : rien', async () => {
    const raw = JSON.stringify(metaBody([{ displayPhone: ACME_NUMBER, phoneNumberId: ACME_PNID, id: 'wamid.2' }]));
    const res = await post(raw, sign(raw, 'autre-secret'));
    expect(res.status).toBe(200);
    await expectNothingHappened(ACME_NUMBER, 'wamid.2');
  });

  // audit 4.2
  it('signature sur les octets reçus : un corps re-sérialisé différemment est refusé', async () => {
    const spaced = JSON.stringify(metaBody([{ displayPhone: ACME_NUMBER, phoneNumberId: ACME_PNID, id: 'wamid.3', text: 'Café crème' }]), null, 2);
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
    expect(metaTexts(world.calls).map((t) => t.text)).toEqual([LLM_REPLY]);
  });

  // audit 1.5
  it("phone_number_id différent de celui des identifiants de l'agent IA : rien", async () => {
    const raw = JSON.stringify(metaBody([{ displayPhone: ACME_NUMBER, phoneNumberId: BETA_PNID, id: 'wamid.4' }]));
    const res = await post(raw, sign(raw));
    expect(res.status).toBe(200);
    await expectNothingHappened(ACME_NUMBER, 'wamid.4');
  });

  // audit 1.1
  it("lot avec un message pour ACME et un pour BETA, même secret d'app : chaque agent IA répond avec son propre jeton", async () => {
    await world.close();
    world = await createWorld({ sharedAppSecret: true });
    const raw = JSON.stringify(metaBody([
      { displayPhone: ACME_NUMBER, phoneNumberId: ACME_PNID, id: 'wamid.A' },
      { displayPhone: BETA_NUMBER, phoneNumberId: BETA_PNID, id: 'wamid.B' },
    ]));
    expect((await post(raw, sign(raw, SHARED_APP_SECRET))).status).toBe(200);
    const texts = metaTexts(world.calls);
    expect(texts).toHaveLength(2);
    expect(texts.filter((t) => t.phoneNumberId === ACME_PNID)).toEqual([
      { phoneNumberId: ACME_PNID, authorization: `Bearer ${ACME_TOKEN}`, to: CONTACT, text: LLM_REPLY },
    ]);
    expect(texts.filter((t) => t.phoneNumberId === BETA_PNID)).toEqual([
      { phoneNumberId: BETA_PNID, authorization: `Bearer ${BETA_TOKEN}`, to: CONTACT, text: LLM_REPLY },
    ]);
    // Aucun appel avec le jeton de l'autre organisation sur son identifiant de numéro.
    for (const call of world.calls) {
      if (call.url.includes(ACME_PNID)) expect(call.headers['Authorization']).toBe(`Bearer ${ACME_TOKEN}`);
      if (call.url.includes(BETA_PNID)) expect(call.headers['Authorization']).toBe(`Bearer ${BETA_TOKEN}`);
    }
    expect(await world.db.getSession(ACME_NUMBER, CONTACT)).toMatchObject({ client_id: 'acme', bot_id: 'ventes' });
    expect(await world.db.getSession(BETA_NUMBER, CONTACT)).toMatchObject({ client_id: 'beta', bot_id: 'accueil' });
  });

  // audit 4.1
  it("message pour le numéro d'un agent IA CM.com reçu sur /webhook/meta : rien", async () => {
    const raw = JSON.stringify(metaBody([{ displayPhone: ACME_CM_NUMBER, phoneNumberId: ACME_PNID, id: 'wamid.5' }]));
    expect((await post(raw, sign(raw))).status).toBe(200);
    expect(chatMock).not.toHaveBeenCalled();
    expect(world.fetchMock).not.toHaveBeenCalled();
    expect(await world.db.getSession(ACME_CM_NUMBER, CONTACT)).toBeUndefined();
  });

  it('numéro destinataire inconnu : rien', async () => {
    const raw = JSON.stringify(metaBody([{ displayPhone: '+33199999999', phoneNumberId: ACME_PNID, id: 'wamid.6' }]));
    expect((await post(raw, sign(raw))).status).toBe(200);
    expect(chatMock).not.toHaveBeenCalled();
    expect(world.fetchMock).not.toHaveBeenCalled();
  });

  // audit 4.2
  it("signature vérifiée une fois par agent IA et par requête, avec son propre secret ; après un échec, ses messages sont écartés sans nouvelle vérification", async () => {
    const verifySpy = vi.mocked(verifyMetaSignature);
    verifySpy.mockClear();

    // Lot mêlé signé avec le secret d'acme : acme répond à ses trois messages, beta est vérifié avec le sien et refusé.
    const raw = JSON.stringify(metaBody([
      { displayPhone: ACME_NUMBER, phoneNumberId: ACME_PNID, id: 'wamid.m1', from: '33600000011' },
      { displayPhone: ACME_NUMBER, phoneNumberId: ACME_PNID, id: 'wamid.m2', from: '33600000012' },
      { displayPhone: BETA_NUMBER, phoneNumberId: BETA_PNID, id: 'wamid.m3', from: '33600000013' },
      { displayPhone: ACME_NUMBER, phoneNumberId: ACME_PNID, id: 'wamid.m4', from: '33600000014' },
    ]));
    expect((await post(raw, sign(raw, ACME_APP_SECRET))).status).toBe(200);
    expect(verifySpy.mock.calls.map((c) => c[2])).toEqual([ACME_APP_SECRET, BETA_APP_SECRET]);
    expect(metaTexts(world.calls)).toHaveLength(3);
    expect(metaTexts(world.calls).every((t) => t.phoneNumberId === ACME_PNID)).toBe(true);

    // Même lot signé avec le secret de beta : beta répond, acme est refusé, chacun vérifié une seule fois.
    verifySpy.mockClear();
    world.calls.length = 0;
    chatMock.mockClear();
    const raw3 = JSON.stringify(metaBody([
      { displayPhone: BETA_NUMBER, phoneNumberId: BETA_PNID, id: 'wamid.q1', from: '33600000031' },
      { displayPhone: ACME_NUMBER, phoneNumberId: ACME_PNID, id: 'wamid.q2', from: '33600000032' },
      { displayPhone: BETA_NUMBER, phoneNumberId: BETA_PNID, id: 'wamid.q3', from: '33600000033' },
    ]));
    expect((await post(raw3, sign(raw3, BETA_APP_SECRET))).status).toBe(200);
    expect(verifySpy.mock.calls.map((c) => c[2])).toEqual([BETA_APP_SECRET, ACME_APP_SECRET]);
    const texts = metaTexts(world.calls);
    expect(texts).toHaveLength(2);
    expect(texts.every((t) => t.phoneNumberId === BETA_PNID)).toBe(true);

    // Signature fausse : une seule vérification pour les trois messages d'acme, rien d'autre.
    verifySpy.mockClear();
    world.calls.length = 0;
    chatMock.mockClear();
    const raw2 = JSON.stringify(metaBody([
      { displayPhone: ACME_NUMBER, phoneNumberId: ACME_PNID, id: 'wamid.n1', from: '33600000021' },
      { displayPhone: ACME_NUMBER, phoneNumberId: ACME_PNID, id: 'wamid.n2', from: '33600000022' },
      { displayPhone: ACME_NUMBER, phoneNumberId: ACME_PNID, id: 'wamid.n3', from: '33600000023' },
    ]));
    expect((await post(raw2, sign(raw2, 'mauvais'))).status).toBe(200);
    expect(verifySpy.mock.calls.map((c) => c[2])).toEqual([ACME_APP_SECRET]);
    expect(chatMock).not.toHaveBeenCalled();
    expect(world.calls).toHaveLength(0);
  });

  // audit 4.2
  it(`au plus ${MAX_MESSAGES_PER_WEBHOOK} messages traités par POST`, async () => {
    const specs = Array.from({ length: MAX_MESSAGES_PER_WEBHOOK + 10 }, (_, i) => ({
      displayPhone: ACME_NUMBER, phoneNumberId: ACME_PNID, id: `wamid.cap${i}`, from: `3360000${String(1000 + i)}`, type: 'audio',
    }));
    const raw = JSON.stringify(metaBody(specs));
    const warn = vi.spyOn(console, 'warn');
    expect((await post(raw, sign(raw))).status).toBe(200);
    expect(metaTexts(world.calls)).toHaveLength(MAX_MESSAGES_PER_WEBHOOK);
    expect(warn.mock.calls.some((args) => String(args[0]).includes('10 message(s) ignoré(s)'))).toBe(true);
    warn.mockRestore();
  });

  it("statuts et événements de compte : journal du nombre et du champ seulement, aucun effet", async () => {
    const raw = JSON.stringify({
      entry: [{
        id: 'waba-1',
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
    log.mockRestore();
  });

  // audit 4.2
  it('corps mal signé : aucune donnée de la requête dans les journaux (champ et identifiant piégés)', async () => {
    const trap = '\n[Server] faux';
    const body = metaBody([
      { displayPhone: ACME_NUMBER, phoneNumberId: ACME_PNID, id: `wamid.a${trap}` },
      { displayPhone: '+33199999999', phoneNumberId: ACME_PNID, id: `wamid.b${trap}` },
      { displayPhone: ACME_CM_NUMBER, phoneNumberId: ACME_PNID, id: `wamid.c${trap}` },
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
    }
    expect(args.some((a) => a.includes('(autre)'))).toBe(true);
    expect(chatMock).not.toHaveBeenCalled();
    expect(world.fetchMock).not.toHaveBeenCalled();
    for (const s of spies) s.mockRestore();
  });

  it("identifiant de message filtré dans les journaux après authentification", async () => {
    const raw = JSON.stringify(metaBody([{ displayPhone: ACME_NUMBER, phoneNumberId: BETA_PNID, id: 'wamid.z\n[Server] faux' }]));
    const warn = vi.spyOn(console, 'warn');
    expect((await post(raw, sign(raw))).status).toBe(200);
    const lines = warn.mock.calls.map((c) => c.map(String).join(' '));
    expect(lines.some((l) => l.includes('wamid.zServerfau'))).toBe(true);
    expect(lines.every((l) => !l.includes('\n') && !l.includes('[Server] faux'))).toBe(true);
    warn.mockRestore();
  });

  it("aucun journal du webhook ne contient l'identifiant du contact ni le texte du message", async () => {
    const spies = (['log', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m));
    const raw = JSON.stringify(metaBody([{ displayPhone: ACME_NUMBER, phoneNumberId: ACME_PNID, id: 'wamid.7', text: 'Texte confidentiel' }]));
    expect((await post(raw, sign(raw))).status).toBe(200);
    expect(metaTexts(world.calls)).toHaveLength(1);
    const lines = spies.flatMap((s) => s.mock.calls.map((args) => args.map(String).join(' ')))
      .filter((l) => l.startsWith('[Webhook') || l.startsWith('[Pipeline'));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(CONTACT);
      expect(line).not.toContain('Texte confidentiel');
    }
    for (const s of spies) s.mockRestore();
  });
});

describe('GET /webhook/meta', () => {
  let world: World;
  const previous = process.env['META_VERIFY_TOKEN'];

  beforeEach(async () => { world = await createWorld(); });
  afterEach(async () => {
    if (previous === undefined) delete process.env['META_VERIFY_TOKEN'];
    else process.env['META_VERIFY_TOKEN'] = previous;
    await world.close();
  });

  const query = { 'hub.mode': 'subscribe', 'hub.verify_token': 'jeton-verif', 'hub.challenge': '12345' };

  // audit 4.3
  it('GET /webhook/meta sans META_VERIFY_TOKEN configuré : 403', async () => {
    process.env['META_VERIFY_TOKEN'] = '';
    expect((await request(await serve(world.app)).get('/webhook/meta').query(query)).status).toBe(403);
    expect((await request(await serve(world.app)).get('/webhook/meta').query({ ...query, 'hub.verify_token': '' })).status).toBe(403);
  });

  // audit 4.3
  it('GET /webhook/meta jeton incorrect : 403', async () => {
    process.env['META_VERIFY_TOKEN'] = 'jeton-verif';
    expect((await request(await serve(world.app)).get('/webhook/meta').query({ ...query, 'hub.verify_token': 'jeton-verix' })).status).toBe(403);
    expect((await request(await serve(world.app)).get('/webhook/meta').query({ ...query, 'hub.verify_token': 'court' })).status).toBe(403);
    expect((await request(await serve(world.app)).get('/webhook/meta').query({ ...query, 'hub.mode': 'unsubscribe' })).status).toBe(403);
  });

  // audit 4.3
  it('GET /webhook/meta jeton correct : 200 text/plain avec le challenge', async () => {
    process.env['META_VERIFY_TOKEN'] = 'jeton-verif';
    const res = await request(await serve(world.app)).get('/webhook/meta').query(query);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.text).toBe('12345');
  });
});
