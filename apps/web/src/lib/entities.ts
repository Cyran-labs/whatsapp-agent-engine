export interface EntitySummary {
  id: number;
  name: string;
  status: 'active' | 'archived';
  bots: number;
  members: number;
}

export function activeEntities(list: EntitySummary[]): EntitySummary[] {
  return list.filter((e) => e.status === 'active');
}

/** Identifiant d'entité d'un paramètre d'URL : entier strictement positif, sinon null. */
export function parseEntityId(raw: string | null): number | null {
  return raw !== null && /^[1-9]\d*$/.test(raw) ? Number(raw) : null;
}
