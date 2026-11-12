import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';
import fr from '../../../messages/fr.json';
import en from '../../../messages/en.json';

/**
 * Garde des clés de traduction (revue finale A, I-2) : toute clé lue par le code avec un texte littéral existe dans
 * `fr.json` et dans `en.json`. Le défaut qu'elle arrête : `t('simulate')` lu dans l'espace `overview` alors que la clé
 * avait été retirée, affiché « overview.simulate » en titre sans qu'aucun test ne casse.
 *
 * Lecture par l'arbre syntaxique de TypeScript, avec la portée lexicale : un traducteur est une constante initialisée
 * par `useTranslations('espace')`, `useTranslations()` ou `await getTranslations('espace')` ; ses appels `t('clé')`,
 * `t.rich('clé')`, `t.markup('clé')` et `t.raw('clé')` sont vérifiés, y compris les deux branches littérales d'un
 * ternaire (`t(cond ? 'a' : 'b')`). Un nom redéclaré dans une portée intérieure (paramètre, autre constante) masque le
 * traducteur, comme pour le compilateur.
 *
 * Limites (non vérifiées, faute de valeur connue sans exécuter le code) :
 * - les clés calculées (`t(\`reasons.${x}\`)`, `t(key)`) et les espaces calculés (`useTranslations(\`connections.${kind}\`)`) ;
 * - les traducteurs reçus en paramètre (`describeFailure(t, …)`) ou passés par une fonction fléchée (`(key) => t(key)`) ;
 * - `t.has('clé')`, qui teste justement l'existence d'une clé.
 */

type Tree = { [key: string]: string | Tree };

function lookup(tree: Tree, path: string): string | Tree | undefined {
  let node: string | Tree | undefined = tree;
  for (const part of path.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return node;
}

interface KeyRead {
  file: string;
  line: number;
  key: string;
  /** `raw` accepte une branche entière ; les autres lectures exigent un texte. */
  raw: boolean;
}

const TRANSLATOR_FACTORIES = new Set(['useTranslations', 'getTranslations']);
const CHECKED_METHODS = new Set(['rich', 'markup', 'raw']);

/** Espace du traducteur créé par cette expression, ou `undefined` si ce n'est pas un traducteur d'espace littéral. */
function translatorNamespace(init: ts.Expression): string | undefined {
  const call = ts.isAwaitExpression(init) ? init.expression : init;
  if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) return undefined;
  if (!TRANSLATOR_FACTORIES.has(call.expression.text)) return undefined;
  if (call.arguments.length === 0) return '';
  const [arg] = call.arguments;
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
  return undefined;
}

function literalKeys(arg: ts.Expression): string[] {
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return [arg.text];
  if (ts.isParenthesizedExpression(arg)) return literalKeys(arg.expression);
  if (ts.isConditionalExpression(arg)) return [...literalKeys(arg.whenTrue), ...literalKeys(arg.whenFalse)];
  return [];
}

/** Noms liés par un motif de déclaration (identifiant, déstructuration). */
function boundNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : boundNames(element.name)));
}

