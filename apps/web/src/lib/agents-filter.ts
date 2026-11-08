import type { AgentSummaryRow } from './onboarding';
import { parseEntityId } from './entities';

export type AgentStatus = 'active' | 'paused' | 'draft';

export type AgentFilter =
  | { kind: 'all' }
  | { kind: 'entity'; entityId: number }
  | { kind: 'status'; status: AgentStatus };

const STATUSES: readonly AgentStatus[] = ['active', 'paused', 'draft'];

/** Un seul filtre à la fois : l'entité l'emporte sur le statut ; toute valeur invalide est ignorée. */
export function parseAgentFilter(params: URLSearchParams): AgentFilter {
  const entityId = parseEntityId(params.get('entity'));
  if (entityId !== null) return { kind: 'entity', entityId };
  const rawStatus = params.get('status');
  const status = STATUSES.find((s) => s === rawStatus);
  if (status) return { kind: 'status', status };
  return { kind: 'all' };
}

export function applyAgentFilter(rows: AgentSummaryRow[], f: AgentFilter): AgentSummaryRow[] {
  if (f.kind === 'entity') return rows.filter((r) => r.entity_id === f.entityId);
  if (f.kind === 'status') return rows.filter((r) => r.status === f.status);
  return rows;
}

export function agentFilterQuery(f: AgentFilter): string {
  if (f.kind === 'entity') return `?entity=${f.entityId}`;
  if (f.kind === 'status') return `?status=${f.status}`;
  return '';
}
