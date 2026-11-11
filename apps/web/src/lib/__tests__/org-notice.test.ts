import { test, expect } from 'vitest';
import type { OrganizationSummary } from '../organizations';
import { parseOrgNotice, refusedNotice, reloadNotice } from '../org-notice';

test('message complet relu', () => {
  expect(parseOrgNotice(JSON.stringify({ kind: 'access', org: 'Maison Lumière', role: 'manager', readOnly: true }))).toEqual({
    kind: 'access',
    org: 'Maison Lumière',
    role: 'manager',
    readOnly: true,
  });
});

test('accès sans rôle et changée : sans rôle', () => {
  expect(parseOrgNotice(JSON.stringify({ kind: 'access', org: 'A' }))).toEqual({ kind: 'access', org: 'A' });
  expect(parseOrgNotice(JSON.stringify({ kind: 'changed', org: 'A', role: 'admin' }))).toEqual({ kind: 'changed', org: 'A' });
});

// recette 3.13 : le rôle dans l'organisation suspendue dit qui contacter
test('suspendue : rôle relu s\'il est connu, sans lecture seule', () => {
  expect(parseOrgNotice(JSON.stringify({ kind: 'suspended', org: 'A', role: 'admin', readOnly: true }))).toEqual({ kind: 'suspended', org: 'A', role: 'admin' });
  expect(parseOrgNotice(JSON.stringify({ kind: 'suspended', org: 'A', role: 'root' }))).toEqual({ kind: 'suspended', org: 'A' });
  expect(parseOrgNotice(JSON.stringify({ kind: 'suspended', org: 'A' }))).toEqual({ kind: 'suspended', org: 'A' });
});

test('rôle inconnu : traité comme un accès perdu', () => {
  expect(parseOrgNotice(JSON.stringify({ kind: 'access', org: 'A', role: 'root' }))).toEqual({ kind: 'access', org: 'A' });
});

test.each([null, '', 'access', '{', '[]', 'null', JSON.stringify({ kind: 'other', org: 'A' }), JSON.stringify({ kind: 'access' }), JSON.stringify({ kind: 'access', org: '' }), JSON.stringify({ kind: 'access', org: 3 })])(
  'valeur inutilisable ignorée : %s',
  (raw) => {
    expect(parseOrgNotice(raw)).toBeNull();
  },
);

const a: OrganizationSummary = { client_id: 'a', name: 'Maison Lumière', role: 'admin', read_only: false };
const b: OrganizationSummary = { client_id: 'b', name: 'Atelier Nord', role: 'advisor', read_only: false };

// audit R-11
test('reloadNotice : l\'organisation affichée est suspendue, absente ou toujours ouvrable', () => {
  expect(reloadNotice(a, b, [{ ...a, status: 'suspended' }, b])).toEqual({ kind: 'suspended', org: 'Maison Lumière', role: 'admin' });
  expect(reloadNotice(b, a, [a, { ...b, status: 'suspended' }])).toEqual({ kind: 'suspended', org: 'Atelier Nord', role: 'advisor' });
  expect(reloadNotice(a, b, [b])).toEqual({ kind: 'access', org: 'Maison Lumière' });
  expect(reloadNotice(a, b, [a, b])).toEqual({ kind: 'changed', org: 'Atelier Nord' });
  expect(reloadNotice(a, b, [{ ...a, status: 'active' }, b])).toEqual({ kind: 'changed', org: 'Atelier Nord' });
});

test('reloadNotice : rien à dire sans organisation à afficher ni si elle est restée la même', () => {
  expect(reloadNotice(a, null, [{ ...a, status: 'suspended' }])).toBeNull();
  expect(reloadNotice(a, a, [a])).toBeNull();
  expect(reloadNotice(null, b, [b])).toEqual({ kind: 'changed', org: 'Atelier Nord' });
});

// recette 3.13, entête 5 : bandeau de l'organisation tentée seulement, et seulement si elle est listée et suspendue
test('refusedNotice : organisation refusée listée et suspendue, nommée avec le rôle', () => {
  const so: OrganizationSummary = { client_id: 'so', name: 'Studio Ocre', role: 'advisor', read_only: false, status: 'suspended' };
  expect(refusedNotice('so', a, [a, so])).toEqual({ kind: 'suspended', org: 'Studio Ocre', role: 'advisor' });
  expect(refusedNotice(null, a, [a, so])).toBeNull();
  // jamais une organisation absente de la liste de l'utilisateur, ni une organisation ouvrable
  expect(refusedNotice('autre', a, [a, so])).toBeNull();
  expect(refusedNotice('b', a, [a, b])).toBeNull();
  // rien à dire sans organisation à afficher : la page « Aucune organisation » s'explique seule
  expect(refusedNotice('so', null, [so])).toBeNull();
});
