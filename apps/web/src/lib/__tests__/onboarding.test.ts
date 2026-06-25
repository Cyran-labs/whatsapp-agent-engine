import { test, expect } from 'vitest';
import { deriveChecklist, type BotSummary } from '../onboarding';

function bot(over: Partial<BotSummary> = {}): BotSummary {
  return { bot_id: 'b', name: 'B', status: 'draft', default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'x' }, ...over };
}

test('checklist vide', () => {
  expect(deriveChecklist([])).toEqual({ created: false, personalized: false, connected: false, active: false });
});

test('checklist : agent draft personnalise', () => {
  expect(deriveChecklist([bot()])).toMatchObject({ created: true, personalized: true, active: false });
});

test('checklist : agent actif', () => {
  expect(deriveChecklist([bot({ status: 'active' })])).toMatchObject({ created: true, active: true });
});

test('checklist : agent sans prompt pour la langue par defaut', () => {
  expect(deriveChecklist([bot({ system_prompt: {} })])).toMatchObject({ created: true, personalized: false });
});
