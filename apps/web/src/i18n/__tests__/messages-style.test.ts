import fr from '../../../messages/fr.json';
import en from '../../../messages/en.json';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

const frFlat = flatten(fr as Tree);
const enFlat = flatten(en as Tree);

function offenders(flat: Record<string, string>, pattern: RegExp): string[] {
  return Object.entries(flat)
    .filter(([, value]) => pattern.test(value))
    .map(([key, value]) => `${key} = ${value}`);
}

describe('style des messages', () => {
  test('aucun tiret cadratin ni demi-cadratin (FR et EN)', () => {
    expect(offenders(frFlat, /[\u2014\u2013]/)).toEqual([]);
    expect(offenders(enFlat, /[\u2014\u2013]/)).toEqual([]);
  });

  test('FR : jamais « agent » seul, toujours « agent IA »', () => {
    expect(offenders(frFlat, /\bagents?\b(?!\s+IA)/i)).toEqual([]);
  });

  test('EN : jamais « agent » seul, toujours « AI agent »', () => {
    expect(offenders(enFlat, /(?<!AI )\bagents?\b/i)).toEqual([]);
  });

  test('FR et EN ont exactement les mêmes clés', () => {
    expect(Object.keys(frFlat).sort()).toEqual(Object.keys(enFlat).sort());
  });
});

// revue finale 2b-3 m-5 : une seule formule pour les messages d'échec génériques, « <Action> impossible. Réessayez. »
// en français et « <Action> failed. Please try again. » en anglais (le motif propre à chaque contexte précède).
const GENERIC_FAILURES = [
  'auth.saveError',
  'auth.invite.loadError',
  'auth.invite.sessionError',
  'auth.forgot.sendError',
  'wizard.createError',
  'wizard.number.failedReason',
  'wizard.activate.activateFailed',
  'wizard.activate.failedReason',
  'simulate.sendError',
  'agentStatus.failed',
  'agentAllowlist.failed',
  'connections.dialogs.failed',
  'connections.verify.inconclusive',
  'connections.connectFlow.errors.failed',
];

describe('messages d\'échec génériques', () => {
  test.each(GENERIC_FAILURES)('%s : « Réessayez. » en FR, « Please try again. » en EN, en phrases séparées', (key) => {
    expect(frFlat[key]).toMatch(/\. [^.]*[Rr]éessayez[^.]*\.$/);
    expect(frFlat[key]).not.toMatch(/[,:;] ?réessayez/i);
    expect(enFlat[key]).toMatch(/\. [^.]*Please try again[^.]*\.$/);
    expect(enFlat[key]).not.toMatch(/[,:;] ?(please )?try again/i);
  });
});
