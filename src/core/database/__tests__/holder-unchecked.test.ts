import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// revue 2b-3 M-1 (cycle 1, m-3) : le contrôle du détenteur ne se désactive que dans les tests et l'amorçage de données.
// Aucun code de production (API d'administration, services, pilotes) ne construit `{ kind: 'unchecked' }`.

const SRC = path.resolve(__dirname, '../../..');
// Définition du type (contrats), test-support : seuls endroits hors tests où le littéral peut figurer.
const ALLOWED = [`${path.sep}test-support${path.sep}`, `${path.sep}__tests__${path.sep}`];

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return e.name.endsWith('.ts') ? [full] : [];
  });
}

describe('détenteur attendu : unchecked réservé aux tests', () => {
  it("aucun fichier de production de src/ ne construit { kind: 'unchecked' }", () => {
    const offenders = sources(SRC)
      .filter((f) => !ALLOWED.some((a) => f.includes(a)))
      .filter((f) => /kind:\s*'unchecked'/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it("l'API d'administration impose toujours un détenteur attendu", () => {
    const service = fs.readFileSync(path.join(SRC, 'core/services/bot-service.ts'), 'utf8');
    expect(service).toMatch(/expectedHolder: \{ kind: 'expected', bot_id: input\.expected_bot_id \}/);
  });
});
