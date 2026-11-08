import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseMetaWebhook } from '../meta-cloud.js';

interface MessageSpec {
  [key: string]: unknown;
}

function message(id: string | undefined, extra: MessageSpec): MessageSpec {
  const base: MessageSpec = { from: '33600000001', timestamp: '1731000000', type: 'text', text: { body: 'bonjour' } };
  if (id !== undefined) base.id = id;
  return { ...base, ...extra };
}

function change(display: string, phoneNumberId: string, messages: MessageSpec[], field = 'messages'): unknown {
  return {
    field,
    value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: display, phone_number_id: phoneNumberId },
      contacts: [{ profile: { name: 'Alice' }, wa_id: '33600000001' }],
      messages,
    },
  };
}

function payload(entries: unknown[]): unknown {
  return { object: 'whatsapp_business_account', entry: entries };
}

function single(msg: MessageSpec): unknown {
  return payload([{ id: 'WABA-1', changes: [change('+33 1 00 00 00 01', 'PNID-A', [msg])] }]);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('parseMetaWebhook', () => {
  // audit 5.1
  it('lit tous les messages de toutes les entrées et de tous les changements', () => {
    const body = payload([
      {
        id: 'WABA-A',
        changes: [
          change('+33 1 00 00 00 01', 'PNID-A', [message('wamid.A1', {}), message('wamid.A2', {})]),
        ],
      },
      {
        id: 'WABA-B',
        changes: [
          change('+33 1 00 00 00 02', 'PNID-B', [message('wamid.B1', {})]),
          change('+33 1 00 00 00 02', 'PNID-B', [message('wamid.B2', {})]),
        ],
      },
    ]);
    const batch = parseMetaWebhook(body);
    expect(batch.messages.map((m) => m.messageId)).toEqual(['wamid.A1', 'wamid.A2', 'wamid.B1', 'wamid.B2']);
    expect(batch.messages[2]).toMatchObject({ toNumber: '+33 1 00 00 00 02', recipientId: 'PNID-B' });
    expect(batch.messages[0]).toMatchObject({ toNumber: '+33 1 00 00 00 01', recipientId: 'PNID-A' });
  });

  it('sépare statuts et événements de compte', () => {
    const body = payload([
      {
        id: 'WABA-A',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '+33 1 00 00 00 01', phone_number_id: 'PNID-A' },
              statuses: [
                { id: 'wamid.S1', status: 'failed', recipient_id: '33600000001', errors: [{ code: 131026, title: 'Undeliverable' }] },
                { id: 'wamid.S2', status: 'delivered', recipient_id: '33600000002' },
              ],
            },
          },
          { field: 'account_update', value: { event: 'DISABLED_UPDATE' } },
        ],
      },
    ]);
    const batch = parseMetaWebhook(body);
    expect(batch.messages).toEqual([]);
    expect(batch.statuses).toEqual([
      { recipientId: 'PNID-A', status: 'failed', errorCodes: [131026] },
      { recipientId: 'PNID-A', status: 'delivered', errorCodes: [] },
    ]);
    expect(batch.accountEvents).toEqual([{ field: 'account_update', entryId: 'WABA-A' }]);
  });

  // audit 5.2
  it.each([
    ['sticker', { type: 'sticker', sticker: { id: 'S1', mime_type: 'image/webp' }, text: undefined }, 'unsupported'],
    ['location', { type: 'location', location: { latitude: 48.8, longitude: 2.3 }, text: undefined }, 'unsupported'],
    ['contacts', { type: 'contacts', contacts: [{ name: { formatted_name: 'Bob' } }], text: undefined }, 'unsupported'],
    ['unsupported', { type: 'unsupported', text: undefined }, 'unsupported'],
    ['un_type_futur', { type: 'un_type_futur', text: undefined }, 'unsupported'],
    ['reaction', { type: 'reaction', reaction: { message_id: 'wamid.X', emoji: '👍' }, text: undefined }, 'ignored'],
    ['button', { type: 'button', button: { text: 'Oui', payload: 'YES' }, text: undefined }, 'text'],
    ['text', { type: 'text' }, 'text'],
    ['audio', { type: 'audio', audio: { id: 'M1', mime_type: 'audio/ogg; codecs=opus' }, text: undefined }, 'audio'],
    ['image', { type: 'image', image: { id: 'M2', mime_type: 'image/jpeg' }, text: undefined }, 'media'],
    ['video', { type: 'video', video: { id: 'M3', mime_type: 'video/mp4' }, text: undefined }, 'media'],
    ['document', { type: 'document', document: { id: 'M4', mime_type: 'application/pdf' }, text: undefined }, 'media'],
  ])('type %s : %s', (type, extra, kind) => {
    const batch = parseMetaWebhook(single(message('wamid.T', extra)));
    expect(batch.messages).toHaveLength(1);
    expect(batch.messages[0].kind).toBe(kind);
    expect(batch.messages[0].providerType).toBe(type);
  });

  it('le texte est vide sauf pour text et order', () => {
    const sticker = parseMetaWebhook(single(message('wamid.T', { type: 'sticker', sticker: { id: 'S1' }, text: undefined })));
    expect(sticker.messages[0].text).toBe('');
    const image = parseMetaWebhook(single(message('wamid.T2', { type: 'image', image: { id: 'M2', mime_type: 'image/png' }, text: undefined })));
    expect(image.messages[0]).toMatchObject({ text: '', mediaUrl: 'M2', mediaType: 'image/png' });
  });

  it('réponse rapide de modèle (button) : le texte du bouton', () => {
    const batch = parseMetaWebhook(single(message('wamid.B', { type: 'button', button: { text: 'Oui', payload: 'YES' }, text: undefined })));
    expect(batch.messages[0]).toMatchObject({ kind: 'text', text: 'Oui' });
  });

  it('réponses interactives : titre du bouton ou de la liste', () => {
    const button = parseMetaWebhook(single(message('wamid.I1', {
      type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'b1', title: 'Option A' } }, text: undefined,
    })));
    expect(button.messages[0]).toMatchObject({ kind: 'text', text: 'Option A', providerType: 'interactive' });
    const list = parseMetaWebhook(single(message('wamid.I2', {
      type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'l1', title: 'Option B' } }, text: undefined,
    })));
    expect(list.messages[0]).toMatchObject({ kind: 'text', text: 'Option B' });
  });

  it('interactive sans titre lisible : non pris en charge', () => {
    const batch = parseMetaWebhook(single(message('wamid.I3', {
      type: 'interactive', interactive: { type: 'nfm_reply' }, text: undefined,
    })));
    expect(batch.messages[0].kind).toBe('unsupported');
  });

  it('commande de catalogue : kind order avec les articles', () => {
    const batch = parseMetaWebhook(single(message('wamid.O', {
      type: 'order',
      order: { catalog_id: 'CAT1', product_items: [{ product_retailer_id: 'SKU1', quantity: '2', item_price: '9.5', currency: 'EUR' }, { product_retailer_id: 'SKU2', quantity: 1, item_price: 3, currency: 'EUR' }] },
      text: undefined,
    })));
    expect(batch.messages[0]).toMatchObject({
      kind: 'order',
      text: '[ORDER_RECEIVED] 3 produit(s)',
      order: {
        catalog_id: 'CAT1',
        items: [
          { product_retailer_id: 'SKU1', quantity: 2, item_price: 9.5, currency: 'EUR' },
          { product_retailer_id: 'SKU2', quantity: 1, item_price: 3, currency: 'EUR' },
        ],
      },
    });
  });

  it("l'identifiant du contact est repris tel quel (un BSUID passe)", () => {
    const batch = parseMetaWebhook(single(message('wamid.U', { from: 'FR.13491208655302741918' })));
    expect(batch.messages[0].contactId).toBe('FR.13491208655302741918');
  });

  it('nom de profil : le contact correspondant, sinon le seul contact', () => {
    const body = payload([{
      id: 'WABA-A',
      changes: [{
        field: 'messages',
        value: {
          metadata: { display_phone_number: '+33 1 00 00 00 01', phone_number_id: 'PNID-A' },
          contacts: [
            { profile: { name: 'Alice' }, wa_id: '33600000001' },
            { profile: { name: 'Bob' }, wa_id: '33600000002' },
          ],
          messages: [message('wamid.P1', { from: '33600000002' }), message('wamid.P2', { from: '33600000009' })],
        },
      }],
    }]);
    const batch = parseMetaWebhook(body);
    expect(batch.messages[0].profileName).toBe('Bob');
    expect(batch.messages[1].profileName).toBeUndefined();
  });

  it('texte tronqué à 2000 caractères', () => {
    const batch = parseMetaWebhook(single(message('wamid.L', { text: { body: 'x'.repeat(3000) } })));
    expect(batch.messages[0].text).toHaveLength(2000);
  });

  it("horodatage ISO issu du timestamp Meta", () => {
    const batch = parseMetaWebhook(single(message('wamid.TS', { timestamp: '1731000000' })));
    expect(batch.messages[0].timestamp).toBe(new Date(1731000000 * 1000).toISOString());
  });

  it('message sans expéditeur : ignoré', () => {
    const batch = parseMetaWebhook(single(message('wamid.N', { from: undefined })));
    expect(batch.messages).toEqual([]);
  });

  // audit 2.3
  it("n'exige aucun identifiant : fonctionne sans aucune variable META_*", () => {
    vi.unstubAllEnvs();
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('META_')) vi.stubEnv(key, '');
    }
    const batch = parseMetaWebhook(single(message('wamid.E', {})));
    expect(batch.messages).toHaveLength(1);
    expect(batch.messages[0]).toMatchObject({ kind: 'text', text: 'bonjour', contactId: '33600000001' });
  });

  // audit 5.12
  it('identifiant de repli aléatoire et unique', () => {
    const batch = parseMetaWebhook(payload([{
      id: 'WABA-A',
      changes: [change('+33 1 00 00 00 01', 'PNID-A', [message(undefined, {}), message(undefined, {})])],
    }]));
    const [a, b] = batch.messages.map((m) => m.messageId);
    expect(a).toMatch(/^meta_[0-9a-f-]{36}$/);
    expect(b).toMatch(/^meta_[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
  });

  it.each([[null], [[]], ['texte'], [42], [undefined], [{}], [{ entry: 'x' }], [{ entry: [null, 3, { changes: 'x' }, { changes: [null, { value: 4 }] }] }]])(
    'corps invalide (%j) : lot vide, aucune exception',
    (body) => {
      expect(parseMetaWebhook(body)).toEqual({ messages: [], statuses: [], accountEvents: [] });
    },
  );

  it('un message mal formé ne bloque pas les suivants', () => {
    const body = payload([{
      id: 'WABA-A',
      changes: [change('+33 1 00 00 00 01', 'PNID-A', [null as unknown as MessageSpec, message('wamid.OK', {})])],
    }]);
    expect(parseMetaWebhook(body).messages.map((m) => m.messageId)).toEqual(['wamid.OK']);
  });

  // audit 5.1
  it('un horodatage démesuré ne fait pas perdre les messages suivants du lot', () => {
    const body = payload([{
      id: 'WABA-A',
      changes: [change('+33 1 00 00 00 01', 'PNID-A', [
        message('wamid.T1', {}),
        message('wamid.T2', { timestamp: '99999999999999999999' }),
        message('wamid.T3', {}),
      ])],
    }]);
    const batch = parseMetaWebhook(body);
    expect(batch.messages.map((m) => m.messageId)).toEqual(['wamid.T1', 'wamid.T2', 'wamid.T3']);
    const middle = batch.messages[1].timestamp;
    expect(new Date(middle).toISOString()).toBe(middle);
    expect(Math.abs(Date.now() - new Date(middle).getTime())).toBeLessThan(60_000);
  });

  it('un message de forme inattendue ne fait pas perdre les suivants', () => {
    const body = payload([{
      id: 'WABA-A',
      changes: [change('+33 1 00 00 00 01', 'PNID-A', [
        message('wamid.F1', { type: 'interactive', interactive: 42, text: undefined }),
        message('wamid.F2', { type: 'order', order: { product_items: 'x' }, text: undefined }),
        message('wamid.F3', {}),
      ])],
    }]);
    expect(parseMetaWebhook(body).messages.map((m) => m.messageId)).toEqual(['wamid.F1', 'wamid.F2', 'wamid.F3']);
  });
});
