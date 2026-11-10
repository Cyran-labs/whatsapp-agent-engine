/**
 * Politique de droits centralisée (§4 du spec comptes et équipes).
 * Module pur : pas de base de données, pas d'Express.
 */

/**
 * Rôle plateforme (`users.role`) du super admin : accès à toutes les organisations.
 * Relu sur l'utilisateur, jamais attribuable par une organisation.
 */
export const PLATFORM_ADMIN_ROLE = 'super_admin';

export interface Access {
  userId: number;
  clientId: string;
  platformAdmin: boolean;
  orgRole: 'admin' | 'super_manager' | null;
  entityRoles: { entityId: number; role: 'manager' | 'advisor' }[];
  readOnly: boolean;
}

export type Action =
  | 'org.read'
  | 'simulate.use'
  | 'bots.configure'
  | 'entities.manage'
  | 'users.manage'
  | 'settings.write'
  | 'audit.read'
  // Comptes WhatsApp d'organisation (raccordement, identifiants, numéros) : admin seulement.
  | 'connections.manage'
  // Usage et coûts LLM (`GET /bots/:botId/usage`) : admin seulement ; refusé à tout autre membre, super manager compris.
  | 'usage.read';

/** Actions ouvertes à tout membre de l'organisation (super manager, manager, conseiller). */
const MEMBER_ACTIONS: ReadonlySet<Action> = new Set<Action>(['org.read', 'simulate.use']);

/** Actions autorisées en lecture seule (aucune écriture, simulateur compris). */
const READ_ONLY_ACTIONS: ReadonlySet<Action> = new Set<Action>(['org.read']);

function hasMembership(access: Access): boolean {
  return access.orgRole !== null || access.entityRoles.length > 0;
}

export function can(access: Access, action: Action): boolean {
  // Admin d'organisation et super admin plateforme : tout.
  if (access.platformAdmin || access.orgRole === 'admin') return true;
  // Aucune appartenance : tout est refusé (fail closed).
  if (!hasMembership(access)) return false;
  // Lecture seule : uniquement la lecture.
  if (access.readOnly) return READ_ONLY_ACTIONS.has(action);
  return MEMBER_ACTIONS.has(action);
}
