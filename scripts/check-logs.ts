/**
 * Garde statique des journaux du moteur : aucun secret, aucune donnée de contact, aucun objet d'erreur
 * entier ne doit être écrit par `console.log|info|warn|error` (lot Restitution des erreurs, Q-9 et Q-11).
 *
 * Usage : `npm run check:logs`. Parcourt `src/**` hors `__tests__` ; sortie `fichier:ligne: motif` ;
 * code de sortie 1 au moindre refus.
 *
 * Deux règles, appliquées aux arguments de chaque appel (le texte fixe des chaînes est ignoré) :
 * 1. un identifiant d'erreur nu (`err`, `error`, `e`, `xxxErr`, `xxxError`) passé en argument : l'objet peut porter
 *    un corps de requête, des en-têtes ou des valeurs sensibles ; la forme acceptée est
 *    `err instanceof Error ? err.message : String(err)` ;
 * 2. une des valeurs `responseText`, `profileName`, `fullName`, `link`, `token`, `secret`, `text`, `content`,
 *    `trimmed`, `.phone`, `.email` interpolée ou passée hors d'un appel `maskContact(...)` ou `maskEmail(...)`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface LogViolation {
  file: string;
  line: number;
  motif: string;
}

const ERROR_OBJECT_MOTIF = "objet d'erreur entier passé à la console";
const SENSITIVE_MOTIF = 'donnée sensible journalisée : ';

const CONSOLE_CALL = /console\s*\.\s*(?:log|info|warn|error)\s*\(/g;
const BARE_ERROR_ARGUMENT = /^(?:e|err|error|[a-z]\w*(?:Err|Error))$/;
const SENSITIVE_WORDS = /(?<![\w$])(responseText|profileName|fullName|link|token|secret|text|content|trimmed)(?![\w$])/g;
const SENSITIVE_PROPERTIES = /(\.phone|\.email)(?![\w$])/g;
const MASK_CALL = /(?<![\w$])(?:maskContact|maskEmail)\s*\(/g;

/**
 * Copie du source de même longueur où les commentaires et le texte fixe des chaînes sont remplacés par des
 * espaces (retours à la ligne conservés). Les expressions d'une chaîne gabarit (`${...}`) restent du code.
 */
function blankLiterals(source: string): string {
  const out = source.split('');
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  // Pile des contextes ouverts : 'code' (accolade ordinaire) ou 'template' (accolade fermante d'une interpolation).
  const braces: Array<'code' | 'interpolation'> = [];
  let i = 0;

  const scanTemplate = (): void => {
    // `i` est sur le caractère qui suit le « ` » ouvrant ou la « } » fermant d'une interpolation.
    while (i < source.length) {
      const c = source[i];
      if (c === '\\') { blank(i, i + 2); i += 2; continue; }
      if (c === '`') { blank(i, i + 1); i += 1; return; }
      if (c === '$' && source[i + 1] === '{') {
        blank(i, i + 2);
        i += 2;
        braces.push('interpolation');
        return;
      }
      blank(i, i + 1);
      i += 1;
    }
  };

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
      blank(i, j + 1);
      i = j + 1;
    } else if (c === '`') {
      blank(i, i + 1);
      i += 1;
      scanTemplate();
    } else if (c === '{') {
      braces.push('code');
      i += 1;
    } else if (c === '}') {
      const top = braces.pop();
      if (top === 'interpolation') {
        blank(i, i + 1);
        i += 1;
        scanTemplate();
      } else {
        i += 1;
      }
    } else {
      i += 1;
    }
  }
  return out.join('');
}

/** Index de la parenthèse fermante qui correspond à la parenthèse ouvrante située à `open`, ou -1. */
function matchingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Retire de `args` les appels `maskContact(...)` et `maskEmail(...)` (arguments compris). */
function withoutMaskCalls(args: string): string {
  let result = args;
  for (;;) {
    MASK_CALL.lastIndex = 0;
    const m = MASK_CALL.exec(result);
    if (!m) return result;
    const open = m.index + m[0].length - 1;
    const close = matchingParen(result, open);
    const end = close === -1 ? result.length : close + 1;
    result = `${result.slice(0, m.index)} ${result.slice(end)}`;
  }
}

/** Découpe les arguments au niveau supérieur (virgules hors parenthèses, crochets et accolades). */
function topLevelArguments(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) {
      parts.push(args.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(args.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (source[i] === '\n') line += 1;
  return line;
}

/** Contrôle le source d'un fichier ; `file` n'est repris que dans le résultat. */
export function checkSource(file: string, source: string): LogViolation[] {
  const code = blankLiterals(source);
  const violations: LogViolation[] = [];
  CONSOLE_CALL.lastIndex = 0;
  for (let m = CONSOLE_CALL.exec(code); m !== null; m = CONSOLE_CALL.exec(code)) {
    const open = m.index + m[0].length - 1;
    const close = matchingParen(code, open);
    const args = code.slice(open + 1, close === -1 ? code.length : close);
    const line = lineOf(source, m.index);

    if (topLevelArguments(args).some((arg) => BARE_ERROR_ARGUMENT.test(arg))) {
      violations.push({ file, line, motif: ERROR_OBJECT_MOTIF });
    }

    const unmasked = withoutMaskCalls(args);
    const found = new Set<string>();
    for (const word of unmasked.matchAll(SENSITIVE_WORDS)) found.add(word[1]);
    for (const prop of unmasked.matchAll(SENSITIVE_PROPERTIES)) found.add(prop[1]);
    for (const term of found) violations.push({ file, line, motif: `${SENSITIVE_MOTIF}${term}` });
  }
  return violations;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function engineFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') files.push(...engineFiles(path));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(path);
    }
  }
  return files;
}

/** Contrôle `src/**` du moteur hors `__tests__` ; les chemins du résultat sont relatifs à la racine du dépôt. */
export function scanEngineLogs(root: string = REPO_ROOT): LogViolation[] {
  const violations: LogViolation[] = [];
  for (const path of engineFiles(join(root, 'src')).sort()) {
    violations.push(...checkSource(relative(root, path), readFileSync(path, 'utf8')));
  }
  return violations;
}

function main(): void {
  const violations = scanEngineLogs();
  if (violations.length === 0) {
    console.log('[check-logs] ok');
    return;
  }
  for (const v of violations) console.error(`${v.file}:${v.line}: ${v.motif}`);
  console.error(`[check-logs] ${violations.length} appel(s) refusé(s) : voir scripts/check-logs.ts pour les règles`);
  process.exit(1);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
