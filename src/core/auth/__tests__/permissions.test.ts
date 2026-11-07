import { describe, it, expect } from 'vitest';
import { can, type Access, type Action } from '../permissions.js';

const base: Access = {
  userId: 1,
  clientId: 'org-test',
  platformAdmin: false,
  orgRole: null,
  entityRoles: [],
  readOnly: false,
};

const profiles: Record<string, Access> = {
  'super admin plateforme': { ...base, platformAdmin: true },
  admin: { ...base, orgRole: 'admin' },
  'super manager': { ...base, orgRole: 'super_manager' },
  'super manager lecture seule': { ...base, orgRole: 'super_manager', readOnly: true },
  manager: { ...base, entityRoles: [{ entityId: 10, role: 'manager' }] },
  conseiller: { ...base, entityRoles: [{ entityId: 10, role: 'advisor' }] },
};

const actions: Action[] = [
  'org.read',
  'simulate.use',
  'bots.configure',
  'entities.manage',
  'users.manage',
  'settings.write',
  'audit.read',
];

// Ordre des colonnes : actions ci-dessus.
const matrix: Record<string, boolean[]> = {
  'super admin plateforme': [true, true, true, true, true, true, true],
  admin: [true, true, true, true, true, true, true],
  'super manager': [true, true, false, false, false, false, false],
  'super manager lecture seule': [true, false, false, false, false, false, false],
  manager: [true, true, false, false, false, false, false],
  conseiller: [true, true, false, false, false, false, false],
};

const cases: [string, Action, boolean][] = Object.entries(matrix).flatMap(([profile, expected]) =>
  actions.map((action, i): [string, Action, boolean] => [profile, action, expected[i]]),
);

describe('can()', () => {
  it.each(cases)('%s / %s => %s', (profile, action, expected) => {
    expect(can(profiles[profile], action)).toBe(expected);
  });

  it('couvre 6 profils x 7 actions', () => {
    expect(cases).toHaveLength(42);
  });

  it('refuse tout à un accès sans rôle ni appartenance (fail closed)', () => {
    for (const action of actions) {
      expect(can(base, action)).toBe(false);
    }
  });

  it('refuse tout, org.read compris, à un accès vide même en lecture seule', () => {
    expect(can({ ...base, readOnly: true }, 'org.read')).toBe(false);
  });

  it('le super admin plateforme garde tous les droits avec readOnly à false', () => {
    const access: Access = { ...base, platformAdmin: true, readOnly: false };
    for (const action of actions) {
      expect(can(access, action)).toBe(true);
    }
  });
});
