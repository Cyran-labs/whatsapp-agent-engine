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

import {
  ACME_CM_KEY, ACME_CM_NUMBER, ACME_CM_TOKEN, ACME_META_KEY, BETA_CM_KEY, BETA_CM_NUMBER, BETA_CM_TOKEN, LLM_REPLY,
  createWorld,
} from './fixtures.js';
import { CONTACT, cmBody, cmRecipients, cmTexts } from '../../test-support/whatsapp.js';
import type { World } from './fixtures.js';

const ACME_PATH = `/webhook/cm-com/${ACME_CM_KEY}`;
// Numéro d'acme/cm au format CM.com (00 + chiffres).
const ACME_CM_TO = ACME_CM_NUMBER.replace('+', '00');

describe('POST /webhook/cm-com/:key', () => {
  let world: World;

  beforeEach(async () => {
    chatMock.mockReset();
    chatMock.mockResolvedValue(JSON.stringify({ type: 'text', text: LLM_REPLY }));
    world = await createWorld();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await world.close();
  });

  async function post(path: string, body: Record<string, unknown>): Promise<request.Response> {
    const res = await request(await serve(world.app)).post(path).send(body);
    await world.tracker.drain(10_000);
    return res;
  }

  async function expectNothingHappened(waNumber: string, messageId: string): Promise<void> {
    expect(chatMock).not.toHaveBeenCalled();
    expect(world.fetchMock).not.toHaveBeenCalled();
    expect(await world.db.getSession(waNumber, CONTACT)).toBeUndefined();
    expect(await world.db.claimMessage(`${waNumber}:${messageId}`, 300)).toBe(true);
  }

  // audit 4.1
  it('anciennes routes (sans clé, par organisation et agent IA) : 404', async () => {
    const body = cmBody({ to: ACME_CM_TO, id: 'cm-1' });
    expect((await post('/webhook/cm-com', body)).status).toBe(404);
    expect((await post('/webhook', body)).status).toBe(404);
    expect((await request(await serve(world.app)).get('/webhook')).status).toBe(404);
    expect((await request(await serve(world.app)).get('/webhook/cm-com')).status).toBe(404);
    expect((await post('/webhook/cm-com/acme/cm', body)).status).toBe(404);
    expect((await post(`/webhook/cm-com/acme/cm/${ACME_CM_KEY}`, body)).status).toBe(404);
    await expectNothingHappened(ACME_CM_NUMBER, 'cm-1');
  });

  // audit 4.1
  it('corps JSON invalide : 404 sur une clé inconnue, 400 seulement après la bonne clé', async () => {
    const server = await serve(world.app);
    const invalid = (path: string) => request(server).post(path).set('Content-Type', 'application/json').send('{"message":');
    expect((await invalid('/webhook/cm-com/mauvaise')).status).toBe(404);
    expect((await invalid(`/webhook/cm-com/${ACME_META_KEY}`)).status).toBe(404);
    expect((await invalid(ACME_PATH)).status).toBe(400);
    await world.tracker.drain(10_000);
    expect(world.fetchMock).not.toHaveBeenCalled();
  });

  // revue finale 2b-3 I-1
  it('corps JSON invalide après la bonne clé : le corps reçu (secret compris) n\'atteint aucun journal', async () => {
    const logs = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'log')];
    for (const spy of logs) spy.mockImplementation(() => undefined);
    const res = await request(await serve(world.app)).post(ACME_PATH).set('Content-Type', 'application/json').send('{"token":"SECRET-WEBHOOK-CM", ');
    expect(res.status).toBe(400);
    for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain('SECRET-WEBHOOK-CM');
    for (const spy of logs) spy.mockRestore();
  });

  // audit 4.1
  it("clé fausse, tronquée ou d'un compte Meta : 404, aucune écriture", async () => {
    const body = cmBody({ to: ACME_CM_TO, id: 'cm-2' });
    expect((await post(`${ACME_PATH}x`, body)).status).toBe(404);
    expect((await post(ACME_PATH.slice(0, -1), body)).status).toBe(404);
    expect((await post(`/webhook/cm-com/${ACME_META_KEY}`, body)).status).toBe(404);
    await expectNothingHappened(ACME_CM_NUMBER, 'cm-2');
  });

  // audit 4.1
  it('compte CM.com déconnecté : sa clé répond 404', async () => {
    expect((await world.db.transitionBotStatus('acme', 'cm', 'draft')).ok).toBe(true);
    expect(await world.db.disconnectWhatsAppAccount('acme', world.accounts.acmeCm.account.id)).toEqual({ ok: true });
    expect((await post(ACME_PATH, cmBody({ to: ACME_CM_TO, id: 'cm-dec' }))).status).toBe(404);
    await expectNothingHappened(ACME_CM_NUMBER, 'cm-dec');
  });

  // audit 4.1
  it("bonne clé : 200 et réponse avec le jeton produit du compte", async () => {
    const res = await post(ACME_PATH, cmBody({ to: ACME_CM_TO, id: 'cm-4' }));
    expect(res.status).toBe(200);
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(cmTexts(world.calls)).toEqual([{ productToken: ACME_CM_TOKEN, from: ACME_CM_NUMBER.slice(1), text: LLM_REPLY }]);
    expect(world.calls.every((c) => c.headers['X-CM-PRODUCTTOKEN'] !== BETA_CM_TOKEN)).toBe(true);
    expect(await world.db.getSession(ACME_CM_NUMBER, CONTACT)).toMatchObject({ client_id: 'acme', bot_id: 'cm' });
  });

  // D1, revue finale 2b-1 m8
  it("jeton produit refusé par CM.com (400, errorCode 103) : le compte passe en erreur (jeton), les messages suivants ne sont pas servis", async () => {
    world.fetchMock.mockImplementation(async (input: unknown, init?: { headers?: Record<string, string>; body?: unknown }) => {
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      world.calls.push({ url: String(input), headers: { ...(init?.headers ?? {}) }, body });
      return { ok: false, status: 400, text: async () => '{"details":"Invalid product token.","errorCode":103}' };
    });
    const res = await post(ACME_PATH, cmBody({ to: ACME_CM_TO, id: 'cm-103' }));
    expect(res.status).toBe(200);
    expect(chatMock).toHaveBeenCalledTimes(1);
    const account = await world.db.getWhatsAppAccount('acme', world.accounts.acmeCm.account.id);
    expect(account).toMatchObject({ state: 'error', error_reason: 'token_invalid', error_detail: 'Jeton refusé par le fournisseur WhatsApp.' });

    await post(ACME_PATH, cmBody({ to: ACME_CM_TO, id: 'cm-104' }));
    expect(chatMock).toHaveBeenCalledTimes(1);
  });

  // audit 1.1
  it("message vers le numéro de beta reçu sur l'URL du compte CM.com d'acme : rien", async () => {
    const res = await post(ACME_PATH, cmBody({ to: BETA_CM_NUMBER.replace('+', '00'), id: 'cm-5' }));
    expect(res.status).toBe(200);
    await expectNothingHappened(BETA_CM_NUMBER, 'cm-5');
    expect(await world.db.getSession(ACME_CM_NUMBER, CONTACT)).toBeUndefined();
  });

  // audit 1.1
  it("message vers le numéro d'acme reçu sur l'URL du compte CM.com de beta : rien", async () => {
    const res = await post(`/webhook/cm-com/${BETA_CM_KEY}`, cmBody({ to: ACME_CM_TO, id: 'cm-6' }));
    expect(res.status).toBe(200);
    await expectNothingHappened(ACME_CM_NUMBER, 'cm-6');
  });

  // audit 5.13
  it('horodatage CM.com illisible : traité comme reçu maintenant', async () => {
    const res = await post(ACME_PATH, cmBody({ to: ACME_CM_TO, id: 'cm-7', timeUtc: 'pas-une-date' }));
    expect(res.status).toBe(200);
    expect(chatMock).toHaveBeenCalledTimes(1);
  });

  // revue finale 2b-1 m13
  it('deux réponses au même message cité, deux `reference` différentes : deux messages traités', async () => {
    await post(ACME_PATH, cmBody({ to: ACME_CM_TO, id: 'ref-1', quoted: 'wamid.cite', text: 'Premier' }));
    await post(ACME_PATH, cmBody({ to: ACME_CM_TO, id: 'ref-2', quoted: 'wamid.cite', text: 'Second' }));
    expect(chatMock).toHaveBeenCalledTimes(2);
    expect(cmTexts(world.calls)).toHaveLength(2);
    expect(await world.db.claimMessage(`${ACME_CM_NUMBER}:ref-1`, 0)).toBe(false);
    expect(await world.db.claimMessage(`${ACME_CM_NUMBER}:ref-2`, 0)).toBe(false);
  });

  // revue finale 2b-1 m13
  it('même `reference` relivrée : un seul traitement', async () => {
    await post(ACME_PATH, cmBody({ to: ACME_CM_TO, id: 'ref-3' }));
    await post(ACME_PATH, cmBody({ to: ACME_CM_TO, id: 'ref-3', quoted: 'wamid.autre' }));
    expect(chatMock).toHaveBeenCalledTimes(1);
  });

  // BSUID entrant (tâche 0)
  it('contact BSUID (from.whatsapp.user_id seul) : servi, identifiant opaque conservé, réponse à ce BSUID', async () => {
    const res = await post(ACME_PATH, cmBody({ to: ACME_CM_TO, id: 'cm-bsuid', fromUserId: 'NL.84827364598365' }));
    expect(res.status).toBe(200);
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(cmRecipients(world.calls)).toEqual(['NL.84827364598365']);
    expect(await world.db.getSession(ACME_CM_NUMBER, 'NL.84827364598365')).toMatchObject({ client_id: 'acme', bot_id: 'cm' });
  });

  // BSUID entrant (tâche 0) : un numéro masqué arrive dans from.number sous forme de BSUID.
  it('BSUID dans from.number : gardé tel quel (pas réduit à ses chiffres)', async () => {
    const res = await post(ACME_PATH, cmBody({ to: ACME_CM_TO, id: 'cm-bsuid2', from: 'NL.84827364598365', fromUserId: 'NL.84827364598365' }));
    expect(res.status).toBe(200);
    expect(cmRecipients(world.calls)).toEqual(['NL.84827364598365']);
    expect(await world.db.getSession(ACME_CM_NUMBER, 'NL.84827364598365')).toBeDefined();
    expect(await world.db.getSession(ACME_CM_NUMBER, '84827364598365')).toBeUndefined();
  });
});
