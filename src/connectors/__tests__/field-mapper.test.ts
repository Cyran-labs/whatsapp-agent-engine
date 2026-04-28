import { describe, expect, it } from 'vitest';
import { FieldMapper, type FieldMapping } from '../field-mapper.js';
import type { NormalizedLead } from '../types.js';

const HUBSPOT_LIKE_MAPPING: FieldMapping = {
  version: 1,
  connector: 'hubspot',
  target_object: 'contact',
  client_id: 'default',
  field_mapping: [
    { source: 'prenom', target: 'firstname' },
    { source: 'first_name', target: 'firstname' },
    { source: 'nom', target: 'lastname' },
    { source: 'last_name', target: 'lastname' },
    { source: 'email', target: 'email' },
    { source: 'phone', target: 'phone', transform: 'e164' },
    { source: 'societe', target: 'company' },
    { source: 'fonction', target: 'jobtitle' },
  ],
  fixed_values: {
    on_create: { lifecyclestage: 'lead', hs_lead_status: 'NEW' },
  },
  fallback: {
    target: 'message',
    concat_template: 'Besoin : {besoin}\nBudget : {budget}\nSource : {source}',
    include_unmapped: true,
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
    lead_id: 'lead-123',
    phone: '33761848975',
    source: 'whatsapp-default-example',
    created_at: '2026-04-28T12:00:00Z',
    updated_at: '2026-04-28T12:00:00Z',
    ...overrides,
  };
}

describe('FieldMapper.apply()', () => {
  it('mappe les champs canoniques FR vers les targets CRM', () => {
    const mapper = new FieldMapper(HUBSPOT_LIKE_MAPPING);
    const out = mapper.apply(makeLead({
      prenom: 'Marc',
      nom: 'Dupont',
      email: 'marc@example.com',
      societe: 'ACME',
      fonction: 'CTO',
    }));

    expect(out['firstname']).toBe('Marc');
    expect(out['lastname']).toBe('Dupont');
    expect(out['email']).toBe('marc@example.com');
    expect(out['company']).toBe('ACME');
    expect(out['jobtitle']).toBe('CTO');
  });

  it('applique les transforms (e164 sur phone)', () => {
    const mapper = new FieldMapper(HUBSPOT_LIKE_MAPPING);
    const out = mapper.apply(makeLead({ phone: '33761848975' }));
    expect(out['phone']).toBe('+33761848975');
  });

  it('e164 ne double pas le + si deja present', () => {
    const mapper = new FieldMapper(HUBSPOT_LIKE_MAPPING);
    const out = mapper.apply(makeLead({ phone: '+33761848975' }));
    expect(out['phone']).toBe('+33761848975');
  });

  it('e164 supprime les 00 prefixes', () => {
    const mapper = new FieldMapper(HUBSPOT_LIKE_MAPPING);
    const out = mapper.apply(makeLead({ phone: '0033761848975' }));
    expect(out['phone']).toBe('+33761848975');
  });

  it('plusieurs sources vers la meme target sont concatenees', () => {
    const mapper = new FieldMapper(HUBSPOT_LIKE_MAPPING);
    // prenom ET first_name mappent tous deux a "firstname"
    const out = mapper.apply(makeLead({
      prenom: 'Marc',
      // @ts-expect-error - first_name n'est pas dans NormalizedLead canonique
      first_name: 'MarcEN',
    }));
    expect(out['firstname']).toContain('Marc');
    expect(out['firstname']).toContain('MarcEN');
    expect(out['firstname']).toBe('Marc\nMarcEN');
  });

  it('ignore les valeurs undefined / null / vides', () => {
    const mapper = new FieldMapper(HUBSPOT_LIKE_MAPPING);
    const out = mapper.apply(makeLead({ prenom: '', nom: undefined, email: 'a@b.c' }));
    expect(out['firstname']).toBeUndefined();
    expect(out['lastname']).toBeUndefined();
    expect(out['email']).toBe('a@b.c');
  });

  it('applique fixed_values.on_create en mode create uniquement', () => {
    const mapper = new FieldMapper(HUBSPOT_LIKE_MAPPING);

    const onCreate = mapper.apply(makeLead({ email: 'a@b.c' }), 'create');
    expect(onCreate['lifecyclestage']).toBe('lead');
    expect(onCreate['hs_lead_status']).toBe('NEW');

    const onUpdate = mapper.apply(makeLead({ email: 'a@b.c' }), 'update');
    expect(onUpdate['lifecyclestage']).toBeUndefined();
    expect(onUpdate['hs_lead_status']).toBeUndefined();
  });

  it('rend le fallback concat avec les valeurs presentes uniquement', () => {
    const mapper = new FieldMapper(HUBSPOT_LIKE_MAPPING);
    const out = mapper.apply(makeLead({
      email: 'a@b.c',
      besoin: 'Bot WhatsApp',
      budget: '5k',
      // source est defini (whatsapp-default-example)
    }));
    expect(out['message']).toContain('Besoin : Bot WhatsApp');
    expect(out['message']).toContain('Budget : 5k');
    expect(out['message']).toContain('Source : whatsapp-default-example');
  });

  it('omet les lignes du template dont la valeur est vide', () => {
    const mapper = new FieldMapper(HUBSPOT_LIKE_MAPPING);
    const out = mapper.apply(makeLead({
      email: 'a@b.c',
      besoin: 'Bot WhatsApp',
      // budget absent → ligne "Budget : " doit disparaitre
    }));
    expect(out['message']).toContain('Besoin : Bot WhatsApp');
    expect(out['message']).not.toContain('Budget :');
  });

  it('inclut les custom_fields dans le fallback quand include_unmapped=true', () => {
    const mapper = new FieldMapper(HUBSPOT_LIKE_MAPPING);
    const out = mapper.apply(makeLead({
      email: 'a@b.c',
      custom_fields: { secteur: 'immobilier', urgence: 'haute' },
    }));
    expect(out['message']).toContain('secteur : immobilier');
    expect(out['message']).toContain('urgence : haute');
  });

  it('concatene fallback apres mapping si meme target', () => {
    const mappingWithBesoinAsMessage: FieldMapping = {
      ...HUBSPOT_LIKE_MAPPING,
      field_mapping: [
        ...HUBSPOT_LIKE_MAPPING.field_mapping,
        { source: 'besoin', target: 'message' },
      ],
    };
    const mapper = new FieldMapper(mappingWithBesoinAsMessage);
    const out = mapper.apply(makeLead({
      email: 'a@b.c',
      besoin: 'Bot WhatsApp',
      budget: '5k',
    }));
    // besoin va dans message via field_mapping, ET le fallback ajoute Budget+Source
    expect(out['message']).toContain('Bot WhatsApp');
    expect(out['message']).toContain('Budget : 5k');
  });
});

