/**
 * Coûts réservés à l'admin (spec « Refonte de la navigation », 9.1) : `GET /bots/:botId/usage` est la seule route du
 * moteur qui renvoie des coûts. Garde statique : les lectures de `llm_usage` (`listLlmUsage*`) ne sont appelées, hors
 * pilotes de base et hors tests, que par `DashboardService.usage`, et la seule route qui appelle `usage(` porte
 * `requireAction('usage.read')`. Le test casse si un autre appelant apparaît, route future comprise.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..');
/** Pilotes et interface de la base : ils déclarent les lectures, ils ne les appellent pas. */
const DRIVERS = new Set(['core/database/types.ts', 'core/database/sqlite.ts', 'core/database/postgres.ts']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'test-support' ? [] : sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, 'utf8') }));

/** Lignes (fichier:ligne) qui contiennent `pattern`. */
function occurrences(pattern: RegExp, skip: Set<string> = new Set()): string[] {
  return files.filter((f) => !skip.has(f.path)).flatMap((f) =>
    f.text.split('\n').flatMap((line, i) => (pattern.test(line) ? [`${f.path}:${i + 1}`] : [])),
  );
}

describe('lectures des coûts : un seul chemin, réservé à usage.read', () => {
  // nav 15.5
  it('listLlmUsage* n\'est appelée que par DashboardService.usage', () => {
    const calls = occurrences(/\blistLlmUsage\w*\s*\(/, DRIVERS);
    expect(calls.map((c) => c.split(':')[0])).toEqual(['core/services/dashboard-service.ts']);
    const service = files.find((f) => f.path === 'core/services/dashboard-service.ts')!.text;
    const start = service.indexOf('  async usage(');
    expect(start).toBeGreaterThan(-1);
    const next = service.indexOf('\n  async ', start + 1);
    const body = service.slice(start, next === -1 ? undefined : next);
    const outside = service.slice(0, start) + (next === -1 ? '' : service.slice(next));
    expect(body).toMatch(/\blistLlmUsage\w*\s*\(/);
    expect(outside).not.toMatch(/\blistLlmUsage\w*\s*\(/);
  });

  // nav 15.5
  it('la seule route qui appelle usage( porte requireAction(\'usage.read\')', () => {
    const calls = occurrences(/\.usage\s*\(/);
    expect(calls.map((c) => c.split(':')[0])).toEqual(['api/admin/routes/dashboard.ts']);
    const routes = files.find((f) => f.path === 'api/admin/routes/dashboard.ts')!.text;
    // Chaque déclaration de route, de `r.<méthode>(` à la suivante.
    const declarations = routes.split(/\n(?=\s*r\.(?:get|post|put|patch|delete)\()/).slice(1);
    const callers = declarations.filter((d) => /\.usage\s*\(/.test(d));
    expect(callers).toHaveLength(1);
    expect(callers[0]).toMatch(/^\s*r\.get\('\/usage', requireAction\('usage\.read'\),/);
  });
});
