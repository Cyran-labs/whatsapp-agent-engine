// Résolution de l'organisation active et des droits (spec comptes et équipes, §7).
// Tout est relu en base à chaque appel : aucun cache, aucun état en mémoire.
// Le jeton ne sert qu'à identifier l'utilisateur ; ni son rôle ni un client_id hérité
// n'interviennent ici.

import type { Database } from '../database/types.js';
import type { MembershipRecord } from '../database/accounts-types.js';
import type { Access } from './permissions.js';
import { forbidden, notFound, unauthorized, validationError } from '../../api/errors.js';

export const ORGANIZATION_HEADER = 'X-Organization-Id';

const PLATFORM_ADMIN_ROLE = 'super_admin';

function organizationRequired() {
  return validationError(
    [{ path: ORGANIZATION_HEADER, message: 'Organisation à préciser.' }],
    'Organisation à préciser.',
  );
}

type OrgRole = NonNullable<Access['orgRole']>;
type EntityRole = Access['entityRoles'][number]['role'];

function isOrgRole(role: MembershipRecord['role']): role is OrgRole {
  return role === 'admin' || role === 'super_manager';
}

function isEntityRole(role: MembershipRecord['role']): role is EntityRole {
  return role === 'manager' || role === 'advisor';
}

/**
 * Construit les droits de l'utilisateur dans l'organisation demandée.
 * - utilisateur absent ou non `active` : 401 ;
 * - super admin (`users.role` relu en base) : organisation obligatoire, 404 si inexistante,
 *   droits admin implicites ;
 * - membre : sans organisation demandée, repli sur l'unique organisation active, sinon 400 ;
 *   aucune appartenance active exploitable dans l'organisation : 403.
 */
export async function resolveAccess(
  db: Database,
  userId: number,
  requestedClientId: string | null,
): Promise<Access> {
  const user = await db.getUserById(userId);
  if (!user || user.status !== 'active') throw unauthorized();

  if (user.role === PLATFORM_ADMIN_ROLE) {
    if (requestedClientId === null) throw organizationRequired();
    const client = await db.getClient(requestedClientId);
    if (!client) throw notFound('Organisation introuvable.');
    return {
      userId: user.id,
      clientId: client.client_id,
      platformAdmin: true,
      orgRole: 'admin',
      entityRoles: [],
      readOnly: false,
    };
  }

  let clientId = requestedClientId;
  if (clientId === null) {
    const organizations = await db.listUserOrganizations(user.id);
    if (organizations.length === 0) throw forbidden();
    const only = organizations[0];
    if (organizations.length > 1 || !only) throw organizationRequired();
    clientId = only.client_id;
  }

  const active = (await db.listUserMemberships(user.id, clientId))
    .filter((m) => m.status === 'active' && m.user_id === user.id && m.client_id === clientId);

  // Ligne d'organisation : rôle d'organisation et entity_id null, sinon ignorée.
  const orgMembership = active.find((m) => m.entity_id === null && isOrgRole(m.role));
  const orgRole: Access['orgRole'] = orgMembership && isOrgRole(orgMembership.role) ? orgMembership.role : null;

  const entityRoles: Access['entityRoles'] = [];
  for (const m of active) {
    if (m.entity_id === null || !isEntityRole(m.role)) continue;
    entityRoles.push({ entityId: m.entity_id, role: m.role });
  }

  if (orgRole === null && entityRoles.length === 0) throw forbidden();

  // Lecture seule : uniquement sur un super manager (invariant §4) ; ignorée ailleurs.
  const readOnly = orgMembership !== undefined
    && orgMembership.role === 'super_manager'
    && orgMembership.read_only === true;

  return { userId: user.id, clientId, platformAdmin: false, orgRole, entityRoles, readOnly };
}
