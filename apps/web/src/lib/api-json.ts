import { NextResponse } from 'next/server';

/**
 * Toute réponse du BFF porte des données d'utilisateur ou d'organisation (ou en dépend) : jamais de cache partagé ni
 * navigateur. Les routes `src/app/api/**` ne construisent pas de réponse autrement que par ces deux fonctions
 * (contrôlé par `__tests__/api-no-store.test.ts`).
 */
export const NO_STORE = 'private, no-store';

/** Réponse JSON du BFF, avec `Cache-Control: private, no-store`. */
export function jsonResponse(body: unknown, init: { status?: number } = {}): NextResponse {
  return NextResponse.json(body, { ...(init.status !== undefined ? { status: init.status } : {}), headers: { 'Cache-Control': NO_STORE } });
}

/** Réponse sans corps (204 le plus souvent), avec `Cache-Control: private, no-store`. */
export function emptyResponse(status: number): NextResponse {
  return new NextResponse(null, { status, headers: { 'Cache-Control': NO_STORE } });
}
