import { isOpenable, type OrgRole, type OrganizationSummary } from './organizations';

/** Genre du message d'organisation : accès changé, organisation suspendue, organisation changée dans un autre onglet. */
export type OrgNoticeKind = 'access' | 'suspended' | 'changed';

/**
 * Message d'organisation affiché par OrgNoticeBanner. `org` nomme l'organisation concernée : celle dont l'accès a changé
 * ou qui est suspendue, ou celle que l'onglet affiche maintenant (`changed`). Pour `access`, `role` (et `readOnly`)
 * n'existent que quand l'accès demeure avec un autre rôle ; sans `role`, l'accès à `org` est perdu. Pour `suspended`,
 * `role` est le rôle de l'utilisateur dans l'organisation suspendue : il dit qui contacter.
 */
export interface OrgNotice {
  kind: OrgNoticeKind;
  org: string;
  role?: OrgRole;
  readOnly?: boolean;
}

const KINDS: readonly OrgNoticeKind[] = ['access', 'suspended', 'changed'];
const ROLES: readonly OrgRole[] = ['admin', 'super_manager', 'manager', 'advisor'];

/** Message relu depuis sessionStorage, sans confiance : null s'il est absent ou mal formé. */
export function parseOrgNotice(raw: string | null): OrgNotice | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { kind, org, role, readOnly } = value as Record<string, unknown>;
    const knownKind = KINDS.find((k) => k === kind);
    if (!knownKind || typeof org !== 'string' || org.length === 0) return null;
    const knownRole = ROLES.find((r) => r === role);
    if (knownKind === 'suspended' && knownRole) return { kind: knownKind, org, role: knownRole };
    if (knownKind !== 'access' || !knownRole) return { kind: knownKind, org };
    return { kind: knownKind, org, role: knownRole, readOnly: readOnly === true };
  } catch {
    return null;
  }
}

/**
 * Message à afficher quand l'onglet se recharge parce que l'organisation affichée (`prev`) n'est plus celle de la session
 * (`shown`, l'organisation que l'onglet affichera). Un seul point de décision, lu sur la session relue : `prev` suspendue
 * dans la liste, `suspended` ; `prev` absente, `access` (accès perdu) ; `prev` toujours ouvrable, `changed` (bascule faite
 * dans un autre onglet). Rien à dire sans organisation à afficher (la page « Aucune organisation » s'explique seule) ni
 * si l'organisation affichée est restée la même.
 */
export function reloadNotice(
  prev: OrganizationSummary | null,
  shown: OrganizationSummary | null,
  organizations: OrganizationSummary[],
): OrgNotice | null {
  if (!shown || shown.client_id === prev?.client_id) return null;
  if (!prev) return { kind: 'changed', org: shown.name };
  const now = organizations.find((o) => o.client_id === prev.client_id);
  if (!now) return { kind: 'access', org: prev.name };
  if (!isOpenable(now)) return { kind: 'suspended', org: prev.name, role: now.role };
  return { kind: 'changed', org: shown.name };
}

/**
 * Message à afficher quand le BFF a refusé l'organisation enregistrée (`refused_client_id` de `/api/auth/me`) et en a
 * ouvert une autre (`shown`) : seulement si elle est listée pour cet utilisateur et suspendue (spec en-tête 7.2). Une
 * autre organisation suspendue dont il est membre, qu'il n'a pas tenté d'ouvrir, n'est jamais nommée.
 */
export function refusedNotice(
  refusedId: string | null,
  shown: OrganizationSummary | null,
  organizations: OrganizationSummary[],
): OrgNotice | null {
  if (!refusedId || !shown) return null;
  const refused = organizations.find((o) => o.client_id === refusedId);
  if (!refused || isOpenable(refused)) return null;
  return { kind: 'suspended', org: refused.name, role: refused.role };
}
