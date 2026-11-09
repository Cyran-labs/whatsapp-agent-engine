import type { ErrorCode, ApiErrorDetail } from '@wabagent/contracts';

/** Codes du moteur, plus ceux que le BFF émet lui-même. */
export type BffErrorCode = ErrorCode | 'ORG_CHANGED';

export class EngineError extends Error {
  readonly name = 'EngineError';
  constructor(
    readonly code: BffErrorCode,
    message: string,
    readonly status: number,
    readonly details?: ApiErrorDetail[],
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
    const e = (body as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
    throw new EngineError(
      (e?.code as ErrorCode) ?? 'INTERNAL',
      e?.message ?? 'Erreur engine.',
      res.status,
      e?.details as ApiErrorDetail[] | undefined,
    );
  }
  return body as T;
}
