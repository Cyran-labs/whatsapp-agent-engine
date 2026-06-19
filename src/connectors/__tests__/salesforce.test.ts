import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SalesforceConnector } from '../salesforce.js';
import type { FieldMapping } from '../field-mapper.js';
import type { NormalizedLead } from '../types.js';

const MAPPING: FieldMapping = {
  version: 1,
  connector: 'salesforce',
  target_object: 'Lead',
  client_id: 'default',
  field_mapping: [
    { source: 'prenom', target: 'FirstName' },
    { source: 'nom', target: 'LastName' },
    { source: 'email', target: 'Email' },
    { source: 'phone', target: 'Phone', transform: 'e164' },
    { source: 'societe', target: 'Company' },
  ],
  default_values: { on_create: { Company: 'Inconnu', LastName: 'Inconnu' } },
  fixed_values: { on_create: { LeadSource: 'WhatsApp' } },
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

const INSTANCE = 'https://acme.my.salesforce.com';

describe('SalesforceConnector.pushLead', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('crée un Lead si la requête SOQL ne retourne rien', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, { records: [] }))             // SOQL
      .mockResolvedValueOnce(mockResponse(201, { id: '00Q1', success: true })); // create

    const connector = new SalesforceConnector({ instanceUrl: INSTANCE, accessToken: 'tok', mapping: MAPPING });
    await connector.pushLead(makeLead());

    const [queryUrl, queryOpts] = fetchMock.mock.calls[0];
    expect(queryUrl).toContain('/services/data/v59.0/query?q=');
    expect(decodeURIComponent(queryUrl)).toContain("SELECT Id FROM Lead WHERE Email = 'marc@example.com'");
    expect(queryOpts.headers['Authorization']).toBe('Bearer tok');

    const [createUrl, createOpts] = fetchMock.mock.calls[1];
    expect(createUrl).toBe(`${INSTANCE}/services/data/v59.0/sobjects/Lead`);
    expect(createOpts.method).toBe('POST');
    const body = JSON.parse(createOpts.body);
    expect(body.FirstName).toBe('Marc');
    expect(body.LastName).toBe('Dupont');
    expect(body.Company).toBe('ACME');
    expect(body.LeadSource).toBe('WhatsApp'); // fixed_values
  });

  it('PATCH si le Lead existe (204 No Content géré)', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, { records: [{ Id: '00Q9' }] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const connector = new SalesforceConnector({ instanceUrl: INSTANCE, accessToken: 'tok', mapping: MAPPING });
    await connector.pushLead(makeLead());

    const [patchUrl, patchOpts] = fetchMock.mock.calls[1];
    expect(patchUrl).toBe(`${INSTANCE}/services/data/v59.0/sobjects/Lead/00Q9`);
    expect(patchOpts.method).toBe('PATCH');
    const body = JSON.parse(patchOpts.body);
    expect(body.LeadSource).toBeUndefined(); // on_create ne s'applique pas en update
  });

  it('échappe les apostrophes dans la valeur SOQL', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, { records: [] }))
      .mockResolvedValueOnce(mockResponse(201, { id: '1', success: true }));

    const connector = new SalesforceConnector({ instanceUrl: INSTANCE, accessToken: 'tok', mapping: MAPPING });
    await connector.pushLead(makeLead({ email: "o'brien@example.com" }));

    expect(decodeURIComponent(fetchMock.mock.calls[0][0])).toContain("\\'brien");
  });

  it('neutralise une tentative d injection SOQL (backslash + quote)', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, { records: [] }))
      .mockResolvedValueOnce(mockResponse(201, { id: '1', success: true }));

    const connector = new SalesforceConnector({ instanceUrl: INSTANCE, accessToken: 'tok', mapping: MAPPING });
    // Payload classique de breakout : se terminer par \' pour casser l'échappement naïf
    await connector.pushLead(makeLead({ email: "x\\' OR Name!='" }));

    const soql = decodeURIComponent(fetchMock.mock.calls[0][0]);
    // Le backslash est doublé et la quote échappée → pas de breakout : le OR reste dans le littéral
    expect(soql).toContain("WHERE Email = 'x\\\\\\' OR Name!=\\'' LIMIT 1");
  });

  it('rejette un sObject non identifiant (anti-injection)', () => {
    expect(() => new SalesforceConnector({
      instanceUrl: INSTANCE, accessToken: 'tok', mapping: MAPPING, sobject: 'Lead WHERE 1=1--',
    })).toThrow(/invalid sobject/);
  });
});

describe('SalesforceConnector — validation & errors', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throw si instanceUrl manquant', () => {
    expect(() => new SalesforceConnector({ instanceUrl: '', accessToken: 'tok', mapping: MAPPING })).toThrow(/instanceUrl is required/);
  });

  it('throw si accessToken manquant', () => {
    expect(() => new SalesforceConnector({ instanceUrl: INSTANCE, accessToken: '', mapping: MAPPING })).toThrow(/accessToken is required/);
  });

  it('fail-fast sur 400', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(400, [{ message: 'Required fields are missing' }]));

    const connector = new SalesforceConnector({ instanceUrl: INSTANCE, accessToken: 'tok', mapping: MAPPING });
    await expect(connector.pushLead(makeLead())).rejects.toThrow(/Salesforce 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
