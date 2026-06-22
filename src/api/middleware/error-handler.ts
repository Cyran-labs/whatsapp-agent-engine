import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError, toErrorBody, validationError, internal, notFound } from '../errors.js';

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
    console.error('[API] Unhandled error:', err);
    appErr = internal();
  }
  res.status(appErr.status).json(toErrorBody(appErr, req.requestId));
}
