import { describe, expect, it } from 'vitest';
import { resolveAccess } from '../access-service.js';
import type { Database, UserRecord } from '../../database/types.js';
import type { MembershipRecord } from '../../database/accounts-types.js';

// Base factice : permet de construire des lignes que les contraintes SQL interdisent,
// pour vérifier que resolveAccess reste sûr même sur des données incohérentes.
function stubDb(
  user: Partial<UserRecord> | undefined,
  memberships: MembershipRecord[],
  clientStatus: string | null = 'active',
): Database {
  const fullUser: UserRecord | undefined = user === undefined ? undefined : {
    id: 1, email: 'u@x.test', password_hash: null, role: 'member', client_id: null, status: 'active',
    created_at: '', updated_at: '', ...user,
  };
  const stub = {
    async getUserById(id: number) { return fullUser && fullUser.id === id ? fullUser : undefined; },
    async getClient(clientId: string) { return clientId === 'acme' && clientStatus !== null ? { client_id: 'acme', name: 'Acme', status: clientStatus } : undefined; },
    async listUserMemberships(userId: number, clientId?: string) {
      return memberships.filter((m) => m.user_id === userId && (clientId === undefined || m.client_id === clientId));
    },
    async listUserOrganizations(userId: number) {
      const ids = [...new Set(memberships.filter((m) => m.user_id === userId && m.status === 'active').map((m) => m.client_id))];
      return ids.map((id) => ({ client_id: id, name: id }));
    },
  };
  return stub as unknown as Database;
}

function m(partial: Partial<MembershipRecord>): MembershipRecord {
  return { id: 1, user_id: 1, client_id: 'acme', entity_id: null, role: 'admin', read_only: false, status: 'active', ...partial };
}

describe('resolveAccess', () => {
  it('read_only sur un admin est ignoré (R8)', async () => {
    const a = await resolveAccess(stubDb({}, [m({ role: 'admin', read_only: true })]), 1, 'acme');
    expect(a.orgRole).toBe('admin');
    expect(a.readOnly).toBe(false);
  });

  it('read_only sur une appartenance d\'entité est ignoré (R8)', async () => {
    const a = await resolveAccess(stubDb({}, [m({ entity_id: 3, role: 'advisor', read_only: true })]), 1, 'acme');
    expect(a.entityRoles).toEqual([{ entityId: 3, role: 'advisor' }]);
    expect(a.readOnly).toBe(false);
  });

  it('read_only d\'un super manager suspendu n\'est pas pris en compte, entité active conservée', async () => {
    const a = await resolveAccess(stubDb({}, [
      m({ id: 1, role: 'super_manager', read_only: true, status: 'suspended' }),
      m({ id: 2, entity_id: 3, role: 'manager' }),
    ]), 1, 'acme');
    expect(a.orgRole).toBeNull();
    expect(a.readOnly).toBe(false);
    expect(a.entityRoles).toEqual([{ entityId: 3, role: 'manager' }]);
  });

  it('seules les appartenances actives comptent', async () => {
    const a = await resolveAccess(stubDb({}, [
      m({ id: 1, entity_id: 3, role: 'manager', status: 'suspended' }),
      m({ id: 2, entity_id: 4, role: 'advisor' }),
    ]), 1, 'acme');
    expect(a.entityRoles).toEqual([{ entityId: 4, role: 'advisor' }]);
  });

  it('rôle d\'organisation porté par une ligne d\'entité : ignoré, refus si rien d\'autre (fail closed)', async () => {
    await expect(resolveAccess(stubDb({}, [m({ entity_id: 3, role: 'admin' })]), 1, 'acme'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rôle d\'entité sans entité : ignoré, refus si rien d\'autre (fail closed)', async () => {
    await expect(resolveAccess(stubDb({}, [m({ entity_id: null, role: 'advisor' })]), 1, 'acme'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('utilisateur invited : 401', async () => {
    await expect(resolveAccess(stubDb({ status: 'invited' }, [m({})]), 1, 'acme'))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('aucune organisation active, sans en-tête : 403', async () => {
    await expect(resolveAccess(stubDb({}, []), 1, null)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('super admin : droits admin implicites, ses propres appartenances ignorées', async () => {
    const a = await resolveAccess(stubDb({ role: 'super_admin' }, [m({ entity_id: 3, role: 'advisor' })]), 1, 'acme');
    expect(a).toEqual({ userId: 1, clientId: 'acme', platformAdmin: true, orgRole: 'admin', entityRoles: [], readOnly: false });
  });

  it('organisation suspendue, membre : 403 « Organisation suspendue. » (R12)', async () => {
    await expect(resolveAccess(stubDb({}, [m({})], 'suspended'), 1, 'acme'))
      .rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Organisation suspendue.' });
  });

  it('organisation suspendue, repli sans en-tête : 403 « Organisation suspendue. » (R12)', async () => {
    await expect(resolveAccess(stubDb({}, [m({})], 'suspended'), 1, null))
      .rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Organisation suspendue.' });
  });

  it('organisation inexistante en base, membre : 403 « Organisation suspendue. » (R12)', async () => {
    await expect(resolveAccess(stubDb({}, [m({})], null), 1, 'acme'))
      .rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Organisation suspendue.' });
  });

  it('organisation suspendue, super admin : accès conservé (R12)', async () => {
    const a = await resolveAccess(stubDb({ role: 'super_admin' }, [], 'suspended'), 1, 'acme');
    expect(a.platformAdmin).toBe(true);
    expect(a.clientId).toBe('acme');
  });
});
