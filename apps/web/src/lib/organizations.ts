export type OrgRole = 'admin' | 'super_manager' | 'manager' | 'advisor';

export interface OrganizationSummary {
  client_id: string;
  name: string;
  role: OrgRole;
  read_only: boolean;
  status?: string;
}

export interface Me {
  id: number;
  email: string;
  role: string;
  status: string;
  organizations: OrganizationSummary[];
}

/** Une organisation est ouvrable si son statut est absent (membre) ou `active`. */
export function isOpenable(o: OrganizationSummary): boolean {
  return o.status === undefined || o.status === 'active';
}

/** Dernière organisation utilisée si encore valable, sinon la première ouvrable, sinon null. */
export function resolveActiveOrg(
  orgs: OrganizationSummary[],
  cookie: string | undefined,
): OrganizationSummary | null {
  const openable = orgs.filter(isOpenable);
  return openable.find((o) => o.client_id === cookie) ?? openable[0] ?? null;
}

/** `claire.bernard@x.fr` donne CB, `contact@x.fr` donne C. */
export function initialsFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  return local
    .split(/[._-]/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

/** Initiales des deux premiers mots ; un seul mot : ses deux premières lettres. */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * Organisation apparue après l'acceptation d'une invitation : celle qui n'était pas dans la liste d'avant
 * (compte neuf : toutes), avec priorité au nom de l'invitation, sinon la première.
 */
export function acceptedOrganization(
  before: OrganizationSummary[],
  after: OrganizationSummary[],
  organizationName?: string,
): OrganizationSummary | null {
  const known = new Set(before.map((o) => o.client_id));
  const appeared = after.filter((o) => !known.has(o.client_id) && isOpenable(o));
  return appeared.find((o) => o.name === organizationName) ?? appeared[0] ?? null;
}
