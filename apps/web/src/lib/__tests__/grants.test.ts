import { test, expect } from 'vitest';
import { Grants } from '@wabagent/contracts';
import { formToGrants, grantsToForm, describeAccess, memberIsSuspended, type AccessForm } from '../grants';

test('formToGrants : la lecture seule est ignorée hors super manager', () => {
  expect(formToGrants({ scope: 'organization', role: 'admin', readOnly: true })).toEqual([{ entity_id: null, role: 'admin' }]);
  expect(formToGrants({ scope: 'organization', role: 'super_manager', readOnly: true })).toEqual([
    { entity_id: null, role: 'super_manager', read_only: true },
  ]);
  expect(formToGrants({ scope: 'organization', role: 'super_manager', readOnly: false })).toEqual([
    { entity_id: null, role: 'super_manager' },
  ]);
});

test('formToGrants : une grant par entité cochée, acceptée par le contrat', () => {
  const grants = formToGrants({ scope: 'entities', entities: { 3: 'manager', 5: 'advisor' } });
  expect(grants).toEqual([
    { entity_id: 3, role: 'manager' },
    { entity_id: 5, role: 'advisor' },
  ]);
  expect(Grants.safeParse(grants).success).toBe(true);
});

test('grantsToForm(formToGrants(x)) est stable', () => {
  const forms: AccessForm[] = [
    { scope: 'organization', role: 'admin', readOnly: false },
    { scope: 'organization', role: 'super_manager', readOnly: true },
    { scope: 'organization', role: 'super_manager', readOnly: false },
    { scope: 'entities', entities: { 3: 'manager', 5: 'advisor' } },
  ];
  for (const f of forms) expect(grantsToForm(formToGrants(f))).toEqual(f);
});

test('grantsToForm lit les appartenances du moteur (statut ignoré)', () => {
  expect(
    grantsToForm([{ entity_id: null, role: 'super_manager', read_only: true, status: 'active' }]),
  ).toEqual({ scope: 'organization', role: 'super_manager', readOnly: true });
  expect(
    grantsToForm([
      { entity_id: 2, role: 'manager', read_only: false, status: 'suspended' },
      { entity_id: 3, role: 'advisor', read_only: false, status: 'suspended' },
    ]),
  ).toEqual({ scope: 'entities', entities: { 2: 'manager', 3: 'advisor' } });
  expect(grantsToForm([])).toEqual({ scope: 'entities', entities: {} });
});

test('describeAccess : une ligne par entité, « Entité archivée » pour un identifiant inconnu', () => {
  const names = new Map([[2, 'Boutique Paris Marais']]);
  expect(
    describeAccess(
      [
        { entity_id: 2, role: 'manager' },
        { entity_id: 9, role: 'advisor' },
      ],
      names,
      'Entité archivée',
    ),
  ).toEqual([
    { role: 'manager', entity: 'Boutique Paris Marais' },
    { role: 'advisor', entity: 'Entité archivée' },
  ]);
});

test('describeAccess : accès d\'organisation, lecture seule seulement pour super manager', () => {
  const names = new Map<number, string>();
  expect(describeAccess([{ entity_id: null, role: 'admin', read_only: true }], names, '?')).toEqual([{ role: 'admin' }]);
  expect(describeAccess([{ entity_id: null, role: 'super_manager', read_only: true }], names, '?')).toEqual([
    { role: 'super_manager', readOnly: true },
  ]);
  expect(describeAccess(null, names, '?')).toEqual([]);
});

test('memberIsSuspended : toutes les appartenances suspendues', () => {
  expect(memberIsSuspended([{ entity_id: 1, role: 'advisor', read_only: false, status: 'suspended' }])).toBe(true);
  expect(memberIsSuspended([{ entity_id: 1, role: 'advisor', read_only: false, status: 'active' }])).toBe(false);
  expect(memberIsSuspended([])).toBe(false);
});
