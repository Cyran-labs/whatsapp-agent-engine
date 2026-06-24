import { NextResponse } from 'next/server';
import { EngineError } from './engine-client';

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof EngineError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } },
      { status: err.status },
    );
  }
  return NextResponse.json({ error: { code: 'INTERNAL', message: 'Erreur interne.' } }, { status: 500 });
}
