import type { ApiErrorBody, ApiErrorDetail, ErrorCode } from '../contracts/errors.js';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  WA_VALIDATION_FAILED: 422,
  CRM_VALIDATION_FAILED: 422,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: ApiErrorDetail[];

  constructor(code: ErrorCode, message: string, details?: ApiErrorDetail[]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    if (details) this.details = details;
  }
}

export function toErrorBody(err: AppError, requestId: string): ApiErrorBody {
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
      request_id: requestId,
    },
  };
}

export const unauthorized = (m = 'Non authentifié.') => new AppError('UNAUTHORIZED', m);
export const forbidden = (m = 'Accès refusé.') => new AppError('FORBIDDEN', m);
export const notFound = (m = 'Ressource introuvable.') => new AppError('NOT_FOUND', m);
export const conflict = (m = 'Conflit.') => new AppError('CONFLICT', m);
export const rateLimited = (m = 'Trop de requêtes.') => new AppError('RATE_LIMITED', m);
export const internal = (m = 'Erreur interne.') => new AppError('INTERNAL', m);
export const validationError = (details: ApiErrorDetail[], m = 'Données invalides.') =>
  new AppError('VALIDATION_ERROR', m, details);
