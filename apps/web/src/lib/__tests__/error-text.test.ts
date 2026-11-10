import { expect, test } from 'vitest';
import { errorText } from '../error-text';

// tâche 15 : le journal du navigateur ne reçoit que le texte de l'erreur
test("une erreur donne son message, jamais l'objet ni ses champs", () => {
  const err = Object.assign(new Error('échec réseau'), { body: 'SECRET-DU-CORPS' });
  expect(errorText(err)).toBe('échec réseau');
});

test("une valeur qui n'est pas une erreur est convertie en texte", () => {
  expect(errorText('boom')).toBe('boom');
  expect(errorText(undefined)).toBe('undefined');
});