describe('FieldMapper.resolveDedupKey()', () => {
  it('utilise primary_key (email) en priorite', () => {
    const mapper = new FieldMapper(HUBSPOT_LIKE_MAPPING);
    const result = mapper.resolveDedupKey(makeLead({
      email: 'marc@example.com',
      phone: '33761848975',
    }));
    expect(result).toEqual({ targetField: 'email', value: 'marc@example.com' });
  });

  it('fallback sur phone si pas d email', () => {
    const mapper = new FieldMapper(HUBSPOT_LIKE_MAPPING);
    const result = mapper.resolveDedupKey(makeLead({ phone: '33761848975' }));
    expect(result).toEqual({ targetField: 'phone', value: '+33761848975' });
  });

  it('applique le transform au phone de dedup', () => {
    const mapper = new FieldMapper(HUBSPOT_LIKE_MAPPING);
    const result = mapper.resolveDedupKey(makeLead({ phone: '0033761848975' }));
    expect(result?.value).toBe('+33761848975');
  });

  it('retourne null si aucune cle de dedup disponible', () => {
    const mapper = new FieldMapper(HUBSPOT_LIKE_MAPPING);
    const lead = makeLead();
    delete (lead as Partial<NormalizedLead>).phone;
    const result = mapper.resolveDedupKey(lead);
    expect(result).toBeNull();
  });

  it('retourne null si dedup absent du mapping', () => {
    const mapping: FieldMapping = { ...HUBSPOT_LIKE_MAPPING };
    delete mapping.deduplication;
    const mapper = new FieldMapper(mapping);
    const result = mapper.resolveDedupKey(makeLead({ email: 'a@b.c' }));
    expect(result).toBeNull();
  });
});

describe('FieldMapper helpers', () => {
  it('listMappedSourceFields retourne les sources uniques', () => {
    const mapper = new FieldMapper(HUBSPOT_LIKE_MAPPING);
    const sources = mapper.listMappedSourceFields();
    expect(sources).toContain('prenom');
    expect(sources).toContain('first_name');
    expect(sources).toContain('email');
    // pas de doublon meme si plusieurs rules
    expect(sources.filter(s => s === 'email').length).toBe(1);
  });

  it('listMappedTargetFields inclut field_mapping + fallback + fixed_values', () => {
    const mapper = new FieldMapper(HUBSPOT_LIKE_MAPPING);
    const targets = mapper.listMappedTargetFields();
    expect(targets).toContain('firstname');
    expect(targets).toContain('email');
    expect(targets).toContain('message');         // fallback
    expect(targets).toContain('lifecyclestage');  // fixed_values.on_create
  });
});
