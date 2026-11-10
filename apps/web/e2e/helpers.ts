import { readFileSync } from 'node:fs';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

const MOCK_URL = 'http://localhost:4999';

export const PASSWORD = 'motdepasse12';

/** Remet le faux moteur dans son état initial (à appeler dans un `beforeEach`). */
export async function resetMock(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${MOCK_URL}/__reset`);
  expect(res.status()).toBe(204);
}

/** Réponse d'erreur imposée à une route du faux moteur (`POST /__fail`) : les champs d'`error` du moteur, plus la méthode et le nombre de réponses. */
export interface ForcedResponseInput {
  /** Route du moteur sans préfixe, ex. `/entities` ou `/bots/demo-1/status`. */
  route: string;
  /** Méthode HTTP visée, toutes si absente. */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  status: number;
  /** Code du moteur, déduit du statut si absent (409 CONFLICT, 400 VALIDATION_ERROR, 500 INTERNAL...). */
  code?: string;
  /** Message du moteur (français), « Refus. » ou « Erreur interne. » si absent. */
  message?: string;
  /** Clé stable du refus (`error.reason`). */
  reason?: string;
  details?: readonly { path: string; message: string; provider_text?: string }[];
  /** Référence de la requête (`error.request_id`), `r` si absente. */
  requestId?: string;
  /** Nombre de réponses forcées, ensuite la route répond normalement. Absent : jusqu'au prochain `resetMock`. */
  times?: number;
}

/** Fait répondre une route du faux moteur par un refus ou une panne : l'unique mécanisme de refus et de panne des parcours. */
export async function forceResponse(request: APIRequestContext, input: ForcedResponseInput): Promise<void> {
  const { requestId, ...rest } = input;
  const res = await request.post(`${MOCK_URL}/__fail`, { data: { ...rest, ...(requestId ? { request_id: requestId } : {}) } });
  expect(res.status()).toBe(204);
}

/** Panne d'une route du faux moteur : répond `status` (500 par défaut) jusqu'au prochain `resetMock`, ou `times` fois. */
export async function failRoute(
  request: APIRequestContext,
  route: string,
  status = 500,
  options: Pick<ForcedResponseInput, 'method' | 'requestId' | 'times'> = {},
): Promise<void> {
  await forceResponse(request, { route, status, ...options });
}

/** Force le refus métier de la création d'un agent IA (`POST /bots`) jusqu'au prochain `resetMock`. */
export async function refuseCreation(request: APIRequestContext, reason: 'bot.entity_required' | 'bot.default_language_missing'): Promise<void> {
  await forceResponse(
    request,
    reason === 'bot.entity_required'
      ? { route: '/bots', method: 'POST', status: 400, message: 'Données invalides.', reason, details: [{ path: 'entity_id', message: 'Choisissez une entité.' }] }
      : {
          route: '/bots',
          method: 'POST',
          status: 400,
          message: 'Données invalides.',
          reason,
          details: [{ path: 'system_prompt', message: 'Aucune personnalité ni prompt pour la langue par défaut (fr).' }],
        },
  );
}

/** Prépare un état du faux moteur (voir `/__scenario`) jusqu'au prochain `resetMock`. */
export async function applyScenario(
  request: APIRequestContext,
  name: 'account-error-check' | 'account-error-provider-text' | 'account-error-cannot-connect' | 'account-error-unreadable' | 'delivery-failures' | 'bot-delivery-failures',
): Promise<void> {
  const res = await request.post(`${MOCK_URL}/__scenario`, { data: { name } });
  expect(res.status()).toBe(204);
}

export async function login(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/fr/login');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

/** Connexion puis attente de la liste des agents IA de l'organisation active. */
export async function loginToAgents(page: Page, email: string): Promise<void> {
  await login(page, email);
  await expect(page.getByRole('heading', { name: 'Tous les agents IA' })).toBeVisible();
}

/** Dernier lien de réinitialisation « envoyé » par le faux moteur (chemin relatif, sans locale), ou null. */
export async function lastResetLink(request: APIRequestContext): Promise<string | null> {
  const res = await request.get(`${MOCK_URL}/__last-reset-link`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { link: string | null }).link;
}

type Locale = 'fr' | 'en';

const MESSAGES: Record<Locale, unknown> = {
  fr: JSON.parse(readFileSync(new URL('../messages/fr.json', import.meta.url), 'utf8')),
  en: JSON.parse(readFileSync(new URL('../messages/en.json', import.meta.url), 'utf8')),
};

/** Index du `}` qui ferme l'accolade ouverte à `open`. */
function closingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`[e2e] accolade non fermée dans « ${text} »`);
}

/** Pluriel ICU `{n, plural, =0 {…} one {…} other {…}}` : la branche choisie par `Intl.PluralRules` de la langue (en français, 0 est « one »), `#` remplacé par le nombre. */
function pickPlural(branches: string, count: number, locale: Locale): string {
  const chosen = new Map<string, string>();
  let i = 0;
  while (i < branches.length) {
    const open = branches.indexOf('{', i);
    if (open < 0) break;
    const key = branches.slice(i, open).trim();
    const close = closingBrace(branches, open);
    chosen.set(key, branches.slice(open + 1, close));
    i = close + 1;
  }
  const text = chosen.get(`=${count}`) ?? chosen.get(new Intl.PluralRules(locale).select(count)) ?? chosen.get('other');
  if (text === undefined) throw new Error(`[e2e] pluriel sans branche pour ${count}`);
  return text.replace(/#/g, String(count));
}

/** Remplace `{nom}` et les pluriels `{nom, plural, …}` d'un message, de gauche à droite. */
function format(template: string, params: Record<string, string | number>, locale: Locale): string {
  let out = '';
  let i = 0;
  while (i < template.length) {
    const open = template.indexOf('{', i);
    if (open < 0) {
      out += template.slice(i);
      break;
    }
    out += template.slice(i, open);
    const close = closingBrace(template, open);
    const inner = template.slice(open + 1, close);
    const [name, kind, ...rest] = inner.split(',');
    const key = name.trim();
    if (!(key in params)) throw new Error(`[e2e] paramètre ${key} manquant dans « ${template} »`);
    if (kind === undefined) out += String(params[key]);
    else if (kind.trim() === 'plural') out += format(pickPlural(rest.join(',').trim(), Number(params[key]), locale), params, locale);
    else throw new Error(`[e2e] format ICU non géré : ${kind.trim()}`);
    i = close + 1;
  }
  return out;
}

/**
 * Texte d'un message de l'interface, lu dans `messages/<locale>.json` (source de vérité des assertions : aucun texte
 * recopié). `{nom}` est remplacé par `params.nom`, les pluriels ICU `{n, plural, …}` sont résolus ; les autres formats
 * ICU (select, rich) ne se lisent pas ici.
 */
export function msg(locale: Locale, key: string, params: Record<string, string | number> = {}): string {
  let node: unknown = MESSAGES[locale];
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) throw new Error(`[e2e] message ${locale}:${key} introuvable`);
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== 'string') throw new Error(`[e2e] message ${locale}:${key} n'est pas un texte`);
  return format(node, params, locale);
}
