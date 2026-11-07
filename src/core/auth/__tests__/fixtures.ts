// Fixtures partagées des tests : organisations, membres, super admin.
import type { Database } from '../../database/types.js';
import type { MembershipGrantRecord } from '../../database/accounts-types.js';
import { ensureDefaultEntity } from '../../database/migrate-accounts.js';
import { hashPassword } from '../passwords.js';

export interface SeedOrgMemberInput {
  email: string;
  password: string;
  clientId: string;
  grants: MembershipGrantRecord[] | 'admin';
}

/**
 * Crée l'organisation et son entité par défaut si absentes, l'utilisateur `member` actif
 * (réutilisé s'il existe déjà, pour les membres de plusieurs organisations) et ses
 * appartenances dans l'organisation. `'admin'` vaut `[{ entity_id: null, role: 'admin' }]`.
 */
export async function seedOrgMember(
  db: Database,
  input: SeedOrgMemberInput,
): Promise<{ userId: number; entityId: number }> {
  if (!(await db.getClient(input.clientId))) {
    await db.upsertClient({ client_id: input.clientId, name: input.clientId, status: 'active' });
  }
  const entity = await ensureDefaultEntity(db, input.clientId);
  const existing = await db.getUserByEmail(input.email);
  const user = existing ?? await db.createUser({
    email: input.email,
    password_hash: await hashPassword(input.password),
    role: 'member',
    client_id: null,
    status: 'active',
  });
  const grants: MembershipGrantRecord[] = input.grants === 'admin'
    ? [{ entity_id: null, role: 'admin' }]
    : input.grants;
  await db.replaceMemberships(user.id, input.clientId, grants);
  return { userId: user.id, entityId: entity.id };
}

/** Crée un super admin plateforme actif, sans appartenance. */
export async function seedSuperAdmin(db: Database, email: string, password: string): Promise<number> {
  const user = await db.createUser({
    email,
    password_hash: await hashPassword(password),
    role: 'super_admin',
    client_id: null,
    status: 'active',
  });
  return user.id;
}
