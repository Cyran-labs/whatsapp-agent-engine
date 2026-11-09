import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMetaCloudTransport, classifyMetaError } from '../meta-cloud.js';
import { createCmComTransport, classifyCmError, CM_SEND_URL } from '../cm-com.js';
import { TransportSendError } from '../types.js';

const metaOpts = { phoneNumberId: '123', accessToken: 'tok-secret' };
const cmOpts = { productToken: 'cm-secret', fromNumber: '33600000000' };

function response(status: number, body: string): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => body } as unknown as Response;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('classifyMetaError', () => {
  // audit 5.9
  it.each([
    [401, '{"error":{"code":190}}', 'auth'],
    [401, '', 'auth'],
    [400, '{"error":{"code":190}}', 'auth'],
    [400, '{"error":{"code":131047}}', 'window_closed'],
    [400, '{"error":{"code":130429}}', 'transient'],
    [400, '{"error":{"code":131056}}', 'transient'],
    [429, '{}', 'transient'],
    [503, '', 'transient'],
    [400, '{"error":{"code":100}}', 'other'],
    [400, 'pas du json', 'other'],
  ])('Meta %i %s : %s', (status, body, kind) => {
    expect(classifyMetaError(status, body)).toBe(kind);
  });
});

describe('classifyCmError', () => {
  // audit 5.9
  it.each([
    [401, '', 'auth'],
    [403, 'forbidden', 'auth'],
    [429, '', 'transient'],
    [500, '', 'transient'],
    [502, '', 'transient'],
    [400, '', 'other'],
    [404, '', 'other'],
    // D1 : CM.com répond 400 avec errorCode 103 pour un jeton produit invalide.
    [400, '{"details":"Invalid product token.","errorCode":103}', 'auth'],
    [200, '{"errorCode":103}', 'auth'],
    // Un code d'authentification l'emporte sur un statut 5xx.
    [503, '{"details":"Invalid product token.","errorCode":103}', 'auth'],
    [400, 'pas du json', 'other'],
    [400, '{"details":"tronqué","errorCo', 'other'],
    [400, '{"errorCode":"103"}', 'other'],
    [400, '{"errorCode":999}', 'other'],
    [400, 'null', 'other'],
    [503, 'pas du json', 'transient'],
  ])('CM %i %s : %s', (status, body, kind) => {
    expect(classifyCmError(status, body)).toBe(kind);
  });
});

describe('envoi Meta', () => {
  // audit 5.9
  it("jeton refusé : une seule tentative, TransportSendError('auth')", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(401, '{"error":{"code":190}}'));
    vi.stubGlobal('fetch', fetchMock);
    const t = createMetaCloudTransport(metaOpts);
    const err = await t.sendText('33611111111', 'salut').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportSendError);
    expect((err as TransportSendError).kind).toBe('auth');
    expect((err as TransportSendError).status).toBe(401);
    expect((err as TransportSendError).code).toBe(190);
    expect((err as TransportSendError).message).toBe('[MetaCloud] 401 (code 190)');
    expect((err as TransportSendError).message).not.toContain('tok-secret');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // audit 5.9
  it("HTTP 503 avec code 190 : auth, une seule tentative", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(503, '{"error":{"code":190}}'));
    vi.stubGlobal('fetch', fetchMock);
    const t = createMetaCloudTransport(metaOpts);
    const err = await t.sendText('33611111111', 'salut').catch((e: unknown) => e);
    expect((err as TransportSendError).kind).toBe('auth');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // audit 5.9
  it('code 131056 : réessayé puis succès', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(400, '{"error":{"code":131056}}'))
      .mockResolvedValueOnce(response(200, '{}'));
    vi.stubGlobal('fetch', fetchMock);
    const t = createMetaCloudTransport(metaOpts);
    const p = t.sendText('33611111111', 'salut');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // audit 5.9
  it("fenêtre fermée : une seule tentative, TransportSendError('window_closed')", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(400, '{"error":{"code":131047}}'));
    vi.stubGlobal('fetch', fetchMock);
    const t = createMetaCloudTransport(metaOpts);
    const err = await t.sendText('33611111111', 'salut').catch((e: unknown) => e);
    expect((err as TransportSendError).kind).toBe('window_closed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // audit 5.9
  it("erreur 'other' : une seule tentative", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(400, '{"error":{"code":100}}'));
    vi.stubGlobal('fetch', fetchMock);
    const t = createMetaCloudTransport(metaOpts);
    const err = await t.sendText('33611111111', 'salut').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportSendError);
    expect((err as TransportSendError).kind).toBe('other');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // audit 5.9
  it('erreur réseau puis succès : réussi en 2 appels', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(response(200, '{"messages":[{"id":"wamid.1"}]}'));
    vi.stubGlobal('fetch', fetchMock);
    const t = createMetaCloudTransport(metaOpts);
    const p = t.sendText('33611111111', 'salut');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // audit 5.9
  it("erreur transitoire persistante : 3 appels puis TransportSendError('transient')", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(503, 'indisponible'));
    vi.stubGlobal('fetch', fetchMock);
    const t = createMetaCloudTransport(metaOpts);
    const assertion = expect(t.sendText('33611111111', 'salut')).rejects.toMatchObject({
      name: 'TransportSendError', kind: 'transient', status: 503,
    });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // audit 5.9
  it("erreur réseau persistante : TransportSendError('transient') sans statut", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    vi.stubGlobal('fetch', fetchMock);
    const t = createMetaCloudTransport(metaOpts);
    const assertion = expect(t.sendText('33611111111', 'salut')).rejects.toMatchObject({
      kind: 'transient', status: undefined,
    });
    await vi.advanceTimersByTimeAsync(4000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // audit 5.14
  it('URL Graph construite avec META_GRAPH_VERSION', async () => {
    vi.stubEnv('META_GRAPH_VERSION', 'v99.0');
    const fetchMock = vi.fn().mockResolvedValue(response(200, '{}'));
    vi.stubGlobal('fetch', fetchMock);
    const t = createMetaCloudTransport(metaOpts);
    await t.sendText('33611111111', 'salut');
    await t.sendReadReceipt('wamid.x');
    await t.sendTypingIndicator('33611111111', 'wamid.x');
    await t.validateCredentials!();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).toContain('/v99.0/');
    }
  });

  // audit 5.14
  it('version Graph lue à l\'appel : changement après création du transport pris en compte', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, '{}'));
    vi.stubGlobal('fetch', fetchMock);
    const t = createMetaCloudTransport(metaOpts);
    vi.stubEnv('META_GRAPH_VERSION', 'v98.0');
    await t.sendText('33611111111', 'salut');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v98.0/');
  });

  // audit 5.14
  it('sans META_GRAPH_VERSION : version par défaut v26.0', async () => {
    vi.stubEnv('META_GRAPH_VERSION', '');
    const fetchMock = vi.fn().mockResolvedValue(response(200, '{}'));
    vi.stubGlobal('fetch', fetchMock);
    const t = createMetaCloudTransport(metaOpts);
    await t.sendText('33611111111', 'salut');
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://graph.facebook.com/v26.0/123/messages');
  });
});

