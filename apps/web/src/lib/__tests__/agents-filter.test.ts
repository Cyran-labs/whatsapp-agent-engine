import { test, expect } from 'vitest';
import { parseAgentFilter, applyAgentFilter, agentFilterQuery } from '../agents-filter';
import type { AgentSummaryRow } from '../onboarding';

function row(bot_id: string, status: string, entity_id: number): AgentSummaryRow {
  return { bot_id, name: bot_id, slug: bot_id, status, languages: ['fr'], default_language: 'fr', number: null, messages_total: 0, leads_total: 0, personalized: true, entity_id };
}
const rows = [row('a', 'active', 1), row('b', 'paused', 1), row('c', 'draft', 2), row('d', 'active', 2)];

test('parseAgentFilter : entité', () => {
  expect(parseAgentFilter(new URLSearchParams('entity=12'))).toEqual({ kind: 'entity', entityId: 12 });
});
test('parseAgentFilter : statut', () => {
  expect(parseAgentFilter(new URLSearchParams('status=paused'))).toEqual({ kind: 'status', status: 'paused' });
});
test('parseAgentFilter : entité et statut présents, l entité gagne', () => {
  expect(parseAgentFilter(new URLSearchParams('entity=3&status=draft'))).toEqual({ kind: 'entity', entityId: 3 });
});
test('parseAgentFilter : valeurs invalides ou absentes donnent all', () => {
  expect(parseAgentFilter(new URLSearchParams(''))).toEqual({ kind: 'all' });
  expect(parseAgentFilter(new URLSearchParams('entity=abc'))).toEqual({ kind: 'all' });
  expect(parseAgentFilter(new URLSearchParams('entity=0'))).toEqual({ kind: 'all' });
  expect(parseAgentFilter(new URLSearchParams('entity=-2'))).toEqual({ kind: 'all' });
  expect(parseAgentFilter(new URLSearchParams('entity=1.5'))).toEqual({ kind: 'all' });
  expect(parseAgentFilter(new URLSearchParams('status=archived'))).toEqual({ kind: 'all' });
});
test('applyAgentFilter', () => {
  expect(applyAgentFilter(rows, { kind: 'all' })).toHaveLength(4);
  expect(applyAgentFilter(rows, { kind: 'entity', entityId: 2 }).map((r) => r.bot_id)).toEqual(['c', 'd']);
  expect(applyAgentFilter(rows, { kind: 'status', status: 'active' }).map((r) => r.bot_id)).toEqual(['a', 'd']);
});
test('agentFilterQuery', () => {
  expect(agentFilterQuery({ kind: 'all' })).toBe('');
  expect(agentFilterQuery({ kind: 'entity', entityId: 7 })).toBe('?entity=7');
  expect(agentFilterQuery({ kind: 'status', status: 'draft' })).toBe('?status=draft');
});
