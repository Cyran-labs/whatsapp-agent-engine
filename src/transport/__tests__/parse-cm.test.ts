import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCmWebhook } from '../cm-com.js';

function payload(message: unknown, extra: Record<string, unknown> = {}): unknown {
  return {
    reference: 'ref-1',
    messageContext: 'ctx-1',
    from: { number: '0033600000001', name: 'Alice' },
    to: { number: '0033100000001' },
    channel: 'WhatsApp',
    timeUtc: '2026-11-08T10:00:00Z',
    message,
    ...extra,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('parseCmWebhook', () => {
  it('texte', () => {
    const msg = parseCmWebhook(payload({ text: 'bonjour' }));
    expect(msg).toMatchObject({
      contactId: '33600000001',
      toNumber: '0033100000001',
      kind: 'text',
      providerType: 'text',
      text: 'bonjour',
      // revue finale 2b-1 m13 : `reference` (message entrant), jamais `messageContext` (message cité).
      messageId: 'ref-1',
      timestamp: '2026-11-08T10:00:00Z',
      profileName: 'Alice',
    });
    expect(msg?.recipientId).toBeUndefined();
  });

  it('texte tronqué à 2000 caractères', () => {
    expect(parseCmWebhook(payload({ text: 'x'.repeat(3000) }))?.text).toHaveLength(2000);
  });

  it('interactif : titre du bouton ou de la liste', () => {
    const button = parseCmWebhook(payload({ custom: { interactive: { type: 'button_reply', button_reply: { id: 'b', title: 'Option A' } } } }));
    expect(button).toMatchObject({ kind: 'text', text: 'Option A', providerType: 'interactive' });
    const list = parseCmWebhook(payload({ custom: { interactive: { type: 'list_reply', list_reply: { id: 'l', title: 'Option B' } } } }));
    expect(list).toMatchObject({ kind: 'text', text: 'Option B' });
  });

  it('média audio', () => {
    const msg = parseCmWebhook(payload({ media: { mediaUri: 'https://cm.example/a.ogg', contentType: 'audio/ogg' } }));
    expect(msg).toMatchObject({ kind: 'audio', text: '', mediaUrl: 'https://cm.example/a.ogg', mediaType: 'audio/ogg', providerType: 'audio/ogg' });
  });

  it('média image', () => {
    const msg = parseCmWebhook(payload({ media: { mediaUri: 'https://cm.example/i.png', contentType: 'image/png' } }));
    expect(msg).toMatchObject({ kind: 'media', text: '', mediaUrl: 'https://cm.example/i.png', mediaType: 'image/png' });
  });

  it('commande de catalogue', () => {
    const msg = parseCmWebhook(payload({
      custom: { order: { catalog_id: 'CAT1', product_items: [{ product_retailer_id: 'SKU1', quantity: '2', item_price: '4.5', currency: 'EUR' }] } },
    }));
    expect(msg).toMatchObject({
      kind: 'order',
      providerType: 'order',
      text: '[ORDER_RECEIVED] 2 produit(s)',
      order: { catalog_id: 'CAT1', items: [{ product_retailer_id: 'SKU1', quantity: 2, item_price: 4.5, currency: 'EUR' }] },
    });
  });

  it('contenu inconnu : non pris en charge', () => {
    const msg = parseCmWebhook(payload({ custom: { message_type: 'location' } }));
    expect(msg).toMatchObject({ kind: 'unsupported', providerType: 'location', text: '' });
  });

  it('absence de from.number et de from.whatsapp.user_id : null', () => {
    expect(parseCmWebhook(payload({ text: 'x' }, { from: {} }))).toBeNull();
    expect(parseCmWebhook(payload({ text: 'x' }, { from: undefined }))).toBeNull();
    expect(parseCmWebhook(payload({ text: 'x' }, { from: { number: '', whatsapp: { user_id: '' } } }))).toBeNull();
  });

  // BSUID entrant (tâche 0 du lot 2b-2)
  it('BSUID dans from.number (numéro masqué) : gardé tel quel, pas réduit à ses chiffres', () => {
    const msg = parseCmWebhook(payload({ text: 'x' }, { from: { number: 'NL.84827364598365', whatsapp: { user_id: 'NL.84827364598365' } } }));
    expect(msg?.contactId).toBe('NL.84827364598365');
  });

  // BSUID entrant (tâche 0 du lot 2b-2)
  it('from.number absent : from.whatsapp.user_id', () => {
    const msg = parseCmWebhook(payload({ text: 'x' }, { from: { whatsapp: { user_id: 'FR.abc123' } } }));
    expect(msg?.contactId).toBe('FR.abc123');
  });

  it('from.number présent : il prime sur from.whatsapp.user_id', () => {
    const msg = parseCmWebhook(payload({ text: 'x' }, { from: { number: '0033600000001', whatsapp: { user_id: 'FR.abc123' } } }));
    expect(msg?.contactId).toBe('33600000001');
  });

  // revue finale 2b-1 m13
  it('messageContext sans reference : identifiant de repli, jamais la référence du message cité', () => {
    const a = parseCmWebhook(payload({ text: 'a' }, { reference: undefined, messageContext: 'wamid.cite' }));
    const b = parseCmWebhook(payload({ text: 'b' }, { reference: undefined, messageContext: 'wamid.cite' }));
    expect(a?.messageId).toMatch(/^cm_[0-9a-f-]{36}$/);
    expect(a?.messageId).not.toBe(b?.messageId);
  });

  it('absence de message : null', () => {
    expect(parseCmWebhook(payload(undefined))).toBeNull();
  });

  // audit 2.3
  it("n'exige aucun identifiant : fonctionne sans aucune variable CM_*", () => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('CM_')) vi.stubEnv(key, '');
    }
    expect(parseCmWebhook(payload({ text: 'bonjour' }))?.kind).toBe('text');
  });

  // audit 5.12
  it('identifiant de repli aléatoire et unique', () => {
    const a = parseCmWebhook(payload({ text: 'a' }, { reference: undefined, messageContext: undefined }));
    const b = parseCmWebhook(payload({ text: 'b' }, { reference: undefined, messageContext: undefined }));
    expect(a?.messageId).toMatch(/^cm_[0-9a-f-]{36}$/);
    expect(b?.messageId).toMatch(/^cm_[0-9a-f-]{36}$/);
    expect(a?.messageId).not.toBe(b?.messageId);
  });

  it.each([[null], [[]], ['texte'], [42], [undefined]])('corps invalide (%j) : null, aucune exception', (body) => {
    expect(parseCmWebhook(body)).toBeNull();
  });
});
