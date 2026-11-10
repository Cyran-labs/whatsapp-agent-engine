import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { test, expect } from 'vitest';

const SRC = join(__dirname, '..', '..');

/** Fichiers du code de l'application (hors tests). */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Seuls fichiers qui touchent au texte brut d'un refus : celui qui le construit et celui qui le lit pour les écrans. */
const ALLOWED = ['lib/api-fetch.ts', 'lib/describe-failure.ts'];

/**
 * Tâche 16b (défauts D-1 et D-2 de la tâche 16) : un écran qui affichait `MutationFailure.error`, le texte du moteur,
 * montrait « Erreur interne. » sur une panne (ni texte contextuel ni référence, audit R-14) et du français dans
 * l'interface anglaise (audit R-15). Le champ s'appelle `engineText` : un lecteur resté sur `.error` ne compile plus, et
 * ce test casse si un écran lit `engineText` au lieu de passer par `describeFailure` (ou `useMutate`,
 * `useDescribeFailure`).
 */
test('le texte brut d\'un refus (MutationFailure.engineText) n\'est lu que par api-fetch.ts et describe-failure.ts', () => {
  const readers = sources(SRC)
    .filter((file) => /\bengineText\b/.test(readFileSync(file, 'utf8')))
    .map((file) => relative(SRC, file).split(sep).join('/'))
    .sort();
  expect(readers).toEqual(ALLOWED);
});
