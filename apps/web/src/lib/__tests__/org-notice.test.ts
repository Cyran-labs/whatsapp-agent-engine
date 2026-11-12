import { test, expect } from 'vitest';
import type { OrganizationSummary } from '../organizations';
import {
  keptSuspendedNotice,
  keptSuspendedValue,
  parseKeptSuspended,
  parseOrgNotice,
  parseStoredOrgNotice,
  refusedNotice,
  reloadNotice,
  storedOrgNoticeValue,
} from '../org-notice';

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

// revue isolation entête M-1 : le message stocké porte l'utilisateur qui l'a reçu
test('message stocké : écrit et relu avec son utilisateur', () => {
  const raw = storedOrgNoticeValue({ kind: 'access', org: 'Maison Lumière' }, 7);
  expect(JSON.parse(raw)).toEqual({ kind: 'access', org: 'Maison Lumière', user_id: 7 });
  expect(parseStoredOrgNotice(raw)).toEqual({ notice: { kind: 'access', org: 'Maison Lumière' }, userId: 7 });
});

// revue isolation entête M-1
test.each([
  JSON.stringify({ kind: 'access', org: 'A' }),
  JSON.stringify({ kind: 'access', org: 'A', user_id: '7' }),
  JSON.stringify({ kind: 'access', org: 'A', user_id: 7.5 }),
  JSON.stringify({ kind: 'access', org: 'A', user_id: null }),
  JSON.stringify({ kind: 'other', org: 'A', user_id: 7 }),
  'access',
  null,
])('message stocké sans utilisateur valable ignoré : %s', (raw) => {
  expect(parseStoredOrgNotice(raw)).toBeNull();
});

// recette K-13 (a) : bandeau d'organisation suspendue gardé d'un rechargement à l'autre, avec l'organisation tentée et
// l'utilisateur qui l'a tentée
test('bandeau gardé : écrit et relu avec l\'organisation tentée et son utilisateur', () => {
  const raw = keptSuspendedValue('b', 7);
  expect(JSON.parse(raw)).toEqual({ client_id: 'b', user_id: 7 });
  expect(parseKeptSuspended(raw)).toEqual({ clientId: 'b', userId: 7 });
});

test.each([
  null,
  '',
  '{',
  JSON.stringify({ client_id: 'b' }),
  JSON.stringify({ client_id: '', user_id: 7 }),
  JSON.stringify({ client_id: 3, user_id: 7 }),
  JSON.stringify({ client_id: 'b', user_id: '7' }),
  JSON.stringify({ client_id: 'b', user_id: 7.5 }),
])('bandeau gardé mal formé ignoré : %s', (raw) => {
  expect(parseKeptSuspended(raw)).toBeNull();
});

// recette K-13 (a), isolation : le bandeau gardé ne revient que pour son utilisateur, et tant que l'organisation tentée
// est listée pour lui, suspendue et non affichée
test('keptSuspendedNotice : seulement pour son utilisateur et une organisation toujours listée et suspendue', () => {
  const suspendedB: OrganizationSummary = { ...b, status: 'suspended' };
  const kept = { clientId: 'b', userId: 7 };
  expect(keptSuspendedNotice(kept, 7, a, [a, suspendedB])).toEqual({ kind: 'suspended', org: 'Atelier Nord', role: 'advisor' });
  // autre utilisateur du même navigateur
  expect(keptSuspendedNotice(kept, 8, a, [a, suspendedB])).toBeNull();
  // organisation réactivée, ou qui n'est plus listée pour lui
  expect(keptSuspendedNotice(kept, 7, a, [a, b])).toBeNull();
  expect(keptSuspendedNotice(kept, 7, a, [a])).toBeNull();
  // aucune organisation à afficher : la page « Aucune organisation » s'explique seule
  expect(keptSuspendedNotice(kept, 7, null, [suspendedB])).toBeNull();
});