/** Lectures de clés littérales d'un fichier source, avec la portée lexicale des traducteurs. */
function keyReads(file: string, source: string): KeyRead[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const reads: KeyRead[] = [];
  // Pile des portées : nom vers espace du traducteur, ou `null` quand le nom masque un traducteur extérieur.
  const scopes: Array<Map<string, string | null>> = [new Map()];

  const resolve = (name: string): string | null | undefined => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      if (scopes[i].has(name)) return scopes[i].get(name);
    }
    return undefined;
  };

  const declare = (names: string[], namespace: string | null): void => {
    for (const name of names) scopes[scopes.length - 1].set(name, namespace);
  };

  const record = (call: ts.CallExpression, namespace: string, raw: boolean): void => {
    const [arg] = call.arguments;
    if (!arg) return;
    const { line } = sourceFile.getLineAndCharacterOfPosition(call.getStart());
    for (const key of literalKeys(arg)) {
      reads.push({ file, line: line + 1, key: namespace ? `${namespace}.${key}` : key, raw });
    }
  };

  const opensScope = (node: ts.Node): boolean =>
    ts.isBlock(node) || ts.isSourceFile(node) || ts.isFunctionLike(node) || ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isCatchClause(node);

  /** Déclarations d'une portée, posées avant de lire son contenu (les fonctions sont visibles avant leur ligne). */
  const hoist = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) {
      for (const parameter of node.parameters) declare(boundNames(parameter.name), null);
    }
    if (ts.isCatchClause(node) && node.variableDeclaration) declare(boundNames(node.variableDeclaration.name), null);
    const statements = ts.isBlock(node) || ts.isSourceFile(node) ? node.statements : undefined;
    if (!statements) return;
    for (const statement of statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name) declare([statement.name.text], null);
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          const namespace = declaration.initializer ? translatorNamespace(declaration.initializer) : undefined;
          declare(boundNames(declaration.name), namespace ?? null);
        }
      }
    }
  };

  const visit = (node: ts.Node): void => {
    const scoped = opensScope(node);
    if (scoped) {
      scopes.push(new Map());
      hoist(node);
    }
    if ((ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) && node.initializer && ts.isVariableDeclarationList(node.initializer)) {
      for (const declaration of node.initializer.declarations) declare(boundNames(declaration.name), null);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee)) {
        const namespace = resolve(callee.text);
        if (typeof namespace === 'string') record(node, namespace, false);
      } else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && CHECKED_METHODS.has(callee.name.text)) {
        const namespace = resolve(callee.expression.text);
        if (typeof namespace === 'string') record(node, namespace, callee.name.text === 'raw');
      }
    }
    ts.forEachChild(node, visit);
    if (scoped) scopes.pop();
  };

  visit(sourceFile);
  return reads;
}

/** Lectures absentes d'un catalogue : clé inconnue, ou branche lue comme un texte. */
function missingIn(catalog: Tree, reads: KeyRead[]): string[] {
  return reads
    .filter(({ key, raw }) => {
      const value = lookup(catalog, key);
      return raw ? value === undefined : typeof value !== 'string';
    })
    .map(({ file, line, key }) => `${file}:${line} ${key}`);
}

const SRC = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !entry.endsWith('.d.ts') ? [path] : [];
  });
}

const ALL_READS = sourceFiles(SRC).flatMap((path) => keyReads(relative(SRC, path), readFileSync(path, 'utf8')));

// revue finale A, I-2 : une clé lue par le code et absente d'un catalogue fait échouer les tests
describe('clés de traduction lues par le code', () => {
  test('la garde trouve les lectures du code (témoin de couverture)', () => {
    // Sans lecture trouvée, les deux tests suivants seraient verts pour rien.
    expect(ALL_READS.length).toBeGreaterThan(500);
    expect(ALL_READS.map((read) => read.key)).toContain('overview.simulate');
  });

  test('toute clé lue existe dans fr.json', () => {
    expect(missingIn(fr as Tree, ALL_READS)).toEqual([]);
  });

  test('toute clé lue existe dans en.json', () => {
    expect(missingIn(en as Tree, ALL_READS)).toEqual([]);
  });
});

