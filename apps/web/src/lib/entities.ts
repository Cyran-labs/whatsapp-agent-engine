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
