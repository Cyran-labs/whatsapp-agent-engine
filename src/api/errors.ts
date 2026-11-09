import type { ApiErrorBody, ApiErrorDetail, ErrorCode, ErrorReason } from '@wabagent/contracts';

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
  /** Clé stable du refus métier (voir `ERROR_REASONS`), absente des erreurs techniques. */
  readonly reason?: ErrorReason;

  constructor(code: ErrorCode, message: string, details?: ApiErrorDetail[], reason?: ErrorReason) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    if (details) this.details = details;
    if (reason) this.reason = reason;
  }
}

export function toErrorBody(err: AppError, requestId: string): ApiErrorBody {
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
      ...(err.reason ? { reason: err.reason } : {}),
      request_id: requestId,
    },
  };
}

export const unauthorized = (m = 'Non authentifié.', reason?: ErrorReason) => new AppError('UNAUTHORIZED', m, undefined, reason);
export const forbidden = (m = 'Accès refusé.', reason?: ErrorReason) => new AppError('FORBIDDEN', m, undefined, reason);
/** 404 d'un agent IA absent ou d'une autre organisation : même texte dans les deux cas. */
export const BOT_NOT_FOUND = 'Agent IA introuvable.';
export const notFound = (m = 'Ressource introuvable.', reason?: ErrorReason) => new AppError('NOT_FOUND', m, undefined, reason);
/** Agent IA absent ou d'une autre organisation : même texte, même clé, jamais de distinction entre les deux. */
export const botNotFound = () => notFound(BOT_NOT_FOUND, 'bot.not_found');
export const conflict = (m = 'Conflit.', reason?: ErrorReason) => new AppError('CONFLICT', m, undefined, reason);
export const rateLimited = (m = 'Trop de requêtes.') => new AppError('RATE_LIMITED', m);
export const internal = (m = 'Erreur interne.') => new AppError('INTERNAL', m);
export const validationError = (details: ApiErrorDetail[], m = 'Données invalides.', reason?: ErrorReason) =>
  new AppError('VALIDATION_ERROR', m, details, reason);
