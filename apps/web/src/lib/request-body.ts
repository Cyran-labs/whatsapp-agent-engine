import type { NextResponse } from 'next/server';
import type { z } from 'zod';
import { ERROR_REASONS, type ErrorReason } from '@wabagent/contracts';
import { jsonResponse } from './api-json';
import { zodIssueToFrench } from './zod-fr';

const INVALID = 'Données invalides.';

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
export function unreadableBodyResponse(): NextResponse {
  return validationError(INVALID, []);
}

export type ValidatedBody<S extends z.ZodTypeAny> =
  | { ok: true; data: z.infer<S>; raw: unknown }
  | { ok: false; response: NextResponse };

/**
 * Valide une valeur déjà lue avec le schéma des contrats : 400 standard sinon, avec des messages toujours en français
 * (`zodIssueToFrench`) et la clé de refus d'une règle qui en porte une. Seul constructeur des 400 de validation du BFF.
 */
export function validateBody<S extends z.ZodTypeAny>(schema: S, raw: unknown): ValidatedBody<S> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data, raw };
  const details = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: zodIssueToFrench(i) }));
  return { ok: false, response: validationError(details[0]?.message ?? INVALID, details, reasonOfIssues(parsed.error.issues)) };
}

/** Lit le corps JSON de la requête puis le valide : un corps illisible donne le 400 standard, jamais un 500. */
export async function readValidatedBody<S extends z.ZodTypeAny>(request: Request, schema: S): Promise<ValidatedBody<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: unreadableBodyResponse() };
  }
  return validateBody(schema, raw);
}
