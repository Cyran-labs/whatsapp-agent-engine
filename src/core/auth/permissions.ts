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

/**
 * Numéros des contacts (liste d'accès limité, `phone` des leads) en entier (spec navigation 9.2) : l'opérateur, l'admin
 * et le super manager (lecture seule comprise, son périmètre couvre toutes les entités) ; sinon seulement un membre qui
 * a une appartenance (manager ou conseiller) sur l'entité de l'agent IA. Un agent IA sans entité (`botEntityId` nul)
 * n'a de numéros en entier que pour les trois premiers. Tout autre membre les reçoit masqués (`maskContactNumber`).
 */
export function canSeeContactNumbers(access: Access, botEntityId: number | null): boolean {
  if (access.platformAdmin || access.orgRole === 'admin' || access.orgRole === 'super_manager') return true;
  if (botEntityId === null) return false;
  return access.entityRoles.some((r) => r.entityId === botEntityId);
}
