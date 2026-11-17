import { test, expect } from 'vitest';
import { businessIdFromInput, wabaIdFromInput } from '../meta-input';

const BUSINESS = '1270659448489249';
const WABA = '1122051030798254';
const MANAGER = `https://business.facebook.com/latest/whatsapp_manager/overview/?business_id=${BUSINESS}&asset_id=${WABA}`;

// Lot R2a, spec R2a §5.1 : l'étape 1 accepte une adresse de page Meta Business ou l'identifiant seul.
test('businessIdFromInput : identifiant seul, adresse avec business_id, rien sinon', () => {
  expect(businessIdFromInput(BUSINESS)).toBe(BUSINESS);
  expect(businessIdFromInput(` ${BUSINESS} `)).toBe(BUSINESS);
  expect(businessIdFromInput(MANAGER)).toBe(BUSINESS);
  expect(businessIdFromInput(`https://business.facebook.com/latest/settings/business_info?business_id=${BUSINESS}`)).toBe(BUSINESS);
  // Ruling du contrôleur : une adresse sans schéma n'est pas reconnue (extractMetaIds).
  expect(businessIdFromInput(`business.facebook.com/latest/settings/business_info?business_id=${BUSINESS}`)).toBeNull();
  expect(businessIdFromInput(`https://business.facebook.com/latest/whatsapp_manager/overview/?asset_id=${WABA}`)).toBeNull();
  expect(businessIdFromInput('')).toBeNull();
  expect(businessIdFromInput('1234')).toBeNull();
});

// Spec R2a §5.1, point 5 : le champ WABA accepte aussi l'adresse de sa page et en extrait asset_id.
test('wabaIdFromInput : identifiant seul, asset_id d\'une adresse, rien sinon', () => {
  expect(wabaIdFromInput(WABA)).toBe(WABA);
  expect(wabaIdFromInput(` ${WABA}`)).toBe(WABA);
  expect(wabaIdFromInput(MANAGER)).toBe(WABA);
  // Une adresse sans asset_id ne donne pas de WABA, même si elle porte un portefeuille.
  expect(wabaIdFromInput(`https://business.facebook.com/latest/settings/business_info?business_id=${BUSINESS}`)).toBeNull();
  expect(wabaIdFromInput('abc')).toBeNull();
  expect(wabaIdFromInput('')).toBeNull();
});
