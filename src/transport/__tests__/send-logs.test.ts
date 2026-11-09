import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMetaCloudTransport } from '../meta-cloud.js';
import { createCmComTransport } from '../cm-com.js';
import { parseAllResponses } from '../../core/handler.js';

const CONTACT = '33611111111';
const MESSAGE = 'Bonjour Claire Bernard, voici votre confirmation';

function response(status: number, body: string): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => body } as unknown as Response;
}

let written: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  written = [];
  for (const method of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      written.push(args.map((a) => String(a)).join(' '));
    });
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function expectNothingPersonal(): void {
  const all = written.join('\n');
  expect(all).not.toContain(CONTACT);
  expect(all).not.toContain('Claire');
  expect(all).not.toContain('confirmation');
  expect(all).not.toContain('tok-secret');
}

// recette Q-11
describe('journaux des envois Meta', () => {
  const t = (): ReturnType<typeof createMetaCloudTransport> => createMetaCloudTransport({ phoneNumberId: '123', accessToken: 'tok-secret' });

  it('envoi réussi : seulement le statut, ni le numéro (wa_id) ni le corps de la réponse', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      response(200, `{"contacts":[{"input":"${CONTACT}","wa_id":"${CONTACT}"}],"messages":[{"id":"wamid.1"}]}`),
    ));
    await t().sendText(CONTACT, MESSAGE);
    expect(written).toContain('[MetaCloud] Message envoyé (200)');
    expectNothingPersonal();
  });

  it('envoi refusé : statut, nature et code, jamais le corps de la réponse', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      response(400, `{"error":{"code":100,"message":"Recipient ${CONTACT} invalide, ${MESSAGE}"}}`),
    ));
    await t().sendText(CONTACT, MESSAGE).catch(() => undefined);
    expect(written).toContain('[MetaCloud] Send failed: 400 (other, code 100)');
    expectNothingPersonal();
  });

  it('accusé de lecture refusé : statut seulement', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(400, `{"error":{"message":"${CONTACT}"}}`)));
    await t().sendReadReceipt?.('wamid.9');
    expect(written).toContain('[MetaCloud] read receipt failed 400');
    expectNothingPersonal();
  });

  it('erreur réseau pendant l\'accusé de lecture : message d\'erreur, pas l\'objet', async () => {
    const error = Object.assign(new Error('socket hang up'), { config: { headers: { Authorization: 'Bearer tok-secret' } } });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
    await t().sendReadReceipt?.('wamid.9');
    expect(written).toContain('[MetaCloud] read receipt error: socket hang up');
    expectNothingPersonal();
  });
});

// recette Q-11
describe('journaux des envois CM.com', () => {
  const t = (): ReturnType<typeof createCmComTransport> => createCmComTransport({ productToken: 'cm-secret', fromNumber: '33600000000' });

  it('envoi réussi : seulement le statut, jamais le corps de la réponse', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(200, `{"to":"${CONTACT}","body":"${MESSAGE}"}`)));
    await t().sendText(CONTACT, MESSAGE);
    expect(written).toContain('[CmCom] Message envoyé (200)');
    expect(written.join('\n')).not.toContain('cm-secret');
    expectNothingPersonal();
  });

  it('envoi refusé : statut, nature et code, jamais le corps de la réponse', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(400, `{"details":"${CONTACT} ${MESSAGE}","errorCode":7}`)));
    await t().sendText(CONTACT, MESSAGE).catch(() => undefined);
    expect(written).toContain('[CmCom] Send failed: 400 (other, code 7)');
    expectNothingPersonal();
  });
});

// recette Q-11
describe('réponse du modèle en texte simple', () => {
  it('est envoyée telle quelle et n\'écrit aucun journal, contenu compris', () => {
    const reply = 'Bonjour Claire, votre rendez-vous est confirmé.';
    expect(parseAllResponses(reply)).toEqual([{ type: 'text', text: reply }]);
    expect(written).toEqual([]);
  });
});
