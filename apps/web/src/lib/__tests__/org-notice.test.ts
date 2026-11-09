import { test, expect } from 'vitest';
import type { OrganizationSummary } from '../organizations';
import { parseOrgNotice, reloadNotice } from '../org-notice';

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

const a: OrganizationSummary = { client_id: 'a', name: 'Maison Lumière', role: 'admin', read_only: false };
const b: OrganizationSummary = { client_id: 'b', name: 'Atelier Nord', role: 'advisor', read_only: false };

// audit R-11
test('reloadNotice : l\'organisation affichée est suspendue, absente ou toujours ouvrable', () => {
  expect(reloadNotice(a, b, [{ ...a, status: 'suspended' }, b])).toEqual({ kind: 'suspended', org: 'Maison Lumière' });
  expect(reloadNotice(a, b, [b])).toEqual({ kind: 'access', org: 'Maison Lumière' });
  expect(reloadNotice(a, b, [a, b])).toEqual({ kind: 'changed', org: 'Atelier Nord' });
  expect(reloadNotice(a, b, [{ ...a, status: 'active' }, b])).toEqual({ kind: 'changed', org: 'Atelier Nord' });
});

test('reloadNotice : rien à dire sans organisation à afficher ni si elle est restée la même', () => {
  expect(reloadNotice(a, null, [{ ...a, status: 'suspended' }])).toBeNull();
  expect(reloadNotice(a, a, [a])).toBeNull();
  expect(reloadNotice(null, b, [b])).toEqual({ kind: 'changed', org: 'Atelier Nord' });
});
