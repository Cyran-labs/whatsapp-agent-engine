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
    expect(offenders(frFlat, /[—–]/)).toEqual([]);
    expect(offenders(enFlat, /[—–]/)).toEqual([]);
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
