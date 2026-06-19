import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttioConnector } from '../attio.js';
import type { NormalizedLead, NormalizedBooking } from '../types.js';

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
    fonction: 'CEO',
    besoin: 'Automatiser le SAV',
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

/** Réponse d'upsert Person/Company/Deal Attio : { data: { id: { record_id } } } */
function recordResponse(recordId: string): Response {
  return mockResponse(200, { data: { id: { record_id: recordId } } });
}

function call(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  const [url, opts] = fetchMock.mock.calls[index];
  return { url: url as string, opts, body: opts.body ? JSON.parse(opts.body) : undefined };
}

function findCall(fetchMock: ReturnType<typeof vi.fn>, predicate: (url: string) => boolean) {
  const found = fetchMock.mock.calls.find(([url]) => predicate(url as string));
  if (!found) return undefined;
  return { url: found[0] as string, opts: found[1], body: found[1].body ? JSON.parse(found[1].body) : undefined };
}

describe('AttioConnector — constructor validation', () => {
  it('throw si apiKey vide', () => {
    expect(() => new AttioConnector({ apiKey: '' })).toThrow(/apiKey is required/);
  });

  it('throw si createDeal sans dealStageId', () => {
    expect(() => new AttioConnector({ apiKey: 'k', createDeal: true })).toThrow(/dealStageId is required/);
  });

  it('throw si createTask sans ownerMemberId', () => {
    expect(() => new AttioConnector({ apiKey: 'k', createTask: true })).toThrow(/ownerMemberId is required/);
  });
});

describe('AttioConnector.pushLead — mode Person+Company+Note', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('upsert Person (match email), upsert+link Company, ajoute une Note', async () => {
    fetchMock
      .mockResolvedValueOnce(recordResponse('person-1'))               // upsert person
      .mockResolvedValueOnce(mockResponse(200, { data: [] }))           // company query (absente)
      .mockResolvedValueOnce(recordResponse('company-1'))              // company create
      .mockResolvedValueOnce(recordResponse('person-1'))              // re-upsert person (link company)
      .mockResolvedValueOnce(mockResponse(201, { data: {} }));         // note

    const connector = new AttioConnector({ apiKey: 'k' });
    await connector.pushLead(makeLead());

    const person = call(fetchMock, 0);
    expect(person.url).toContain('/objects/people/records?matching_attribute=email_addresses');
    expect(person.opts.method).toBe('PUT');
    const values = person.body.data.values;
    expect(values.name[0].first_name).toBe('Marc');
    expect(values.email_addresses[0].email_address).toBe('marc@example.com');
    expect(values.phone_numbers[0].original_phone_number).toBe('+33761848975');
    expect(values.job_title[0].value).toBe('CEO');

    const note = findCall(fetchMock, (u) => u.endsWith('/notes'));
    expect(note).toBeDefined();
    expect(note!.body.data.parent_object).toBe('people');
    expect(note!.body.data.parent_record_id).toBe('person-1');
    expect(note!.body.data.content).toContain('Besoin : Automatiser le SAV');

    // Aucun deal créé en mode simple
    expect(findCall(fetchMock, (u) => u.includes('/objects/deals/'))).toBeUndefined();
  });

  it('match par phone si pas d email, et exclut un téléphone non-numérique de phone_numbers', async () => {
    fetchMock
      .mockResolvedValueOnce(recordResponse('person-2'))
      .mockResolvedValueOnce(mockResponse(201, { data: {} })); // note (pas de société)

    const connector = new AttioConnector({ apiKey: 'k' });
    const lead = makeLead({ email: undefined, societe: undefined, phone: 'wamid_ABC123' });
    await connector.pushLead(lead);

    const person = call(fetchMock, 0);
    expect(person.url).toContain('matching_attribute=phone_numbers');
    // wa_id alphanumérique : ne doit PAS partir dans phone_numbers (Attio le rejette)
    expect(person.body.data.values.phone_numbers).toBeUndefined();
  });

  it('throw si upsert Person échoue (pas de record_id)', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { data: {} }));

    const connector = new AttioConnector({ apiKey: 'k' });
    await expect(connector.pushLead(makeLead({ societe: undefined }))).rejects.toThrow(/person upsert failed/);
  });
});

