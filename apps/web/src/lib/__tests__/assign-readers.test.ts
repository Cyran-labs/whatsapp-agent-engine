import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const SRC = join(__dirname, '..', '..');
const read = (path: string): string => readFileSync(join(SRC, path), 'utf8');

/**
 * Écrans qui décident d'un branchement : chacun appelle `assignRefusal` (décision des contrats, `decideAssign`), soit
 * directement, soit par `choosableNumbers`, `selectableGroups` et `NumberPicker`, qui reçoivent le statut de l'agent IA.
 */
const DECIDERS = [
  'components/connections/number-menu.tsx',
  'components/connections/assign-bot-dialog.tsx',
  'components/connections/numbers-table.tsx',
  'components/numbers/number-picker.tsx',
];
const PICKER_USERS = ['components/agent/assign-number-dialog.tsx', 'components/wizard/step-number.tsx'];

/**
 * Comparaison de l'état d'un compte à `connected`, sous toutes ses formes (`===`, `!==`, `==`, `!=`, dans les deux sens).
 * Limite : garde textuelle, comme `check:logs`. Une règle recopiée sous une autre forme (`state === 'error' &&
 * isServingStatus(…)`) n'est pas reconnue ; l'import et l'appel de `assignRefusal` exigés plus bas la complètent.
 */
const STATE_IS_CONNECTED = /\bstate\s*[!=]==?\s*['"]connected['"]|['"]connected['"]\s*[!=]==?\s*[\w.?]*\bstate\b/;

// entête 5, recette 3.7 : la décision d'écran appelle decideAssign des contrats, pas une règle recopiée sur l'état du compte
describe('décisions de branchement des écrans (entête 5)', () => {
  test.each(DECIDERS)('%s importe assignRefusal de lib/assign-choice', (file) => {
    const source = read(file);
    expect(source).toMatch(/import\s*\{[^}]*\bassignRefusal\b[^}]*\}\s*from\s*['"]@\/lib\/assign-choice['"]/);
    expect(source).toMatch(/\bassignRefusal\(/);
  });

  test.each(PICKER_USERS)('%s passe le statut de l\'agent IA au choix des numéros', (file) => {
    const source = read(file);
    expect(source).toMatch(/choosableNumbers\(accounts,\s*\w+/);
    expect(source).toMatch(/selectableGroups\(accounts,\s*\w+/);
    expect(source).toMatch(/<NumberPicker[^>]*\bbotStatus=/);
  });

  test.each([...DECIDERS, ...PICKER_USERS])('%s ne compare pas l\'état d\'un compte à « connected » pour décider', (file) => {
    expect(read(file)).not.toMatch(STATE_IS_CONNECTED);
  });

  test('la garde reconnaît une comparaison à « connected » (témoin)', () => {
    for (const sample of ["account.state !== 'connected'", "group.account.state === 'connected'", "'connected' === account.state", 'state=="connected"']) {
      expect(sample).toMatch(STATE_IS_CONNECTED);
    }
    expect("account.state === 'error'").not.toMatch(STATE_IS_CONNECTED);
  });

  test('lib/assign-choice appelle decideAssign des contrats', () => {
    const source = read('lib/assign-choice.ts');
    expect(source).toMatch(/import\s*\{[^}]*\bdecideAssign\b[^}]*\}\s*from\s*['"]@wabagent\/contracts['"]/);
    expect(source).toMatch(/\bdecideAssign\(/);
  });
});
