import { describe, expect, it } from 'vitest';
import { composeSystemPrompt, isComposableLanguage } from '../personality.js';

describe('composeSystemPrompt', () => {
  it('compose un prompt FR complet', () => {
    const out = composeSystemPrompt(
      { role: 'Conseiller commercial', tones: ['chaleureux', 'concis'], objective: 'qualifier le besoin', info: 'Ouvert du mardi au samedi' },
      'fr',
    );
    expect(out).toContain('Tu es Conseiller commercial.');
    expect(out).toContain('Ton ton : chaleureux, concis.');
    expect(out).toContain('Ton objectif principal : qualifier le besoin.');
    expect(out).toContain('Informations à connaître : Ouvert du mardi au samedi.');
    expect(out).toContain('Réponds en français, en messages courts adaptés à WhatsApp.');
  });

  it('omet les lignes vides (tones/objective/info)', () => {
    const out = composeSystemPrompt({ role: 'Assistant', tones: [], objective: '', info: '' }, 'fr');
    expect(out).toContain('Tu es Assistant.');
    expect(out).not.toContain('Ton ton');
    expect(out).not.toContain('objectif');
    expect(out).not.toContain('Informations');
  });

  it('compose en EN', () => {
    const out = composeSystemPrompt({ role: 'Sales advisor', tones: ['friendly'], objective: 'qualify', info: '' }, 'en');
    expect(out).toContain('You are Sales advisor.');
    expect(out).toContain('Your tone: friendly.');
    expect(out).toContain('Reply in English, in short WhatsApp-friendly messages.');
  });

  it('lève une erreur pour une langue sans template', () => {
    expect(() => composeSystemPrompt({ role: 'X', tones: [], objective: '', info: '' }, 'de')).toThrow();
  });

  it('isComposableLanguage', () => {
    expect(isComposableLanguage('fr')).toBe(true);
    expect(isComposableLanguage('de')).toBe(false);
  });
});
