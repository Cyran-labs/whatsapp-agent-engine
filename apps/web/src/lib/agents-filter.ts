import type { AgentSummaryRow } from './onboarding';
import { parseEntityId } from './entities';
import { shownNotRespondingReason } from './status-words';

export type AgentStatus = 'active' | 'limited' | 'paused' | 'draft';

/** `not_responding` : agents IA qui portent la mention « Ne répond pas » (spec 7.3), quel que soit leur statut. */
export type AgentFilter =
  | { kind: 'all' }
  | { kind: 'entity'; entityId: number }
  | { kind: 'status'; status: AgentStatus }
  | { kind: 'not_responding' };

const STATUSES: readonly AgentStatus[] = ['active', 'limited', 'paused', 'draft'];
const NOT_RESPONDING = 'not_responding';

/** Un seul filtre à la fois : l'entité l'emporte sur le statut ; toute valeur invalide est ignorée. */
export function parseAgentFilter(params: URLSearchParams): AgentFilter {
  const entityId = parseEntityId(params.get('entity'));
  if (entityId !== null) return { kind: 'entity', entityId };
  const rawStatus = params.get('status');
  if (rawStatus === NOT_RESPONDING) return { kind: 'not_responding' };
  const status = STATUSES.find((s) => s === rawStatus);
  if (status) return { kind: 'status', status };
  return { kind: 'all' };
}

/** Agent IA qui porte la mention, par la règle de la pastille (`shownNotRespondingReason`) : la liste compte ce qu'elle affiche. */
export function isNotResponding(row: Pick<AgentSummaryRow, 'status' | 'not_responding'>): boolean {
  return shownNotRespondingReason(row.status, row.not_responding) !== null;
}

export function applyAgentFilter(rows: AgentSummaryRow[], f: AgentFilter): AgentSummaryRow[] {
  if (f.kind === 'entity') return rows.filter((r) => r.entity_id === f.entityId);
  if (f.kind === 'status') return rows.filter((r) => r.status === f.status);
  if (f.kind === 'not_responding') return rows.filter(isNotResponding);
  return rows;
}

export function agentFilterQuery(f: AgentFilter): string {
  if (f.kind === 'entity') return `?entity=${f.entityId}`;
  if (f.kind === 'status') return `?status=${f.status}`;
  if (f.kind === 'not_responding') return `?status=${NOT_RESPONDING}`;
  return '';
}
