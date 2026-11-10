import { ERROR_REASONS, type ErrorCode, type ErrorReason, type ApiErrorDetail } from '@wabagent/contracts';

/** Codes du moteur, plus ceux que le BFF émet lui-même. */
export type BffErrorCode = ErrorCode | 'ORG_CHANGED';

/** Repli quand le moteur répond une erreur sans corps JSON exploitable. */
const UNREADABLE_ENGINE_BODY = 'Le moteur a renvoyé une réponse illisible.';

export class EngineError extends Error {
  readonly name = 'EngineError';
  constructor(
    readonly code: BffErrorCode,
    message: string,
    readonly status: number,
    readonly details?: ApiErrorDetail[],
    /** Clé stable du refus métier envoyée par le moteur (`error.reason`), seulement si le contrat la connaît. */
    readonly reason?: ErrorReason,
    /** Référence de la requête côté moteur (`error.request_id`), à citer au support. */
    readonly requestId?: string,
  ) {
    super(message);
  }
}

function baseUrl(): string {
  const url = process.env.ENGINE_API_URL;
  if (!url) throw new Error('[BFF] ENGINE_API_URL manquant');
  return url.replace(/\/$/, '');
}

export async function engineCall<T>(path: string, init?: RequestInit): Promise<T> {
  // Réponses authentifiées (jeton, organisation) : jamais relues d'un cache de données de Next (`no-store` en dernier,
  // pour qu'aucun appelant ne puisse le remplacer).
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const e = (body as { error?: { code?: string; message?: string; details?: unknown; reason?: unknown; request_id?: unknown } } | undefined)?.error;
    throw new EngineError(
      (e?.code as ErrorCode) ?? 'INTERNAL',
      e?.message ?? UNREADABLE_ENGINE_BODY,
      res.status,
      e?.details as ApiErrorDetail[] | undefined,
      ERROR_REASONS.find((r) => r === e?.reason),
      typeof e?.request_id === 'string' ? e.request_id : undefined,
    );
  }
  return body as T;
}
