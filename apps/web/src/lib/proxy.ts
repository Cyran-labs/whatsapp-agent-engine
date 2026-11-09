import type { NextResponse } from 'next/server';
import type { z } from 'zod';
import { ERROR_REASONS, type ErrorReason } from '@wabagent/contracts';
import { engineFetch } from './engine-fetch';
import { errorResponse } from './api-response';
import { jsonResponse, emptyResponse } from './api-json';
import { zodIssueToFrench } from './zod-fr';

export interface ProxyInit {
  method?: string;
  /** Valeur déjà lue, ou la `Request` entrante (corps lu ici : un corps non JSON donne un 400). */
  body?: unknown;
  schema?: z.ZodTypeAny;
  /** Statut renvoyé en cas de succès (200 par défaut). */
  status?: number;
}

const INVALID = 'Données invalides.';
const NUMERIC_ID = /^\d+$/;

/** Identifiant de chemin d'une route dynamique : chiffres seulement, sinon 404 sans appel moteur. */
export function rejectNonNumericId(id: string): NextResponse | null {
  if (NUMERIC_ID.test(id)) return null;
  return jsonResponse({ error: { code: 'NOT_FOUND', message: 'Ressource introuvable.' } }, { status: 404 });
}

/**
 * Clé de refus portée par une règle des contrats (`params.reason` d'un `refine`), seulement si elle figure dans
 * `ERROR_REASONS` : même lecture que le gestionnaire d'erreurs du moteur.
 */
function reasonOfIssues(issues: z.ZodIssue[]): ErrorReason | undefined {
  for (const issue of issues) {
    if (issue.code !== 'custom') continue;
    const reason = (issue.params as { reason?: unknown } | undefined)?.reason;
    const known = ERROR_REASONS.find((r) => r === reason);
    if (known) return known;
  }
  return undefined;
}

function validationError(message: string, details: { path: string; message: string }[], reason?: ErrorReason): NextResponse {
  return jsonResponse(
    { error: { code: 'VALIDATION_ERROR', message, details, ...(reason ? { reason } : {}) } },
    { status: 400 },
  );
}

/** Corps de requête illisible (pas du JSON) : 400 standard, jamais 500, le moteur n'est pas appelé. */
function unreadableBodyResponse(): NextResponse {
  return validationError(INVALID, []);
}

/**
 * Relais BFF vers le moteur : valide le corps avec `schema` (400 standard sinon),
 * appelle `engineFetch`, renvoie le JSON du moteur (ou 204 si réponse vide).
 */
export async function proxyEngine(enginePath: string, init: ProxyInit = {}): Promise<NextResponse> {
  try {
    const method = init.method ?? 'GET';
    let body: unknown = init.body;
    if (body instanceof Request) {
      try {
        body = await body.json();
      } catch {
        return unreadableBodyResponse();
      }
    }
    if (init.schema) {
      const parsed = init.schema.safeParse(body);
      if (!parsed.success) {
        const details = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: zodIssueToFrench(i) }));
        return validationError(details[0]?.message ?? INVALID, details, reasonOfIssues(parsed.error.issues));
      }
      body = parsed.data;
    }
    const result = await engineFetch<unknown>(enginePath, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (result === undefined) return emptyResponse(204);
    return jsonResponse(result, { status: init.status ?? 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
