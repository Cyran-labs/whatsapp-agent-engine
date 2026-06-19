import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PipedriveConnector } from '../pipedrive.js';
import type { FieldMapping } from '../field-mapper.js';
import type { NormalizedLead } from '../types.js';

const MAPPING: FieldMapping = {
  version: 1,
  connector: 'pipedrive',
  target_object: 'person',
  client_id: 'default',
  field_mapping: [
    { source: 'prenom', target: 'first_name' },
    { source: 'nom', target: 'last_name' },
    { source: 'prenom', target: 'name' },
    { source: 'email', target: 'email' },
    { source: 'phone', target: 'phone', transform: 'e164' },
  ],
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

describe('PipedriveConnector.pushLead', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('crée une person si aucun match, email/phone en tableaux', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, { data: { items: [] } })) // search vide
      .mockResolvedValueOnce(mockResponse(201, { data: { id: 42 } }));   // create

    const connector = new PipedriveConnector({ apiToken: 'tok', companyDomain: 'acme', mapping: MAPPING });
    await connector.pushLead(makeLead());

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [searchUrl] = fetchMock.mock.calls[0];
    expect(searchUrl).toContain('acme.pipedrive.com/api/v1/persons/search');
    expect(searchUrl).toContain('term=marc%40example.com');
    expect(searchUrl).toContain('api_token=tok');

    const [createUrl, createOpts] = fetchMock.mock.calls[1];
    expect(createUrl).toContain('/persons?api_token=tok');
    expect(createOpts.method).toBe('POST');
    const body = JSON.parse(createOpts.body);
    expect(body.first_name).toBe('Marc');
    expect(body.email).toEqual([{ value: 'marc@example.com', primary: true }]);
    expect(body.phone).toEqual([{ value: '+33761848975', primary: true }]);
  });

  it('update si la person existe', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, { data: { items: [{ item: { id: 7 } }] } }))
      .mockResolvedValueOnce(mockResponse(200, { data: { id: 7 } }));

    const connector = new PipedriveConnector({ apiToken: 'tok', companyDomain: 'acme', mapping: MAPPING });
    await connector.pushLead(makeLead());

    const [updateUrl, updateOpts] = fetchMock.mock.calls[1];
    expect(updateUrl).toContain('/persons/7?api_token=tok');
    expect(updateOpts.method).toBe('PUT');
  });

  it('fallback dedup sur phone si pas d email', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, { data: { items: [] } }))
      .mockResolvedValueOnce(mockResponse(201, { data: { id: 1 } }));

    const connector = new PipedriveConnector({ apiToken: 'tok', mapping: MAPPING });
    const lead = makeLead();
    delete (lead as Partial<NormalizedLead>).email;
    await connector.pushLead(lead);

    const [searchUrl] = fetchMock.mock.calls[0];
    expect(searchUrl).toContain('fields=phone');
    expect(searchUrl).toContain('term=%2B33761848975');
  });
});

describe('PipedriveConnector — validation & errors', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throw si apiToken vide', () => {
    expect(() => new PipedriveConnector({ apiToken: '', mapping: MAPPING })).toThrow(/apiToken is required/);
  });

  it('throw si ni mapping ni clientId', () => {
    expect(() => new PipedriveConnector({ apiToken: 'tok' } as never)).toThrow(/mapping or clientId/);
  });

  it('fail-fast sur 400', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(400, { error: 'bad' }));

    const connector = new PipedriveConnector({ apiToken: 'tok', mapping: MAPPING });
    await expect(connector.pushLead(makeLead())).rejects.toThrow(/Pipedrive 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
