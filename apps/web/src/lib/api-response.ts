import type { NextResponse } from 'next/server';
import { EngineError } from './engine-client';
import { jsonResponse } from './api-json';

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof EngineError) {
    return jsonResponse(
      { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } },
      { status: err.status },
    );
  }
  console.error('[BFF] erreur inattendue', err);
  return jsonResponse({ error: { code: 'INTERNAL', message: 'Erreur interne.' } }, { status: 500 });
}
