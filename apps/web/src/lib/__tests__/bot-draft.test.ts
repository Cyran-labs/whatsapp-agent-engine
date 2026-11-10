import { describe, test, expect } from 'vitest';
import { slugify, nextSlug, buildBotPayload, hasDefaultLanguagePersonality, leadFieldProblem, type WizardState } from '../bot-draft';

test('slugify normalise', () => {
  expect(slugify('Assistant Boutique')).toBe('assistant-boutique');
  expect(slugify('  Café & Thé!! ')).toBe('cafe-the');
  expect(slugify('123 Go')).toBe('123-go');
});

test('nextSlug suffixe en cas de collision', () => {
  expect(nextSlug('sales', [])).toBe('sales');
  expect(nextSlug('sales', ['sales'])).toBe('sales-2');
  expect(nextSlug('sales', ['sales', 'sales-2'])).toBe('sales-3');
});

function state(over: Partial<WizardState> = {}): WizardState {
  return {
    name: 'Ventes', slug: 'ventes', languages: ['fr'], defaultLanguage: 'fr',
    perLang: { fr: { mode: 'guided', role: 'Conseiller', tones: ['concis'], objective: 'aider', info: '', raw: '' } },
    welcomeEnabled: true, welcome: { fr: 'Bonjour' }, leadFields: ['Nom', 'Téléphone'], entityId: null, ...over,
  };
}

test('buildBotPayload : langue guidee -> personality, pas de system_prompt', () => {
  const p = buildBotPayload(state());
  expect(p.personality?.fr.role).toBe('Conseiller');
  expect(p.system_prompt.fr).toBeUndefined();
  expect(p.welcome).toEqual({ enabled: true, message: { fr: 'Bonjour' } });
  expect(p.lead_fields).toBe('Nom, Téléphone');
  expect(p).not.toHaveProperty('transport'); // le transport découle du compte WhatsApp du numéro
});

test('buildBotPayload : langue brute -> system_prompt, pas de personality', () => {
  const p = buildBotPayload(state({ perLang: { fr: { mode: 'raw', role: '', tones: [], objective: '', info: '', raw: 'Prompt brut.' } } }));
  expect(p.system_prompt.fr).toBe('Prompt brut.');
  expect(p.personality).toBeNull();
});

test('buildBotPayload : entity_id envoye quand une entite est choisie', () => {
  expect(buildBotPayload(state({ entityId: 5 })).entity_id).toBe(5);
});

test('buildBotPayload : pas d\'entity_id quand aucune entite', () => {
  expect('entity_id' in buildBotPayload(state())).toBe(false);
});

describe('hasDefaultLanguagePersonality (pré-contrôle de bot-service.ts resolvePrompts)', () => {
  const base: WizardState = {
    name: 'x', slug: 'x', languages: ['fr', 'en'], defaultLanguage: 'en',
    perLang: {
      fr: { mode: 'guided', role: 'Conseiller', tones: [], objective: '', info: '', raw: '' },
      en: { mode: 'guided', role: '', tones: [], objective: '', info: '', raw: '' },
    },
    welcomeEnabled: false, welcome: {}, leadFields: [], entityId: null,
  };

  test('seule la langue par défaut compte : un rôle dans une autre langue ne suffit pas', () => {
    expect(hasDefaultLanguagePersonality(base)).toBe(false);
  });

  test('rôle guidé ou prompt brut non vides dans la langue par défaut', () => {
    expect(hasDefaultLanguagePersonality({ ...base, perLang: { ...base.perLang, en: { ...base.perLang.en, role: ' Advisor ' } } })).toBe(true);
    expect(hasDefaultLanguagePersonality({ ...base, perLang: { ...base.perLang, en: { ...base.perLang.en, mode: 'raw', raw: 'You are' } } })).toBe(true);
  });

  test('mode guidé : un prompt brut resté en mémoire ne compte pas (buildBotPayload ne l\'envoie pas)', () => {
    expect(hasDefaultLanguagePersonality({ ...base, perLang: { ...base.perLang, en: { ...base.perLang.en, raw: 'You are' } } })).toBe(false);
  });
});

describe('leadFieldProblem', () => {
  test('un champ déjà présent est refusé, un nouveau ou un texte vide non', () => {
    expect(leadFieldProblem(' e-mail ', ['e-mail'])).toBe('duplicate');
    expect(leadFieldProblem('téléphone', ['e-mail'])).toBeNull();
    expect(leadFieldProblem('   ', ['e-mail'])).toBeNull();
  });
});
