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
  'auth.loginUnavailable',
  'auth.invite.loadError',
  'auth.invite.sessionError',
  'auth.forgot.sendError',
  'wizard.createError',
  'wizard.number.failedReason',
  'wizard.activate.activateFailed',
  'wizard.activate.failedReason',
  'agentStatus.failed',
  'agentAllowlist.failed',
  'connections.dialogs.failed',
  'connections.verify.inconclusive',
  'connections.connectFlow.errors.failed',
  'errors.generic.network',
  'errors.generic.server',
];

describe('messages d\'échec génériques', () => {
  test.each(GENERIC_FAILURES)('%s : « Réessayez. » en FR, « Please try again. » en EN, en phrases séparées', (key) => {
    expect(frFlat[key]).toMatch(/\. [^.]*[Rr]éessayez[^.]*\.$/);
    expect(frFlat[key]).not.toMatch(/[,:;] ?réessayez/i);
    expect(enFlat[key]).toMatch(/\. [^.]*Please try again[^.]*\.$/);
    expect(enFlat[key]).not.toMatch(/[,:;] ?(please )?try again/i);
  });
});

// contre-audit D-8 (écart EN) : en anglais, « Brancher » / « Débrancher » (un numéro sur un agent IA) se disent
// « Assign » / « Unassign », jamais « Connect » / « Disconnect », réservés à « Raccorder » un compte WhatsApp.
describe('vocabulaire anglais du branchement', () => {
  // Messages qui disent aussi « Raccordez le compte » : « Connect » y est le bon mot pour le compte.
  const MIXED = new Set(['connections.emptyText']);

  test('toute clé française sur « brancher » ou « débrancher » dit « assign » ou « unassign » en anglais', () => {
    const wrong: string[] = [];
    for (const [key, value] of Object.entries(frFlat)) {
      if (!/\b(?:d[ée])?branch/i.test(value) || MIXED.has(key)) continue;
      const english = enFlat[key] ?? '';
      if (/\b(?:dis)?connect/i.test(english)) wrong.push(`${key} = ${english}`);
    }
    expect(wrong).toEqual([]);
  });

  test('libellés des actions', () => {
    expect(enFlat['connections.numbers.assign']).toBe('Assign to an AI agent');
    expect(enFlat['connections.numbers.assignShort']).toBe('Assign');
    expect(enFlat['connections.menu.assign']).toBe('Assign to an AI agent');
    expect(enFlat['connections.menu.unassign']).toBe('Unassign from AI agent');
    expect(enFlat['agentNumber.assign']).toBe('Assign a number');
    expect(enFlat['agentNumber.unassign']).toBe('Unassign');
    expect(enFlat['connections.unassign.confirm']).toBe('Unassign AI agent');
    expect(enFlat['connections.connect']).toBe('+ Connect a WhatsApp account');
    expect(enFlat['agentNumber.dialog.connect']).toBe('Connect a WhatsApp account');
  });
});
