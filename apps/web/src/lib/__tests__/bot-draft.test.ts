import { test, expect } from 'vitest';
import { slugify, nextSlug, buildBotPayload, type WizardState } from '../bot-draft';

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
    welcomeEnabled: true, welcome: { fr: 'Bonjour' }, leadFields: ['Nom', 'Téléphone'], ...over,
  };
}

test('buildBotPayload : langue guidee -> personality, pas de system_prompt', () => {
  const p = buildBotPayload(state());
  expect(p.personality?.fr.role).toBe('Conseiller');
  expect(p.system_prompt.fr).toBeUndefined();
  expect(p.welcome).toEqual({ enabled: true, message: { fr: 'Bonjour' } });
  expect(p.lead_fields).toBe('Nom, Téléphone');
  expect(p.transport).toBe('meta-cloud');
});

test('buildBotPayload : langue brute -> system_prompt, pas de personality', () => {
  const p = buildBotPayload(state({ perLang: { fr: { mode: 'raw', role: '', tones: [], objective: '', info: '', raw: 'Prompt brut.' } } }));
  expect(p.system_prompt.fr).toBe('Prompt brut.');
  expect(p.personality).toBeNull();
});
