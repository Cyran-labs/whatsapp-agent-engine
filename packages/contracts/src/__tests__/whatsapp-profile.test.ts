import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import {
  ApplyDisplayNameInput, CreateWhatsAppAccountInput, PROFILE_PHOTO_MAX_BYTES, PROFILE_PHOTO_TYPES, RequestDisplayNameInput,
  UpdateWhatsAppBusinessProfileInput, WHATSAPP_VERTICALS,
} from '../index.js';

const TECHNICAL = /String must|Invalid|Expected|Required|Number must|Array must/;

function messages(schema: ZodTypeAny, value: unknown): string[] {
  const r = schema.safeParse(value);
  if (r.success) throw new Error('la valeur aurait dû être refusée');
  return r.error.issues.map((i) => i.message);
}

const meta = { mode: 'meta_manual', name: 'Boutique', waba_id: '123456789', access_token: 'EAA'.padEnd(40, 'x'), app_secret: 'a'.repeat(32) };
// Un emoji hors du plan de base compte pour 1 point de code et 2 unités UTF-16
const EMOJI = '\u{1F600}';

describe('contracts: portefeuille au raccordement (lot R2a)', () => {
  it('business_id facultatif, chiffres seuls, espaces de bord retirés', () => {
    expect(CreateWhatsAppAccountInput.parse(meta)).not.toHaveProperty('business_id');
    expect(CreateWhatsAppAccountInput.parse({ ...meta, business_id: ' 1270659448489249 ' }))
      .toMatchObject({ business_id: '1270659448489249' });
    expect(messages(CreateWhatsAppAccountInput, { ...meta, business_id: 'abc' })).toContain('ID du portefeuille : 5 à 25 chiffres.');
    expect(() => CreateWhatsAppAccountInput.parse({ ...meta, business_id: '1234' })).toThrow();
    expect(() => CreateWhatsAppAccountInput.parse({ ...meta, business_id: '1'.repeat(26) })).toThrow();
    // L'adresse est lue par le web (`extractMetaIds`) : le moteur ne reçoit que l'identifiant
    expect(() => CreateWhatsAppAccountInput.parse({
      ...meta, business_id: 'https://business.facebook.com/latest/settings/business_info?business_id=1270659448489249',
    })).toThrow();
  });
});

