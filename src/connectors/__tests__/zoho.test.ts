import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZohoConnector } from '../zoho.js';
import type { FieldMapping } from '../field-mapper.js';
import type { NormalizedLead } from '../types.js';

const MAPPING: FieldMapping = {
  version: 1,
  connector: 'zoho',
  target_object: 'Leads',
  client_id: 'default',
  field_mapping: [
    { source: 'prenom', target: 'First_Name' },
    { source: 'nom', target: 'Last_Name' },
    { source: 'email', target: 'Email' },
    { source: 'phone', target: 'Phone', transform: 'e164' },
    { source: 'societe', target: 'Company' },
  ],
  default_values: { on_create: { Last_Name: 'Inconnu', Company: 'Inconnu' } },
  fixed_values: { on_create: { Lead_Source: 'WhatsApp' } },
  deduplication: { primary_key: 'email', fallback_keys: ['phone'] },
};

function makeLead(overrides: Partial<NormalizedLead> = {}): NormalizedLead {
  return {
    client_id: 'default',
    bot_id: 'example',
    lead_id: 'lead-1',
    phone: '33761848975',
    email: 'marc@example.com',
    prenom: 'Marc',
    nom: 'Dupont',
    societe: 'ACME',
    source: 'whatsapp-default-example',
    created_at: '2026-04-28T12:00:00Z',
    updated_at: '2026-04-28T12:00:00Z',
    ...overrides,
  };
}

function mockResponse(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { 'Content-Type': 'application/json' } });
}

describe('ZohoConnector.pushLead', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('crée un Lead quand search renvoie 204 (aucun match)', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 }))                 // search vide
      .mockResolvedValueOnce(mockResponse(201, { data: [{ details: { id: 'z1' } }] })); // create

    const connector = new ZohoConnector({ accessToken: 'tok', mapping: MAPPING });
    await connector.pushLead(makeLead());

    const [searchUrl, searchOpts] = fetchMock.mock.calls[0];
    expect(searchUrl).toContain('https://www.zohoapis.com/crm/v2/Leads/search?criteria=');
    expect(decodeURIComponent(searchUrl)).toContain('(Email:equals:marc@example.com)');
    expect(searchOpts.headers['Authorization']).toBe('Zoho-oauthtoken tok');

    const [createUrl, createOpts] = fetchMock.mock.calls[1];
    expect(createUrl).toBe('https://www.zohoapis.com/crm/v2/Leads');
    expect(createOpts.method).toBe('POST');
    const body = JSON.parse(createOpts.body);
    expect(body.data[0].First_Name).toBe('Marc');
    expect(body.data[0].Lead_Source).toBe('WhatsApp');
  });

  it('PUT si le Lead existe', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, { data: [{ id: 'z9' }] }))
      .mockResolvedValueOnce(mockResponse(200, { data: [{ details: { id: 'z9' } }] }));

    const connector = new ZohoConnector({ accessToken: 'tok', mapping: MAPPING });
    await connector.pushLead(makeLead());

    const [putUrl, putOpts] = fetchMock.mock.calls[1];
    expect(putUrl).toBe('https://www.zohoapis.com/crm/v2/Leads/z9');
    expect(putOpts.method).toBe('PUT');
  });

  it('respecte le data center via apiDomain', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(mockResponse(201, { data: [{ details: { id: 'z1' } }] }));

    const connector = new ZohoConnector({ accessToken: 'tok', apiDomain: 'https://www.zohoapis.eu', mapping: MAPPING });
    await connector.pushLead(makeLead());

    expect(fetchMock.mock.calls[0][0]).toContain('https://www.zohoapis.eu/crm/v2/Leads/search');
  });
});

describe('ZohoConnector — validation & errors', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throw si accessToken manquant', () => {
    expect(() => new ZohoConnector({ accessToken: '', mapping: MAPPING })).toThrow(/accessToken is required/);
  });

  it('rejette une valeur de dedup contenant des caractères structurels criteria (anti-IDOR)', async () => {
    const connector = new ZohoConnector({ accessToken: 'tok', mapping: MAPPING });
    // Tentative d'altérer la criteria : (Email:equals:x)or(Id:not_equal:0)
    await expect(connector.pushLead(makeLead({ email: 'x)or(Id:not_equal:0' })))
      .rejects.toThrow(/unsafe dedup value/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejette un module non identifiant', () => {
    expect(() => new ZohoConnector({ accessToken: 'tok', mapping: MAPPING, module: 'Leads)or(' }))
      .toThrow(/invalid module/);
  });

  it('fail-fast sur 401 (token invalide)', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(401, { code: 'INVALID_TOKEN' }));

    const connector = new ZohoConnector({ accessToken: 'tok', mapping: MAPPING });
    await expect(connector.pushLead(makeLead())).rejects.toThrow(/Zoho 401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
