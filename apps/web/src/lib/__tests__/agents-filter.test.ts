import { test, expect } from 'vitest';
import { parseAgentFilter, applyAgentFilter, agentFilterQuery } from '../agents-filter';
import type { AgentSummaryRow } from '../onboarding';

function row(bot_id: string, status: string, entity_id: number): AgentSummaryRow {
  return { bot_id, name: bot_id, slug: bot_id, status, languages: ['fr'], default_language: 'fr', number: null, connected: false, status_reason: null, not_responding: null, account_state: null, messages_total: 0, leads_total: 0, personalized: true, entity_id };
}
const rows = [row('a', 'active', 1), row('b', 'paused', 1), row('c', 'draft', 2), row('d', 'active', 2), row('e', 'limited', 2)];

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
  expect(applyAgentFilter(rows, { kind: 'all' })).toHaveLength(5);
  expect(applyAgentFilter(rows, { kind: 'entity', entityId: 2 }).map((r) => r.bot_id)).toEqual(['c', 'd', 'e']);
  expect(applyAgentFilter(rows, { kind: 'status', status: 'active' }).map((r) => r.bot_id)).toEqual(['a', 'd']);
});
test('statut limited : analysé, filtré, sérialisé', () => {
  expect(parseAgentFilter(new URLSearchParams('status=limited'))).toEqual({ kind: 'status', status: 'limited' });
  expect(applyAgentFilter(rows, { kind: 'status', status: 'limited' }).map((r) => r.bot_id)).toEqual(['e']);
  expect(agentFilterQuery({ kind: 'status', status: 'limited' })).toBe('?status=limited');
});
test('agentFilterQuery', () => {
  expect(agentFilterQuery({ kind: 'all' })).toBe('');
  expect(agentFilterQuery({ kind: 'entity', entityId: 7 })).toBe('?entity=7');
  expect(agentFilterQuery({ kind: 'status', status: 'draft' })).toBe('?status=draft');
});

// spec 7.3 : filtre de la mention « Ne répond pas »
const muted = [
  { ...row('m1', 'limited', 1), not_responding: 'empty_allowlist' as const },
  { ...row('m2', 'active', 2), not_responding: 'account_not_connected' as const },
];
test('not_responding : analysé depuis ?status=not_responding, l entité gagne toujours', () => {
  expect(parseAgentFilter(new URLSearchParams('status=not_responding'))).toEqual({ kind: 'not_responding' });
  expect(parseAgentFilter(new URLSearchParams('entity=4&status=not_responding'))).toEqual({ kind: 'entity', entityId: 4 });
  expect(parseAgentFilter(new URLSearchParams('status=not-responding'))).toEqual({ kind: 'all' });
  expect(parseAgentFilter(new URLSearchParams('status=NOT_RESPONDING'))).toEqual({ kind: 'all' });
});
test('not_responding : garde les agents IA qui portent la mention, quel que soit leur statut', () => {
  expect(applyAgentFilter([...rows, ...muted], { kind: 'not_responding' }).map((r) => r.bot_id)).toEqual(['m1', 'm2']);
  expect(applyAgentFilter(rows, { kind: 'not_responding' })).toEqual([]);
});
// relecture tâche 7, M-2 : la liste filtrée compte ce que le tableau affiche, jamais un motif inconnu ni un statut hors service
test('not_responding : motif inconnu des contrats ou agent IA hors service écartés, comme dans le tableau', () => {
  const odd = [
    { ...row('x1', 'active', 1), not_responding: 'motif_futur' },
    { ...row('x2', 'draft', 1), not_responding: 'no_number' },
  ] as unknown as AgentSummaryRow[];
  expect(applyAgentFilter(odd, { kind: 'not_responding' })).toEqual([]);
});
test('not_responding : sérialisé en ?status=not_responding', () => {
  expect(agentFilterQuery({ kind: 'not_responding' })).toBe('?status=not_responding');
  expect(parseAgentFilter(new URLSearchParams(agentFilterQuery({ kind: 'not_responding' }).slice(1)))).toEqual({ kind: 'not_responding' });
});
