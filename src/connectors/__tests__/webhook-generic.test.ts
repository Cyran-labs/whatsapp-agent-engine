import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import { WebhookGenericConnector } from '../webhook-generic.js';
import type { NormalizedLead, NormalizedBooking, NormalizedOrder } from '../types.js';

const URL = 'https://crm.example.com/webhook';
const SECRET = 'shhh-secret';

function makeLead(overrides: Partial<NormalizedLead> = {}): NormalizedLead {
  return {
    client_id: 'default',
    bot_id: 'example',
    lead_id: 'lead-1',
    phone: '33761848975',
    email: 'marc@example.com',
    prenom: 'Marc',
    nom: 'Dupont',
    source: 'whatsapp-default-example',
    created_at: '2026-04-28T12:00:00Z',
    updated_at: '2026-04-28T12:00:00Z',
    ...overrides,
  };
}

function mockResponse(status: number, body: unknown = {}): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { 'Content-Type': 'application/json' } });
}

describe('WebhookGenericConnector', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pushLead poste un événement lead.qualified signé HMAC SHA-256', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200));

    const connector = new WebhookGenericConnector({ url: URL, secret: SECRET });
    await connector.pushLead(makeLead());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(URL);
    expect(opts.method).toBe('POST');

    const body = opts.body as string;
    const parsed = JSON.parse(body);
    expect(parsed.event).toBe('lead.qualified');
    expect(parsed.data.lead_id).toBe('lead-1');

    // La signature doit correspondre au HMAC du body brut avec le secret
    const expected = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    expect(opts.headers['X-Cyran-Signature']).toBe(`sha256=${expected}`);
    expect(opts.headers['X-Cyran-Event-Id']).toBeTruthy();
    expect(opts.headers['X-Cyran-Timestamp']).toBeTruthy();
  });

  it('updateLead poste lead.updated avec leadId + fields', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200));

    const connector = new WebhookGenericConnector({ url: URL, secret: SECRET });
    await connector.updateLead('lead-1', { prenom: 'Marc Updated' });

    const parsed = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(parsed.event).toBe('lead.updated');
    expect(parsed.data.leadId).toBe('lead-1');
    expect(parsed.data.fields.prenom).toBe('Marc Updated');
  });

  it('pushBooking poste rdv.created', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200));

    const booking: NormalizedBooking = {
      client_id: 'default',
      bot_id: 'example',
      lead_id: 'lead-1',
      phone: '33761848975',
      event_name: 'Demo',
      start_time: '2026-05-02T10:00:00Z',
      source: 'calendly',
    };
    const connector = new WebhookGenericConnector({ url: URL, secret: SECRET });
    await connector.pushBooking(booking);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).event).toBe('rdv.created');
  });

  it('pushOrder poste order.placed', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200));

    const order: NormalizedOrder = {
      client_id: 'default',
      bot_id: 'example',
      lead_id: 'lead-1',
      phone: '33761848975',
      items: [{ product_id: 'p1', name: 'Widget', quantity: 2, unit_price: 10, currency: 'EUR' }],
      total: 20,
      currency: 'EUR',
      ordered_at: '2026-05-02T10:00:00Z',
    };
    const connector = new WebhookGenericConnector({ url: URL, secret: SECRET });
    await connector.pushOrder(order);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).event).toBe('order.placed');
  });

  it('signatures différentes pour des payloads différents', async () => {
    fetchMock.mockResolvedValue(mockResponse(200));

    const connector = new WebhookGenericConnector({ url: URL, secret: SECRET });
    await connector.pushLead(makeLead({ lead_id: 'a' }));
    await connector.pushLead(makeLead({ lead_id: 'b' }));

    const sig1 = fetchMock.mock.calls[0][1].headers['X-Cyran-Signature'];
    const sig2 = fetchMock.mock.calls[1][1].headers['X-Cyran-Signature'];
    expect(sig1).not.toBe(sig2);
  });

  it('fail-fast sur 400 sans retry', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(400, { error: 'bad' }));

    const connector = new WebhookGenericConnector({ url: URL, secret: SECRET });
    await expect(connector.pushLead(makeLead())).rejects.toThrow(/Client error 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retry sur 500 puis succès', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(mockResponse(500))
      .mockResolvedValueOnce(mockResponse(200));

    const connector = new WebhookGenericConnector({ url: URL, secret: SECRET });
    const promise = connector.pushLead(makeLead());
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('throw après épuisement des retries (3 tentatives par défaut)', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(mockResponse(503));

    const connector = new WebhookGenericConnector({ url: URL, secret: SECRET });
    const promise = connector.pushLead(makeLead());
    const assertion = expect(promise).rejects.toThrow(/HTTP 503/);
    await vi.runAllTimersAsync();
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
