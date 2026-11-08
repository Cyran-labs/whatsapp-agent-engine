import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMetaCloudTransport, toMetaNumber } from '../meta-cloud.js';
import { createCmComTransport, toCmNumber, CM_SEND_URL } from '../cm-com.js';

const BSUID = 'FR.abc123';

interface Sent { url: string; body: Record<string, unknown>; }
let sent: Sent[];

beforeEach(() => {
  sent = [];
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
    sent.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
    return { ok: true, status: 200, text: async () => '{}' } as unknown as Response;
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('normalisation des destinataires', () => {
  it('un BSUID passe inchangé, un numéro est normalisé comme avant', () => {
    expect(toMetaNumber(BSUID)).toBe(BSUID);
    expect(toCmNumber(BSUID)).toBe(BSUID);
    expect(toMetaNumber('+33 6 12 34 56 78')).toBe('33612345678');
    expect(toCmNumber('+33612345678')).toBe('0033612345678');
  });
});

describe('envoi Meta vers un BSUID', () => {
  const meta = (): ReturnType<typeof createMetaCloudTransport> => createMetaCloudTransport({ phoneNumberId: '123', accessToken: 'tok' });

  it('texte vers un BSUID : recipient et pas de to', async () => {
    await meta().sendText(BSUID, 'x');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body['recipient']).toBe(BSUID);
    expect('to' in sent[0]!.body).toBe(false);
    expect(sent[0]!.body['type']).toBe('text');
  });

  it('texte vers un numéro : to comme avant, pas de recipient', async () => {
    await meta().sendText('33612345678', 'x');
    expect(sent[0]!.body['to']).toBe('33612345678');
    expect('recipient' in sent[0]!.body).toBe(false);
  });

  it('tous les envois qui construisent un destinataire respectent la règle', async () => {
    const t = meta();
    const calls: Array<(to: string) => Promise<void>> = [
      (to) => t.sendText(to, 'x'),
      (to) => t.sendImage(to, 'https://example.test/i.png', 'c'),
      (to) => t.sendButtons(to, 'x', [{ id: 'a', title: 'A' }]),
      (to) => t.sendList(to, 'x', 'Choisir', [{ title: 'S', options: ['o'] }]),
      (to) => t.sendImageButtons(to, 'https://example.test/i.png', 'x', [{ id: 'a', title: 'A' }]),
      (to) => t.sendCta(to, 'x', 'Voir', 'https://example.test'),
      (to) => t.sendCatalog(to, 'x'),
      (to) => t.sendProduct(to, 'x', 'cat', 'p1'),
      (to) => t.sendProductList(to, 'x', 'h', 'cat', [{ title: 'S', product_retailer_ids: ['p1'] }]),
    ];
    for (const send of calls) await send(BSUID);
    for (const send of calls) await send('33612345678');
    expect(sent).toHaveLength(calls.length * 2);
    for (const s of sent.slice(0, calls.length)) {
      expect(s.body['recipient']).toBe(BSUID);
      expect('to' in s.body).toBe(false);
    }
    for (const s of sent.slice(calls.length)) {
      expect(s.body['to']).toBe('33612345678');
      expect('recipient' in s.body).toBe(false);
    }
  });
});

describe('envoi CM.com vers un BSUID', () => {
  // Doc CM.com : le BSUID se place dans to.number, sans to.whatsapp.user_id.
  it('texte vers un BSUID : to = [{ number: BSUID }] seul', async () => {
    await createCmComTransport({ productToken: 'cm-tok', fromNumber: '33600000000' }).sendText(BSUID, 'x');
    expect(sent[0]!.url).toBe(CM_SEND_URL);
    const msg = (sent[0]!.body['messages'] as { msg: Array<Record<string, unknown>> }).msg[0]!;
    expect(msg['to']).toEqual([{ number: BSUID }]);
  });

  it('texte vers un numéro : format 00 comme avant', async () => {
    await createCmComTransport({ productToken: 'cm-tok', fromNumber: '33600000000' }).sendText('+33612345678', 'x');
    const msg = (sent[0]!.body['messages'] as { msg: Array<Record<string, unknown>> }).msg[0]!;
    expect(msg['to']).toEqual([{ number: '0033612345678' }]);
  });
});