describe('AttioConnector.pushLead — mode Deal + Task', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('crée le Deal dans le stage configuré, owner assigné, + Note + Task', async () => {
    fetchMock
      .mockResolvedValueOnce(recordResponse('person-1'))               // upsert person
      .mockResolvedValueOnce(mockResponse(200, { data: [] }))           // company query
      .mockResolvedValueOnce(recordResponse('company-1'))              // company create
      .mockResolvedValueOnce(recordResponse('person-1'))              // re-upsert (link)
      .mockResolvedValueOnce(recordResponse('deal-1'))                // deal create
      .mockResolvedValueOnce(mockResponse(201, { data: {} }))          // note on deal
      .mockResolvedValueOnce(mockResponse(201, { data: {} }));         // task

    const connector = new AttioConnector({
      apiKey: 'k',
      createDeal: true,
      dealStageId: 'stage-xyz',
      ownerMemberId: 'member-marc',
      createTask: true,
    });
    await connector.pushLead(makeLead());

    const deal = findCall(fetchMock, (u) => u.endsWith('/objects/deals/records'));
    expect(deal).toBeDefined();
    const dv = deal!.body.data.values;
    expect(dv.name[0].value).toBe('ACME — Marc Dupont');
    expect(dv.stage[0].status).toBe('stage-xyz');
    expect(dv.owner[0].referenced_actor_id).toBe('member-marc');
    expect(dv.associated_people[0].target_record_id).toBe('person-1');
    expect(dv.associated_company[0].target_record_id).toBe('company-1');

    const note = findCall(fetchMock, (u) => u.endsWith('/notes'));
    expect(note!.body.data.parent_object).toBe('deals');
    expect(note!.body.data.parent_record_id).toBe('deal-1');

    const task = findCall(fetchMock, (u) => u.endsWith('/tasks'));
    expect(task).toBeDefined();
    expect(task!.body.data.assignees[0].referenced_actor_id).toBe('member-marc');
    expect(task!.body.data.linked_records[0].target_record_id).toBe('deal-1');
    expect(typeof task!.body.data.deadline_at).toBe('string');
  });
});

describe('AttioConnector.pushBooking', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('upsert Person et ajoute une Note RDV', async () => {
    fetchMock
      .mockResolvedValueOnce(recordResponse('person-9'))
      .mockResolvedValueOnce(mockResponse(201, { data: {} }));

    const booking: NormalizedBooking = {
      client_id: 'default',
      bot_id: 'example',
      lead_id: 'lead-9',
      phone: '33761848975',
      event_name: 'Demo produit',
      start_time: '2026-05-02T10:00:00Z',
      invitee_email: 'marc@example.com',
      invitee_name: 'Marc',
      source: 'calendly',
    };

    const connector = new AttioConnector({ apiKey: 'k' });
    await connector.pushBooking(booking);

    const note = findCall(fetchMock, (u) => u.endsWith('/notes'));
    expect(note!.body.data.content).toContain('RDV : Demo produit');
    expect(note!.body.data.content).toContain('Début : 2026-05-02T10:00:00Z');
    expect(note!.body.data.title).toContain('RDV confirmé');
  });
});

describe('AttioConnector — error handling', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fail-fast sur 400 (pas de retry)', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(400, { message: 'Invalid value' }));

    const connector = new AttioConnector({ apiKey: 'k' });
    await expect(connector.pushLead(makeLead({ societe: undefined }))).rejects.toThrow(/Attio 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('inclut Bearer token dans Authorization', async () => {
    fetchMock
      .mockResolvedValueOnce(recordResponse('person-1'))
      .mockResolvedValueOnce(mockResponse(201, { data: {} }));

    const connector = new AttioConnector({ apiKey: 'my-attio-key' });
    await connector.pushLead(makeLead({ societe: undefined }));

    expect(fetchMock.mock.calls[0][1].headers['Authorization']).toBe('Bearer my-attio-key');
  });
});
