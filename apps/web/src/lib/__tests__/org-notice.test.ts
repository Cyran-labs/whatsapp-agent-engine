import { test, expect } from 'vitest';
import { parseOrgNotice } from '../org-notice';

test('message complet relu', () => {
  expect(parseOrgNotice(JSON.stringify({ kind: 'access', org: 'Maison Lumière', role: 'manager', readOnly: true }))).toEqual({
    kind: 'access',
    org: 'Maison Lumière',
    role: 'manager',
    readOnly: true,
  });
});

test('accès sans rôle, suspendue et changée : sans rôle', () => {
  expect(parseOrgNotice(JSON.stringify({ kind: 'access', org: 'A' }))).toEqual({ kind: 'access', org: 'A' });
  expect(parseOrgNotice(JSON.stringify({ kind: 'suspended', org: 'A', role: 'admin' }))).toEqual({ kind: 'suspended', org: 'A' });
  expect(parseOrgNotice(JSON.stringify({ kind: 'changed', org: 'A' }))).toEqual({ kind: 'changed', org: 'A' });
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
