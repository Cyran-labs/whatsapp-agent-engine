import type { ErrorCode, ApiErrorDetail } from '@wabagent/contracts';

export class EngineError extends Error {
  readonly name = 'EngineError';
  constructor(
    readonly code: ErrorCode,
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
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const e = body?.error;
    throw new EngineError(
      (e?.code as ErrorCode) ?? 'INTERNAL',
      e?.message ?? 'Erreur engine.',
      res.status,
      e?.details,
    );
  }
  return body as T;
}
