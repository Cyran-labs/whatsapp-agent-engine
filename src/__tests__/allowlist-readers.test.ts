/**
 * Liste d'accès limité (Whitelist) des agents IA : numéros de contacts (spec « Refonte de la navigation », 9.2).
 * `presentBotForViewer` masque la liste pour un membre hors de l'entité de l'agent IA. Garde statique, sur le modèle de
 * `cost-readers.test.ts` : le masquage est appliqué route par route, donc le test casse si une route de `src/api`
 * renvoie le résultat de `getBot` ou `listBots` (ou d'une écriture qui renvoie l'agent IA en entier) sans passer par
 * `presentBotForViewer`, ou si l'action qui autorise ces réponses en entier s'ouvre à un autre rôle que l'administrateur
 * et l'opérateur.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { can, type Access } from '../core/auth/permissions.js';

const SRC = join(import.meta.dirname, '..');
const API = join(SRC, 'api');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

/** Sans commentaires : un mot cité dans un commentaire ne doit pas valoir garde. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

const apiFiles = sourceFiles(API).map((path) => ({
  path: relative(SRC, path),
  text: stripComments(readFileSync(path, 'utf8')),
}));

/** Méthodes de `BotService` qui renvoient l'agent IA en entier (`BotDetail`, liste d'accès comprise) ou une liste de ceux-ci. */
const BOT_DETAIL_CALL = new RegExp(
  '\\bbotService\\.(?:getBot|listBots|createBot|updateBot|assignNumber|unassignNumber|setStatus|setAllowlist|activate)\\s*\\(' +
    // Les deux lectures, sous n'importe quel nom de variable.
    '|\\.(?:getBot|listBots)\\s*\\(',
);
const BOTS_ROUTES = 'api/admin/routes/bots.ts';

/** Chaque déclaration de route, de `r.<méthode>(` à la suivante. */
function declarations(text: string): string[] {
  return text.split(/\n(?=\s*r\.(?:get|post|put|patch|delete)\()/).slice(1);
}

function guards(declaration: string): string[] {
  return [...declaration.matchAll(/requireAction\('([^']+)'\)/g)].map((m) => m[1]!);
}

describe('liste d\'accès limité : masquée pour tout lecteur org.read', () => {
  // revue isolation navigation m-2
  it('aucune route hors bots.ts n\'appelle BotService, et la base n\'est pas lue par l\'API pour la liste', () => {
    const outside = apiFiles
      .filter((f) => f.path !== BOTS_ROUTES && (BOT_DETAIL_CALL.test(f.text) || /\bgetAllowlist\s*\(/.test(f.text)))
      .map((f) => f.path);
    expect(outside).toEqual([]);
  });

  // revue isolation navigation m-2
  it('chaque route de bots.ts qui renvoie un agent IA est sous bots.configure seul, ou enveloppe presentBotForViewer', () => {
    const routes = declarations(apiFiles.find((f) => f.path === BOTS_ROUTES)!.text);
    const callers = routes.filter((d) => BOT_DETAIL_CALL.test(d));
    // Garde-fou du test lui-même : les deux lectures et les écritures sont bien repérées.
    expect(callers.length).toBeGreaterThanOrEqual(9);
    const reads = callers.filter((d) => /\.(getBot|listBots)\s*\(/.test(d) && /^\s*r\.get\(/.test(d));
    expect(reads).toHaveLength(2);
    for (const d of callers) {
      const gated = guards(d).length === 1 && guards(d)[0] === 'bots.configure';
      const masked = /presentBotForViewer\s*\(/.test(d);
      expect(gated || masked, `route sans masquage ni bots.configure : ${d.trim().split('\n')[0]}`).toBe(true);
    }
    // Les lectures ouvertes à org.read passent obligatoirement par le masquage, jamais par la seule garde.
    for (const d of reads) {
      expect(guards(d)).toEqual(['org.read']);
      expect(d).toMatch(/presentBotForViewer\s*\(/);
    }
  });

  // revue isolation navigation m-2
  it('bots.configure reste réservée à l\'administrateur et à l\'opérateur', () => {
    const base: Access = { userId: 1, clientId: 'org', platformAdmin: false, orgRole: null, entityRoles: [], readOnly: false };
    const refused: Access[] = [
      { ...base, orgRole: 'super_manager' },
      { ...base, orgRole: 'super_manager', readOnly: true },
      { ...base, entityRoles: [{ entityId: 1, role: 'manager' }] },
      { ...base, entityRoles: [{ entityId: 1, role: 'advisor' }] },
      { ...base, entityRoles: [{ entityId: 1, role: 'manager' }], readOnly: true },
      base,
    ];
    for (const access of refused) expect(can(access, 'bots.configure'), JSON.stringify(access)).toBe(false);
    expect(can({ ...base, orgRole: 'admin' }, 'bots.configure')).toBe(true);
    expect(can({ ...base, platformAdmin: true }, 'bots.configure')).toBe(true);
  });
});