// décision de François (vague finale) : l'état « Whitelist vide » a un seul texte partout (encart Statut, encadré, bulle
// de la liste, colonne, Connexions, Santé), une seule clé par langue ; l'ancienne phrase de l'encart n'existe plus
describe('texte de l\'état « Whitelist vide »', () => {
  const PHRASE_KEY = 'agents.notResponding.emptyAllowlist.hint';
  const LABEL_KEY = 'agents.notResponding.emptyAllowlist.label';
  const flat = (tree: Tree, prefix = ''): Array<[string, string]> =>
    Object.entries(tree).flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof value === 'string' ? [[path, value] as [string, string]] : flat(value, path);
    });

  test('étiquette et phrase retenues, FR et EN', () => {
    expect(lookup(fr as Tree, LABEL_KEY)).toBe('Whitelist vide');
    expect(lookup(fr as Tree, PHRASE_KEY)).toBe('Ajoutez un numéro à la Whitelist pour que cet agent IA réponde.');
    expect(typeof lookup(en as Tree, PHRASE_KEY)).toBe('string');
  });

  test('l\'ancienne phrase n\'existe plus, ni dans les catalogues ni dans le code', () => {
    const old = [/ne répond à personne\s*:\s*sa Whitelist est vide/i, /answers nobody:\s*its Allowlist is empty/i];
    for (const [key, value] of [...flat(fr as Tree), ...flat(en as Tree)]) {
      for (const pattern of old) expect(`${key} = ${value}`).not.toMatch(pattern);
    }
    for (const path of sourceFiles(SRC)) {
      for (const pattern of old) expect(readFileSync(path, 'utf8'), path).not.toMatch(pattern);
    }
    expect(lookup(fr as Tree, 'agentStatus.emptyList.text')).toBeUndefined();
    expect(lookup(en as Tree, 'agentStatus.emptyList.text')).toBeUndefined();
  });

  test('une seule clé porte la phrase par langue, et c\'est la seule lue pour cet état', () => {
    for (const catalog of [fr as Tree, en as Tree]) {
      const phrase = lookup(catalog, PHRASE_KEY);
      expect(flat(catalog).filter(([, value]) => value === phrase).map(([key]) => key)).toEqual([PHRASE_KEY]);
    }
    const phraseReads = ALL_READS.filter((read) => read.key === PHRASE_KEY);
    expect(phraseReads.length).toBeGreaterThan(0);
    // Aucune autre clé lue ne dit que la Whitelist est vide en phrase (seules l'étiquette et la mention courte le nomment).
    const emptyWords = /Whitelist est vide|Whitelist vide\b.*\.|ne répond à personne/i;
    const otherReads = ALL_READS.filter((read) => read.key !== PHRASE_KEY && read.key !== LABEL_KEY)
      .filter((read) => emptyWords.test(String(lookup(fr as Tree, read.key) ?? '')) && /Whitelist/.test(String(lookup(fr as Tree, read.key) ?? '')));
    expect(otherReads.map((read) => read.key)).toEqual([]);
  });
});

describe('lecture des clés (témoins)', () => {
  const keysOf = (source: string, file = 'sample.tsx'): string[] => keyReads(file, source).map((read) => read.key);

  test('espace, racine, rich, markup, raw et ternaire littéral', () => {
    const source = `
      function A() {
        const t = useTranslations('overview');
        const root = useTranslations();
        return [t('simulate'), root('common.save'), t.rich('liveOn', {}), t.markup('m', {}), t.raw('list'), t(ok ? 'yes' : 'no')];
      }
      async function B() { const t = await getTranslations('auth'); return t('title'); }`;
    expect(keysOf(source)).toEqual(['overview.simulate', 'common.save', 'overview.liveOn', 'overview.m', 'overview.list', 'overview.yes', 'overview.no', 'auth.title']);
  });

  test('portée lexicale : chaque composant a son traducteur, un paramètre masque le traducteur extérieur', () => {
    const source = `
      function A() { const t = useTranslations('agents'); return t('title'); }
      function B() {
        const t = useTranslations('usage');
        const inner = (t: (key: string) => string) => t('notChecked');
        return t('title');
      }`;
    expect(keysOf(source)).toEqual(['agents.title', 'usage.title']);
  });

  test('clés et espaces calculés ignorés (limite écrite)', () => {
    const source = `
      function A({ kind, key }) {
        const t = useTranslations(\`connections.\${kind}\`);
        const u = useTranslations('agents');
        return [t('title'), u(key), u(\`reasons.\${key}\`), u.has('maybe')];
      }`;
    expect(keysOf(source)).toEqual([]);
  });

  test('missingIn : clé absente, branche lue comme un texte, raw sur une branche', () => {
    const catalog: Tree = { a: { b: 'B', list: { x: 'X' } } };
    const reads: KeyRead[] = [
      { file: 'f', line: 1, key: 'a.b', raw: false },
      { file: 'f', line: 2, key: 'a.missing', raw: false },
      { file: 'f', line: 3, key: 'a.list', raw: false },
      { file: 'f', line: 4, key: 'a.list', raw: true },
    ];
    expect(missingIn(catalog, reads)).toEqual(['f:2 a.missing', 'f:3 a.list']);
  });
});
