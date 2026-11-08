import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test, expect } from 'vitest';

const SRC = join(__dirname, '..', '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' || path === join(SRC, 'app', 'api') ? [] : sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

test('les routes d\'administration du BFF sont appelées via apiFetch, jamais par fetch direct', () => {
  // fetch direct vers /api/... hors /api/auth/... (routes d'auth : connexion, session, mot de passe)
  const direct = /(?<![\w.])fetch\(\s*[`'"]\/api\/(?!auth\/)/;
  const offenders = sources(SRC)
    .filter((file) => direct.test(readFileSync(file, 'utf8')))
    .map((file) => relative(SRC, file));
  expect(offenders).toEqual([]);
});