describe('contracts: profil WhatsApp (lot R2a, essai §5)', () => {
  it('objet partiel : chaque champ est facultatif', () => {
    expect(UpdateWhatsAppBusinessProfileInput.parse({})).toEqual({});
    expect(UpdateWhatsAppBusinessProfileInput.parse({ address: '' })).toEqual({ address: '' });
    expect(UpdateWhatsAppBusinessProfileInput.parse({ websites: [] })).toEqual({ websites: [] });
  });

  it('about : 1 à 139 points de code, jamais vide ni espaces seuls (Ruling R-5)', () => {
    expect(UpdateWhatsAppBusinessProfileInput.parse({ about: '  Bonjour  ' })).toEqual({ about: 'Bonjour' });
    expect(UpdateWhatsAppBusinessProfileInput.parse({ about: EMOJI.repeat(139) }).about).toBe(EMOJI.repeat(139));
    expect(messages(UpdateWhatsAppBusinessProfileInput, { about: '' })).toContain('Les infos ne peuvent pas être vides.');
    expect(messages(UpdateWhatsAppBusinessProfileInput, { about: '   ' })).toContain('Les infos ne peuvent pas être vides.');
    expect(messages(UpdateWhatsAppBusinessProfileInput, { about: EMOJI.repeat(140) })).toContain('Les infos font 139 caractères au plus.');
    expect(messages(UpdateWhatsAppBusinessProfileInput, { about: 'x'.repeat(140) })).toContain('Les infos font 139 caractères au plus.');
  });

  it('description, adresse, e-mail : longueurs en points de code, vidage permis', () => {
    expect(UpdateWhatsAppBusinessProfileInput.parse({ description: EMOJI.repeat(512) }).description).toBe(EMOJI.repeat(512));
    expect(messages(UpdateWhatsAppBusinessProfileInput, { description: 'x'.repeat(513) })).toContain('La description fait 512 caractères au plus.');
    expect(UpdateWhatsAppBusinessProfileInput.parse({ address: EMOJI.repeat(256) }).address).toBe(EMOJI.repeat(256));
    expect(messages(UpdateWhatsAppBusinessProfileInput, { address: 'x'.repeat(257) })).toContain("L'adresse fait 256 caractères au plus.");
    expect(UpdateWhatsAppBusinessProfileInput.parse({ description: '', email: '' })).toEqual({ description: '', email: '' });
  });

  it('e-mail : forme contrôlée par WABAGENT, Meta ne la contrôle pas (Ruling R-6)', () => {
    expect(UpdateWhatsAppBusinessProfileInput.parse({ email: ' contact@boutique.fr ' })).toEqual({ email: 'contact@boutique.fr' });
    for (const bad of ['pas-un-email', 'a@b', '@boutique.fr', 'a b@boutique.fr', 'contact@', 'a@@b.fr']) {
      expect(messages(UpdateWhatsAppBusinessProfileInput, { email: bad })).toContain('Adresse e-mail invalide.');
    }
    const long = `${'a'.repeat(120)}@shop.fr`;
    expect([...long].length).toBe(128);
    expect(UpdateWhatsAppBusinessProfileInput.parse({ email: long }).email).toBe(long);
    expect(messages(UpdateWhatsAppBusinessProfileInput, { email: `a${long}` })).toContain("L'e-mail fait 128 caractères au plus.");
  });

  it('sites web : 2 au plus, 1 à 256 caractères, sans schéma accepté', () => {
    expect(UpdateWhatsAppBusinessProfileInput.parse({ websites: ['example.com', ' https://boutique.fr '] }))
      .toEqual({ websites: ['example.com', 'https://boutique.fr'] });
    expect(messages(UpdateWhatsAppBusinessProfileInput, { websites: ['a.fr', 'b.fr', 'c.fr'] })).toContain('2 sites web au plus.');
    expect(messages(UpdateWhatsAppBusinessProfileInput, { websites: ['  '] })).toContain("L'adresse du site est vide.");
    expect(UpdateWhatsAppBusinessProfileInput.parse({ websites: [EMOJI.repeat(256)] }).websites).toEqual([EMOJI.repeat(256)]);
    expect(messages(UpdateWhatsAppBusinessProfileInput, { websites: ['x'.repeat(257)] })).toContain("L'adresse du site fait 256 caractères au plus.");
  });

  it('secteur : liste fermée de 22 valeurs', () => {
    expect(WHATSAPP_VERTICALS).toHaveLength(22);
    expect(new Set(WHATSAPP_VERTICALS).size).toBe(22);
    expect(WHATSAPP_VERTICALS).toEqual(expect.arrayContaining(['OTHER', 'RETAIL', 'MATRIMONY_SERVICE', 'PROF_SERVICES']));
    expect(UpdateWhatsAppBusinessProfileInput.parse({ vertical: 'RETAIL' })).toEqual({ vertical: 'RETAIL' });
    expect(messages(UpdateWhatsAppBusinessProfileInput, { vertical: 'GOLF' })).toContain('Secteur inconnu.');
    expect(() => UpdateWhatsAppBusinessProfileInput.parse({ vertical: 'retail' })).toThrow();
  });

  it('photo : JPEG ou PNG, 5 Mo au plus (Ruling R-4)', () => {
    expect(PROFILE_PHOTO_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect([...PROFILE_PHOTO_TYPES]).toEqual(['image/jpeg', 'image/png']);
  });
});

describe('contracts: nom d\'affichage (lot R2a)', () => {
  it('nom demandé : 1 à 512 caractères, espaces de bord retirés (Ruling R-7)', () => {
    expect(RequestDisplayNameInput.parse({ new_display_name: '  Boutique Lumière  ' })).toEqual({ new_display_name: 'Boutique Lumière' });
    expect(RequestDisplayNameInput.parse({ new_display_name: EMOJI.repeat(512) }).new_display_name).toBe(EMOJI.repeat(512));
    expect(messages(RequestDisplayNameInput, { new_display_name: '   ' })).toContain('Le nom est requis.');
    expect(messages(RequestDisplayNameInput, { new_display_name: 'x'.repeat(513) })).toContain('Le nom fait 512 caractères au plus.');
  });

  it('code : exactement 6 chiffres, jamais recopié dans un message de refus (spec R2a §9.4)', () => {
    expect(ApplyDisplayNameInput.parse({ pin: '482915' })).toEqual({ pin: '482915' });
    for (const bad of ['48291', '4829150', '48291a', ' 482915', '482 915', '']) {
      const r = ApplyDisplayNameInput.safeParse({ pin: bad });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues.map((i) => i.message)).toContain('Le code fait 6 chiffres.');
        if (bad !== '') expect(JSON.stringify(r.error.issues)).not.toContain(bad.trim());
      }
    }
    expect(() => ApplyDisplayNameInput.parse({ pin: 482915 })).toThrow();
  });

  it('aucun message technique anglais', () => {
    const cases: Array<[ZodTypeAny, unknown]> = [
      [UpdateWhatsAppBusinessProfileInput, { about: '' }],
      [UpdateWhatsAppBusinessProfileInput, { about: 'x'.repeat(140), description: 'x'.repeat(513), address: 'x'.repeat(257) }],
      [UpdateWhatsAppBusinessProfileInput, { email: 'x', websites: ['a', 'b', 'c'], vertical: 'GOLF' }],
      [UpdateWhatsAppBusinessProfileInput, { websites: ['', 'x'.repeat(257)] }],
      [RequestDisplayNameInput, { new_display_name: '' }],
      [ApplyDisplayNameInput, { pin: 'abc' }],
      [CreateWhatsAppAccountInput, { ...meta, business_id: 'abc' }],
    ];
    for (const [schema, value] of cases) for (const m of messages(schema, value)) expect(m).not.toMatch(TECHNICAL);
  });
});
