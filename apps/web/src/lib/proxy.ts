import type { NextResponse } from 'next/server';
import type { z } from 'zod';
import { engineFetch } from './engine-fetch';
import { errorResponse } from './api-response';
import { jsonResponse, emptyResponse } from './api-json';

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

function validationError(message: string, details: { path: string; message: string }[]): NextResponse {
  return jsonResponse({ error: { code: 'VALIDATION_ERROR', message, details } }, { status: 400 });
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
        return validationError(INVALID, []);
      }
    }
    if (init.schema) {
      const parsed = init.schema.safeParse(body);
      if (!parsed.success) {
        return validationError(
          parsed.error.issues[0]?.message ?? INVALID,
          parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        );
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
