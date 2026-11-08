import type { Grants } from '@wabagent/contracts';

export type OrgGrantRole = 'admin' | 'super_manager';
export type EntityGrantRole = 'manager' | 'advisor';

/** État du formulaire d'accès : soit un rôle d'organisation, soit un rôle par entité. */
export type AccessForm =
  | { scope: 'organization'; role: OrgGrantRole; readOnly: boolean }
  | { scope: 'entities'; entities: Record<number, EntityGrantRole> };

/** Appartenance telle que le moteur la renvoie dans `GET /users`. */
export interface Membership {
  entity_id: number | null;
  role: string;
  read_only: boolean;
  status: 'active' | 'suspended';
}

/** Rôle et périmètre d'une appartenance ou d'une grant d'invitation (statut facultatif). */
export interface GrantLike {
  entity_id: number | null;
  role: string;
  read_only?: boolean;
  status?: string;
}

export interface MemberRow {
  user_id: number;
  email: string;
  status: string;
  memberships: Membership[];
}

export interface InvitationRow {
  id: number;
  email: string;
  grants: GrantLike[] | null;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface AccessLine {
  /** Clé de rôle (`admin`, `super_manager`, `manager`, `advisor`), à traduire à l'affichage. */
  role: string;
  entity?: string;
  readOnly?: boolean;
}

/** Grants du contrat ; la lecture seule n'existe que pour un super manager. */
export function formToGrants(form: AccessForm): Grants {
  if (form.scope === 'organization') {
    if (form.role === 'super_manager' && form.readOnly) return [{ entity_id: null, role: 'super_manager', read_only: true }];
    return [{ entity_id: null, role: form.role }];
  }
  return Object.entries(form.entities).map(([id, role]) => ({ entity_id: Number(id), role }));
}

export function grantsToForm(grants: GrantLike[]): AccessForm {
  const org = grants.find((g) => g.entity_id === null);
  if (org && (org.role === 'admin' || org.role === 'super_manager')) {
    return { scope: 'organization', role: org.role, readOnly: org.role === 'super_manager' && org.read_only === true };
  }
  const entities: Record<number, EntityGrantRole> = {};
  for (const g of grants) {
    if (g.entity_id !== null && (g.role === 'manager' || g.role === 'advisor')) entities[g.entity_id] = g.role;
  }
  return { scope: 'entities', entities };
}

export function describeAccess(
  grants: GrantLike[] | null,
  entityNames: ReadonlyMap<number, string>,
  unknownEntityLabel: string,
): AccessLine[] {
  return (grants ?? []).map((g) => {
    if (g.entity_id === null) {
      return g.role === 'super_manager' && g.read_only === true ? { role: g.role, readOnly: true } : { role: g.role };
    }
    return { role: g.role, entity: entityNames.get(g.entity_id) ?? unknownEntityLabel };
  });
}

/** Un membre est « Suspendu » dans l'organisation quand toutes ses appartenances le sont. */
export function memberIsSuspended(memberships: Membership[]): boolean {
  return memberships.length > 0 && memberships.every((m) => m.status === 'suspended');
}
