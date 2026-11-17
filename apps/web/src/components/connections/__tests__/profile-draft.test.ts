import { test, expect } from 'vitest';
import type { WhatsAppBusinessProfileView } from '@wabagent/contracts';
import { blockingErrors, draftOf } from '../profile-draft';

// Revue finale M-e : un champ non touché tel que Meta le rend (infos vides, site de plus de 256 caractères) ne bloque pas
// l'enregistrement des autres ; seuls les champs envoyés (présents dans le patch) sont contrôlés.
const LONG_SITE = `https://exemple.fr/${'a'.repeat(260)}`;

function fromMeta(over: Partial<WhatsAppBusinessProfileView> = {}): WhatsAppBusinessProfileView {
  return {
    about: '', description: 'Boutique', address: '', email: '', websites: [LONG_SITE], vertical: 'RETAIL', photo_url: null,
    read_at: '2026-11-17T10:00:00.000Z', ...over,
  };
}

test('champs non touchés hors règles chez Meta : aucun blocage pour un autre champ modifié', () => {
  const baseline = draftOf(fromMeta());
  expect(blockingErrors(baseline, { ...baseline, description: 'Livraison en 48 h' })).toEqual([]);
});

test('champ modifié hors règles : bloquant (infos vidées, site trop long saisi)', () => {
  const baseline = draftOf(fromMeta({ about: 'Bonjour', websites: [] }));
  expect(blockingErrors(baseline, { ...baseline, about: '  ' })).toEqual(['about']);
  expect(blockingErrors(baseline, { ...baseline, websites: [LONG_SITE] })).toEqual(['websites.0']);
});

test('sites modifiés : le site trop long gardé tel que Meta le rend bloque, puisque la liste entière est envoyée', () => {
  const baseline = draftOf(fromMeta({ about: 'Bonjour' }));
  expect(blockingErrors(baseline, { ...baseline, websites: [LONG_SITE, 'https://second.fr'] })).toEqual(['websites.0']);
});

test('e-mail modifié mal formé : bloquant ; e-mail non touché : jamais contrôlé', () => {
  const baseline = draftOf(fromMeta({ about: 'Bonjour', email: 'ancien@exemple' }));
  expect(blockingErrors(baseline, { ...baseline, description: 'Autre' })).toEqual([]);
  expect(blockingErrors(baseline, { ...baseline, email: 'contact@exemple' })).toEqual(['email']);
});
