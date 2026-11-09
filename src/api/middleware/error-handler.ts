import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError, toErrorBody, validationError, internal, notFound } from '../errors.js';

/**
 * Erreur de l'analyseur JSON d'Express (`body-parser`) : son objet porte le corps reçu (`body`), qui peut contenir
 * un secret, et le message de `SyntaxError` en cite un extrait. Seul son `type` est lu, jamais journalisé avec le corps.
 */
function bodyParserType(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const { type } = err as { type?: unknown };
  return typeof type === 'string' && type.length > 0 ? type : null;
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

export function notFoundHandler(req: Request, res: Response): void {
  const err = notFound('Endpoint introuvable.');
  res.status(err.status).json(toErrorBody(err, req.requestId));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let appErr: AppError;
  if (err instanceof ZodError) {
    appErr = validationError(err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
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