describe('envoi CM.com', () => {
  // audit 5.9
  it("jeton refusé : une seule tentative, TransportSendError('auth')", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(403, 'forbidden'));
    vi.stubGlobal('fetch', fetchMock);
    const t = createCmComTransport(cmOpts);
    const err = await t.sendText('33611111111', 'salut').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportSendError);
    expect((err as TransportSendError).kind).toBe('auth');
    expect((err as TransportSendError).message).not.toContain('cm-secret');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // D1
  it("400 avec errorCode 103 : une seule tentative, TransportSendError('auth') avec statut et code", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(400, '{"details":"Invalid product token.","errorCode":103}'));
    vi.stubGlobal('fetch', fetchMock);
    const t = createCmComTransport(cmOpts);
    const err = await t.sendText('33611111111', 'salut').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportSendError);
    expect((err as TransportSendError).kind).toBe('auth');
    expect((err as TransportSendError).status).toBe(400);
    expect((err as TransportSendError).code).toBe(103);
    expect((err as TransportSendError).message).toBe('[CmCom] 400 (code 103)');
    expect((err as TransportSendError).message).not.toContain('cm-secret');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // D1
  it("503 avec errorCode 103 : une seule tentative, 'auth'", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(503, '{"errorCode":103}'));
    vi.stubGlobal('fetch', fetchMock);
    const t = createCmComTransport(cmOpts);
    const err = await t.sendText('33611111111', 'salut').catch((e: unknown) => e);
    expect((err as TransportSendError).kind).toBe('auth');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // D1
  it("400 au corps non JSON : 'other', code absent, une seule tentative", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(400, '<html>Bad request</html>'));
    vi.stubGlobal('fetch', fetchMock);
    const t = createCmComTransport(cmOpts);
    const err = await t.sendText('33611111111', 'salut').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportSendError);
    expect((err as TransportSendError).kind).toBe('other');
    expect((err as TransportSendError).code).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // audit 5.9
  it('erreur réseau puis succès : réussi en 2 appels', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(response(200, '{}'));
    vi.stubGlobal('fetch', fetchMock);
    const t = createCmComTransport(cmOpts);
    const p = t.sendText('33611111111', 'salut');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(CM_SEND_URL);
  });

  // audit 5.9
  it("500 persistant : 3 appels puis TransportSendError('transient')", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(500, 'oups'));
    vi.stubGlobal('fetch', fetchMock);
    const t = createCmComTransport(cmOpts);
    const assertion = expect(t.sendText('33611111111', 'salut')).rejects.toMatchObject({
      kind: 'transient', status: 500,
    });
    await vi.advanceTimersByTimeAsync(4000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
