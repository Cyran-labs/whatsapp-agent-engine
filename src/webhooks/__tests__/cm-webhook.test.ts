import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const chatMock = vi.hoisted(() => vi.fn());

vi.mock('../../llm/anthropic.js', () => ({
  chat: chatMock,
  withRetry: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getClientForTenant: vi.fn(async () => ({
    messages: { create: vi.fn(async () => ({ content: [{ type: 'text', text: '{}' }] })) },
  })),
}));

import {
  ACME_CM_NUMBER, ACME_CM_TOKEN, BETA_CM_NUMBER, BETA_CM_TOKEN, CONTACT, LLM_REPLY,
  cmBody, cmTexts, createWorld,
} from './fixtures.js';
import type { World } from './fixtures.js';

describe('POST /webhook/cm-com/:clientId/:botId/:secret', () => {
  let world: World;

  beforeEach(async () => {
    chatMock.mockReset();
    chatMock.mockResolvedValue(JSON.stringify({ type: 'text', text: LLM_REPLY }));
    world = await createWorld();
  });

  afterEach(async () => {
    await world.close();
  });

  async function post(path: string, body: Record<string, unknown>): Promise<request.Response> {
    const res = await request(world.app).post(path).send(body);
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
  it('POST /webhook/cm-com sans secret, POST /webhook : 404', async () => {
    const body = cmBody({ to: '0033100000003', id: 'cm-1' });
    expect((await post('/webhook/cm-com', body)).status).toBe(404);
    expect((await post('/webhook', body)).status).toBe(404);
    expect((await request(world.app).get('/webhook')).status).toBe(404);
    expect((await request(world.app).get('/webhook/cm-com')).status).toBe(404);
    expect((await post('/webhook/cm-com/acme/cm', body)).status).toBe(404);
    await expectNothingHappened(ACME_CM_NUMBER, 'cm-1');
  });

  // audit 4.1
  it('URL CM.com avec un mauvais secret : 404, aucune écriture', async () => {
    const secret = await world.cmSecret('acme', 'cm');
    const body = cmBody({ to: '0033100000003', id: 'cm-2' });
    expect((await post(`/webhook/cm-com/acme/cm/${secret}x`, body)).status).toBe(404);
    expect((await post(`/webhook/cm-com/acme/cm/${secret.slice(0, -1)}`, body)).status).toBe(404);
    // Secret d'un autre agent IA CM.com : refusé aussi.
    expect((await post(`/webhook/cm-com/acme/cm/${await world.cmSecret('beta', 'cm')}`, body)).status).toBe(404);
    await expectNothingHappened(ACME_CM_NUMBER, 'cm-2');
  });

  // audit 4.1
  it('agent IA inconnu ou de transport Meta : 404', async () => {
    const secret = await world.cmSecret('acme', 'cm');
    const body = cmBody({ to: '0033100000003', id: 'cm-3' });
    expect((await post(`/webhook/cm-com/acme/inconnu/${secret}`, body)).status).toBe(404);
    expect((await post(`/webhook/cm-com/acme/ventes/${secret}`, body)).status).toBe(404);
    expect((await post(`/webhook/cm-com/beta/cm/${secret}`, body)).status).toBe(404);
    await expectNothingHappened(ACME_CM_NUMBER, 'cm-3');
  });

  // audit 4.1
  it("bon secret : 200 et réponse avec le jeton produit de l'agent IA", async () => {
    const secret = await world.cmSecret('acme', 'cm');
    const res = await post(`/webhook/cm-com/acme/cm/${secret}`, cmBody({ to: '0033100000003', id: 'cm-4' }));
    expect(res.status).toBe(200);
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(cmTexts(world.calls)).toEqual([{ productToken: ACME_CM_TOKEN, from: '0033100000003', text: LLM_REPLY }]);
    expect(world.calls.every((c) => c.headers['X-CM-PRODUCTTOKEN'] !== BETA_CM_TOKEN)).toBe(true);
    expect(await world.db.getSession(ACME_CM_NUMBER, CONTACT)).toMatchObject({ client_id: 'acme', bot_id: 'cm' });
  });

  // audit 1.1
  it("message vers le numéro de l'agent IA B reçu sur l'URL CM.com de l'agent IA A : rien", async () => {
    const secret = await world.cmSecret('acme', 'cm');
    const res = await post(`/webhook/cm-com/acme/cm/${secret}`, cmBody({ to: '0033100000004', id: 'cm-5' }));
    expect(res.status).toBe(200);
    await expectNothingHappened(BETA_CM_NUMBER, 'cm-5');
    expect(await world.db.getSession(ACME_CM_NUMBER, CONTACT)).toBeUndefined();
  });

  // audit 5.13
  it('horodatage CM.com illisible : traité comme reçu maintenant', async () => {
    const secret = await world.cmSecret('acme', 'cm');
    const res = await post(`/webhook/cm-com/acme/cm/${secret}`, cmBody({ to: '0033100000003', id: 'cm-6', timeUtc: 'pas-une-date' }));
    expect(res.status).toBe(200);
    expect(chatMock).toHaveBeenCalledTimes(1);
  });
});
