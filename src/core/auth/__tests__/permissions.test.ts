import { describe, it, expect } from 'vitest';
import { can, canSeeContactNumbers, type Access, type Action } from '../permissions.js';

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
  'connections.manage',
  // nav 15.5 : coûts réservés à l'admin.
  'usage.read',
];

// Ordre des colonnes : actions ci-dessus.
const matrix: Record<string, boolean[]> = {
  'super admin plateforme': [true, true, true, true, true, true, true, true, true],
  admin: [true, true, true, true, true, true, true, true, true],
  'super manager': [true, true, false, false, false, false, false, false, false],
  'super manager lecture seule': [true, false, false, false, false, false, false, false, false],
  manager: [true, true, false, false, false, false, false, false, false],
  conseiller: [true, true, false, false, false, false, false, false, false],
};

const cases: [string, Action, boolean][] = Object.entries(matrix).flatMap(([profile, expected]) =>
  actions.map((action, i): [string, Action, boolean] => [profile, action, expected[i]]),
);

describe('can()', () => {
  it.each(cases)('%s / %s => %s', (profile, action, expected) => {
    expect(can(profiles[profile], action)).toBe(expected);
  });

  it('couvre 6 profils x 9 actions', () => {
    expect(cases).toHaveLength(54);
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

// nav 15.6, point d'attention 2 : numéros des contacts en entier pour l'admin, l'opérateur, le super manager et les
// membres de l'entité de l'agent IA ; masqués pour tout autre membre, et pour un agent IA sans entité (hors admin,
// opérateur, super manager).
describe('canSeeContactNumbers()', () => {
  const BOT_ENTITY = 10;
  const contactProfiles: Record<string, Access> = {
    ...profiles,
    'manager autre entité': { ...base, entityRoles: [{ entityId: 20, role: 'manager' }] },
    'conseiller autre entité': { ...base, entityRoles: [{ entityId: 20, role: 'advisor' }] },
    'conseiller des deux entités': { ...base, entityRoles: [{ entityId: 20, role: 'advisor' }, { entityId: 10, role: 'advisor' }] },
    'sans appartenance': base,
  };
  // [entité de l'agent IA = 10, entité nulle]
  const expected: Record<string, [boolean, boolean]> = {
    'super admin plateforme': [true, true],
    admin: [true, true],
    'super manager': [true, true],
    'super manager lecture seule': [true, true],
    manager: [true, false],
    conseiller: [true, false],
    'manager autre entité': [false, false],
    'conseiller autre entité': [false, false],
    'conseiller des deux entités': [true, false],
    'sans appartenance': [false, false],
  };
  const contactCases = Object.entries(expected).flatMap(([profile, [own, none]]): [string, number | null, boolean][] => [
    [profile, BOT_ENTITY, own],
    [profile, null, none],
  ]);

  it.each(contactCases)('%s / entité %s => %s', (profile, entityId, see) => {
    expect(canSeeContactNumbers(contactProfiles[profile]!, entityId)).toBe(see);
  });

  it('couvre chaque profil avec et sans entité', () => {
    expect(contactCases).toHaveLength(Object.keys(contactProfiles).length * 2);
  });
});
