import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ERROR_REASONS } from '@wabagent/contracts';
import { expect, test } from 'vitest';

const E2E = join(__dirname, '..', '..', '..', 'e2e');
const KNOWN: readonly string[] = ERROR_REASONS;
const DOMAINS = [...new Set(ERROR_REASONS.map((reason) => reason.split('.')[0]))];

/**
 * contre-audit D-7 : le faux moteur et les parcours qui lui imposent un refus n'emploient que des clés que le moteur
 * réel connaît (`ERROR_REASONS`). Une clé inventée ferait passer au vert un parcours que le moteur réel ne produirait
 * jamais (le contre-audit avait forcé `entity.name_too_long`, qui n'existe pas).
 */
test('toute clé de refus écrite dans le faux moteur et les parcours e2e est une valeur de ERROR_REASONS', () => {
  // Faux moteur : toute chaîne de la forme « domaine.cas » est une clé de refus. Parcours et aides : seulement ce qui
  // est passé comme `reason` (les autres chaînes « auth.email »... sont des clés de texte de l'interface).
  const broad = new RegExp(`['"\`]((?:${DOMAINS.join('|')})\\.[a-z_]+)['"\`]`, 'g');
  const narrow = new RegExp(`(?:\\breason\\w*\\s*[:=]\\s*|refuseCreation\\([^,]+,\\s*)['"\`]([a-z_]+\\.[a-z_]+)['"\`]`, 'g');
  const unknown: string[] = [];
  for (const name of readdirSync(E2E).filter((file) => /\.ts$/.test(file))) {
    const source = readFileSync(join(E2E, name), 'utf8');
    const pattern = name.startsWith('mock-') ? broad : narrow;
    for (const match of source.matchAll(pattern)) {
      const key = match[1] ?? '';
      if (!KNOWN.includes(key)) unknown.push(`${name}: ${key}`);
    }
  }
  expect(unknown).toEqual([]);
});

test('le faux moteur refuse de poser une clé hors ERROR_REASONS (garde dans fail et dans POST /__fail)', () => {
  const source = readFileSync(join(E2E, 'mock-engine.ts'), 'utf8');
  expect(source).toMatch(/ERROR_REASONS/);
  expect(source).toMatch(/!isErrorReason\(reason\)\) throw/);
  expect(source).toMatch(/!isErrorReason\(forced\.reason\)\) return send\(res, 400/);
});
