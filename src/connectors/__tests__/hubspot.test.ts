import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HubSpotConnector } from '../hubspot.js';
import type { FieldMapping } from '../field-mapper.js';
import type { NormalizedLead } from '../types.js';

const MAPPING: FieldMapping = {
  version: 1,
  connector: 'hubspot',
  target_object: 'contact',
  client_id: 'default',
  field_mapping: [
    { source: 'prenom', target: 'firstname' },
    { source: 'nom', target: 'lastname' },
    { source: 'email', target: 'email' },
    { source: 'phone', target: 'phone', transform: 'e164' },
  ],
  fixed_values: {
    on_create: { lifecyclestage: 'lead' },
  },
  deduplication: {
    primary_key: 'email',
    fallback_keys: ['phone'],
  },
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
    source: 'whatsapp-default-example',
    created_at: '2026-04-28T12:00:00Z',
    updated_at: '2026-04-28T12:00:00Z',
    ...overrides,
  };
}

function mockResponse(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('HubSpotConnector.pushLead', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cree un nouveau contact si aucun email match', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, { results: [] })) // search vide
      .mockResolvedValueOnce(mockResponse(201, { id: '999', properties: {} })); // create

    const connector = new HubSpotConnector({ accessToken: 'pat-test', mapping: MAPPING });
    await connector.pushLead(makeLead());

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [searchUrl, searchOpts] = fetchMock.mock.calls[0];
    expect(searchUrl).toContain('/crm/v3/objects/contacts/search');
    expect(searchOpts.method).toBe('POST');
    expect(JSON.parse(searchOpts.body).filterGroups[0].filters[0].propertyName).toBe('email');

    const [createUrl, createOpts] = fetchMock.mock.calls[1];
    expect(createUrl).toBe('https://api.hubapi.com/crm/v3/objects/contacts');
    expect(createOpts.method).toBe('POST');

    const createdProps = JSON.parse(createOpts.body).properties;
    expect(createdProps.firstname).toBe('Marc');
    expect(createdProps.lastname).toBe('Dupont');
    expect(createdProps.email).toBe('marc@example.com');
    expect(createdProps.phone).toBe('+33761848975');
    expect(createdProps.lifecyclestage).toBe('lead'); // fixed_values.on_create
  });

  it('update si email existe (dedup match)', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, {
        results: [{ id: '12345', properties: { email: 'marc@example.com' } }],
      }))
      .mockResolvedValueOnce(mockResponse(200, { id: '12345', properties: {} }));

    const connector = new HubSpotConnector({ accessToken: 'pat-test', mapping: MAPPING });
    await connector.pushLead(makeLead());

    const [, updateOpts] = fetchMock.mock.calls[1];
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.hubapi.com/crm/v3/objects/contacts/12345');
    expect(updateOpts.method).toBe('PATCH');

    const props = JSON.parse(updateOpts.body).properties;
    expect(props.firstname).toBe('Marc');
    // En mode update, fixed_values.on_create ne s'applique PAS
    expect(props.lifecyclestage).toBeUndefined();
  });

  it('utilise phone comme fallback de dedup si pas d email', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, { results: [] }))
      .mockResolvedValueOnce(mockResponse(201, { id: '777', properties: {} }));

    const connector = new HubSpotConnector({ accessToken: 'pat-test', mapping: MAPPING });
    const lead = makeLead({ phone: '33761848975' });
    delete (lead as Partial<NormalizedLead>).email;
    await connector.pushLead(lead);

    const searchBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(searchBody.filterGroups[0].filters[0].propertyName).toBe('phone');
    expect(searchBody.filterGroups[0].filters[0].value).toBe('+33761848975');
  });

  it('inclut Bearer token dans Authorization', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, { results: [] }))
      .mockResolvedValueOnce(mockResponse(201, { id: '1', properties: {} }));

    const connector = new HubSpotConnector({ accessToken: 'pat-mytoken', mapping: MAPPING });
    await connector.pushLead(makeLead());

    expect(fetchMock.mock.calls[0][1].headers['Authorization']).toBe('Bearer pat-mytoken');
  });
});

describe('HubSpotConnector.updateLead', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skip silencieusement si contact introuvable', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { results: [] }));

    const connector = new HubSpotConnector({ accessToken: 'pat-test', mapping: MAPPING });
    await connector.updateLead('marc@example.com', { email: 'marc@example.com', prenom: 'Marc Updated' });

    // 1 search, pas de PATCH
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('patche le contact trouve', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, {
        results: [{ id: '999', properties: {} }],
      }))
      .mockResolvedValueOnce(mockResponse(200, { id: '999', properties: {} }));

    const connector = new HubSpotConnector({ accessToken: 'pat-test', mapping: MAPPING });
    await connector.updateLead('marc@example.com', {
      email: 'marc@example.com',
      prenom: 'Marc Updated',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].method).toBe('PATCH');
    const props = JSON.parse(fetchMock.mock.calls[1][1].body).properties;
    expect(props.firstname).toBe('Marc Updated');
  });
});

describe('HubSpotConnector — error handling', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fail-fast sur 400 (pas de retry)', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(400, { message: 'Invalid property' }));

    const connector = new HubSpotConnector({ accessToken: 'pat-test', mapping: MAPPING });
    await expect(connector.pushLead(makeLead())).rejects.toThrow(/HubSpot 400/);

    // Une seule tentative malgre les 3 retries possibles
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throw si accessToken vide', () => {
    expect(() => new HubSpotConnector({ accessToken: '', mapping: MAPPING })).toThrow(/accessToken is required/);
  });

  it('throw si mapping absent', () => {
    expect(() => new HubSpotConnector({ accessToken: 'pat-test' } as never)).toThrow(/mapping is required/);
  });
});
