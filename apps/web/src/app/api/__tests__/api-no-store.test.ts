import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test, expect } from 'vitest';
import { emptyResponse, jsonResponse, NO_STORE } from '@/lib/api-json';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const SRC = join(__dirname, '..', '..', '..'); // apps/web/src
const BARE = /NextResponse\.(json|redirect|next)\(|new NextResponse\(|new Response\(|Response\.json\(/;

test('jsonResponse et emptyResponse portent Cache-Control: private, no-store', () => {
  expect(NO_STORE).toBe('private, no-store');
  const json = jsonResponse({ a: 1 }, { status: 201 });
  expect([json.status, json.headers.get('cache-control')]).toEqual([201, 'private, no-store']);
  const empty = emptyResponse(204);
  expect([empty.status, empty.headers.get('cache-control')]).toEqual([204, 'private, no-store']);
  expect(jsonResponse({}).status).toBe(200);
});

// Casse si une route (ou le relais) construit une réponse sans passer par api-json : elle n'aurait pas l'en-tête.
test('aucune route de src/app/api ni du relais ne construit de réponse hors de lib/api-json', () => {
  const files = [...sourceFiles(join(SRC, 'app', 'api')), join(SRC, 'lib', 'proxy.ts'), join(SRC, 'lib', 'api-response.ts')];
  expect(files.length).toBeGreaterThan(20);
  const offenders = files.filter((f) => BARE.test(readFileSync(f, 'utf8'))).map((f) => relative(SRC, f));
  expect(offenders).toEqual([]);
});

test('next.config : toute route /api est servie en private, no-store (filet de sécurité)', async () => {
  const { default: config } = await import('../../../../next.config');
  const rules = await config.headers?.();
  const api = rules?.find((r) => r.source === '/api/:path*');
  expect(api?.headers).toEqual([{ key: 'Cache-Control', value: 'private, no-store' }]);
});
