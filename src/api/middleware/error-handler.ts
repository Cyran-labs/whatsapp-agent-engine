import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { ERROR_REASONS, type ErrorReason } from '@wabagent/contracts';
import { AppError, toErrorBody, validationError, internal, notFound } from '../errors.js';

/**
 * Erreur de l'analyseur JSON d'Express (`body-parser`) : son objet porte le corps reçu (`body`), qui peut contenir
 * un secret, et le message de `SyntaxError` en cite un extrait. Seul son `type` est lu (liste fermée des types de `body-parser` : un `type` d'une autre bibliothèque reste une erreur inconnue, 500), jamais journalisé avec le corps.
 */
const BODY_PARSER_TYPES: readonly string[] = [
  'entity.too.large',
  'entity.parse.failed',
  'encoding.unsupported',
  'charset.unsupported',
  'request.aborted',
  'request.size.invalid',
  'stream.encoding.set',
  'stream.not.readable',
];

function bodyParserType(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const { type } = err as { type?: unknown };
  return typeof type === 'string' && BODY_PARSER_TYPES.includes(type) ? type : null;
}

/**
 * Corps trop volumineux : 400 et non 413, car `ErrorCode` des contrats n'a pas de code 413 et les clients (web compris)
 * ne distinguent que ces codes ; le message dit la cause.
 */
function bodyParserError(type: string): AppError {
  if (type === 'entity.too.large') return new AppError('VALIDATION_ERROR', 'Corps JSON trop volumineux.');
  if (type === 'entity.parse.failed') return new AppError('VALIDATION_ERROR', 'Corps JSON invalide.');
  return new AppError('VALIDATION_ERROR', 'Corps de requête illisible.');
}

/**
 * Clé de refus portée par une règle des contrats (`params.reason` d'un `refine`), seulement si elle figure dans
 * `ERROR_REASONS` : une règle de forme (Zod) qui est aussi un refus métier affiché sur un écran.
 */
function reasonOfZodError(err: ZodError): ErrorReason | undefined {
  for (const issue of err.issues) {
    if (issue.code !== 'custom') continue;
    const reason = (issue.params as { reason?: unknown } | undefined)?.reason;
    const known = ERROR_REASONS.find((r) => r === reason);
    if (known) return known;
  }
  return undefined;
}

export function notFoundHandler(req: Request, res: Response): void {
  const err = notFound('Endpoint introuvable.');
  res.status(err.status).json(toErrorBody(err, req.requestId));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let appErr: AppError;
  if (err instanceof ZodError) {
    appErr = validationError(err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })), undefined, reasonOfZodError(err));
  } else if (err instanceof AppError) {
    appErr = err;
  } else {
    const parserType = bodyParserType(err);
    if (parserType !== null) {
      console.warn(`[API] Corps de requête refusé (${parserType})`);
      appErr = bodyParserError(parserType);
    } else {
      // Nom et pile seulement, jamais l'objet entier : il peut porter un corps, des en-têtes ou des valeurs sensibles.
      const detail = err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : typeof err;
      console.error(`[API] Unhandled error: ${detail}`);
      appErr = internal();
    }
  }
  res.status(appErr.status).json(toErrorBody(appErr, req.requestId));
}
