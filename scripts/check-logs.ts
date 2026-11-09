/**
 * Garde statique des journaux du moteur : aucun secret, aucune donnée de contact, aucun objet d'erreur
 * entier ne doit être écrit par `console.log|info|warn|error` (lot Restitution des erreurs, Q-9 et Q-11).
 *
 * Usage : `npm run check:logs`. Parcourt `src/**` hors `__tests__` ; sortie `fichier:ligne: motif` ;
 * code de sortie 1 au moindre refus.
 *
 * Deux règles, appliquées aux arguments de chaque appel (le texte fixe des chaînes est ignoré) :
 * 1. un identifiant d'erreur nu (`err`, `error`, `e`, `xxxErr`, `xxxError`) passé en argument, seul, dans un objet
 *    littéral (`{ err }`) ou sous la forme `err as Error` : l'objet peut porter un corps de requête, des en-têtes ou
 *    des valeurs sensibles ; la forme acceptée est `err instanceof Error ? err.message : String(err)` ;
 * 2. une des valeurs `responseText`, `rawResponse`, `body`, `payload`, `text`, `content`, `trimmed`, `profileName`,
 *    `fullName`, `prenom`, `nom`, `societe`, `link`, `token`, `secret`, `providerDetail`, `phone`, `email`,
 *    `contactId`, `invitee_*` (nom entier d'identifiant ou de propriété) ou `JSON.stringify` interpolée ou passée
 *    hors d'un appel `maskContact(...)` ou `maskEmail(...)`. `phoneNumberId` ou `bodyParserType` ne sont pas visés.
 *
 * Exemption explicite : un commentaire `// check-logs-ignore: <raison>` sur la ligne qui précède l'appel `console.*`.
 * La raison est obligatoire (sans raison, l'exemption est elle-même refusée). Chaque exemption acceptée est listée à
 * chaque exécution, même quand la garde réussit, et un test fige la liste attendue : toute nouvelle exemption casse
 * ce test et doit être justifiée.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface LogViolation {
  file: string;
  line: number;
  motif: string;
}

/** Appel `console.*` explicitement exempté par un commentaire `check-logs-ignore`. */
export interface LogExemption {
  file: string;
  line: number;
  reason: string;
}

export interface LogCheckResult {
  violations: LogViolation[];
  exemptions: LogExemption[];
}

const ERROR_OBJECT_MOTIF = "objet d'erreur entier passé à la console";
const SENSITIVE_MOTIF = 'donnée sensible journalisée : ';
const EMPTY_EXEMPTION_MOTIF = 'exemption check-logs-ignore sans raison';
const EXEMPTION_COMMENT = /^\s*\/\/\s*check-logs-ignore:(.*)$/;

const CONSOLE_CALL = /console\s*\.\s*(?:log|info|warn|error)\s*\(/g;
const ERROR_IDENTIFIER = '(?:e|err|error|[a-z]\\w*(?:Err|Error))';
const BARE_ERROR_ARGUMENT = new RegExp(`^${ERROR_IDENTIFIER}$`);
/** Erreur typée sans être lue : `err as Error`, `(err as Error)` (mais `(err as Error).message` est accepté). */
const CAST_ERROR_ARGUMENT = new RegExp(`^\\(?\\s*${ERROR_IDENTIFIER}\\s+as\\s+[\\w.]+\\s*\\)?$`);
/** Identifiant d'erreur dans un objet littéral, hors clé (`{ err }`, `{ error: err }`, pas `{ error: 'x' }`). */
const ERROR_IN_OBJECT = new RegExp(`(?<![\\w$.])${ERROR_IDENTIFIER}(?![\\w$])(?!\\s*:)`);
const SENSITIVE_WORDS = /(?<![\w$])(responseText|rawResponse|body|payload|text|content|trimmed|profileName|fullName|prenom|nom|societe|link|token|secret|providerDetail|phone|email|contactId|invitee_\w+)(?![\w$])/g;
const JSON_STRINGIFY = /(?<![\w$])JSON\s*\.\s*stringify(?![\w$])/;

function isErrorObjectArgument(arg: string): boolean {
  if (BARE_ERROR_ARGUMENT.test(arg) || CAST_ERROR_ARGUMENT.test(arg)) return true;
  return arg.startsWith('{') && ERROR_IN_OBJECT.test(arg);
}
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
  return checkSourceDetailed(file, source).violations;
}

/** Comme `checkSource`, avec la liste des exemptions acceptées. */
export function checkSourceDetailed(file: string, source: string): LogCheckResult {
  const code = blankLiterals(source);
  const lines = source.split('\n');
  const violations: LogViolation[] = [];
  const exemptions: LogExemption[] = [];
  CONSOLE_CALL.lastIndex = 0;
  for (let m = CONSOLE_CALL.exec(code); m !== null; m = CONSOLE_CALL.exec(code)) {
    const open = m.index + m[0].length - 1;
    const close = matchingParen(code, open);
    const args = code.slice(open + 1, close === -1 ? code.length : close);
    const line = lineOf(source, m.index);

    const exemption = line >= 2 ? EXEMPTION_COMMENT.exec(lines[line - 2] ?? '') : null;
    if (exemption !== null) {
      const reason = (exemption[1] ?? '').trim();
      if (reason.length === 0) violations.push({ file, line, motif: EMPTY_EXEMPTION_MOTIF });
      else exemptions.push({ file, line, reason });
      continue;
    }

    if (topLevelArguments(args).some(isErrorObjectArgument)) {
      violations.push({ file, line, motif: ERROR_OBJECT_MOTIF });
    }

    const unmasked = withoutMaskCalls(args);
    const found = new Set<string>();
    for (const word of unmasked.matchAll(SENSITIVE_WORDS)) {
      const name = word[1] ?? '';
      // `lead.phone` et `lead.email` sont signalés avec leur point, comme dans la règle d'origine.
      const dotted = (name === 'phone' || name === 'email') && unmasked[(word.index ?? 0) - 1] === '.';
      found.add(dotted ? `.${name}` : name);
    }
    if (JSON_STRINGIFY.test(unmasked)) found.add('JSON.stringify');
    for (const term of found) violations.push({ file, line, motif: `${SENSITIVE_MOTIF}${term}` });
  }
  return { violations, exemptions };
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
export function scanEngine(root: string = REPO_ROOT): LogCheckResult {
  const result: LogCheckResult = { violations: [], exemptions: [] };
  for (const path of engineFiles(join(root, 'src')).sort()) {
    const one = checkSourceDetailed(relative(root, path), readFileSync(path, 'utf8'));
    result.violations.push(...one.violations);
    result.exemptions.push(...one.exemptions);
  }
  return result;
}

export function scanEngineLogs(root: string = REPO_ROOT): LogViolation[] {
  return scanEngine(root).violations;
}

function main(): void {
  const { violations, exemptions } = scanEngine();
  for (const e of exemptions) console.log(`[check-logs] exemption acceptée : ${e.file}:${e.line}: ${e.reason}`);
  if (violations.length === 0) {
    console.log('[check-logs] ok');
    return;
  }
  for (const v of violations) console.error(`${v.file}:${v.line}: ${v.motif}`);
  console.error(`[check-logs] ${violations.length} appel(s) refusé(s) : voir scripts/check-logs.ts pour les règles`);
  process.exit(1);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
